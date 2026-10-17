import { hashedPatternKey, persistedStayKey, recordLearnedName } from "./name-patterns";
import { nameBand, type NameBand } from "@dayframe/shared";
import {
  LocationReviewActionSchema,
  stableLocationId,
  stayPatternKey,
  type LocationReviewAction,
  type ReviewEntryEdit
} from "@dayframe/shared";
import type pg from "pg";
import {
  isLockNotAvailableError,
  isStatementTimeoutError
} from "../db";
import { withSyncTransaction, setSyncPhase, syncFailureMetadata, SyncOperationError, type SyncTransactionOptions } from "../sync-transaction";
import { insertPlaceWith, ReviewResolutionError } from "../event-service";
import { placeDisplayNameSql } from "../place-display";
import type { RequestSession } from "../session";
import { syncTimeEntryTags } from "../tag-service";
import {
  REVIEW_DECISION_PAYLOAD_KEY,
  REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY,
  isOwnerAuthoredReviewDescription,
  reviewSuggestedTitles,
  type ReviewDecisionPayload
} from "../review-decision-signal";
import { ensureCommuteCategoryId } from "../automatic-category-service";
import { reviewProposalHash } from "../review-proposal-hash";
import { SUPERSEDED_REVIEW_SCOPE } from "./location-review-supersession";

type LockedReview = {
  id: string;
  eventId: string;
  status: string;
  ignoredScope: string | null;
  title: string;
  confidence: string;
  suggestedCategoryId: string | null;
  suggestedPlaceId: string | null;
  suggestedStartedAt: Date | string;
  suggestedStoppedAt: Date | string;
  segmentId: string;
  segmentKind: "stay" | "commute";
  /** A commute row holding time away from a place (never a journey). */
  timeAway: boolean;
  segmentStatus: string;
  deviceId: string | null;
  algorithmVersion: string | null;
  learnedPlaceId: string | null;
  placeMatchKind: string | null;
  centreLatitude: number | null;
  centreLongitude: number | null;
  eventSource: string | null;
  eventType: string | null;
  semanticRevision: Date | string | null;
  /**
   * Every title Dayframe ever suggested for this item: its event's recorded history (replay
   * retitles included) plus its current title, or for a correction part the history carried from
   * the items it came from. A description equal to one of them is not the owner's.
   */
  suggestedTitles: string[];
  /** Its learned-name pattern (PRD D19, A8), when the emitter keyed it; and whether its title is a learned name. */
  namePatternKey: string | null;
  namePatternBand: string | null;
  learnedName: boolean;
  /** Its suggested activity is one the person chose for this pattern before. */
  learnedActivity: boolean;
  /** A merge's learned names and activities, from both cards it joined (Codex r3 on #458). */
  learnedTitles?: string[];
  learnedCategoryIds?: string[];
};

type LockedReviewRow = Omit<LockedReview, "suggestedTitles"> & { reviewSuggestedTitles: unknown; correctionEvent: boolean };

type ConfirmedPlaceIdentity = {
  placeId: string | null;
  placeLabel: string | null;
  /** The place this decision corrected a Stay to, which its learned-name pattern follows. */
  patternPlace?: PatternPlace;
};

type PatternPlace = { placeId: string | null; learnedPlaceId: string | null };

export const LOCATION_REVIEW_STATEMENT_TIMEOUT_MS = 8_000;
export const LOCATION_REVIEW_LOCK_TIMEOUT_MS = 1_500;

/**
 * Whether a Review item is a location Stay's or Move's, whose plain "accept" (older clients) is a
 * Confirm, so it keeps the same name and learning semantics (Codex r2 on #458).
 */
export async function isLocationSegmentReview(reviewItemId: string, session: RequestSession, options: SyncTransactionOptions = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewItemId)) return false;
  // Within the request's own budget (Codex r3 on #458).
  return withSyncTransaction("location_review_classify", async ({ client }) => {
    const result = await client.query<{ located: boolean }>(
      `select location_segment_id is not null as located
       from review_items where id = $1 and workspace_id = $2 and user_id = $3`,
      [reviewItemId, session.workspaceId, session.userId]);
    return Boolean(result.rows[0]?.located);
  }, { ...options, readOnly: true });
}

export async function resolveLocationReviewAction(
  reviewItemId: string,
  input: unknown,
  session: RequestSession,
  options: SyncTransactionOptions = {}
) {
  const startedAt = Date.now();
  const action = LocationReviewActionSchema.parse(input);
  let lockOutcome: "not_attempted" | "acquired" | "contended" = "not_attempted";
  try {
    const result = await withSyncTransaction("location_review", async ({client, phase}) => {
    phase("owner_lock");
    const lock = await client.query<{ acquired: boolean }>(
      `select pg_try_advisory_xact_lock(
         hashtext($1),
         hashtext($2)
       ) as acquired`,
      [session.workspaceId, session.userId]
    );
    if (!lock.rows[0]?.acquired) {
      lockOutcome = "contended";
      throw locationReviewLocked(reviewItemId);
    }
    lockOutcome = "acquired";
    phase("effect");
    const result = await resolveLocationReviewActionWithClient(
      client,
      reviewItemId,
      action,
      session
    );
    return result;
    }, options);
    logDirectLocationMutation({
      actionKind: action.action,
      durationMs: Date.now() - startedAt,
      lockOutcome,
      outcome: locationMutationOutcome(result)
    });
    return result;
  } catch (error) {
    if (isLockNotAvailableError(error)) {
      const lockedError = locationReviewLocked(reviewItemId);
      logDirectLocationMutation({
        actionKind: action.action,
        durationMs: Date.now() - startedAt,
        lockOutcome: isLockNotAvailableError(error) ? "contended" : lockOutcome,
        outcome: lockedError.code
      });
      throw lockedError;
    }
    if (isStatementTimeoutError(error) || error instanceof SyncOperationError) {
      const failure = syncFailureMetadata(error);
      throw new ReviewResolutionError(failure.reason === "operation_timeout" ? "review_query_timeout" :
        failure.reason === "query_cancelled" ? "review_query_cancelled" : "review_service_unavailable",
        "Location Review could not finish. Reconcile your saved action.", {
          status: 503, details: { canonicalStatus: "unknown", ...failure, retryAfterMs: 5_000 }
        });
    }
    logDirectLocationMutation({
      actionKind: action.action,
      durationMs: Date.now() - startedAt,
      lockOutcome,
      outcome: locationMutationErrorOutcome(error)
    });
    throw error;
  }
}

function logDirectLocationMutation(input: {
  actionKind: string;
  durationMs: number;
  lockOutcome: "not_attempted" | "acquired" | "contended";
  outcome: string;
}) {
  if (
    input.durationMs < 750 &&
    input.lockOutcome !== "contended" &&
    ["accepted", "ignored", "completed", "open"].includes(input.outcome)
  ) {
    return;
  }
  console.info("Dayframe direct Location Review mutation timing", input);
}

function locationMutationOutcome(result: unknown) {
  if (!result || typeof result !== "object") return "completed";
  const status = "status" in result ? result.status : null;
  return typeof status === "string" ? status : "completed";
}

function locationMutationErrorOutcome(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "unknown_error";
}

export async function resolveLocationReviewActionWithClient(
  client: pg.PoolClient,
  reviewItemId: string,
  input: unknown,
  session: RequestSession,
  options: { expectedProposalHash?: string } = {}
) {
  const action = LocationReviewActionSchema.parse(input);
  setSyncPhase(client, "review_lock");
  const lockedItems = action.action === "merge" || action.action === "merge_and_confirm"
    ? await lockLocationReviews(
        client,
        [reviewItemId, action.adjacentReviewItemId],
        session
      )
    : [await lockLocationReview(client, reviewItemId, session)];
  setSyncPhase(client, "effect");
  const item = lockedItems.find((candidate) => candidate.id === reviewItemId);
  if (!item) {
    throw new ReviewResolutionError(
      "review_item_not_found",
      "Location review item not found.",
      { status: 404 }
    );
  }
  if (item.status === "open" && options.expectedProposalHash) {
    assertExpectedLocationProposal(item, options.expectedProposalHash);
  }
  if (item.status !== "open") {
    return resolveClosedLocationReview(client, item, action, session);
  }
  const segmentItems = action.action === "merge" || action.action === "merge_and_confirm"
    ? lockedItems
    : [item];
  await lockLocationSegments(client, segmentItems, session);
  return performAction(client, item, action, session);
}

