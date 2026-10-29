import type pg from "pg";
import {
  applyTimelineCorrectionsWithJoins,
  mergeSameModeLegs,
  sameKnownPlace,
  TimelineCorrectionRequestSchema,
  type LocationSegment,
  type TimelineCorrection,
  type TimelineCorrectionRequest,
  type TripLeg
} from "@dayframe/shared";
import { withSyncTransaction } from "../sync-transaction";
import { reconcileTimerTripClashes } from "./timer-trip-clash-service";
import type { RequestSession } from "../session";
import { placeDisplayNameSql } from "../place-display";
import { SUPERSEDED_REVIEW_SCOPE } from "./location-review-supersession";
import { recordReviewTitleHistory } from "./review-title-history";
import { resolveLocationReviewActionWithClient } from "./location-review-service";

/**
 * Timeline corrections (location v4 §4, §14; build step 11). Event-first, in one owner-locked
 * transaction: an activity event, the correction row tied to the time it covers, then the segment it
 * changes. Replay applies every active correction again (`activeTimelineCorrections` +
 * `applyTimelineCorrections`), so replay never undoes what the person set. A place's place or times, or a
 * trip's times or existence, are not corrected here once it has a block: its block is what the person
 * edits. A leg's mode is, on any trip. Step 12 part 4: a place the person wasn't at joins the trips either
 * side into one ("I wasn't here"), and a trip they didn't take joins the two visits to one place either side
 * ("I didn't leave"); neither when a block was made from any item it joins. Never coordinates.
 */

export class TimelineCorrectionError extends Error {
  constructor(message: string, readonly status: 404 | 409 | 422) {
    super(message);
  }
}

type CorrectionRow = {
  id: string; subject: TimelineCorrection["subject"]; kind: TimelineCorrection["kind"];
  spanStartedAt: Date; spanStoppedAt: Date; target: TimelineCorrection["target"]; createdAt: Date;
};

const iso = (value: Date | string) => new Date(value).toISOString();

function correctionFromRow(row: CorrectionRow): TimelineCorrection {
  return {
    id: row.id,
    subject: row.subject,
    kind: row.kind,
    spanStartedAt: iso(row.spanStartedAt),
    spanStoppedAt: iso(row.spanStoppedAt),
    target: row.target ?? {},
    createdAt: iso(row.createdAt)
  };
}

/** The person's active corrections overlapping [from, to), oldest first, for replay to apply again. */
export async function activeTimelineCorrections(client: pg.PoolClient, session: RequestSession, from: string, to: string) {
  const result = await client.query<CorrectionRow>(
    `select id, subject, kind, span_started_at as "spanStartedAt", span_stopped_at as "spanStoppedAt", target,
            created_at as "createdAt"
       from location_timeline_corrections
      where workspace_id = $1 and user_id = $2 and replaced_at is null
        and span_started_at < $4::timestamptz and span_stopped_at > $3::timestamptz
      order by created_at, id`,
    [session.workspaceId, session.userId, from, to]);
  return result.rows.map(correctionFromRow);
}

/**
 * Replay's segments with the person's corrections applied; unchanged when there are none. `joinedStayIds`, when
 * given, is filled with the stays "I didn't leave" folded into another (id → the one that stands for it).
 */
export async function withTimelineCorrections(
  client: pg.PoolClient, session: RequestSession, segments: LocationSegment[], processingAt: string,
  joinedStayIds?: Map<string, string>
): Promise<LocationSegment[]> {
  if (!segments.length) return segments;
  const from = segments.reduce((min, segment) => Math.min(min, Date.parse(segment.startedAt)), Number.POSITIVE_INFINITY);
  const nowMs = Date.parse(processingAt);
  const to = segments.reduce((max, segment) => Math.max(max, segment.stoppedAt ? Date.parse(segment.stoppedAt) : nowMs), from);
  const corrections = await activeTimelineCorrections(client, session, new Date(from).toISOString(), new Date(Math.max(to, from + 1)).toISOString());
  if (!corrections.length) return segments;
  // A place the person picked that has since been deleted (or a learned place no longer accepted) is no
  // longer theirs to apply: that correction is skipped, never written back (Codex r2 on #566).
  const placeIds = [...new Set(corrections.flatMap((correction) => correction.target.placeId ? [correction.target.placeId] : []))];
  const learnedIds = [...new Set(corrections.flatMap((correction) => correction.target.learnedPlaceId ? [correction.target.learnedPlaceId] : []))];
  const known = new Set<string>();
  if (placeIds.length) {
    for (const row of (await client.query<{ id: string }>(`select id from places where workspace_id = $1 and id = any($2::uuid[])`,
      [session.workspaceId, placeIds])).rows) known.add(row.id);
  }
  if (learnedIds.length) {
    for (const row of (await client.query<{ id: string }>(
      `select id from learned_places where workspace_id = $1 and user_id = $2 and status = 'accepted' and id = any($3::uuid[])`,
      [session.workspaceId, session.userId, learnedIds])).rows) known.add(row.id);
  }
  const usable = corrections.filter((correction) => correction.kind !== "place" ||
    ((!correction.target.placeId || known.has(correction.target.placeId)) &&
      (!correction.target.learnedPlaceId || known.has(correction.target.learnedPlaceId))));
  if (!usable.length) return segments;
  const applied = applyTimelineCorrectionsWithJoins(segments, usable, nowMs);
  for (const [from, to] of applied.joinedStayIds) joinedStayIds?.set(from, to);
  return applied.segments;
}

