import {
  LocationReviewActionSchema,
  stableLocationId,
  type LocationReviewAction,
  type ReviewEntryEdit
} from "@dayframe/shared";
import type pg from "pg";
import { isLockNotAvailableError, pool } from "../db";
import { ReviewResolutionError } from "../event-service";
import type { RequestSession } from "../session";
import { syncTimeEntryTags } from "../tag-service";

type LockedReview = {
  id: string;
  eventId: string;
  status: string;
  title: string;
  confidence: string;
  suggestedCategoryId: string | null;
  suggestedPlaceId: string | null;
  suggestedStartedAt: Date | string;
  suggestedStoppedAt: Date | string;
  segmentId: string;
  segmentKind: "stay" | "commute";
  segmentStatus: string;
  deviceId: string | null;
  algorithmVersion: string | null;
  learnedPlaceId: string | null;
  placeMatchKind: string | null;
  centreLatitude: number | null;
  centreLongitude: number | null;
};

export async function resolveLocationReviewAction(
  reviewItemId: string,
  input: unknown,
  session: RequestSession
) {
  const action = LocationReviewActionSchema.parse(input);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [session.workspaceId, session.userId]
    );
    const item = await lockLocationReview(client, reviewItemId, session);
    if (item.status !== "open") {
      await client.query("commit");
      return { ok: true, action: action.action, status: item.status, alreadyResolved: true };
    }
    const result = await performAction(client, item, action, session);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    if (isLockNotAvailableError(error)) {
      throw new ReviewResolutionError(
        "review_item_locked",
        "This location review is already being updated. Try again in a moment.",
        { status: 409 }
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function lockLocationReview(client: pg.PoolClient, id: string, session: RequestSession) {
  const result = await client.query<LockedReview>(
    `select ri.id,
            ri.event_id as "eventId",
            ri.status,
            ri.title,
            ri.confidence,
            ri.suggested_category_id as "suggestedCategoryId",
            ri.suggested_place_id as "suggestedPlaceId",
            ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            ri.location_segment_id as "segmentId",
            case when st.id is not null then 'stay' else 'commute' end as "segmentKind",
            coalesce(st.status, cs.status) as "segmentStatus",
            coalesce(st.device_id, cs.device_id) as "deviceId",
            coalesce(st.algorithm_version, cs.algorithm_version) as "algorithmVersion",
            st.learned_place_id as "learnedPlaceId",
            st.metadata ->> 'placeMatchKind' as "placeMatchKind",
            case when st.centre is null then null else ST_Y(st.centre::geometry) end as "centreLatitude",
            case when st.centre is null then null else ST_X(st.centre::geometry) end as "centreLongitude"
     from review_items ri
     join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     left join stay_segments st
       on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     left join commute_segments cs
       on cs.id = ri.location_segment_id and cs.workspace_id = ri.workspace_id and cs.user_id = ri.user_id
     where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3
       and ri.location_segment_id is not null and (st.id is not null or cs.id is not null)
     for update of ri, ae nowait`,
    [id, session.workspaceId, session.userId]
  );
  if (!result.rows[0]) {
    throw new ReviewResolutionError("review_item_not_found", "Location review item not found.", { status: 404 });
  }
  return result.rows[0];
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
    case "save_place_and_confirm":
      return savePlaceAndConfirm(client, item, action, session);
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
  placeIdOverride?: string | null
) {
  const window = editedWindow(item, edit);
  await validateReferences(client, session, edit?.categoryId, placeIdOverride ?? edit?.placeId);
  await validateNoConfirmedOverlap(client, session, window.startedAt, window.stoppedAt, item.eventId);
  const entry = await client.query<{ id: string }>(
    `insert into time_entries (
       workspace_id, user_id, category_id, place_id, source, confidence, review_status,
       description, started_at, stopped_at, created_from_event_id
     ) values ($1, $2, $3, $4, 'location_learning', $5, 'confirmed', $6, $7, $8, $9)
     on conflict do nothing
     returning id`,
    [
      session.workspaceId,
      session.userId,
      edit?.categoryId ?? item.suggestedCategoryId,
      placeIdOverride ?? edit?.placeId ?? item.suggestedPlaceId,
      item.confidence,
      edit?.description?.trim() || item.title,
      window.startedAt,
      window.stoppedAt,
      item.eventId
    ]
  );
  let entryId = entry.rows[0]?.id;
  if (!entryId) {
    const existing = await client.query<{ id: string }>(
      `select id from time_entries
       where workspace_id = $1 and user_id = $2 and created_from_event_id = $3 limit 1`,
      [session.workspaceId, session.userId, item.eventId]
    );
    entryId = existing.rows[0]?.id;
  }
  if (!entryId) {
    throw new ReviewResolutionError("database_constraint", "Unable to create the confirmed location entry.", { status: 409 });
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
  if (action.action === "change_place_and_confirm") {
    return confirmReview(
      client,
      { ...item, suggestedPlaceId: action.placeId },
      undefined,
      session,
      action.action,
      action.placeId
    );
  }
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
  const place = await client.query<{ id: string }>(
    `insert into places (workspace_id, name, latitude, longitude, radius_meters, priority, logging_enabled)
     values ($1, $2, $3, $4, $5, 5, true) returning id`,
    [session.workspaceId, action.name, action.latitude, action.longitude, action.radiusMeters]
  );
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
  return confirmReview(client, item, action.edit, session, "save_place_and_confirm", place.rows[0].id);
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
        child.edit?.placeId ?? source.placeId,
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
      item,
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
    item,
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
    if (!category.rows[0]) throw new ReviewResolutionError("invalid_action", "Category was not found.", { status: 422 });
  }
  if (placeId) {
    const place = await client.query("select 1 from places where id = $1 and workspace_id = $2", [placeId, session.workspaceId]);
    if (!place.rows[0]) throw new ReviewResolutionError("invalid_action", "Place was not found.", { status: 422 });
  }
}

async function validateNoConfirmedOverlap(
  client: pg.PoolClient,
  session: RequestSession,
  startedAt: string,
  stoppedAt: string,
  eventId: string
) {
  const overlap = await client.query(
    `select 1 from time_entries
     where workspace_id = $1 and user_id = $2 and review_status = 'confirmed'
       and created_from_event_id is distinct from $5
       and started_at < $4 and coalesce(stopped_at, 'infinity'::timestamptz) > $3
     limit 1`,
    [session.workspaceId, session.userId, startedAt, stoppedAt, eventId]
  );
  if (overlap.rows[0]) {
    throw new ReviewResolutionError("duplicate_entry", "This time overlaps an existing confirmed entry.", { status: 409 });
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
  await validateReferences(client, session, edit?.categoryId, edit?.placeId);
  await validateNoConfirmedOverlap(client, session, startedAt, stoppedAt, item.eventId);
  const event = await createChildEvent(client, session, item, segmentId, startedAt, stoppedAt, edit);
  const entry = await client.query<{ id: string }>(
    `insert into time_entries (
       workspace_id, user_id, category_id, place_id, source, confidence, review_status,
       description, started_at, stopped_at, created_from_event_id
     ) values ($1, $2, $3, $4, 'location_learning', $5, 'confirmed', $6, $7, $8, $9)
     returning id`,
    [
      session.workspaceId,
      session.userId,
      edit?.categoryId ?? item.suggestedCategoryId,
      edit?.placeId ?? item.suggestedPlaceId,
      item.confidence,
      edit?.description ?? item.title,
      startedAt,
      stoppedAt,
      event
    ]
  );
  await syncTimeEntryTags(client, entry.rows[0].id, edit?.tags ?? [], session);
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
  await validateReferences(client, session, edit?.categoryId, edit?.placeId);
  const eventId = await createChildEvent(client, session, item, segmentId, startedAt, stoppedAt, edit);
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
      edit?.categoryId ?? item.suggestedCategoryId,
      edit?.placeId ?? item.suggestedPlaceId,
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
  edit?: ReviewEntryEdit
) {
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
      JSON.stringify({ segmentId, startedAt, stoppedAt, correction: true }),
      edit?.categoryId ?? item.suggestedCategoryId,
      edit?.placeId ?? item.suggestedPlaceId
    ]
  );
  await client.query(
    `update stay_segments set created_from_event_id = $1 where id = $2 and workspace_id = $3 and user_id = $4`,
    [event.rows[0].id, segmentId, session.workspaceId, session.userId]
  );
  return event.rows[0].id;
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