async function lockLocationReview(client: pg.PoolClient, id: string, session: RequestSession) {
  const items = await lockLocationReviews(client, [id], session);
  const item = items[0];
  if (!item) {
    throw new ReviewResolutionError("review_item_not_found", "Location review item not found.", { status: 404 });
  }
  return item;
}

async function lockLocationReviews(
  client: pg.PoolClient,
  ids: string[],
  session: RequestSession
) {
  const uniqueIds = [...new Set(ids)].sort();
  const result = await client.query<LockedReviewRow>(
    `select ri.id,
            ri.event_id as "eventId",
            ri.status,
            ri.ignored_scope as "ignoredScope",
            ri.title,
            ri.confidence,
            ri.suggested_category_id as "suggestedCategoryId",
            ri.suggested_place_id as "suggestedPlaceId",
            ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            ri.location_segment_id as "segmentId",
            case when st.id is not null then 'stay' else 'commute' end as "segmentKind",
            coalesce(cs.metadata ->> 'qualificationReason' = 'same_place_outing', false) as "timeAway",
            coalesce(st.status, cs.status) as "segmentStatus",
            coalesce(st.device_id, cs.device_id) as "deviceId",
            coalesce(st.algorithm_version, cs.algorithm_version) as "algorithmVersion",
            st.learned_place_id as "learnedPlaceId",
            st.metadata ->> 'placeMatchKind' as "placeMatchKind",
            case when st.centre is null then null else ST_Y(st.centre::geometry) end as "centreLatitude",
            case when st.centre is null then null else ST_X(st.centre::geometry) end as "centreLongitude",
            ae.source as "eventSource",
            ae.event_type as "eventType",
            ae.raw_payload -> '${REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY}' as "reviewSuggestedTitles",
            ae.raw_payload ->> 'namePatternKey' as "namePatternKey",
            ae.raw_payload ->> 'namePatternBand' as "namePatternBand",
            coalesce(ae.raw_payload ->> 'nameSource' = 'learned', false) as "learnedName",
            coalesce(ae.raw_payload ->> 'activitySource' = 'learned', false) as "learnedActivity",
            coalesce(ae.client_event_id like 'location-correction:%', false) as "correctionEvent",
            coalesce(st.updated_at, cs.updated_at, ri.resolved_at, ri.created_at) as "semanticRevision"
     from review_items ri
     join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     left join stay_segments st
       on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     left join commute_segments cs
       on cs.id = ri.location_segment_id and cs.workspace_id = ri.workspace_id and cs.user_id = ri.user_id
     where ri.id = any($1::uuid[]) and ri.workspace_id = $2 and ri.user_id = $3
       and ri.location_segment_id is not null and (st.id is not null or cs.id is not null)
     order by ri.id
     for update of ri, ae nowait`,
    [uniqueIds, session.workspaceId, session.userId]
  );
  if (result.rows.length !== uniqueIds.length) {
    throw new ReviewResolutionError("review_item_not_found", "Location review item not found.", { status: 404 });
  }
  return result.rows.map(({ reviewSuggestedTitles: payloadTitles, correctionEvent, ...row }) => ({
    ...row,
    suggestedTitles: reviewSuggestedTitles(payloadTitles, row.title, { correction: correctionEvent })
  }));
}

async function lockLocationSegments(
  client: pg.PoolClient,
  items: LockedReview[],
  session: RequestSession
) {
  for (const segmentKind of ["stay", "commute"] as const) {
    const ids = items
      .filter((item) => item.segmentKind === segmentKind)
      .map((item) => item.segmentId)
      .filter((id, index, all) => all.indexOf(id) === index)
      .sort();
    if (ids.length === 0) continue;
    const result = await client.query<{ id: string }>(
      `select id
       from ${segmentKind === "stay" ? "stay_segments" : "commute_segments"}
       where id = any($1::uuid[])
         and workspace_id = $2
         and user_id = $3
       order by id
       for update nowait`,
      [ids, session.workspaceId, session.userId]
    );
    if (result.rows.length !== ids.length) {
      throw new ReviewResolutionError(
        "review_item_not_found",
        "Location segment was not found.",
        { status: 404 }
      );
    }
  }
}

function locationReviewLocked(reviewItemId: string) {
  return new ReviewResolutionError(
    "review_item_locked",
    "This location review is already being updated. Try again in a moment.",
    {
      status: 409,
      details: {
        reviewItemId,
        canonicalStatus: "unknown", reason: "lock_unavailable", retryAfterMs: 5_000
      }
    }
  );
}

function assertExpectedLocationProposal(item: LockedReview, expectedProposalHash: string) {
  const actual = reviewProposalHash({
    reviewItemId: item.id,
    eventId: item.eventId,
    locationSegmentId: item.segmentId,
    sourceKind: "location_v2",
    title: item.title,
    categoryId: item.suggestedCategoryId,
    placeId: item.suggestedPlaceId,
    startedAt: item.suggestedStartedAt,
    stoppedAt: item.suggestedStoppedAt,
    confidence: item.confidence,
    eventSource: item.eventSource,
    eventType: item.eventType,
    semanticRevision: item.semanticRevision
  });
  if (actual === expectedProposalHash) return;
  throw new ReviewResolutionError(
    "proposal_changed",
    "This Review proposal changed before it could be confirmed. Refresh it before trying again.",
    {
      status: 409,
      details: {
        reviewItemId: item.id,
        canonicalStatus: "open",
        canonicalReviewStatuses: { [item.id]: "open" },
        proposalHash: actual
      }
    }
  );
}

async function resolveClosedLocationReview(
  client: pg.PoolClient,
  item: LockedReview,
  action: LocationReviewAction,
  session: RequestSession
) {
  // An Ignore queued before replay retired this proposal is still the user's
  // decision. Record it as theirs, so the proposal is never reopened if its
  // segment returns, before acknowledging it as already resolved.
  if (action.action === "ignore_once_location" && item.status === "ignored" && item.ignoredScope === SUPERSEDED_REVIEW_SCOPE) {
    await client.query(
      `update review_items set ignored_scope = 'once', resolved_at = now()
       where id = $1 and workspace_id = $2 and user_id = $3 and ignored_scope = $4`,
      [item.id, session.workspaceId, session.userId, SUPERSEDED_REVIEW_SCOPE]
    );
    await auditCorrection(client, session, "ignore_once", item.segmentId, {});
  }
  const equivalent =
    (action.action === "ignore_once_location" && item.status === "ignored") ||
    (
      action.action === "confirm" &&
      item.status === "accepted" &&
      await locationEditMatchesExisting(client, item, {}, session)
    ) ||
    (
      action.action === "edit_and_confirm" &&
      item.status === "accepted" &&
      await locationEditMatchesExisting(client, item, action.edit, session)
    ) ||
    (
      action.action === "record_poi_once" &&
      item.status === "accepted" &&
      await locationEditMatchesExisting(
        client,
        item,
        action.edit ?? {},
        session,
        { placeId: null, placeLabel: action.name.trim() }
      )
    );
  if (equivalent) {
    return {
      ok: true,
      action: action.action,
      status: item.status,
      alreadyResolved: true,
      equivalent: true
    };
  }
  throw new ReviewResolutionError(
    "resolution_conflict",
    "This Review item was resolved differently on another device.",
    {
      status: 409,
      details: {
        canonicalStatus: item.status,
        requestedAction: action.action,
        reviewItemId: item.id
      }
    }
  );
}