type SegmentRow = {
  id: string; startedAt: Date; stoppedAt: Date | null; createdFromEventId: string | null; metadata: Record<string, unknown>;
};

async function lockSegment(client: pg.PoolClient, session: RequestSession, table: "stay_segments" | "commute_segments", itemId: string) {
  // Trusted table name; the item is the timeline's id for it (its client segment id).
  const result = await client.query<SegmentRow>(
    `select id, started_at as "startedAt", stopped_at as "stoppedAt", created_from_event_id as "createdFromEventId", metadata
       from ${table}
      where workspace_id = $1 and user_id = $2 and client_segment_id = $3 and status <> 'superseded'
      order by updated_at desc
      limit 1
      for update`,
    [session.workspaceId, session.userId, itemId]);
  const row = result.rows[0];
  if (!row) throw new TimelineCorrectionError("That place or trip is no longer in your day.", 404);
  return row;
}

/**
 * Whether a block was made from this segment, so its block is what the person edits: a time entry made
 * from the segment's own event, or from an event naming it (`clientSegmentId`, or a Review correction's
 * `segmentId`, the row id). An open Review suggestion has an event but no time entry, so it is no block
 * (Codex r1 on #566).
 */
async function hasBlock(client: pg.PoolClient, session: RequestSession, itemId: string, row: SegmentRow) {
  const result = await client.query(
    `select 1 from time_entries te
       join activity_events ae on ae.id = te.created_from_event_id
        and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
      where te.workspace_id = $1 and te.user_id = $2
        and (te.created_from_event_id = $5::uuid
          or (ae.raw_payload ? 'clientSegmentId' and ae.raw_payload ->> 'clientSegmentId' = $3)
          or (ae.raw_payload ? 'segmentId' and ae.raw_payload ->> 'correction' = 'true' and ae.raw_payload ->> 'segmentId' = $4))
      limit 1`,
    [session.workspaceId, session.userId, itemId, row.id, row.createdFromEventId]);
  return (result.rowCount ?? 0) > 0;
}

function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number) {
  return Math.min(aTo, bTo) > Math.max(aFrom, bFrom);
}

/**
 * The span a correction is tied to: the engine's span for the item. An item the person already corrected
 * carries that span (`correctionSpan` in its metadata, kept by replay), since its times may differ from
 * what the engine derives; never a neighbour's span (Codex r1 on #566).
 */
function correctionSpan(row: SegmentRow, startedAt: string, stoppedAt: string) {
  const kept = row.metadata?.correctionSpan as { startedAt?: unknown; stoppedAt?: unknown } | undefined;
  return typeof kept?.startedAt === "string" && typeof kept.stoppedAt === "string" &&
    Number.isFinite(Date.parse(kept.startedAt)) && Date.parse(kept.stoppedAt) > Date.parse(kept.startedAt)
    ? { startedAt: iso(kept.startedAt), stoppedAt: iso(kept.stoppedAt) } : { startedAt, stoppedAt };
}

function targetFor(request: TimelineCorrectionRequest): TimelineCorrection["target"] {
  switch (request.kind) {
    case "place": return { placeId: request.placeId, learnedPlaceId: request.learnedPlaceId };
    case "times": return { startedAt: iso(request.startedAt), stoppedAt: iso(request.stoppedAt) };
    case "leg_mode": return { mode: request.mode };
    case "delete":
    case "merge":
    case "log_place": return {};
  }
}

async function assertOwnPlace(client: pg.PoolClient, session: RequestSession, request: Extract<TimelineCorrectionRequest, { kind: "place" }>) {
  if (request.placeId) {
    const saved = await client.query(`select 1 from places where id = $1 and workspace_id = $2 and archived_at is null`,
      [request.placeId, session.workspaceId]);
    if (!saved.rowCount) throw new TimelineCorrectionError("That place isn't one of your places.", 422);
  }
  if (request.learnedPlaceId) {
    const learned = await client.query(
      `select 1 from learned_places where id = $1 and workspace_id = $2 and user_id = $3 and status = 'accepted'`,
      [request.learnedPlaceId, session.workspaceId, session.userId]);
    if (!learned.rowCount) throw new TimelineCorrectionError("That place isn't one of your places.", 422);
  }
}

type TripRow = SegmentRow & {
  clientSegmentId: string; fromStayId: string; toStayId: string; toPlaceId: string | null;
  stopLowerBoundAt: Date | null; stopUpperBoundAt: Date | null; routeDistance: number | null; routeSampleCount: number;
  maxGapSeconds: number | null; continuityStatus: string;
};
type StayRow = SegmentRow & { clientSegmentId: string; placeId: string | null; learnedPlaceId: string | null };

