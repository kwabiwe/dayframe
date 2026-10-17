import type pg from "pg";
import { PRESERVE_REVIEW_TITLE_HISTORY_SQL, recordReviewTitleHistory } from "./review-title-history";
import {
  AUTOMATIC_LOCATION_POLICY_VERSION, LOCATION_ENGINE_V2_CONFIG, assessAutomaticLocation, assessAutomaticOverlap,
  type CommuteSegment, type LocationSegment, type StaySegment
} from "@dayframe/shared";
import {
  assessAutomaticMove, hasMeaningfulKnownPlaceWindow, isTimeAway, moveName, stayName, OUTING_KEY_PAYLOAD_KEY, OUTING_ROLE_PAYLOAD_KEY,
  type MoveEndpoint, type MoveName
} from "@dayframe/shared";
import type { RequestSession } from "../session";
import { placeDisplayNameSql, placeRoleLabelSql } from "../place-display";
import { ensureCommuteCategoryId, ensureTravelCategoryId, findErrandsCategoryId } from "../automatic-category-service";
import { locationSemanticDisposition } from "./location-semantic-policy";
import { autoLogPolicyFallback, reviewModeSemanticReason, type AutoLogFallbackReason } from "./review-mode-reason";
import { learnedNamesFor, namePatternsFor } from "./name-patterns";
import { chooseAutoLoggedMoves, logTripsAutomatically, moveEndsKnown, movesBlocked, optedOutMoves, retireCoveredAutoMoves } from "./location-auto-moves";
import { reopenSupersededReviews } from "./location-review-supersession";
import { healthCoveredMoves, retireCoveredCandidateCards } from "./health-coverage";
import {
  AUTO_LOG_SUPERSEDED_PAYLOAD_KEY, LOCATION_AUTO_LOG_SOURCE, type AutoLogOrphan, type AutoLogReconciliation
} from "./location-auto-log";

// Bounded row sets, including reads. All work uses the caller's owner-locked transaction.
const SEMANTIC_CHUNK_SIZE = 250;
function* chunks<T>(rows: T[]) {
  for (let offset = 0; offset < rows.length; offset += SEMANTIC_CHUNK_SIZE) {
    yield rows.slice(offset, offset + SEMANTIC_CHUNK_SIZE);
  }
}
type Place = {
  id: string; name: string; categoryId: string | null;
  description: string | null; loggingEnabled: boolean;
  /** Log automatically (owner decision 14 Oct 2026). */
  autoLog: boolean;
};
type LearnedPlace = { id: string; name: string; saved: Place | null };

/**
 * Both ends of every Move (PRD D19): the saved place's display name and role, else the accepted
 * learned place its persisted endpoint stay matched (learned endpoints have no place ID on the
 * commute), else unknown.
 */
/** One Move's name (title, route line, activity) from its ends and mode; see `moveEndpoints`. */
export async function segmentMoveName(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, segment: CommuteSegment, stayIds: ReadonlyMap<string, string>
) {
  return (await moveEndpoints(client, session, [segment], stayIds)).get(segment.clientSegmentId)!;
}