async function locationEditMatchesExisting(
  client: pg.PoolClient,
  item: LockedReview,
  edit: ReviewEntryEdit,
  session: RequestSession,
  placeIdentity?: ConfirmedPlaceIdentity
) {
  const result = await client.query<{
    id: string;
    categoryId: string | null;
    placeId: string | null;
    placeLabel: string | null;
    description: string | null;
    startedAt: Date | string;
    stoppedAt: Date | string;
  }>(
    `select id,
            category_id as "categoryId",
            place_id as "placeId",
            place_label as "placeLabel",
            description,
            started_at as "startedAt",
            stopped_at as "stoppedAt"
     from time_entries
     where workspace_id = $1 and user_id = $2 and created_from_event_id = $3
     limit 1`,
    [session.workspaceId, session.userId, item.eventId]
  );
  const entry = result.rows[0];
  if (!entry) return false;
  const expectedCategory = await confirmedLocationCategoryId(
    client,
    session,
    entryKind(item),
    item.suggestedCategoryId,
    edit
  );
  const expectedPlace = placeIdentity
    ? placeIdentity.placeId
    : Object.prototype.hasOwnProperty.call(edit, "placeId")
      ? edit.placeId ?? null
      : item.suggestedPlaceId;
  const expectedPlaceLabel = placeIdentity ? placeIdentity.placeLabel : null;
  if (
    entry.categoryId !== expectedCategory ||
    entry.placeId !== expectedPlace ||
    entry.placeLabel !== expectedPlaceLabel ||
    (entry.description ?? "") !== (confirmedLocationDescription(entryKind(item), item.title, edit, item.suggestedTitles, item.learnedName ? item.title : null) ?? "") ||
    new Date(entry.startedAt).toISOString() !== new Date(edit.startedAt ?? item.suggestedStartedAt).toISOString() ||
    new Date(entry.stoppedAt).toISOString() !== new Date(edit.stoppedAt ?? item.suggestedStoppedAt).toISOString()
  ) {
    return false;
  }
  const tags = await client.query<{ name: string }>(
    `select tag.name
     from time_entry_tags link
     join tags tag on tag.id = link.tag_id and tag.workspace_id = link.workspace_id
     where link.workspace_id = $1 and link.time_entry_id = $2
     order by tag.normalized_name`,
    [session.workspaceId, entry.id]
  );
  const actualTags = normalisedTags(tags.rows.map((tag) => tag.name));
  const expectedTags = normalisedTags(edit.tags ?? []);
  return actualTags.length === expectedTags.length &&
    actualTags.every((tag, index) => tag === expectedTags[index]);
}

function normalisedTags(tags: string[]) {
  return tags.map((tag) => tag.trim().toLowerCase()).sort();
}

async function performAction(
  client: pg.PoolClient,
  item: LockedReview,
  action: LocationReviewAction,
  session: RequestSession
) {
  switch (action.action) {
    case "confirm":
      return confirmReview(client, item, undefined, session, "confirm");
    case "ignore_once_location":
      return ignoreLocationReview(client, item, session);
    case "change_place":
    case "change_place_and_confirm":
      return changePlace(client, item, action, session);
    case "edit_and_confirm":
      return confirmReview(client, item, action.edit, session, "edit_and_confirm");
    case "record_once":
      return confirmReview(client, item, action.edit, session, "record_once");
    case "record_poi_once":
      if (item.segmentKind !== "stay") {
        throw new ReviewResolutionError("invalid_action", "Only a visit can use a one-time place.", { status: 422 });
      }
      return confirmReview(
        client,
        item,
        action.edit,
        session,
        "record_poi_once",
        { placeId: null, placeLabel: action.name.trim() }
      );
    case "save_place_and_confirm":
      return savePlaceAndConfirm(client, item, action, session);
    case "save_place":
      return savePlace(client, item, action, session);
    case "split":
    case "split_and_confirm":
      return splitReview(client, item, action, session);
    case "merge":
    case "merge_and_confirm":
      return mergeReviews(client, item, action, session);
    default:
      throw new ReviewResolutionError("invalid_action", "Use the standard review action for this operation.", { status: 400 });
  }
}

async function ignoreLocationReview(
  client: pg.PoolClient,
  item: LockedReview,
  session: RequestSession
) {
  await resolveReviewAndEvent(client, item, session, "ignored");
  await client.query(
    `update ${item.segmentKind === "stay" ? "stay_segments" : "commute_segments"}
     set status = 'ignored', continuity_status = 'manual', updated_at = now()
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [item.segmentId, session.workspaceId, session.userId]
  );
  await auditCorrection(client, session, "ignore_once", item.segmentId, {});
  return { ok: true, action: "ignore_once_location" as const, status: "ignored" as const };
}

async function confirmReview(
  client: pg.PoolClient,
  item: LockedReview,
  edit: ReviewEntryEdit | undefined,
  session: RequestSession,
  action: string,
  placeIdentity?: ConfirmedPlaceIdentity
) {
  const window = editedWindow(item, edit);
  const categoryId = await confirmedLocationCategoryId(
    client,
    session,
    entryKind(item),
    item.suggestedCategoryId,
    edit
  );
  const placeId = placeIdentity
    ? placeIdentity.placeId
    : Object.prototype.hasOwnProperty.call(edit ?? {}, "placeId")
      ? edit?.placeId ?? null
      : item.suggestedPlaceId;
  const placeLabel = placeIdentity?.placeLabel ?? null;
  await validateReferences(client, session, categoryId, placeId);
  const description = confirmedLocationDescription(entryKind(item), item.title, edit, item.suggestedTitles, item.learnedName ? item.title : null);
  const entry = await client.query<{ id: string }>(
    `insert into time_entries (
       workspace_id, user_id, category_id, place_id, place_label, source, confidence, review_status,
       description, started_at, stopped_at, created_from_event_id
     ) values ($1, $2, $3, $4, $5, 'location_learning', $6, 'confirmed', $7, $8, $9, $10)
     on conflict do nothing
     returning id`,
    [
      session.workspaceId,
      session.userId,
      categoryId,
      placeId,
      placeLabel,
      item.confidence,
      description,
      window.startedAt,
      window.stoppedAt,
      item.eventId
    ]
  );
  let entryId = entry.rows[0]?.id;
  // Recent (E1) learns only words the owner typed in this decision, recorded on the block's event.
  if (entryId && isOwnerAuthoredReviewDescription(description, item.suggestedTitles)) {
    await recordOwnerAuthoredDescription(client, session, item.eventId);
  }
  if (entryId) {
    await learnFromDecision(client, session, item, item.eventId,
      await resultPattern(client, session, item, { segmentId: item.segmentId, startedAt: window.startedAt, stoppedAt: window.stoppedAt,
        place: placeIdentity ? placeIdentity.patternPlace : editedPatternPlace(item, edit) }),
      { description, categoryId, edit });
  }
  if (!entryId) {
    const existing = await client.query<{ id: string }>(
      `select id from time_entries
       where workspace_id = $1 and user_id = $2 and created_from_event_id = $3 limit 1`,
      [session.workspaceId, session.userId, item.eventId]
    );
    entryId = existing.rows[0]?.id;
  }
  if (!entryId) {
    throw new ReviewResolutionError("database_constraint", "Unable to create the confirmed location block.", { status: 409 });
  }
  await syncTimeEntryTags(client, entryId, edit?.tags ?? [], session);
  await resolveReviewAndEvent(client, item, session, "accepted");
  await client.query(
    `update ${item.segmentKind === "stay" ? "stay_segments" : "commute_segments"}
     set status = 'finalised', continuity_status = 'manual', updated_at = now()
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [item.segmentId, session.workspaceId, session.userId]
  );
  await auditCorrection(client, session, action, item.segmentId, { entryId });
  return { ok: true, action, status: "accepted", entryId };
}

/** What a confirmed Review becomes: a stay, a journey, or time away from a place. */
type LocationEntryKind = LockedReview["segmentKind"] | "time_away";
function entryKind(item: Pick<LockedReview, "segmentKind" | "timeAway">): LocationEntryKind {
  return item.segmentKind === "commute" && item.timeAway ? "time_away" : item.segmentKind;
}