/** The trip into (`to`) or out of (`from`) a stay row, locked. */
async function lockTripAt(client: pg.PoolClient, session: RequestSession, stayRowId: string, end: "from" | "to") {
  // Trusted column name from `end`.
  const result = await client.query<TripRow>(
    `select id, client_segment_id as "clientSegmentId", started_at as "startedAt", stopped_at as "stoppedAt",
            created_from_event_id as "createdFromEventId", metadata, from_stay_segment_id as "fromStayId",
            to_stay_segment_id as "toStayId", to_place_id as "toPlaceId", stop_lower_bound_at as "stopLowerBoundAt",
            stop_upper_bound_at as "stopUpperBoundAt", route_distance_m as "routeDistance", route_sample_count as "routeSampleCount",
            max_gap_seconds as "maxGapSeconds", continuity_status as "continuityStatus"
       from commute_segments
      where workspace_id = $1 and user_id = $2 and ${end}_stay_segment_id = $3 and status <> 'superseded'
      order by updated_at desc
      limit 1
      for update`,
    [session.workspaceId, session.userId, stayRowId]);
  return result.rows[0] ?? null;
}

/** A stay row by its row id, locked. */
async function lockStayRow(client: pg.PoolClient, session: RequestSession, id: string) {
  const result = await client.query<StayRow>(
    `select id, client_segment_id as "clientSegmentId", started_at as "startedAt", stopped_at as "stoppedAt",
            created_from_event_id as "createdFromEventId", metadata, place_id as "placeId", learned_place_id as "learnedPlaceId"
       from stay_segments
      where workspace_id = $1 and user_id = $2 and id = $3 and status <> 'superseded'
      for update`,
    [session.workspaceId, session.userId, id]);
  return result.rows[0] ?? null;
}

/** What a place delete or trip merge joins, checked: the items either side, never one with a block. */
async function joinedItems(client: pg.PoolClient, session: RequestSession, request: TimelineCorrectionRequest, row: SegmentRow) {
  if (request.kind === "delete" && request.subject === "place") {
    const before = await lockTripAt(client, session, row.id, "to");
    const after = await lockTripAt(client, session, row.id, "from");
    if (!before || !after || before.id === after.id) {
      throw new TimelineCorrectionError("Only a place with a trip before and after it can come off your day.", 422);
    }
    for (const trip of [before, after]) {
      if (await hasBlock(client, session, trip.clientSegmentId, trip)) {
        throw new TimelineCorrectionError("A trip next to this place is already in a block. Edit the block instead.", 409);
      }
    }
    return { kind: "place_delete" as const, before, after };
  }
  if (request.kind === "merge") {
    const ends = (await client.query<{ fromStayId: string; toStayId: string }>(
      `select from_stay_segment_id as "fromStayId", to_stay_segment_id as "toStayId" from commute_segments
        where id = $1 and workspace_id = $2 and user_id = $3`, [row.id, session.workspaceId, session.userId])).rows[0];
    const first = ends ? await lockStayRow(client, session, ends.fromStayId) : null;
    const second = ends ? await lockStayRow(client, session, ends.toStayId) : null;
    if (!first || !second || first.id === second.id || !sameKnownPlace(first, second)) {
      throw new TimelineCorrectionError("Only a trip between two visits to one of your places can be one stay.", 422);
    }
    for (const stay of [first, second]) {
      if (await hasBlock(client, session, stay.clientSegmentId, stay)) {
        throw new TimelineCorrectionError("A visit either side is already in a block. Edit the block instead.", 409);
      }
    }
    return { kind: "trip_merge" as const, first, second };
  }
  return null;
}

/** Retires the open Review suggestions of these segment rows, and their events, with the person's reason. */
async function retireSuggestions(client: pg.PoolClient, session: RequestSession, segmentRowIds: string[], note: string) {
  const retired = await client.query<{ sourceEventId: string | null }>(
    `update review_items
        set status = 'ignored', resolved_at = now(), ignored_scope = '${SUPERSEDED_REVIEW_SCOPE}',
            notes = concat_ws(' ', nullif(notes, ''), $4::text)
      where workspace_id = $1 and user_id = $2 and location_segment_id = any($3::uuid[]) and status = 'open'
      returning event_id as "sourceEventId"`,
    [session.workspaceId, session.userId, segmentRowIds, note]);
  const eventIds = retired.rows.flatMap((item) => item.sourceEventId ? [item.sourceEventId] : []);
  if (eventIds.length) {
    await client.query(
      `update activity_events set review_status = 'ignored'
        where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'needs_review'`,
      [session.workspaceId, session.userId, eventIds]);
  }
}