async function moveEndpoints(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, segments: LocationSegment[], stayIds: ReadonlyMap<string, string>,
  /** Moves whose ends their person corrected: named from those ends alone (Codex r3 on #459). */
  correctedMoves: ReadonlySet<string> = new Set()
) {
  const moves = segments.filter((segment): segment is CommuteSegment => segment.kind === "commute");
  const saved = new Map<string, MoveEndpoint>();
  const learned = new Map<string, MoveEndpoint>();
  const placeIds = [...new Set(moves.flatMap((segment) => [segment.fromPlaceId, segment.toPlaceId].filter((id): id is string => Boolean(id))))].sort();
  const stayDbIds = [...new Set(moves.flatMap((segment) => [
    segment.fromPlaceId ? undefined : stayIds.get(segment.fromStaySegmentId),
    segment.toPlaceId ? undefined : stayIds.get(segment.toStaySegmentId)
  ].filter((id): id is string => Boolean(id))))].sort();
  const role = (value: string | null) => value === "home" || value === "work" ? value : null;
  for (const ids of chunks(placeIds)) {
    const result = await client.query<{ id: string; name: string; role: string | null }>(
      `select pl.id, ${placeDisplayNameSql("pl")} as name, pl.role from places pl where pl.workspace_id = $1 and pl.id = any($2::uuid[])`,
      [session.workspaceId, ids]);
    for (const row of result.rows) saved.set(row.id, { name: row.name, role: role(row.role) });
  }
  for (const ids of chunks(stayDbIds)) {
    // A learned place linked to a saved place goes by the saved place's display name, as its Stay does.
    const result = await client.query<{ id: string; name: string; role: string | null }>(`select ss.id, coalesce(${placeDisplayNameSql("p")}, lp.name) as name,
      p.role
      from stay_segments ss
      join learned_places lp on lp.id = ss.learned_place_id and lp.workspace_id = ss.workspace_id and lp.user_id = ss.user_id
      left join places p on p.id = lp.place_id and p.workspace_id = lp.workspace_id and lp.status = 'accepted'
      where ss.workspace_id = $1 and ss.user_id = $2 and ss.id = any($3::uuid[])`, [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) learned.set(row.id, { name: row.name, role: role(row.role) });
  }
  const unknown: MoveEndpoint = { name: null, role: null };
  const end = (placeId: string | null | undefined, staySegmentId: string) => {
    if (placeId) return saved.get(placeId) ?? unknown;
    const dbId = stayIds.get(staySegmentId);
    return (dbId && learned.get(dbId)) || unknown;
  };
  return new Map(moves.map((segment) => {
    const from = end(segment.fromPlaceId, segment.fromStaySegmentId);
    const to = end(segment.toPlaceId, segment.toStaySegmentId);
    // A corrected Move is a round trip only when its corrected ends are one place; the engine's
    // qualification still governs policy, never this name.
    const sameEndpoint = correctedMoves.has(segment.clientSegmentId)
      ? Boolean(segment.fromPlaceId && segment.fromPlaceId === segment.toPlaceId)
      : isTimeAway(segment) || segment.qualificationReason === "same_place_meaningful_round_trip" ||
        Boolean(segment.fromPlaceId && segment.fromPlaceId === segment.toPlaceId);
    return [segment.clientSegmentId, moveName({ from, to, travelMode: segment.travelMode, sameEndpoint,
      stopCount: segment.stops?.length ?? 0 })] as const;
  }));
}

async function displayContext(
  client: pg.PoolClient, session: RequestSession, segments: LocationSegment[], stayIds: ReadonlyMap<string, string>,
  correctedMoves: ReadonlySet<string> = new Set()
) {
  const stays = segments.filter((segment): segment is StaySegment => segment.kind === "stay");
  const places = new Map<string, Place>();
  const learned = new Map<string, LearnedPlace>();
  // Moves are named from their ends and mode (PRD D19).
  const moves = await moveEndpoints(client, session, segments, stayIds, correctedMoves);
  const placeIds = [...new Set(stays.flatMap(s => s.placeId ? [s.placeId] : []))].sort();
  const learnedIds = [...new Set(stays.flatMap(s => s.learnedPlaceId ? [s.learnedPlaceId] : []))].sort();
  // Saved places belong to a workspace; learned places additionally belong to a user.
  for (const ids of chunks(placeIds)) {
    const result = await client.query<Place>(`select pl.id, ${placeDisplayNameSql("pl")} as name, pl.default_category_id as "categoryId",
      pl.default_activity_description as description, pl.logging_enabled as "loggingEnabled",
      pl.auto_log as "autoLog"
      from places pl where pl.workspace_id = $1 and pl.id = any($2::uuid[])`, [session.workspaceId, ids]);
    for (const row of result.rows) places.set(row.id, row);
  }
  for (const ids of chunks(learnedIds)) {
    const result = await client.query<LearnedPlace>(`select lp.id, coalesce(${placeRoleLabelSql("p")}, lp.name) as name,
      case when p.id is null then null else jsonb_build_object('id',p.id,'name',coalesce(${placeDisplayNameSql("p")},lp.name),
        'categoryId',p.default_category_id,'description',p.default_activity_description,
        'loggingEnabled',p.logging_enabled,'autoLog',p.auto_log) end as saved
      from learned_places lp left join places p on p.id = lp.place_id and p.workspace_id = lp.workspace_id
        and lp.status = 'accepted'
      where lp.workspace_id = $1 and lp.user_id = $2 and lp.id = any($3::uuid[])`,
    [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) learned.set(row.id, row);
  }
  return (segment: LocationSegment) => {
    if (segment.kind === "commute") {
      const move = moves.get(segment.clientSegmentId) ?? moveName({ from: { name: null, role: null }, to: { name: null, role: null },
        travelMode: segment.travelMode, sameEndpoint: isTimeAway(segment), stopCount: segment.stops?.length ?? 0 });
      return { trusted: null, title: move.title, move };
    }
    const trusted = segment.placeMatchKind === "saved" && segment.placeId
      ? places.get(segment.placeId) ?? null
      : segment.placeMatchKind === "learned" && segment.learnedPlaceId
        ? learned.get(segment.learnedPlaceId)?.saved ?? null : null;
    const learnedName = segment.learnedPlaceId ? learned.get(segment.learnedPlaceId) : null;
    const saved = segment.placeId ? places.get(segment.placeId) : null;
    // A Stay is called by its place (PRD D19); the place's own default description, the user's
    // words, still wins.
    const title = trusted ? trusted.description?.trim() || stayName({ name: trusted.name })
      : learnedName ? stayName({ name: learnedName.name })
        : !segment.placeId ? stayName({ name: null, ambiguous: segment.placeMatchKind === "ambiguous" })
          : stayName({ name: saved?.name ?? "Saved place" });
    return { trusted, title, move: null };
  };
}

/**
 * A Stay its person corrected (Change place, Save this place: its persisted row is `manual`) keeps the
 * place it was corrected to when replay re-emits its card, so the card, its activity and its reason
 * follow the correction rather than the engine's match (Codex r1 on #459); the Moves either side of it
 * end at that place too, for their names and activity (Codex r2 on #459). A Stay saved as a place
 * also keeps the activity its card had then (`correctedCategoryId`), never the place's default, and
 * whether the person chose that activity there (`chosenCategories`), which a decision then learns.
 */
export async function withCorrectedStayPlaces(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, segments: LocationSegment[], stayIds: ReadonlyMap<string, string>
): Promise<{
  segments: LocationSegment[]; correctedCategories: ReadonlyMap<string, string | null>; correctedMoves: ReadonlySet<string>;
  chosenCategories: ReadonlySet<string>;
}> {
  const ids = [...new Set(segments.flatMap((segment) => segment.kind === "stay" ? stayIds.get(segment.clientSegmentId) ?? []
    : [stayIds.get(segment.fromStaySegmentId), stayIds.get(segment.toStaySegmentId)].filter((id): id is string => Boolean(id))))].sort();
  const corrected = new Map<string, Pick<StaySegment, "placeId" | "learnedPlaceId" | "placeMatchKind">>();
  const categories = new Map<string, string | null>();
  const chosen = new Set<string>();
  for (const batch of chunks(ids)) {
    const result = await client.query<{ id: string; placeId: string | null; learnedPlaceId: string | null; kind: string | null;
      hasCategory: boolean; categoryId: string | null; chosen: boolean | null }>(
      `select id, place_id as "placeId", learned_place_id as "learnedPlaceId", metadata ->> 'placeMatchKind' as kind,
              metadata ? 'correctedCategoryId' as "hasCategory", metadata ->> 'correctedCategoryId' as "categoryId",
              (metadata ->> 'correctedCategoryChosen')::boolean as chosen
       from stay_segments where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and continuity_status = 'manual'`,
      [session.workspaceId, session.userId, batch]);
    for (const row of result.rows) {
      const placeMatchKind = row.kind === "saved" && row.placeId ? "saved" : row.kind === "learned" && row.learnedPlaceId ? "learned"
        : row.placeId ? "saved" : row.learnedPlaceId ? "learned" : "unknown";
      corrected.set(row.id, { placeId: row.placeId, learnedPlaceId: row.learnedPlaceId, placeMatchKind });
      if (row.hasCategory) categories.set(row.id, row.categoryId);
      if (row.hasCategory && row.chosen === true) chosen.add(row.id);
    }
  }
  const correctedCategories = new Map<string, string | null>();
  const correctedMoves = new Set<string>();
  const chosenCategories = new Set<string>();
  if (corrected.size === 0) return { segments, correctedCategories, correctedMoves, chosenCategories };
  const savedPlaceOf = (clientStayId: string) => {
    const identity = corrected.get(stayIds.get(clientStayId) ?? "");
    return identity ? { placeId: identity.placeMatchKind === "saved" ? identity.placeId : null } : null;
  };
  return {
    segments: segments.map((segment) => {
      if (segment.kind === "commute") {
        const from = savedPlaceOf(segment.fromStaySegmentId);
        const to = savedPlaceOf(segment.toStaySegmentId);
        // Named from corrected ends only when a correction really moved an end (a time-only correction keeps it).
        if ((from && from.placeId !== (segment.fromPlaceId ?? null)) || (to && to.placeId !== (segment.toPlaceId ?? null))) {
          correctedMoves.add(segment.clientSegmentId);
        }
        return from || to
          ? { ...segment, ...(from ? { fromPlaceId: from.placeId } : {}), ...(to ? { toPlaceId: to.placeId } : {}) }
          : segment;
      }
      const persistedId = stayIds.get(segment.clientSegmentId) ?? "";
      const identity = corrected.get(persistedId);
      if (categories.has(persistedId)) correctedCategories.set(segment.clientSegmentId, categories.get(persistedId) ?? null);
      if (chosen.has(persistedId)) chosenCategories.add(segment.clientSegmentId);
      return identity ? { ...segment, ...identity } : segment;
    }),
    correctedCategories,
    correctedMoves,
    chosenCategories
  };
}

/** Event payload keys for one card per outing (PRD D19): the shared key and each member's role. */
export { OUTING_KEY_PAYLOAD_KEY, OUTING_ROLE_PAYLOAD_KEY };

/**
 * Tags the cards of each outing (PRD D19: "an unknown Stay and the Moves either side of it are one
 * Review card"): among this emission's open cards, an unknown Stay with a Move card arriving at it
 * and/or one leaving it. A Move belongs to the unknown Stay it arrives at; it joins the Stay it leaves
 * only when it does not arrive at another unknown Stay's card, so Home → A → B → Home gives A
 * (with the Move there) and B (with the Move from A and the Move home). Time away is never a member.
 * Decided rows are left alone. Mutates the rows' payloads: the key is `outing:<Stay segment>`.
 */
export function tagOutings(rows: Array<{ kind: string; review_status: string; raw_payload: Record<string, unknown> }>) {
  const open = rows.filter((row) => row.review_status === "needs_review");
  const stays = open.filter((row) => row.kind === "stay" && row.raw_payload.placeMatchKind === "unknown" &&
    typeof row.raw_payload.clientSegmentId === "string");
  const unknownStayIds = new Set(stays.map((row) => row.raw_payload.clientSegmentId as string));
  const moves = open.filter((row) => row.kind === "commute" && typeof row.raw_payload.fromStaySegmentId === "string" &&
    typeof row.raw_payload.toStaySegmentId === "string" && !("stopCount" in row.raw_payload) &&
    row.raw_payload.qualificationReason !== "same_place_outing");
  for (const stay of stays) {
    const id = stay.raw_payload.clientSegmentId as string;
    const arriving = moves.find((move) => move.raw_payload.toStaySegmentId === id);
    const leaving = moves.find((move) => move.raw_payload.fromStaySegmentId === id &&
      !unknownStayIds.has(move.raw_payload.toStaySegmentId as string));
    if (!arriving && !leaving) continue;
    const key = `outing:${id}`;
    const tag = (row: { raw_payload: Record<string, unknown> }, role: "stay" | "in" | "out") => {
      row.raw_payload = { ...row.raw_payload, [OUTING_KEY_PAYLOAD_KEY]: key, [OUTING_ROLE_PAYLOAD_KEY]: role };
    };
    tag(stay, "stay");
    if (arriving) tag(arriving, "in");
    if (leaving) tag(leaving, "out");
  }
}

/**
 * Counts what a replay changed that the app shows: Review items inserted, reopened, retired by replay, or
 * with a changed title, place, category, time, confidence or note; existing events whose time, confidence,
 * suggestions or payload changed (Review renders the payload); and a created Commute activity. A replay re-emits every finalised segment, so the
 * emitted count is almost never zero; the app refreshes its Dashboard only when this count is.
 */
export type SemanticChangeCounter = { count: number };

/** Dedicated review-only persistence. The v2_enabled automatic emitter remains separate. */
export async function emitReviewSemanticSegments(
  client: pg.PoolClient, session: RequestSession, segments: LocationSegment[],
  stayIds: Map<string, string>, commuteIds: Map<string, string>,
  changes: SemanticChangeCounter = { count: 0 },
  // Log automatically: blocks of visits replay retired, which a replacement visit takes over, and the
  // window in which replay keeps auto-logged visits in step (none: their blocks never move).
  autoLog: {
    orphans: AutoLogOrphan[]; used: Set<string>; reconciliation?: AutoLogReconciliation;
    /** The blocks replay locked unedited, the only ones emission may move. */
    locked: ReadonlySet<string>;
  } = { orphans: [], used: new Set(), locked: new Set() },
  /** The replayed device's readings' time zones, for learned names' time-of-day bands. */
  evidenceTimeZones: ReadonlyMap<string, string> = new Map()
): Promise<number> {
  const corrections = await withCorrectedStayPlaces(client, session, segments, stayIds);
  segments = corrections.segments;
  const clientEventIdOf = (segment: LocationSegment) => `location-segment:${segment.clientSegmentId}`.slice(0, 160);
  // A stay too short to offer (an unknown stay under 10 minutes, PRD D19; a known place under its
  // window). One that shrank there while its card is open loses that card, as replay retires a card
  // whose segment vanished; it reopens if the stay grows back (Codex r1 on #461).
  const tooShort = (segment: LocationSegment) => segment.kind === "stay" && (
    (segment.placeMatchKind === "saved" || segment.placeMatchKind === "learned")
      ? !hasMeaningfulKnownPlaceWindow(segment.startedAt, segment.stoppedAt)
      : segment.placeMatchKind === "unknown" &&
        Date.parse(segment.stoppedAt ?? segment.startedAt) - Date.parse(segment.startedAt) < LOCATION_ENGINE_V2_CONFIG.unknownStayReviewDwellMs);
  changes.count += await retireCoveredCandidateCards(client, session,
    segments.filter((segment) => tooShort(segment) && stayIds.has(segment.clientSegmentId)).map(clientEventIdOf));
  const candidates = segments.flatMap(segment => {
    if (tooShort(segment)) return [];
    const segmentId = (segment.kind === "stay" ? stayIds : commuteIds).get(segment.clientSegmentId);
    if (!segmentId) return [];
    return [{ segment, segmentId, clientEventId: clientEventIdOf(segment) }];
  }).sort((a, b) => a.clientEventId < b.clientEventId ? -1 : a.clientEventId > b.clientEventId ? 1 : 0);
  if (!candidates.length) return 0;
  const context = await displayContext(client, session, candidates.map(row => row.segment), stayIds, corrections.correctedMoves);
  const offerable = candidates.filter(row => context(row.segment).trusted?.loggingEnabled !== false);
  // Health walks win (PRD D19): a Move an Apple Health workout of its kind covers is the workout.
  // It is not offered (nor reopened) here; replay retires any open card for it afterwards
  // (retireHealthCoveredMoveCards), and it comes back if the workout goes while its evidence lasts.
  const healthCovered = await healthCoveredMoves(client, session, offerable);
  changes.count += await retireCoveredCandidateCards(client, session, [...healthCovered]);
  changes.count += await retireCoveredAutoMoves(client, session, [...healthCovered], autoLog.locked);
  const eligible = offerable.filter((row) => !healthCovered.has(row.clientEventId));
  const existing = new Map<string, { id: string; clientEventId: string; reviewStatus: string; autoLogSuperseded: boolean }>();
  for (const batch of chunks(eligible)) {
    const result = await client.query<{ id: string; clientEventId: string; reviewStatus: string; autoLogSuperseded: boolean }>(
      `select id, client_event_id as "clientEventId", review_status as "reviewStatus",
              coalesce(raw_payload ? '${AUTO_LOG_SUPERSEDED_PAYLOAD_KEY}', false) as "autoLogSuperseded"
       from activity_events
       where workspace_id = $1 and user_id = $2 and client_event_id = any($3::text[])
       order by client_event_id for update`, [session.workspaceId, session.userId, batch.map(row => row.clientEventId)]);
    for (const row of result.rows) existing.set(row.clientEventId, row);
  }
  // A stay whose auto-logged visit replay retired, back in the output: offered again as new (it never
  // had a Review). Its block moved on or was removed when it was retired.
  const freshAgain = new Set<string>();
  const retiredAutoLog = [...existing.values()].filter((row) => row.reviewStatus === "ignored" && row.autoLogSuperseded);
  for (const batch of chunks(retiredAutoLog)) {
    await client.query(
      `update activity_events set review_status = 'needs_review', raw_payload = raw_payload - '${AUTO_LOG_SUPERSEDED_PAYLOAD_KEY}'
       where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'ignored'`,
      [session.workspaceId, session.userId, batch.map((row) => row.id)]);
    for (const row of batch) {
      row.reviewStatus = "needs_review";
      freshAgain.add(row.clientEventId);
    }
  }
  // A segment back in the output after replay retired it is offered again.
  const ignored = [...existing.values()].filter((row) => row.reviewStatus === "ignored");
  for (const batch of chunks(ignored)) {
    const reopened = await reopenSupersededReviews(client, session, batch.map((row) => row.id));
    for (const row of batch) if (reopened.has(row.id)) row.reviewStatus = "needs_review";
    changes.count += reopened.size;
  }
  // Commute only between Home and Work, Errands (if the workspace has it) for a Move with a stop,
  // Travel for every other Move (PRD D19, A5). Commute's lock comes before Travel's.
  const moveActivities = new Set(eligible.flatMap((row) => row.segment.kind === "commute" ? [context(row.segment).move?.activity] : []));
  const commuteCategoryId = moveActivities.has("commute") ? await ensureCommuteCategoryId(client, session, changes) : null;
  const errandsCategoryId = moveActivities.has("errand") ? await findErrandsCategoryId(client, session) : null;
  const travelCategoryId = moveActivities.has("travel") || (moveActivities.has("errand") && !errandsCategoryId)
    ? await ensureTravelCategoryId(client, session, changes) : null;
  const moveCategoryId = (move: MoveName | null | undefined) => move?.activity === "commute" ? commuteCategoryId
    : move?.activity === "errand" ? errandsCategoryId ?? travelCategoryId : travelCategoryId;
  // Replay locked every block it may touch once, in entry-id order, before emission (Codex r2/r3 on
  // #435): only those are moved or removed.
  const lockedOrphans = autoLog.orphans.filter((orphan) => autoLog.locked.has(orphan.entryId));
  const autoLogged = await chooseAutoLoggedVisits(client, session, eligible, context, existing, freshAgain, lockedOrphans);
  // Learned names (PRD D19, A8): a name the person gave this pattern is the card's name, and its
  // activity the card's activity; after two uses it also names a Log automatically block.
  const patterns = await namePatternsFor(client, session, eligible, stayIds, commuteIds, evidenceTimeZones, corrections.correctedMoves);
  const learnedNames = await learnedNamesFor(client, session, patterns);
  // Moves log themselves (PRD D19, A3/A4) when the person's switch is on and the evidence is clear.
  const moveIds = new Set(eligible.flatMap((row) => row.segment.kind === "commute" ? [row.clientEventId] : []));
  const autoMoves = await chooseAutoLoggedMoves(client, session, eligible, {
    stays: new Map(segments.flatMap((segment) => segment.kind === "stay" ? [[segment.clientSegmentId, segment] as const] : [])),
    prior: new Set(existing.keys()),
    freshAgain,
    optedOut: moveIds.size ? await optedOutMoves(client, session, patterns, moveIds) : new Set(),
    orphanEntryIds: lockedOrphans.map((orphan) => orphan.entryId),
    enabled: moveIds.size > 0 && await logTripsAutomatically(client, session)
  });
  const rows = eligible.map(({ segment, segmentId, clientEventId }) => {
    const { trusted, title: placeTitle, move } = context(segment);
    const pattern = patterns.get(clientEventId);
    const learned = learnedNames.get(clientEventId);
    const title = learned?.name ?? placeTitle;
    // The activity a person corrected this Stay to (Save this place) comes first, then a learned one.
    const corrected = corrections.correctedCategories.has(segment.clientSegmentId);
    const learnedActivity = !corrected && learned?.categoryId ? learned.categoryId : null;
    const categoryId = corrected ? corrections.correctedCategories.get(segment.clientSegmentId) ?? null
      : learnedActivity ?? (segment.kind === "commute" ? moveCategoryId(move) : trusted?.categoryId ?? null);
    const nameFields = pattern ? {
      namePatternKey: pattern.key, namePatternBand: pattern.band,
      ...(learned?.name ? { nameSource: "learned" } : {}),
      // An activity the person chose when saving the place stays theirs to teach (Codex r5 on #459).
      ...(learnedActivity || (corrected && corrections.chosenCategories.has(segment.clientSegmentId)) ? { activitySource: "learned" } : {})
    } : {};
    const placeId = trusted?.id ?? (segment.kind === "stay" ? segment.placeId ?? null : null);
    const disposition = locationSemanticDisposition("v2_review", segment);
    // Same pure overlap result as the original review path; never read time entries here.
    const overlapDecision = assessAutomaticOverlap({kind: segment.kind === "commute" ? "location_commute" : "location_stay",
      startedAt: segment.startedAt, stoppedAt: segment.stoppedAt!, placeId, clientEventId}, []);
    const overlapsConfirmedTime = !overlapDecision.allowed;
    const semanticReason = overlapsConfirmedTime
      ? overlapDecision.reason
      : reviewModeSemanticReason(segment, trusted, segment.kind === "commute"
        ? autoMoves.fallback.get(clientEventId) : autoLogged.fallback.get(clientEventId));
    const policyEvidence = {
      policyVersion: AUTOMATIC_LOCATION_POLICY_VERSION,
      confidenceTier: disposition.confidenceTier,
      startUncertaintySeconds: disposition.boundary.startUncertaintyMs == null ? null : disposition.boundary.startUncertaintyMs / 1_000,
      stopUncertaintySeconds: disposition.boundary.stopUncertaintyMs == null ? null : disposition.boundary.stopUncertaintyMs / 1_000,
      maximumObservationGapSeconds: segment.kind === "commute" ? segment.maximumObservationGapSeconds ?? null : null,
      maximumOverlapSeconds: overlapDecision.maximumOverlapMs / 1_000,
      overlapReason: overlapDecision.reason,
      overlapClass: overlapDecision.overlapClass
    };
    const rawPayload = segment.kind === "stay"
      ? {
          ...policyEvidence,
          clientSegmentId: segment.clientSegmentId,
          algorithmVersion: segment.algorithmVersion,
          placeMatchKind: segment.placeMatchKind,
          evidenceCount: segment.evidenceIds.length,
          continuityStatus: segment.continuityStatus,
          startedAt: segment.startedAt,
          stoppedAt: segment.stoppedAt,
          ...nameFields,
          semanticDisposition: "needs_review",
          semanticReason
        }
      : {
          ...policyEvidence,
          clientSegmentId: segment.clientSegmentId,
          algorithmVersion: segment.algorithmVersion,
          fromStaySegmentId: segment.fromStaySegmentId,
          toStaySegmentId: segment.toStaySegmentId,
          routeSampleCount: segment.routeSampleCount,
          qualificationReason: segment.qualificationReason ?? null,
          // Only when Motion & Fitness supplied them, so other proposals' payloads do not change.
          ...(segment.travelMode ? { travelMode: segment.travelMode } : {}),
          ...(segment.motionSupported ? { motionSupported: true } : {}),
          // Time away only: how many unnamed stops it included.
          ...(isTimeAway(segment) && segment.stops?.length ? { stopCount: segment.stops.length } : {}),
          // The Move's second line ("Home → Gym", "Round trip from Home"; PRD D19).
          ...(move ? { routeLabel: move.route } : {}),
          continuityStatus: segment.continuityStatus,
          startedAt: segment.startedAt,
          stoppedAt: segment.stoppedAt,
          ...nameFields,
          semanticDisposition: "needs_review",
          semanticReason
        };
    const eventType = segment.kind === "commute" ? "commute_detected" : segment.placeMatchKind === "learned"
      ? "learned_place_visit" : segment.placeMatchKind === "saved" ? "geofence_exit" : "unknown_stay";
    // Log automatically (a visit) or a Move that logs itself: confirmed now, never a Review card.
    const autoLog = autoLogged.logged.has(clientEventId) || autoMoves.logged.has(clientEventId);
    const payload: Record<string, unknown> = autoLog
      ? { ...rawPayload, semanticDisposition: "auto_logged", semanticReason: segment.kind === "commute" ? "move_auto_log" : "place_auto_log" }
      : rawPayload;
    return { client_event_id: clientEventId, segment_id: segmentId, kind: segment.kind,
      event_type: eventType, occurred_at: segment.startedAt, stopped_at: segment.stoppedAt,
      confidence: segment.confidence, raw_payload: payload, category_id: categoryId, place_id: placeId, title,
      auto_log: autoLog,
      description: autoLog ? (learned?.name && learned.uses >= 2 ? learned.name : trusted?.description?.trim() || null) : null,
      initial_review_status: autoLog ? "confirmed" : "needs_review",
      review_status: autoLog ? "confirmed" : existing.get(clientEventId)?.reviewStatus ?? "needs_review",
      notes: overlapsConfirmedTime
        ? `Automatic logging paused because this ${segment.kind === "commute" ? "commute" : "visit"} conflicts with tracked time by more than five minutes. You can still confirm it from Review.`
        : segment.continuityStatus === "uncertain_gap"
        ? "The boundary includes an evidence gap; check the Calendar before confirming."
        : "Ordered location evidence supports this suggestion." };
  });
  // One card per outing (PRD D19): an unknown Stay's card and the Move cards either side of it share
  // an outing key, so clients show them as one card and decide them together (`confirm_outing`).
  tagOutings(rows);
  const eventIds = new Map<string, string>();
  for (const batch of chunks(rows)) {
    // `previous` reads the rows as they were before this statement (all CTEs share one snapshot), so
    // `changed` says whether an existing event's stored fields really changed: Review renders its payload
    // (Motion & Fitness travel mode, for one) even when the Review item's own columns stay the same.
    const events = await client.query<{id: string; clientEventId: string; changed: boolean}>(`
      with previous as (
        select client_event_id, occurred_at, confidence, raw_payload, suggested_category_id, suggested_place_id
        from activity_events
        where workspace_id = $1 and user_id = $2
          and client_event_id in (select r.client_event_id from jsonb_to_recordset($3::jsonb) as r(client_event_id text))
      ), upserted as (
      insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at,
        confidence, raw_payload, suggested_category_id, suggested_place_id, review_status)
      select $1, $2, r.client_event_id, 'location_learning', r.event_type, r.occurred_at,
        r.confidence, r.raw_payload, r.category_id, r.place_id, r.initial_review_status
      from jsonb_to_recordset($3::jsonb) as r(client_event_id text, event_type text, occurred_at timestamptz,
        confidence text, raw_payload jsonb, category_id uuid, place_id uuid, initial_review_status text)
     on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null
     do update set
       -- Only a stay offered again after its auto-logged visit was retired (it has no Review) is
       -- confirmed here; every other event keeps its status.
       review_status = case
         when activity_events.review_status = 'needs_review' and excluded.review_status = 'confirmed' then 'confirmed'
         else activity_events.review_status
       end,
       occurred_at = case
         when activity_events.review_status = 'needs_review' then excluded.occurred_at
         else activity_events.occurred_at
       end,
       confidence = case
         when activity_events.review_status = 'needs_review' then excluded.confidence
         else activity_events.confidence
       end,
       raw_payload = case
         when activity_events.review_status = 'needs_review' then ${PRESERVE_REVIEW_TITLE_HISTORY_SQL}
         else activity_events.raw_payload
       end,
       suggested_category_id = case
         when activity_events.review_status = 'needs_review' then excluded.suggested_category_id
         else activity_events.suggested_category_id
       end,
       suggested_place_id = case
         when activity_events.review_status = 'needs_review' then excluded.suggested_place_id
         else activity_events.suggested_place_id
       end

      returning id, client_event_id, occurred_at, confidence, raw_payload, suggested_category_id, suggested_place_id
      )
      select u.id, u.client_event_id as "clientEventId",
        (p.client_event_id is not null and
          (p.occurred_at, p.confidence, p.raw_payload, p.suggested_category_id, p.suggested_place_id)
          is distinct from (u.occurred_at, u.confidence, u.raw_payload, u.suggested_category_id, u.suggested_place_id)
        ) as changed
      from upserted u left join previous p on p.client_event_id = u.client_event_id`,
      [session.workspaceId, session.userId, JSON.stringify(batch)]);
    for (const event of events.rows) eventIds.set(event.clientEventId, event.id);
    // New events are counted through the Review item inserted for each below.
    changes.count += events.rows.filter((event) => event.changed).length;
  }
  const linked = rows.map(row => ({ ...row, event_id: eventIds.get(row.client_event_id)! }));
  for (const row of linked.filter((candidate) => candidate.auto_log)) {
    changes.count += await writeAutoLoggedBlock(client, session, row, autoLog);
  }
  // A visit (or a Move, PRD D19) already auto-logged whose segment kept its ID while its boundaries
  // moved (a late fix): its unedited block follows (Codex r1 on #435). Only within the reconciliation
  // window, where replay re-persisted the segment; elsewhere it is a decision and its block stays put.
  if (autoLog.reconciliation) {
    const since = Date.parse(autoLog.reconciliation.sinceAt);
    // A Move's block follows only while the Move, so moved, would still log itself: clear, and over no
    // tracked time beyond five minutes nor a running timer (its own block aside); otherwise the block
    // stays where it was logged (Codex r1 on #462).
    const segmentOf = new Map(eligible.map((row) => [row.clientEventId, row.segment]));
    const stayById = new Map(segments.flatMap((segment) => segment.kind === "stay" ? [[segment.clientSegmentId, segment] as const] : []));
    const moves = linked.filter((row) => !row.auto_log && row.kind === "commute" && Date.parse(row.occurred_at) >= since &&
      existing.get(row.client_event_id)?.reviewStatus === "confirmed");
    const stillClear = moves.filter((row) => {
      const segment = segmentOf.get(row.client_event_id);
      return segment?.kind === "commute" && assessAutomaticMove(segment, moveEndsKnown(segment, stayById)).eligible;
    });
    const blockedMoves = await movesBlocked(client, session, stillClear.map((row) => ({
      key: row.client_event_id, startedAt: row.occurred_at, stoppedAt: row.stopped_at!, eventId: row.event_id
    })), lockedOrphans.map((orphan) => orphan.entryId), "overlap");
    const unfollowed = new Set(moves.filter((row) => !stillClear.includes(row) || blockedMoves.has(row.client_event_id))
      .map((row) => row.client_event_id));
    const followed = linked.filter((row) => !row.auto_log && Date.parse(row.occurred_at) >= since && !unfollowed.has(row.client_event_id));
    for (const batch of chunks(followed)) {
      const bounds = JSON.stringify(batch.map((row) => ({
        event_id: row.event_id, occurred_at: row.occurred_at, stopped_at: row.stopped_at
      })));
      // Only blocks this replay locked above (entry-id order, once).
      const moved = await client.query(
        `update time_entries te set started_at = r.occurred_at, stopped_at = r.stopped_at, updated_at = now()
         from jsonb_to_recordset($3::jsonb) as r(event_id uuid, occurred_at timestamptz, stopped_at timestamptz)
         where te.workspace_id = $1 and te.user_id = $2 and te.id = any($4::uuid[])
           and te.created_from_event_id = r.event_id
           and te.source = '${LOCATION_AUTO_LOG_SOURCE}' and te.user_edited_at is null
           and (te.started_at, te.stopped_at) is distinct from (r.occurred_at, r.stopped_at)`,
        [session.workspaceId, session.userId, bounds, [...autoLog.locked]]);
      changes.count += moved.rowCount ?? 0;
    }
    // A Move that logged itself keeps its event in step with the Move replay re-emits under the same
    // ID — its window when its unedited block followed, and its current travel mode — so checks that
    // read the event (Health coverage, "logged before") judge the Move as it now is (Codex r4 on #462).
    const followedIds = new Set(followed.map((row) => row.client_event_id));
    for (const batch of chunks(moves)) {
      await client.query(
        `update activity_events ae
         set raw_payload = (ae.raw_payload - 'travelMode')
           || case when r.travel_mode is null then '{}'::jsonb else jsonb_build_object('travelMode', r.travel_mode) end
           || case when r.followed then jsonb_build_object('startedAt', r.started_at, 'stoppedAt', r.stopped_at) else '{}'::jsonb end
         from jsonb_to_recordset($3::jsonb) as r(event_id uuid, travel_mode text, followed boolean, started_at text, stopped_at text)
         where ae.workspace_id = $1 and ae.user_id = $2 and ae.id = r.event_id
           and ae.review_status = 'confirmed' and ae.raw_payload ->> 'semanticDisposition' = 'auto_logged'
           and exists (select 1 from time_entries te where te.workspace_id = $1 and te.user_id = $2
             and te.created_from_event_id = ae.id and te.source = '${LOCATION_AUTO_LOG_SOURCE}' and te.user_edited_at is null)`,
        [session.workspaceId, session.userId, JSON.stringify(batch.map((row) => ({
          event_id: row.event_id, travel_mode: (row.raw_payload as { travelMode?: string }).travelMode ?? null,
          followed: followedIds.has(row.client_event_id), started_at: row.occurred_at, stopped_at: row.stopped_at
        })))]);
    }
  }
  for (const batch of chunks(linked.filter(row => row.review_status === "needs_review"))) {
    const parameters = [session.workspaceId, session.userId, JSON.stringify(batch)];
    const inserted = await client.query(`insert into review_items (workspace_id,user_id,event_id,location_segment_id,type,title,
      suggested_category_id,suggested_place_id,suggested_started_at,suggested_stopped_at,confidence,status,notes)
      select $1,$2,r.event_id,r.segment_id,r.event_type || '_suggestion',r.title,r.category_id,r.place_id,
        r.occurred_at,r.stopped_at,r.confidence,'open',r.notes
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid,event_type text,title text,
        category_id uuid,place_id uuid,occurred_at timestamptz,stopped_at timestamptz,confidence text,notes text)
      where not exists (select 1 from review_items where workspace_id=$1 and user_id=$2 and event_id=r.event_id)`, parameters);
    changes.count += inserted.rowCount ?? 0;
    // Keep every title Dayframe suggested (E1): the outgoing one before a retitle, the new one after.
    const batchEventIds = batch.map(row => row.event_id);
    await recordReviewTitleHistory(client, session, batchEventIds);
    // Preserve the original update list: in particular type and status are never changed.
    // Unchanged rows are skipped (no other effect: review_items has no updated_at, and its owner trigger
    // fires only on owner columns), so the row count is the number of items that really changed.
    const updated = await client.query(`update review_items target set location_segment_id=r.segment_id,title=r.title,
      suggested_category_id=r.category_id,suggested_place_id=r.place_id,suggested_started_at=r.occurred_at,
      suggested_stopped_at=r.stopped_at,confidence=r.confidence,notes=r.notes
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid,title text,category_id uuid,place_id uuid,
        occurred_at timestamptz,stopped_at timestamptz,confidence text,notes text)
      where target.workspace_id=$1 and target.user_id=$2 and target.event_id=r.event_id and target.status='open'
        and (target.location_segment_id,target.title,target.suggested_category_id,target.suggested_place_id,
          target.suggested_started_at,target.suggested_stopped_at,target.confidence,target.notes)
          is distinct from (r.segment_id,r.title,r.category_id,r.place_id,r.occurred_at,r.stopped_at,r.confidence,r.notes)`, parameters);
    changes.count += updated.rowCount ?? 0;
    await recordReviewTitleHistory(client, session, batchEventIds);
  }
  for (const batch of chunks(linked.filter(row => row.kind === "stay"))) {
    await client.query(`update stay_segments target set created_from_event_id=r.event_id,
      review_status=r.review_status,updated_at=now()
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid,review_status text)
      where target.workspace_id=$1 and target.user_id=$2 and target.id=r.segment_id`,
    [session.workspaceId, session.userId, JSON.stringify(batch)]);
  }
  for (const batch of chunks(linked.filter(row => row.kind === "commute"))) {
    await client.query(`update commute_segments target set created_from_event_id=r.event_id,updated_at=now()
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid)
      where target.workspace_id=$1 and target.user_id=$2 and target.id=r.segment_id`,
    [session.workspaceId, session.userId, JSON.stringify(batch)]);
  }
  return rows.length;
}

type SemanticCandidate = { segment: LocationSegment; segmentId: string; clientEventId: string };
type SegmentContext = (segment: LocationSegment) => { trusted: Place | null; title: string; move: MoveName | null };

/**
 * Log automatically (owner decision 14 Oct 2026): the stays this emission logs as blocks instead of
 * Review cards. Only a stay at a saved place (or a learned place linked to one) with logging and Log
 * automatically on, never offered in Review before (under any segment ID: no Review card for an
 * overlapping visit at that place), that passes the trusted-stay policy of PR #186
 * (confidence, continuity, five-minute boundaries; the same rule `v2_enabled` uses) and overlaps no
 * tracked time at all, a running timer included. Anything else stays a Review card, and `fallback`
 * says why (location v3 bug 8), checked in this order: the policy, an overlapping block, a visit
 * here logged before, offered in Review before. Stays under five minutes never get here
 * (`hasMeaningfulKnownPlaceWindow`). One bounded read per 250 stays.
 */
async function chooseAutoLoggedVisits(
  client: pg.PoolClient, session: RequestSession, eligible: SemanticCandidate[], context: SegmentContext,
  existing: ReadonlyMap<string, { reviewStatus: string }>, freshAgain: ReadonlySet<string>, orphans: AutoLogOrphan[]
) {
  const logged = new Set<string>();
  const fallback = new Map<string, AutoLogFallbackReason | ReturnType<typeof autoLogPolicyFallback>>();
  const candidates = eligible.filter(({ segment, clientEventId }) => {
    if (segment.kind !== "stay") return false;
    const { trusted } = context(segment);
    if (!trusted?.autoLog || trusted.loggingEnabled === false) return false;
    // Decided (logged, confirmed or skipped) and not offered again: its payload is kept as it is, so
    // neither the decision nor a reason is needed, and replay spends no read on it (Codex r1 on #450).
    const prior = existing.get(clientEventId);
    if (prior && prior.reviewStatus !== "needs_review" && !freshAgain.has(clientEventId)) return false;
    const policy = assessAutomaticLocation("v2_enabled", segment);
    if (policy.action !== "auto_confirm") {
      fallback.set(clientEventId, autoLogPolicyFallback(policy.reason));
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return { logged, fallback };
  // A retired visit's own block is about to move or go: it never blocks its replacement.
  const orphanIds = orphans.map((orphan) => orphan.entryId);
  const blocked = new Map<string, { reason: "overlap" | "logged" | "offered" | null }>();
  for (const batch of chunks(candidates)) {
    // One ordered CASE gives the first reason that holds, so each check runs at most once and only
    // when the ones before it failed (Codex r2 on #450). A card already offered here skips the last
    // check (it was offered, whatever that read says) but keeps the order before it, so an identical
    // replay gives it the same reason.
    const result = await client.query<{ clientEventId: string; reason: "overlap" | "logged" | "offered" | null }>(
      `select r.client_event_id as "clientEventId", case
         -- Any block not ignored, however long (a timer left running for days and then stopped) or
         -- still running (Codex r2 on #435); a range scan of idx_time_entries_workspace_started.
         when exists (
           select 1 from time_entries te
           where te.workspace_id = $1 and te.user_id = $2 and te.review_status <> 'ignored'
             and te.started_at < r.stopped_at and coalesce(te.stopped_at, 'infinity'::timestamptz) > r.started_at
             and not (te.id = any($4::uuid[]))) then 'overlap'
         -- Another visit at the place already auto-logged and still a decision (its block deleted or
         -- edited; a retired one is no longer confirmed): never logged twice, even when the deletion
         -- landed while this replay ran (Codex r3 on #435).
         when exists (
           select 1 from activity_events ae
           where ae.workspace_id = $1 and ae.user_id = $2 and ae.suggested_place_id = r.place_id
             and ae.review_status = 'confirmed' and ae.raw_payload ->> 'semanticDisposition' = 'auto_logged'
             and ae.client_event_id <> r.client_event_id
             and ae.occurred_at < r.stopped_at and (ae.raw_payload ->> 'stoppedAt')::timestamptz > r.started_at) then 'logged'
         when r.offered_here then 'offered'
         -- Offered in Review before under another segment ID (its stay was replaced): stays a card
         -- whatever became of that card (Codex r1 on #435).
         when exists (
           select 1 from review_items ri
           where ri.workspace_id = $1 and ri.user_id = $2 and ri.suggested_place_id = r.place_id
             and ri.suggested_started_at < r.stopped_at and ri.suggested_stopped_at > r.started_at) then 'offered'
       end as reason
       from jsonb_to_recordset($3::jsonb)
         as r(client_event_id text, place_id uuid, started_at timestamptz, stopped_at timestamptz, offered_here boolean)`,
      [session.workspaceId, session.userId, JSON.stringify(batch.map(({ segment, clientEventId }) => ({
        client_event_id: clientEventId, place_id: context(segment).trusted?.id ?? null,
        started_at: segment.startedAt, stopped_at: segment.stoppedAt,
        offered_here: existing.has(clientEventId) && !freshAgain.has(clientEventId)
      }))), orphanIds]);
    for (const row of result.rows) blocked.set(row.clientEventId, row);
  }
  for (const { clientEventId } of candidates) {
    // Decided once: a stay already offered in Review stays there (the read says "offered").
    const found = blocked.get(clientEventId)?.reason ?? null;
    const reason: AutoLogFallbackReason | null = found === "overlap" ? "auto_log_overlap"
      : found === "logged" ? "auto_log_logged_before"
        : found === "offered" ? "auto_log_offered_before" : null;
    if (reason) fallback.set(clientEventId, reason);
    else logged.add(clientEventId);
  }
  return { logged, fallback };
}

/**
 * Writes one auto-logged visit's (or Move's) block: the unedited block of a visit (Move) replay just
 * retired at the same place and overlapping time moves to this one (owner decision 15 Oct 2026: the block follows the
 * visit), otherwise a new block tied to the stay's event, at most one per event. Returns the number
 * of blocks written.
 */
async function writeAutoLoggedBlock(
  client: pg.PoolClient, session: RequestSession,
  row: { event_id: string; kind: string; place_id: string | null; category_id: string | null; description: string | null;
    occurred_at: string; stopped_at?: string | null; confidence: string },
  autoLog: { orphans: AutoLogOrphan[]; used: Set<string>; locked: ReadonlySet<string> }
) {
  const start = Date.parse(row.occurred_at);
  const stop = row.stopped_at ? Date.parse(row.stopped_at) : Number.POSITIVE_INFINITY;
  const orphan = autoLog.orphans.find((candidate) => autoLog.locked.has(candidate.entryId) && !autoLog.used.has(candidate.entryId) &&
    // A visit's block moves only to a visit, a Move's only to a Move (PRD D19).
    (candidate.kind ?? "stay") === (row.kind === "commute" ? "commute" : "stay") &&
    candidate.placeId === row.place_id && Date.parse(candidate.startedAt) < stop &&
    (candidate.stoppedAt ? Date.parse(candidate.stoppedAt) : Number.POSITIVE_INFINITY) > start);
  if (orphan) {
    const moved = await client.query(
      `update time_entries
       set started_at = $4, stopped_at = $5, created_from_event_id = $6, confidence = $7, updated_at = now()
       where workspace_id = $1 and user_id = $2 and id = $3
         and source = '${LOCATION_AUTO_LOG_SOURCE}' and user_edited_at is null`,
      [session.workspaceId, session.userId, orphan.entryId, row.occurred_at, row.stopped_at, row.event_id, row.confidence]);
    if (moved.rowCount) {
      autoLog.used.add(orphan.entryId);
      return 1;
    }
  }
  const inserted = await client.query(
    `insert into time_entries (workspace_id, user_id, category_id, place_id, source, confidence, review_status,
       description, started_at, stopped_at, created_from_event_id)
     select $1, $2, $3, $4, '${LOCATION_AUTO_LOG_SOURCE}', $5, 'confirmed', $6, $7, $8, $9
     where not exists (
       select 1 from time_entries where workspace_id = $1 and user_id = $2 and created_from_event_id = $9)`,
    [session.workspaceId, session.userId, row.category_id, row.place_id, row.confidence, row.description,
      row.occurred_at, row.stopped_at, row.event_id]);
  return inserted.rowCount ?? 0;
}