export function confirmedLocationDescription(
  segmentKind: LocationEntryKind,
  title: string,
  edit: ReviewEntryEdit | undefined,
  suggestedTitles: readonly string[] = [],
  /** The card's title when it is a name the person gave this pattern before (PRD D19, A8). */
  learnedTitle: string | null = null
) {
  // A Move (a journey, or time away from a place: a round-trip Move under PRD D19) keeps no
  // description of its own: its block shows its activity, and only words the person typed stay. An
  // editor that sent a title Dayframe suggested back unchanged ("Trip", "Time away from Home", from
  // an older app's prefill) did not type it (Codex r1 on #456). A learned name is the person's own
  // words from before, so accepting it keeps it.
  if (segmentKind === "commute" || segmentKind === "time_away") {
    const typed = edit?.description?.trim() || null;
    // Typed in a current app's editor (it starts a Move empty): the person's words, whatever they say
    // (Codex r2 on #456). Without the marker, equal to a Dayframe title is an older app's prefill.
    if (typed && edit?.descriptionTyped === true) return typed;
    if (typed && isOwnerAuthoredReviewDescription(typed, [title, ...suggestedTitles])) return typed;
    if (learnedTitle && (!typed || !isOwnerAuthoredReviewDescription(typed, [learnedTitle]))) return learnedTitle;
    return null;
  }
  return edit?.description?.trim() || title;
}

export async function confirmedLocationCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  segmentKind: LocationEntryKind,
  suggestedCategoryId: string | null,
  edit: ReviewEntryEdit | undefined
) {
  if (edit && Object.prototype.hasOwnProperty.call(edit, "categoryId")) {
    return edit.categoryId ?? null;
  }
  if (suggestedCategoryId) return suggestedCategoryId;
  if (segmentKind === "commute") return ensureCommuteCategoryId(client, session);
  return null;
}

async function changePlace(
  client: pg.PoolClient,
  item: LockedReview,
  action: Extract<LocationReviewAction, { action: "change_place" | "change_place_and_confirm" }>,
  session: RequestSession
) {
  if (action.placeId && action.learnedPlaceId) {
    throw new ReviewResolutionError("invalid_action", "Choose either a saved place or a learned place.", { status: 422 });
  }
  if (action.placeId) await validateReferences(client, session, undefined, action.placeId);
  if (action.learnedPlaceId) {
    const learned = await client.query(
      `select 1 from learned_places where id = $1 and workspace_id = $2 and user_id = $3 and status = 'accepted'`,
      [action.learnedPlaceId, session.workspaceId, session.userId]
    );
    if (!learned.rows[0]) throw new ReviewResolutionError("invalid_action", "Learned place was not found.", { status: 422 });
  }
  await client.query(
    `update review_items set suggested_place_id = $1
     where id = $2 and workspace_id = $3 and user_id = $4`,
    [action.placeId, item.id, session.workspaceId, session.userId]
  );
  if (item.segmentKind === "stay") {
    await client.query(
      `update stay_segments
       set place_id = $1, learned_place_id = $2,
           continuity_status = 'manual', metadata = metadata || $3::jsonb, updated_at = now()
       where id = $4 and workspace_id = $5 and user_id = $6`,
      [
        action.placeId,
        action.learnedPlaceId ?? null,
        JSON.stringify({ placeMatchKind: action.placeId ? "saved" : action.learnedPlaceId ? "learned" : "unknown" }),
        item.segmentId,
        session.workspaceId,
        session.userId
      ]
    );
    if (action.placeId && item.centreLatitude != null && item.centreLongitude != null) {
      await client.query(
        `insert into place_match_feedback (
           workspace_id, user_id, place_id, anchor, radius_m, correction_count, status
         ) values ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 60, 1, 'active')`,
        [session.workspaceId, session.userId, action.placeId, item.centreLongitude, item.centreLatitude]
      );
    }
  }
  await auditCorrection(client, session, "change_place", item.segmentId, {
    correctedToSavedPlace: Boolean(action.placeId),
    correctedToLearnedPlace: Boolean(action.learnedPlaceId)
  });
  const patternPlace = { placeId: action.placeId ?? null, learnedPlaceId: action.learnedPlaceId ?? null };
  if (action.action === "change_place_and_confirm") {
    return confirmReview(
      client,
      { ...item, suggestedPlaceId: action.placeId },
      action.edit,
      session,
      action.action,
      { placeId: action.placeId, placeLabel: null, patternPlace }
    );
  }
  // A Stay corrected to another place teaches that place's pattern when it is confirmed later (Codex
  // r2 on #458).
  await persistPattern(client, session, item, item.eventId,
    await resultPattern(client, session, item, { segmentId: item.segmentId, startedAt: new Date(item.suggestedStartedAt).toISOString(),
      stoppedAt: new Date(item.suggestedStoppedAt).toISOString(), place: patternPlace }));
  return { ok: true, action: action.action, status: "open" };
}

async function savePlaceAndConfirm(
  client: pg.PoolClient,
  item: LockedReview,
  action: Extract<LocationReviewAction, { action: "save_place_and_confirm" }>,
  session: RequestSession
) {
  if (item.segmentKind !== "stay") {
    throw new ReviewResolutionError("invalid_action", "Only a visit can be saved as a place.", { status: 422 });
  }
  // The place logs as this visit's activity and keeps the box's switches (PRD D19, Codex r1 on #459).
  const defaultCategoryId = action.edit && Object.prototype.hasOwnProperty.call(action.edit, "categoryId")
    ? action.edit.categoryId ?? null : item.suggestedCategoryId;
  await validateReferences(client, session, defaultCategoryId, null);
  const suggestVisits = action.suggestVisits ?? true;
  const created = await insertPlaceWith(client, {
    name: action.name, latitude: action.latitude, longitude: action.longitude, radiusMeters: action.radiusMeters, priority: 5,
    defaultCategoryId, loggingEnabled: suggestVisits, autoLog: suggestVisits && (action.autoLog ?? false)
  }, session);
  const place = { rows: [{ id: created.id }] };
  await client.query(
    `update stay_segments set place_id = $1, learned_place_id = null,
       continuity_status = 'manual', metadata = metadata || '{"placeMatchKind":"saved"}'::jsonb,
       updated_at = now()
     where id = $2 and workspace_id = $3 and user_id = $4`,
    [place.rows[0].id, item.segmentId, session.workspaceId, session.userId]
  );
  await client.query(
    `insert into place_match_feedback (
       workspace_id, user_id, place_id, anchor, radius_m, correction_count, status
     ) values ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, 1, 'active')`,
    [session.workspaceId, session.userId, place.rows[0].id, action.longitude, action.latitude, Math.min(160, action.radiusMeters)]
  );
  return confirmReview(
    client,
    item,
    action.edit,
    session,
    "save_place_and_confirm",
    { placeId: place.rows[0].id, placeLabel: null, patternPlace: { placeId: place.rows[0].id, learnedPlaceId: null } }
  );
}

/** How far back "Save this place" re-matches other open unsaved Stays (design §7). */
export const SAVE_PLACE_REMATCH_DAYS = 7;

/**
 * "Save this place" (PRD D19, design §7): a place centred on where the Stay was, with the size the
 * person chose, its "Logs as" activity as the place's default, applied to this visit without logging
 * it; then every other open unsaved Stay card of the last seven days whose centre lies inside the new
 * circle takes it too. Each corrected Stay is the person's (`manual`), as with Change place, so replay
 * keeps it. Under the owner lock; other cards a different writer holds are left for replay to match.
 */