/** Records one correction and applies it to the segment now; replay applies it again from then on. */
export async function correctLocationTimeline(input: unknown, session: RequestSession) {
  const request = TimelineCorrectionRequestSchema.parse(input);
  return withSyncTransaction("timeline_correction", async ({ client, phase }) => {
    phase("owner_lock");
    // The same owner lock as location ingest and replay, so a replay never interleaves with a correction.
    await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [session.workspaceId, session.userId]);
    // A retry of a correction already made (its reply was lost) gets that correction back, unchanged, before
    // any check: by then the item may have moved, or a trip be gone (step 12). The owner lock above serialises
    // the two attempts; the activity_events client id index backs it.
    const clientEventId = request.clientCorrectionId ? `timeline_correction:${request.clientCorrectionId}` : null;
    if (clientEventId) {
      const earlier = await client.query<(CorrectionRow | { id: null }) & { eventId: string; eventKind: string | null }>(
        `select c.id, c.subject, c.kind, c.span_started_at as "spanStartedAt", c.span_stopped_at as "spanStoppedAt", c.target,
                c.created_at as "createdAt", e.id as "eventId", e.raw_payload ->> 'kind' as "eventKind"
           from activity_events e
           left join location_timeline_corrections c
             on c.created_from_event_id = e.id and c.workspace_id = e.workspace_id and c.user_id = e.user_id
          where e.workspace_id = $1 and e.user_id = $2 and e.client_event_id = $3`,
        [session.workspaceId, session.userId, clientEventId]);
      const found = earlier.rows[0];
      if (found?.id) return { ok: true as const, correction: correctionFromRow(found as CorrectionRow) };
      // "Logs as" makes blocks, not a correction: its retry gets those blocks back.
      if (found && found.eventKind === "log_place" && request.kind === "log_place") {
        return { ok: true as const, logged: { entryIds: await entriesFromEvent(client, session, found.eventId),
          resolvedReviewItemIds: await resolvedFromEvent(client, session, found.eventId) } };
      }
      // The id is taken by an event that made no correction: never a second write under it (Codex r1 on #597).
      if (found) throw new TimelineCorrectionError("That change was already used for something else. Try again.", 409);
    }
    phase("effect");
    const table = request.subject === "place" ? "stay_segments" : "commute_segments";
    const row = await lockSegment(client, session, table, request.itemId);
    // A leg's mode changes only the trip's legs, so a trip's block keeps it too (its leg strip, step 16).
    if (request.kind !== "leg_mode" && await hasBlock(client, session, request.itemId, row)) {
      throw new TimelineCorrectionError(request.subject === "place"
        ? "This place is already in a block. Edit the block instead."
        : "This trip is already in a block. Edit the block instead.", 409);
    }
    if (request.kind === "log_place") return logPlace(client, session, request, row, clientEventId);
    const joined = await joinedItems(client, session, request, row);
    const itemStartedAt = iso(row.startedAt);
    const itemStoppedAt = iso(row.stoppedAt ?? new Date());
    if (request.kind === "place") await assertOwnPlace(client, session, request);
    if (request.kind === "times" && !overlaps(Date.parse(request.startedAt), Date.parse(request.stoppedAt), Date.parse(itemStartedAt), Date.parse(itemStoppedAt))) {
      throw new TimelineCorrectionError("New times must overlap the item's times.", 422);
    }
    let legIndex = -1;
    if (request.kind === "leg_mode") {
      const legs = Array.isArray(row.metadata?.legs) ? row.metadata.legs as Array<{ startedAt?: string; stoppedAt?: string }> : [];
      legIndex = legs.findIndex((leg) => leg.startedAt && leg.stoppedAt &&
        Date.parse(leg.startedAt) === Date.parse(request.legStartedAt) && Date.parse(leg.stoppedAt) === Date.parse(request.legStoppedAt));
      if (legIndex < 0) throw new TimelineCorrectionError("That leg is no longer part of this trip.", 404);
    }
    const span = request.kind === "leg_mode"
      ? { startedAt: iso(request.legStartedAt), stoppedAt: iso(request.legStoppedAt) }
      : correctionSpan(row, itemStartedAt, itemStoppedAt);
    const target = targetFor(request);
    const event = await client.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload, review_status, client_event_id)
       values ($1, $2, 'manual_app', 'timeline_correction', now(), 'high', $3::jsonb, 'confirmed', $4)
       returning id`,
      [session.workspaceId, session.userId, JSON.stringify({ subject: request.subject, kind: request.kind, itemId: request.itemId, target }), clientEventId]);
    const inserted = await client.query<CorrectionRow>(
      `insert into location_timeline_corrections
         (workspace_id, user_id, subject, kind, span_started_at, span_stopped_at, target, created_from_event_id)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       returning id, subject, kind, span_started_at as "spanStartedAt", span_stopped_at as "spanStoppedAt", target,
                 created_at as "createdAt"`,
      [session.workspaceId, session.userId, request.subject, request.kind, span.startedAt, span.stoppedAt,
        JSON.stringify(target), event.rows[0].id]);
    const correction = correctionFromRow(inserted.rows[0]);
    // A newer correction of the same kind for the same item replaces the older one.
    await client.query(
      `update location_timeline_corrections set replaced_at = now(), replaced_by_id = $1
        where workspace_id = $2 and user_id = $3 and id <> $1 and replaced_at is null
          and subject = $4 and kind = $5 and span_started_at = $6::timestamptz and span_stopped_at = $7::timestamptz`,
      [correction.id, session.workspaceId, session.userId, request.subject, request.kind, span.startedAt, span.stoppedAt]);
    if (joined) await applyJoin(client, session, row, joined);
    else await applyToSegment(client, session, table, row, request, legIndex, span);
    // A trip the correction removed, joined or moved settles a timer's "?" about it now, not at the next replay.
    const nowMs = Date.now();
    await reconcileTimerTripClashes(client, session, {
      from: new Date(Date.parse(span.startedAt) - 60_000).toISOString(),
      to: new Date(Math.min(nowMs, Date.parse(span.stoppedAt) + 86_400_000)).toISOString()
    }, new Date(nowMs));
    return { ok: true as const, correction };
  });
}

async function applyToSegment(
  client: pg.PoolClient, session: RequestSession, table: "stay_segments" | "commute_segments", row: SegmentRow,
  request: TimelineCorrectionRequest, legIndex: number, span: { startedAt: string; stoppedAt: string }
) {
  const scope = [row.id, session.workspaceId, session.userId];
  const spanJson = JSON.stringify(span);
  switch (request.kind) {
    case "place":
      await client.query(
        // The person's place (`setByYou`): Review names the trips either side from it and learns names against
        // it, as for its own corrections; replay applies it again, and a place you are still at still closes
        // when you leave (Codex r3/r4 on #566).
        `update stay_segments
            set place_id = $4, learned_place_id = $5,
                metadata = metadata || jsonb_build_object('placeMatchKind', $6::text, 'setByYou', true, 'placeSetByYou', true,
                  'correctionSpan', $7::jsonb),
                updated_at = now()
          where id = $1 and workspace_id = $2 and user_id = $3`,
        [...scope, request.placeId, request.learnedPlaceId, request.placeId ? "saved" : request.learnedPlaceId ? "learned" : "unknown", spanJson]);
      // Its open Review suggestion, and its event, offer the place the person set: confirming it logs that
      // place, as Review's own "change place" does (Codex r2 on #566). The outgoing and new titles join the
      // suggestion's title history, so an editor still showing an older title never teaches it as the
      // person's own (Codex r6 on #566).
      const suggestionEvents = (await client.query<{ eventId: string }>(
        `select event_id as "eventId" from review_items
          where location_segment_id = $1 and workspace_id = $2 and user_id = $3 and status = 'open' and event_id is not null`,
        scope)).rows.map((row) => row.eventId);
      await recordReviewTitleHistory(client, session, suggestionEvents);
      // A learned place linked to a saved place offers the saved place, as Review emission resolves it, so
      // confirming before replay logs the same place as after (Codex r7 on #566).
      const offeredPlaceId = request.placeId ?? (request.learnedPlaceId ? (await client.query<{ placeId: string | null }>(
        `select lp.place_id as "placeId" from learned_places lp
           join places p on p.id = lp.place_id and p.workspace_id = lp.workspace_id
          where lp.id = $1 and lp.workspace_id = $2 and lp.user_id = $3 and lp.status = 'accepted'`,
        [request.learnedPlaceId, session.workspaceId, session.userId])).rows[0]?.placeId ?? null : null);
      await client.query(
        `with suggestion as (
           update review_items ri
              set suggested_place_id = $4,
                  -- As replay names it: the place's own default description wins, then its name (Codex r8 on #566).
                  title = coalesce((select coalesce(nullif(btrim(p.default_activity_description), ''), ${placeDisplayNameSql("p")})
                      from places p where p.id = $4 and p.workspace_id = $2),
                    (select nullif(btrim(lp.name), '') from learned_places lp where lp.id = $5 and lp.workspace_id = $2 and lp.user_id = $3),
                    'Unknown place')
            where ri.workspace_id = $2 and ri.user_id = $3 and ri.location_segment_id = $1 and ri.status = 'open'
            returning ri.event_id)
         -- The suggestion's title is now the place's, never a learned name the person could be taught back
         -- (Codex r5 on #566), as Review's own save-place does.
         update activity_events ae set suggested_place_id = $4, raw_payload = ae.raw_payload - 'semanticReason' - 'nameSource'
           from suggestion
          where ae.id = suggestion.event_id and ae.workspace_id = $2 and ae.user_id = $3`,
        [...scope, offeredPlaceId, request.learnedPlaceId]);
      await recordReviewTitleHistory(client, session, suggestionEvents);
      return;
    case "times":
      // Trusted table name from the subject.
      await client.query(
        `update ${table} set started_at = $4, stopped_at = $5,
                metadata = metadata || jsonb_build_object('setByYou', true, 'correctionSpan', $6::jsonb), updated_at = now()
          where id = $1 and workspace_id = $2 and user_id = $3`,
        [...scope, iso(request.startedAt), iso(request.stoppedAt), spanJson]);
      // Its open Review suggestion offers the times the person set (Codex r2 on #566).
      await client.query(
        `update review_items set suggested_started_at = $4, suggested_stopped_at = $5
          where workspace_id = $2 and user_id = $3 and location_segment_id = $1 and status = 'open'`,
        [...scope, iso(request.startedAt), iso(request.stoppedAt)]);
      return;
    case "leg_mode": {
      // The leg takes the mode, and a neighbour of the same mode becomes one leg with it, as replay
      // makes them (card A; Codex r2 on #590).
      const legs = (row.metadata?.legs as TripLeg[]).map((leg, index) => {
        if (index !== legIndex) return leg;
        const set: TripLeg = { ...leg, mode: request.mode, confidence: "sure", setByYou: true };
        delete set.runnerUp;
        return set;
      });
      await client.query(
        `update commute_segments set metadata = jsonb_set(metadata, '{legs}', $4::jsonb), updated_at = now()
          where id = $1 and workspace_id = $2 and user_id = $3`,
        [...scope, JSON.stringify(mergeSameModeLegs(legs))]);
      return;
    }
    case "delete": {
      // A trip that wasn't one leaves the timeline, and its open Review suggestion with it.
      await client.query(`update commute_segments set status = 'superseded', updated_at = now() where id = $1 and workspace_id = $2 and user_id = $3`, scope);
      const retired = await client.query<{ sourceEventId: string | null }>(
        `update review_items
            set status = 'ignored', resolved_at = now(), ignored_scope = '${SUPERSEDED_REVIEW_SCOPE}',
                notes = concat_ws(' ', nullif(notes, ''), 'You said this wasn''t a trip.')
          where workspace_id = $2 and user_id = $3 and location_segment_id = $1 and status = 'open'
          returning event_id as "sourceEventId"`,
        scope);
      const eventIds = retired.rows.flatMap((item) => item.sourceEventId ? [item.sourceEventId] : []);
      if (eventIds.length) {
        await client.query(
          `update activity_events set review_status = 'ignored'
            where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'needs_review'`,
          [session.workspaceId, session.userId, eventIds]);
      }
      return;
    }
  }
}

/**
 * "I wasn't here": the trip in takes the trip out's end, both trips' legs and stops, and the place and the
 * trip out leave the day. "I didn't leave": the first visit runs to the second's end, and the trip and the
 * second visit leave it; a trip that left the second visit leaves the first. Replay makes the same from the
 * correction (`applyTimelineCorrections`).
 */
async function applyJoin(
  client: pg.PoolClient, session: RequestSession, row: SegmentRow, joined: NonNullable<Awaited<ReturnType<typeof joinedItems>>>
) {
  const owner = [session.workspaceId, session.userId];
  const supersede = async (table: "stay_segments" | "commute_segments", ids: string[]) => client.query(
    // Trusted table name.
    `update ${table} set status = 'superseded', updated_at = now() where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])`,
    [...owner, ids]);
  if (joined.kind === "place_delete") {
    const { before, after } = joined;
    const legsOf = (trip: TripRow) => Array.isArray(trip.metadata?.legs) ? trip.metadata.legs as TripLeg[] : [];
    const stopsOf = (trip: TripRow) => Array.isArray(trip.metadata?.stops) ? trip.metadata.stops as unknown[] : [];
    const legs = mergeSameModeLegs([...legsOf(before), ...legsOf(after)]);
    const stops = [...stopsOf(before), ...stopsOf(after)];
    const kept: Record<string, unknown> = { ...before.metadata };
    // Its classification described the trip in alone (a round trip, say): the one trip has none (Codex r2 on #603).
    for (const key of ["legs", "stops", "travelMode", "motionSupported", "motionTimed", "qualificationReason"]) delete kept[key];
    const { travelMode, motionSupported, motionTimed } = before.metadata ?? {};
    const metadata = {
      ...kept,
      ...(legs.length ? { legs } : {}),
      ...(stops.length ? { stops } : {}),
      ...(travelMode && travelMode === after.metadata?.travelMode ? { travelMode } : {}),
      ...(motionSupported || after.metadata?.motionSupported ? { motionSupported: true } : {}),
      ...(motionTimed || after.metadata?.motionTimed ? { motionTimed: true } : {}),
      setByYou: true,
      // Later corrections of the one trip are tied to the trip in's span, as replay ties them (Codex r1 on #603).
      correctionSpan: correctionSpan(before, iso(before.startedAt), iso(before.stoppedAt ?? new Date()))
    };
    await client.query(
      `update commute_segments
          set stopped_at = $4, stop_lower_bound_at = $5, stop_upper_bound_at = $6, to_stay_segment_id = $7, to_place_id = $8,
              route_distance_m = case when route_distance_m is null or $9::double precision is null then null else route_distance_m + $9 end,
              straight_line_distance_m = null, route_sample_count = route_sample_count + $10,
              max_gap_seconds = greatest(max_gap_seconds, $11),
              continuity_status = case when continuity_status = 'continuous' and $12 = 'continuous' then 'continuous' else 'uncertain_gap' end,
              confidence = 'low', metadata = $13::jsonb, updated_at = now()
        where id = $3 and workspace_id = $1 and user_id = $2`,
      [...owner, before.id, after.stoppedAt, after.stopLowerBoundAt, after.stopUpperBoundAt, after.toStayId, after.toPlaceId,
        after.routeDistance, after.routeSampleCount, after.maxGapSeconds ?? 0, after.continuityStatus, JSON.stringify(metadata)]);
    await supersede("stay_segments", [row.id]);
    await supersede("commute_segments", [after.id]);
    // The trip in's suggestion described another trip (its route, title and activity): replay offers the one
    // trip afresh, reopening it with what the one trip is (Codex r1 on #603).
    await retireSuggestions(client, session, [row.id, after.id, before.id], "You said you weren't here.");
    return;
  }
  const { first, second } = joined;
  await client.query(
    // Still open, closed or finalised as the second visit is; tied to the first visit's span, as replay ties it
    // (Codex r1 on #603).
    `update stay_segments s
        set stopped_at = n.stopped_at, stop_lower_bound_at = n.stop_lower_bound_at, stop_upper_bound_at = n.stop_upper_bound_at,
            status = n.status, sample_count = s.sample_count + n.sample_count,
            metadata = s.metadata || jsonb_build_object('setByYou', true, 'correctionSpan', $5::jsonb)
              || case when n.metadata ? 'openTrip' then jsonb_build_object('openTrip', n.metadata -> 'openTrip') else '{}'::jsonb end,
            updated_at = now()
       from stay_segments n
      where s.id = $3 and n.id = $4 and s.workspace_id = $1 and s.user_id = $2 and n.workspace_id = $1 and n.user_id = $2`,
    [...owner, first.id, second.id, JSON.stringify(correctionSpan(first, iso(first.startedAt), iso(first.stoppedAt ?? new Date())))]);
  await client.query(
    `update commute_segments set from_stay_segment_id = $3, updated_at = now()
      where workspace_id = $1 and user_id = $2 and from_stay_segment_id = $4 and status <> 'superseded' and id <> $5`,
    [...owner, first.id, second.id, row.id]);
  await supersede("commute_segments", [row.id]);
  await supersede("stay_segments", [second.id]);
  // The journey in progress moves to the one stay rather than being on both (Codex r2 on #603).
  await client.query(`update stay_segments set metadata = metadata - 'openTrip' where id = $3 and workspace_id = $1 and user_id = $2`,
    [...owner, second.id]);
  await retireSuggestions(client, session, [row.id, second.id], "You said you didn't leave.");
  // The first visit's open suggestion offers the one stay; while the one stay is still open, replay offers it
  // again once it ends (Codex r1 on #603).
  if (second.stoppedAt == null) {
    await retireSuggestions(client, session, [first.id], "You said you didn't leave.");
    return;
  }
  await client.query(
    `update review_items set suggested_stopped_at = $4
      where workspace_id = $1 and user_id = $2 and location_segment_id = $3 and status = 'open'`,
    [...owner, first.id, second.stoppedAt]);
}

/** The questions a "Logs as" closed, as its event recorded them. */
async function resolvedFromEvent(client: pg.PoolClient, session: RequestSession, eventId: string) {
  const ids = (await client.query<{ ids: unknown }>(
    `select raw_payload -> 'resolvedReviewItemIds' as ids from activity_events where id = $1 and workspace_id = $2 and user_id = $3`,
    [eventId, session.workspaceId, session.userId])).rows[0]?.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

async function entriesFromEvent(client: pg.PoolClient, session: RequestSession, eventId: string) {
  return (await client.query<{ id: string }>(
    `select id from time_entries where workspace_id = $1 and user_id = $2 and created_from_event_id = $3 order by started_at`,
    [session.workspaceId, session.userId, eventId])).rows.map((row) => row.id);
}

/** The parts of [from, to) no interval covers, a minute or longer, in order. */
export function freeSpans(fromMs: number, toMs: number, taken: ReadonlyArray<{ fromMs: number; toMs: number }>) {
  const out: Array<{ fromMs: number; toMs: number }> = [];
  let cursor = fromMs;
  for (const span of [...taken].sort((a, b) => a.fromMs - b.fromMs)) {
    if (span.toMs <= cursor) continue;
    if (span.fromMs > cursor) out.push({ fromMs: cursor, toMs: Math.min(span.fromMs, toMs) });
    cursor = Math.max(cursor, span.toMs);
    if (cursor >= toMs) break;
  }
  if (cursor < toMs) out.push({ fromMs: cursor, toMs });
  return out.filter((span) => span.toMs - span.fromMs >= 60_000);
}

/**
 * "Logs as" (step 12 part 4, orchestrator 28 Oct 2026): a finished place with no block becomes blocks with the
 * picked activity, for the time the person's own blocks don't cover. Event-first: a `location_place_logged`
 * event naming the place's segment, then its blocks, then the place kept as decided, as a confirmed suggestion
 * is, so replay never replaces it. A place that still has open questions (asking or expired on the device) has
 * each closed in the same transaction exactly as its own "Not now" closes it (`ignore_once_location`, with its
 * audit), before the blocks are made; their ids come back as `resolvedReviewItemIds` (Codex r2 on #609).
 */
async function logPlace(
  client: pg.PoolClient, session: RequestSession, request: Extract<TimelineCorrectionRequest, { kind: "log_place" }>, row: SegmentRow,
  clientEventId: string | null
) {
  if (!row.stoppedAt) throw new TimelineCorrectionError("This place hasn't ended yet. Log it once you've left.", 422);
  const category = await client.query(
    `select 1 from categories where id = $1 and workspace_id = $2 and is_archived = false`, [request.categoryId, session.workspaceId]);
  if (!category.rowCount) throw new TimelineCorrectionError("That activity isn't one of yours.", 422);
  const place = await client.query<{ placeId: string | null; learnedPlaceId: string | null }>(
    `select place_id as "placeId", learned_place_id as "learnedPlaceId" from stay_segments where id = $1 and workspace_id = $2 and user_id = $3`,
    [row.id, session.workspaceId, session.userId]);
  const fromMs = new Date(row.startedAt).getTime();
  const toMs = new Date(row.stoppedAt).getTime();
  // The person's own blocks, running ones to now, decide what is free.
  const taken = await client.query<{ startedAt: Date; stoppedAt: Date }>(
    `select started_at as "startedAt", coalesce(stopped_at, now()) as "stoppedAt" from time_entries
      where workspace_id = $1 and user_id = $2 and started_at < $4 and coalesce(stopped_at, now()) > $3`,
    [session.workspaceId, session.userId, iso(row.startedAt), iso(row.stoppedAt)]);
  const free = freeSpans(fromMs, toMs, taken.rows.map((entry) => ({ fromMs: entry.startedAt.getTime(), toMs: entry.stoppedAt.getTime() })));
  if (!free.length) throw new TimelineCorrectionError("Your blocks already cover this place's time.", 409);
  // The place's open questions close first, each as its own "Not now" does (status ignored, its audit): the
  // blocks are the answer. An outing's stay closes with its trips (ignore_outing), never splitting the outing.
  // The review rows are locked FOR UPDATE by the review service, under the owner lock this transaction holds;
  // the place's own event is written last below, so it ends confirmed and logged by you, never ignored.
  const asked = await client.query<{ id: string; outingKey: string | null }>(
    `select ri.id, ae.raw_payload ->> 'outingKey' as "outingKey"
       from review_items ri
       join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
      where ri.workspace_id = $1 and ri.user_id = $2 and ri.location_segment_id = $3 and ri.status = 'open'
      order by ri.id`,
    [session.workspaceId, session.userId, row.id]);
  const resolvedReviewItemIds: string[] = [];
  for (const question of asked.rows) {
    if (resolvedReviewItemIds.includes(question.id)) continue;
    if (question.outingKey) {
      const members = (await client.query<{ id: string }>(
        `select ri.id
           from review_items ri
           join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
          where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ri.id <> $3
            and ri.location_segment_id is not null and ae.raw_payload ->> 'outingKey' = $4
          order by ri.id`,
        [session.workspaceId, session.userId, question.id, question.outingKey])).rows.map((member) => member.id);
      if (members.length) {
        await resolveLocationReviewActionWithClient(client, question.id, { action: "ignore_outing", memberReviewItemIds: members }, session);
        resolvedReviewItemIds.push(question.id, ...members);
        continue;
      }
    }
    await resolveLocationReviewActionWithClient(client, question.id, { action: "ignore_once_location" }, session);
    resolvedReviewItemIds.push(question.id);
  }
  const event = await client.query<{ id: string }>(
    `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload, review_status, client_event_id)
     values ($1, $2, 'manual_app', 'location_place_logged', now(), 'high', $3::jsonb, 'confirmed', $4)
     returning id`,
    [session.workspaceId, session.userId, JSON.stringify({ kind: "log_place", clientSegmentId: request.itemId, categoryId: request.categoryId,
      resolvedReviewItemIds }), clientEventId]);
  const entryIds: string[] = [];
  for (const span of free) {
    const entry = await client.query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, category_id, place_id, source, confidence, review_status, started_at, stopped_at,
         created_from_event_id)
       values ($1, $2, $3, $4, 'location_learning', 'high', 'confirmed', $5, $6, $7)
       returning id`,
      [session.workspaceId, session.userId, request.categoryId, place.rows[0]?.placeId ?? null,
        new Date(span.fromMs).toISOString(), new Date(span.toMs).toISOString(), event.rows[0].id]);
    entryIds.push(entry.rows[0].id);
  }
  await client.query(
    `update stay_segments set status = 'finalised', continuity_status = 'manual', updated_at = now()
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [row.id, session.workspaceId, session.userId]);
  // The place's own location event, the one replay offers it from, says the person decided it: replay then
  // never asks about it nor logs it automatically, even before it first offered it or once a block is deleted
  // (Codex r1 on #605).
  const eventType = place.rows[0]?.placeId ? "geofence_exit" : place.rows[0]?.learnedPlaceId ? "learned_place_visit" : "unknown_stay";
  await client.query(
    `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
     values ($1, $2, $3, 'location_learning', $4, $5, 'high', $6::jsonb, 'confirmed')
     on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null
     do update set review_status = 'confirmed',
       raw_payload = activity_events.raw_payload || jsonb_build_object('semanticDisposition', 'logged_by_you')`,
    [session.workspaceId, session.userId, `location-segment:${request.itemId}`.slice(0, 160), eventType, iso(row.startedAt),
      JSON.stringify({ clientSegmentId: request.itemId, startedAt: iso(row.startedAt), stoppedAt: iso(row.stoppedAt),
        semanticDisposition: "logged_by_you" })]);
  return { ok: true as const, logged: { entryIds, resolvedReviewItemIds } };
}