async function savePlace(
  client: pg.PoolClient,
  item: LockedReview,
  action: Extract<LocationReviewAction, { action: "save_place" }>,
  session: RequestSession
) {
  if (item.segmentKind !== "stay") {
    throw new ReviewResolutionError("invalid_action", "Only a visit can be saved as a place.", { status: 422 });
  }
  if (item.suggestedPlaceId) {
    throw new ReviewResolutionError("invalid_action", "This visit already has a saved place.", { status: 422 });
  }
  if (item.centreLatitude == null || item.centreLongitude == null) {
    throw new ReviewResolutionError("invalid_action", "This visit has no location to save.", { status: 422 });
  }
  // An omitted activity is the visit's own; an explicit null clears it (Codex r1 on #459).
  const categoryId = action.categoryId === undefined ? item.suggestedCategoryId : action.categoryId;
  await validateReferences(client, session, categoryId, null);
  const place = await insertPlaceWith(client, {
    name: action.name, latitude: item.centreLatitude, longitude: item.centreLongitude, radiusMeters: action.radiusMeters,
    defaultCategoryId: categoryId, loggingEnabled: action.suggestVisits, autoLog: action.suggestVisits && action.autoLog
  }, session);
  // Other open unsaved Stays there, newest first; a card another writer holds is skipped.
  const others = await client.query<{ reviewId: string; segmentId: string; eventId: string }>(
    `select ri.id as "reviewId", st.id as "segmentId", ri.event_id as "eventId"
     from review_items ri
     join stay_segments st on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.id <> $3 and ri.status = 'open'
       and ri.suggested_place_id is null and st.place_id is null and st.status = 'finalised'
       and ri.suggested_started_at > now() - make_interval(days => $4)
       and st.centre is not null
       and ST_DWithin(st.centre, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7)
     order by ri.suggested_started_at desc, ri.id
     for update of ri, st, ae skip locked`,
    [session.workspaceId, session.userId, item.id, SAVE_PLACE_REMATCH_DAYS, item.centreLongitude, item.centreLatitude, action.radiusMeters]);
  for (const target of [{ reviewId: item.id, segmentId: item.segmentId, eventId: item.eventId, own: true }, ...others.rows.map((row) => ({ ...row, own: false }))]) {
    const card = await client.query<{ categoryId: string | null }>(
      `update review_items ri set suggested_place_id = $1,
         title = (select ${placeDisplayNameSql("p")} from places p where p.id = $1),
         suggested_category_id = case when $5 then $6::uuid else coalesce(ri.suggested_category_id, $6::uuid) end
       where ri.id = $2 and ri.workspace_id = $3 and ri.user_id = $4
       returning ri.suggested_category_id as "categoryId"`,
      [place.id, target.reviewId, session.workspaceId, session.userId, target.own, categoryId]);
    // The card's reason was about the place it did not have; replay gives the saved place's (Codex r1 on #459).
    // The card is now titled by the place, never a learned name; an activity the person chose here is
    // theirs to teach (Codex r4 on #459).
    await client.query(
      `update activity_events set suggested_place_id = $1,
         raw_payload = (raw_payload - 'semanticReason' - 'nameSource')
           || case when $5 then jsonb_build_object('activitySource', 'learned') else '{}'::jsonb end
       where id = $2 and workspace_id = $3 and user_id = $4`,
      [place.id, target.eventId, session.workspaceId, session.userId, target.own && Boolean(action.categoryId)]);
    // The Stay keeps the activity its card now has, which replay keeps over the place's default
    // (a re-matched card keeps its own; Codex r2 on #459).
    await client.query(
      `update stay_segments set place_id = $1, learned_place_id = null, continuity_status = 'manual',
         metadata = metadata || jsonb_build_object('placeMatchKind', 'saved', 'correctedCategoryId', $5::uuid), updated_at = now()
       where id = $2 and workspace_id = $3 and user_id = $4`,
      [place.id, target.segmentId, session.workspaceId, session.userId, card.rows[0]?.categoryId ?? null]);
  }
  await client.query(
    `insert into place_match_feedback (
       workspace_id, user_id, place_id, anchor, radius_m, correction_count, status
     ) values ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, 1, 'active')`,
    [session.workspaceId, session.userId, place.id, item.centreLongitude, item.centreLatitude, Math.min(160, action.radiusMeters)]);
  await auditCorrection(client, session, "save_place", item.segmentId, { rematchedCount: others.rows.length });
  return { ok: true, action: action.action, status: "open" as const, placeId: place.id, rematchedCount: others.rows.length };
}

async function splitReview(
  client: pg.PoolClient,
  item: LockedReview,
  action: Extract<LocationReviewAction, { action: "split" | "split_and_confirm" }>,
  session: RequestSession
) {
  if (item.segmentKind !== "stay") {
    throw new ReviewResolutionError("invalid_action", "Only a visit can be split.", { status: 422 });
  }
  const startedAt = new Date(item.suggestedStartedAt).toISOString();
  const stoppedAt = new Date(item.suggestedStoppedAt).toISOString();
  const splitAt = new Date(action.splitAt).toISOString();
  const minimumChildMs = 60_000;
  if (
    Date.parse(splitAt) - Date.parse(startedAt) < minimumChildMs ||
    Date.parse(stoppedAt) - Date.parse(splitAt) < minimumChildMs
  ) {
    throw new ReviewResolutionError("invalid_time_window", "Split point must leave at least one minute on each side.", { status: 422 });
  }
  const parent = await client.query<{
    clientSegmentId: string;
    algorithmVersion: string;
    deviceId: string;
    placeId: string | null;
    learnedPlaceId: string | null;
    confidence: string;
    centreLongitude: number | null;
    centreLatitude: number | null;
    radiusMeters: number | null;
  }>(
    `select client_segment_id as "clientSegmentId", algorithm_version as "algorithmVersion",
            device_id as "deviceId", place_id as "placeId", learned_place_id as "learnedPlaceId",
            confidence,
            case when centre is null then null else ST_X(centre::geometry) end as "centreLongitude",
            case when centre is null then null else ST_Y(centre::geometry) end as "centreLatitude",
            radius_m as "radiusMeters"
     from stay_segments where id = $1 and workspace_id = $2 and user_id = $3 for update`,
    [item.segmentId, session.workspaceId, session.userId]
  );
  const source = parent.rows[0];
  if (!source) throw new ReviewResolutionError("review_item_not_found", "Visit segment was not found.", { status: 404 });
  const leftId = stableLocationId("stay", [source.clientSegmentId, splitAt, "left"]);
  const rightId = stableLocationId("stay", [source.clientSegmentId, splitAt, "right"]);
  const childIds: string[] = [];
  for (const child of [
    { clientId: leftId, start: startedAt, stop: splitAt, edit: action.left },
    { clientId: rightId, start: splitAt, stop: stoppedAt, edit: action.right }
  ]) {
    const result = await client.query<{ id: string }>(
      `insert into stay_segments (
         workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, source,
         place_id, learned_place_id, started_at, stopped_at, centre, radius_m, confidence,
         continuity_status, parent_segment_id, review_status, metadata, updated_at
       ) values (
         $1, $2, $3, $4, $5, 'finalised', 'manual_split', $6, $7, $8, $9,
         case when $10::double precision is null or $11::double precision is null then null
              else ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography end,
         $12, $13, 'manual', $14, 'needs_review', '{"placeMatchKind":"manual"}'::jsonb, now()
       ) returning id`,
      [
        session.workspaceId,
        session.userId,
        source.deviceId,
        child.clientId,
        source.algorithmVersion,
        child.edit?.placeId !== undefined ? child.edit.placeId : source.placeId,
        child.edit?.placeId !== undefined ? null : source.learnedPlaceId,
        child.start,
        child.stop,
        source.centreLongitude,
        source.centreLatitude,
        source.radiusMeters,
        source.confidence,
        item.segmentId
      ]
    );
    childIds.push(result.rows[0].id);
  }
  await client.query(
    `update stay_segments set status = 'superseded', superseded_by_segment_id = $1, updated_at = now()
     where id = $2 and workspace_id = $3 and user_id = $4`,
    [childIds[0], item.segmentId, session.workspaceId, session.userId]
  );
  await client.query(
    `update location_segment_evidence
     set stay_segment_id = case
       when (select occurred_at from location_evidence where id = evidence_id) <= $1 then $2::uuid
       else $3::uuid end,
       role = case when abs(extract(epoch from ((select occurred_at from location_evidence where id = evidence_id) - $1::timestamptz))) < 60
         then 'manual_boundary' else role end
     where workspace_id = $4 and user_id = $5 and stay_segment_id = $6`,
    [splitAt, childIds[0], childIds[1], session.workspaceId, session.userId, item.segmentId]
  );
  await resolveReviewAndEvent(client, item, session, "accepted");
  if (action.action === "split_and_confirm") {
    const entryIds = [];
    for (const [index, childId] of childIds.entries()) {
      const edit = index === 0 ? action.left : action.right;
      const start = index === 0 ? startedAt : splitAt;
      const stop = index === 0 ? splitAt : stoppedAt;
      const entry = await createChildEntry(client, session, item, childId, start, stop, edit);
      entryIds.push(entry);
    }
    await auditCorrection(client, session, "split_and_confirm", item.segmentId, { childCount: 2 });
    return { ok: true, action: action.action, status: "accepted", childSegmentIds: childIds, entryIds };
  }
  for (const [index, childId] of childIds.entries()) {
    await createChildReview(
      client,
      session,
      item,
      childId,
      index === 0 ? startedAt : splitAt,
      index === 0 ? splitAt : stoppedAt,
      index === 0 ? action.left : action.right
    );
  }
  await auditCorrection(client, session, "split", item.segmentId, { childCount: 2 });
  return { ok: true, action: action.action, status: "accepted", childSegmentIds: childIds };
}

async function mergeReviews(
  client: pg.PoolClient,
  item: LockedReview,
  action: Extract<LocationReviewAction, { action: "merge" | "merge_and_confirm" }>,
  session: RequestSession
) {
  if (item.segmentKind !== "stay") throw new ReviewResolutionError("invalid_action", "Only adjacent visits can be merged.", { status: 422 });
  const adjacent = await lockLocationReview(client, action.adjacentReviewItemId, session);
  if (adjacent.status !== "open" || adjacent.segmentKind !== "stay" || adjacent.id === item.id) {
    throw new ReviewResolutionError("invalid_action", "Choose a different adjacent visit.", { status: 422 });
  }
  if (
    !item.deviceId || item.deviceId !== adjacent.deviceId ||
    !item.algorithmVersion || item.algorithmVersion !== adjacent.algorithmVersion
  ) {
    throw new ReviewResolutionError("invalid_action", "Visits from different capture streams cannot be merged.", { status: 422 });
  }
  const ordered = [item, adjacent].sort((a, b) => Date.parse(String(a.suggestedStartedAt)) - Date.parse(String(b.suggestedStartedAt)));
  const gapMs = Date.parse(String(ordered[1].suggestedStartedAt)) - Date.parse(String(ordered[0].suggestedStoppedAt));
  if (gapMs < 0 || gapMs > 30 * 60_000) {
    throw new ReviewResolutionError("invalid_time_window", "Visits must be adjacent and no more than 30 minutes apart.", { status: 422 });
  }
  const placeEvidenceMatches =
    ordered[0].suggestedPlaceId === ordered[1].suggestedPlaceId &&
    ordered[0].learnedPlaceId === ordered[1].learnedPlaceId &&
    ordered[0].placeMatchKind === ordered[1].placeMatchKind;
  if (!placeEvidenceMatches && !action.acknowledgeContradictoryEvidence) {
    throw new ReviewResolutionError("invalid_action", "The visits have contradictory place evidence. Acknowledge it before merging.", { status: 422 });
  }
  const intervening = await client.query(
    `select 1 from stay_segments
     where workspace_id = $1 and user_id = $2 and device_id = $3
       and status <> 'superseded'
       and id <> all($4::uuid[])
       and started_at > $5::timestamptz and started_at < $6::timestamptz
     limit 1`,
    [
      session.workspaceId,
      session.userId,
      item.deviceId,
      ordered.map((candidate) => candidate.segmentId),
      ordered[0].suggestedStartedAt,
      ordered[1].suggestedStartedAt
    ]
  );
  if (intervening.rows[0]) {
    throw new ReviewResolutionError("invalid_time_window", "Another visit exists between these stays.", { status: 422 });
  }
  const lockedSegments = await client.query<{ id: string }>(
    `select id from stay_segments
     where id = any($1::uuid[]) and workspace_id = $2 and user_id = $3
     order by id
     for update nowait`,
    [[item.segmentId, adjacent.segmentId], session.workspaceId, session.userId]
  );
  if (lockedSegments.rowCount !== 2) {
    throw new ReviewResolutionError("review_item_not_found", "One of the visit segments was not found.", { status: 404 });
  }
  const clientSegmentId = stableLocationId("stay", [ordered[0].segmentId, ordered[1].segmentId, "merge"]);
  const merged = await client.query<{ id: string }>(
    `insert into stay_segments (
       workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, source,
       place_id, learned_place_id, started_at, stopped_at, centre, radius_m,
       max_spread_m, sample_count, raw_sample_count, confidence, continuity_status, parent_segment_id,
       review_status, metadata, updated_at
     )
     select workspace_id, user_id, device_id, $1, algorithm_version, 'finalised', 'manual_merge',
            $2, $3, $4, $5, centre, radius_m,
            max_spread_m, sample_count, raw_sample_count, confidence, 'manual', id, 'needs_review',
            jsonb_build_object('mergedSegmentIds', $6::text[]), now()
     from stay_segments where id = $7 and workspace_id = $8 and user_id = $9
     returning id`,
    [
      clientSegmentId,
      action.edit?.placeId !== undefined
        ? action.edit.placeId
        : ordered[0].suggestedPlaceId ?? ordered[1].suggestedPlaceId,
      action.edit?.placeId !== undefined
        ? null
        : ordered[0].learnedPlaceId ?? ordered[1].learnedPlaceId,
      new Date(ordered[0].suggestedStartedAt).toISOString(),
      new Date(ordered[1].suggestedStoppedAt).toISOString(),
      ordered.map((candidate) => candidate.segmentId),
      ordered[0].segmentId,
      session.workspaceId,
      session.userId
    ]
  );
  const mergedId = merged.rows[0].id;
  await client.query(
    `update stay_segments set status = 'superseded', superseded_by_segment_id = $1, updated_at = now()
     where id = any($2::uuid[]) and workspace_id = $3 and user_id = $4`,
    [mergedId, ordered.map((candidate) => candidate.segmentId), session.workspaceId, session.userId]
  );
  await client.query(
    `insert into location_segment_evidence (
       workspace_id, user_id, evidence_id, stay_segment_id, commute_segment_id, sequence_index, role
     )
     select workspace_id, user_id, evidence_id, $1, null, min(sequence_index), role
     from location_segment_evidence
     where stay_segment_id = any($2::uuid[]) and workspace_id = $3 and user_id = $4
     group by workspace_id, user_id, evidence_id, role
     on conflict do nothing`,
    [mergedId, ordered.map((candidate) => candidate.segmentId), session.workspaceId, session.userId]
  );
  await client.query(
    `delete from location_segment_evidence
     where stay_segment_id = any($1::uuid[]) and workspace_id = $2 and user_id = $3`,
    [ordered.map((candidate) => candidate.segmentId), session.workspaceId, session.userId]
  );
  await resolveReviewAndEvent(client, item, session, "accepted");
  await resolveReviewAndEvent(client, adjacent, session, "accepted");
  if (action.action === "merge_and_confirm") {
    const entryId = await createChildEntry(
      client,
      session,
      mergedLearning(item, adjacent),
      mergedId,
      new Date(ordered[0].suggestedStartedAt).toISOString(),
      new Date(ordered[1].suggestedStoppedAt).toISOString(),
      action.edit
    );
    await auditCorrection(client, session, "merge_and_confirm", mergedId, { mergedCount: 2 });
    return { ok: true, action: action.action, status: "accepted", mergedSegmentId: mergedId, entryId };
  }
  await createChildReview(
    client,
    session,
    mergedLearning(item, adjacent),
    mergedId,
    new Date(ordered[0].suggestedStartedAt).toISOString(),
    new Date(ordered[1].suggestedStoppedAt).toISOString(),
    action.edit
  );
  await auditCorrection(client, session, "merge", mergedId, { mergedCount: 2 });
  return { ok: true, action: action.action, status: "accepted", mergedSegmentId: mergedId };
}

function editedWindow(item: LockedReview, edit?: ReviewEntryEdit) {
  const startedAt = new Date(edit?.startedAt ?? item.suggestedStartedAt).toISOString();
  const stoppedAt = new Date(edit?.stoppedAt ?? item.suggestedStoppedAt).toISOString();
  if (Date.parse(stoppedAt) <= Date.parse(startedAt)) {
    throw new ReviewResolutionError("invalid_time_window", "Stop time must be after start time.", { status: 422 });
  }
  return { startedAt, stoppedAt };
}

async function validateReferences(
  client: pg.PoolClient,
  session: RequestSession,
  categoryId?: string | null,
  placeId?: string | null
) {
  if (categoryId) {
    const category = await client.query("select 1 from categories where id = $1 and workspace_id = $2 and is_archived = false", [categoryId, session.workspaceId]);
    if (!category.rows[0]) throw new ReviewResolutionError("invalid_action", "Activity was not found.", { status: 422 });
  }
  if (placeId) {
    const place = await client.query("select 1 from places where id = $1 and workspace_id = $2", [placeId, session.workspaceId]);
    if (!place.rows[0]) throw new ReviewResolutionError("invalid_action", "Place was not found.", { status: 422 });
  }
}

async function resolveReviewAndEvent(
  client: pg.PoolClient,
  item: Pick<LockedReview, "id" | "eventId">,
  session: RequestSession,
  status: "accepted" | "ignored"
) {
  await client.query(
    `update review_items set status = $1, resolved_at = now()
     where id = $2 and workspace_id = $3 and user_id = $4`,
    [status, item.id, session.workspaceId, session.userId]
  );
  await client.query(
    `update activity_events set review_status = $1
     where id = $2 and workspace_id = $3 and user_id = $4`,
    [status === "accepted" ? "confirmed" : "ignored", item.eventId, session.workspaceId, session.userId]
  );
}

async function createChildEntry(
  client: pg.PoolClient,
  session: RequestSession,
  item: LockedReview,
  segmentId: string,
  startedAt: string,
  stoppedAt: string,
  edit?: ReviewEntryEdit
) {
  const categoryId = editedCategoryId(item, edit);
  const placeId = editedPlaceId(item, edit);
  await validateReferences(client, session, categoryId, placeId);
  const description = edit?.description ?? item.title;
  const { id: event, pattern } = await createChildEvent(client, session, item, segmentId, startedAt, stoppedAt, edit, {
    ownerAuthoredDescription: isOwnerAuthoredReviewDescription(description, item.suggestedTitles)
  });
  const entry = await client.query<{ id: string }>(
    `insert into time_entries (
       workspace_id, user_id, category_id, place_id, source, confidence, review_status,
       description, started_at, stopped_at, created_from_event_id
     ) values ($1, $2, $3, $4, 'location_learning', $5, 'confirmed', $6, $7, $8, $9)
     returning id`,
    [
      session.workspaceId,
      session.userId,
      categoryId,
      placeId,
      item.confidence,
      description,
      startedAt,
      stoppedAt,
      event
    ]
  );
  await syncTimeEntryTags(client, entry.rows[0].id, edit?.tags ?? [], session);
  await learnFromDecision(client, session, item, event, pattern, { description, categoryId, edit });
  return entry.rows[0].id;
}

async function createChildReview(
  client: pg.PoolClient,
  session: RequestSession,
  item: LockedReview,
  segmentId: string,
  startedAt: string,
  stoppedAt: string,
  edit?: ReviewEntryEdit
) {
  await validateReferences(client, session, editedCategoryId(item, edit), editedPlaceId(item, edit));
  const { id: eventId } = await createChildEvent(client, session, item, segmentId, startedAt, stoppedAt, edit);
  await client.query(
    `insert into review_items (
       workspace_id, user_id, event_id, location_segment_id, type, title,
       suggested_category_id, suggested_place_id, suggested_started_at, suggested_stopped_at,
       confidence, status, notes
     ) values ($1, $2, $3, $4, 'location_manual_correction', $5, $6, $7, $8, $9, $10, 'open', 'Review the corrected boundary.')`,
    [
      session.workspaceId,
      session.userId,
      eventId,
      segmentId,
      edit?.description ?? item.title,
      editedCategoryId(item, edit),
      editedPlaceId(item, edit),
      startedAt,
      stoppedAt,
      item.confidence
    ]
  );
}

async function createChildEvent(
  client: pg.PoolClient,
  session: RequestSession,
  item: LockedReview,
  segmentId: string,
  startedAt: string,
  stoppedAt: string,
  edit?: ReviewEntryEdit,
  decision: { ownerAuthoredDescription: boolean } = { ownerAuthoredDescription: false }
) {
  // The part's own segment holds its identity: the Stay's, or the place it was corrected to.
  const pattern = await resultPattern(client, session, item, { segmentId, startedAt, stoppedAt });
  const event = await client.query<{ id: string }>(
    `insert into activity_events (
       workspace_id, user_id, client_event_id, source, event_type, occurred_at,
       confidence, raw_payload, suggested_category_id, suggested_place_id, review_status
     ) values ($1, $2, $3, 'location_learning', 'unknown_stay', $4, $5, $6::jsonb, $7, $8, 'needs_review')
     returning id`,
    [
      session.workspaceId,
      session.userId,
      `location-correction:${segmentId}`.slice(0, 160),
      startedAt,
      item.confidence,
      JSON.stringify({
        segmentId,
        startedAt,
        stoppedAt,
        correction: true,
        // The titles Dayframe suggested along this correction chain, never the owner's own.
        [REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY]: item.suggestedTitles,
        // A part of the same Stay keeps its learned-name pattern, or that of the place it was corrected
        // to, and where its name and activity came from (PRD D19, A8; Codex r1/r2 on #458).
        ...(pattern ? { namePatternKey: pattern.key, namePatternBand: pattern.band } : {}),
        ...childProvenance(item, edit),
        ...(decision.ownerAuthoredDescription
          ? { [REVIEW_DECISION_PAYLOAD_KEY]: { ownerAuthoredDescription: true } satisfies ReviewDecisionPayload }
          : {})
      }),
      editedCategoryId(item, edit),
      editedPlaceId(item, edit)
    ]
  );
  await client.query(
    `update stay_segments set created_from_event_id = $1 where id = $2 and workspace_id = $3 and user_id = $4`,
    [event.rows[0].id, segmentId, session.workspaceId, session.userId]
  );
  return { id: event.rows[0].id, pattern };
}

/** Marks the block's source event: the owner typed its description in this Review decision. */
async function recordOwnerAuthoredDescription(client: pg.PoolClient, session: RequestSession, eventId: string) {
  const decision: ReviewDecisionPayload = { ownerAuthoredDescription: true };
  await client.query(
    `update activity_events
     set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object($4::text, $5::jsonb)
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [eventId, session.workspaceId, session.userId, REVIEW_DECISION_PAYLOAD_KEY, JSON.stringify(decision)]
  );
}

async function auditCorrection(
  client: pg.PoolClient,
  session: RequestSession,
  action: string,
  segmentId: string,
  metadata: Record<string, unknown>
) {
  await client.query(
    `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
     values ($1, $2, $3, 'location_segment', $4, $5::jsonb)`,
    [session.workspaceId, session.userId, action, segmentId, JSON.stringify(metadata)]
  );
}

const NAME_BANDS = new Set<string>(["morning", "afternoon", "evening", "weekend"]);
function isNameBand(value: string | null): value is NameBand {
  return value != null && NAME_BANDS.has(value);
}

/** Whether an edit carries a field at all: an explicit `null` clears it, an absent one keeps the suggestion. */
function edits(edit: ReviewEntryEdit | undefined, field: "categoryId" | "placeId") {
  return edit !== undefined && Object.prototype.hasOwnProperty.call(edit, field);
}

/** The activity a correction part or its block gets: a cleared one stays cleared (Codex r2 on #458). */
function editedCategoryId(item: LockedReview, edit?: ReviewEntryEdit) {
  return edits(edit, "categoryId") ? edit?.categoryId ?? null : item.suggestedCategoryId;
}

function editedPlaceId(item: LockedReview, edit?: ReviewEntryEdit) {
  return edits(edit, "placeId") ? edit?.placeId ?? null : item.suggestedPlaceId;
}

/** The place an edit corrected a Stay to, when it really changed it (an untouched field is no change). */
function editedPatternPlace(item: LockedReview, edit?: ReviewEntryEdit): PatternPlace | undefined {
  const placeId = editedPlaceId(item, edit);
  return edits(edit, "placeId") && placeId !== item.suggestedPlaceId ? { placeId, learnedPlaceId: null } : undefined;
}

/**
 * The pattern a decision teaches (Codex r1–r3 on #458). Its key: a Stay corrected to another place in
 * this decision (the editor, Change place, saving one, a learned place, or none: the Stay's cell)
 * teaches that place; a Stay its person corrected before (Change place on its own, a split or merge
 * part) teaches its stored identity; otherwise the item's own. Its band: that of the result's start in
 * the time zone of the result's first reading (a split part, a merge, a new start), else the item's.
 */
async function resultPattern(
  client: pg.PoolClient, session: RequestSession, item: LockedReview,
  result: { segmentId: string; startedAt: string; stoppedAt: string; place?: PatternPlace }
) {
  if (!isNameBand(item.namePatternBand)) return null;
  // The time zone of the device's first reading from the result's start (as the emitter keys a
  // segment by its first reading), else its last one before; only readings inside the visit itself
  // (the result's window joined with the item's), so a split part with no reading of its own takes
  // its source's zone and never a later trip's (Codex r4/r5 on #458). Seeks idx_location_evidence_user_time.
  const from = Math.min(Date.parse(result.startedAt), Date.parse(String(item.suggestedStartedAt)));
  const to = Math.max(Date.parse(result.stoppedAt), Date.parse(String(item.suggestedStoppedAt)));
  const evidence = await client.query<{ timeZone: string }>(
    `select "timeZone" from (
       (select time_zone as "timeZone", 0 as rank from location_evidence
        where workspace_id = $1 and user_id = $2 and ($4::text is null or device_id = $4)
          and occurred_at >= $3::timestamptz and occurred_at <= $6::timestamptz
        order by occurred_at limit 1)
       union all
       (select time_zone as "timeZone", 1 as rank from location_evidence
        where workspace_id = $1 and user_id = $2 and ($4::text is null or device_id = $4)
          and occurred_at < $3::timestamptz and occurred_at >= $5::timestamptz
        order by occurred_at desc limit 1)
     ) nearest order by rank limit 1`,
    [session.workspaceId, session.userId, result.startedAt, item.deviceId,
      Number.isFinite(from) ? new Date(from).toISOString() : result.startedAt,
      Number.isFinite(to) ? new Date(to).toISOString() : result.stoppedAt]);
  const timeZone = evidence.rows[0]?.timeZone;
  const band = timeZone ? nameBand(result.startedAt, timeZone) : item.namePatternBand;
  if (item.segmentKind !== "stay") return item.namePatternKey ? { key: item.namePatternKey, band } : null;
  let key: string | null;
  if (result.place) {
    key = stayPatternKey({ placeId: result.place.placeId, learnedPlaceId: result.place.learnedPlaceId,
      centreLatitude: item.centreLatitude, centreLongitude: item.centreLongitude });
  } else {
    const stored = await client.query<{ placeId: string | null; learnedPlaceId: string | null; placeMatchKind: string | null;
      latitude: number | null; longitude: number | null }>(
      `select place_id as "placeId", learned_place_id as "learnedPlaceId", metadata ->> 'placeMatchKind' as "placeMatchKind",
              st_y(centre::geometry) as latitude, st_x(centre::geometry) as longitude
       from stay_segments where id = $1 and workspace_id = $2 and user_id = $3 and continuity_status = 'manual'`,
      [result.segmentId, session.workspaceId, session.userId]);
    if (!stored.rows[0]) return item.namePatternKey ? { key: item.namePatternKey, band } : null;
    key = persistedStayKey(stored.rows[0]);
  }
  return key ? { key: hashedPatternKey(session, key), band } : null;
}

/** The learned names a decision on this item can keep: its own, or a merge's from both cards. */
function learnedTitlesOf(item: LockedReview) {
  return item.learnedTitles ?? (item.learnedName ? [item.title] : []);
}

function learnedCategoryIdsOf(item: LockedReview) {
  return item.learnedCategoryIds ?? (item.learnedActivity && item.suggestedCategoryId ? [item.suggestedCategoryId] : []);
}

/** Whether a name is one of these titles, case and spacing aside. */
function keepsTitle(name: string | null | undefined, titles: readonly string[]) {
  return Boolean(name?.trim()) && titles.some((title) => !isOwnerAuthoredReviewDescription(name, [title]));
}

/** A merge of two cards: both cards' suggested titles, and both cards' learned names and activities. */
function mergedLearning(item: LockedReview, adjacent: LockedReview): LockedReview {
  return {
    ...item,
    suggestedTitles: [...new Set([...item.suggestedTitles, ...adjacent.suggestedTitles])],
    learnedTitles: [...new Set([...learnedTitlesOf(item), ...learnedTitlesOf(adjacent)])],
    learnedCategoryIds: [...new Set([...learnedCategoryIdsOf(item), ...learnedCategoryIdsOf(adjacent)])]
  };
}

/**
 * Where a correction part's name and activity came from, so confirming it later still teaches them:
 * a learned name it kept, and a learned activity it kept or one the person chose in the correction
 * (which becomes the part's suggestion and so no longer looks changed; Codex r2/r3 on #458).
 */
function childProvenance(item: LockedReview, edit?: ReviewEntryEdit) {
  const keptName = keepsTitle(edit?.description ?? item.title, learnedTitlesOf(item));
  const categoryId = editedCategoryId(item, edit);
  const chose = edits(edit, "categoryId") && categoryId !== item.suggestedCategoryId && categoryId !== null;
  const keptActivity = categoryId !== null && learnedCategoryIdsOf(item).includes(categoryId);
  return { ...(keptName ? { nameSource: "learned" } : {}), ...(chose || keptActivity ? { activitySource: "learned" } : {}) };
}

/** Keeps on the event the pattern its decision taught, which "Stop suggesting this" forgets. */
async function persistPattern(
  client: pg.PoolClient, session: RequestSession, item: LockedReview, eventId: string, pattern: { key: string; band: NameBand } | null
) {
  if (!pattern || (eventId === item.eventId && pattern.key === item.namePatternKey && pattern.band === item.namePatternBand)) return;
  await client.query(
    `update activity_events set raw_payload = raw_payload || jsonb_build_object('namePatternKey', $4::text, 'namePatternBand', $5::text)
     where workspace_id = $1 and user_id = $2 and id = $3`,
    [session.workspaceId, session.userId, eventId, pattern.key, pattern.band]);
}

/**
 * Learned names (PRD D19, A8): what this decision teaches its pattern. A name only when it is the
 * person's (it differs from every title Dayframe suggested, or it is the learned name they kept); an
 * activity only when they changed it from the suggestion, or kept a learned one (Codex r1 on #458).
 * The event keeps the pattern it taught, for "Stop suggesting this".
 */
async function learnFromDecision(
  client: pg.PoolClient, session: RequestSession, item: LockedReview, eventId: string,
  pattern: { key: string; band: NameBand } | null,
  decision: { description: string | null; categoryId: string | null; edit?: ReviewEntryEdit }
) {
  if (!pattern) return;
  const description = decision.description?.trim() || null;
  const name = description && (isOwnerAuthoredReviewDescription(description, item.suggestedTitles) ||
    keepsTitle(description, learnedTitlesOf(item))) ? description : null;
  const changedActivity = decision.edit?.categoryId !== undefined && decision.edit.categoryId !== item.suggestedCategoryId;
  const keptActivity = !changedActivity && decision.categoryId !== null && learnedCategoryIdsOf(item).includes(decision.categoryId);
  await recordLearnedName(client, session, pattern,
    { name, categoryId: (changedActivity || keptActivity) ? decision.categoryId : null });
  await persistPattern(client, session, item, eventId, pattern);
}
