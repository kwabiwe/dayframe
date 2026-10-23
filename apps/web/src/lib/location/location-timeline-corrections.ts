import type pg from "pg";
import {
  applyTimelineCorrections,
  TimelineCorrectionRequestSchema,
  type LocationSegment,
  type TimelineCorrection,
  type TimelineCorrectionRequest
} from "@dayframe/shared";
import { withSyncTransaction } from "../sync-transaction";
import type { RequestSession } from "../session";
import { placeDisplayNameSql } from "../place-display";
import { SUPERSEDED_REVIEW_SCOPE } from "./location-review-supersession";

/**
 * Timeline corrections (location v4 §4, §14; build step 11). Event-first, in one owner-locked
 * transaction: an activity event, the correction row tied to the time it covers, then the segment it
 * changes. Replay applies every active correction again (`activeTimelineCorrections` +
 * `applyTimelineCorrections`), so replay never undoes what the person set. A place's place or times, or a
 * trip's times or existence, are not corrected here once it has a block: its block is what the person
 * edits. A leg's mode is, on any trip. Never coordinates.
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

/** Replay's segments with the person's corrections applied; unchanged when there are none. */
export async function withTimelineCorrections(
  client: pg.PoolClient, session: RequestSession, segments: LocationSegment[], processingAt: string
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
  return usable.length ? applyTimelineCorrections(segments, usable, nowMs) : segments;
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
  if (!row) throw new TimelineCorrectionError("That item is no longer on your timeline.", 404);
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
    case "delete": return {};
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

/** Records one correction and applies it to the segment now; replay applies it again from then on. */
export async function correctLocationTimeline(input: unknown, session: RequestSession) {
  const request = TimelineCorrectionRequestSchema.parse(input);
  return withSyncTransaction("timeline_correction", async ({ client, phase }) => {
    phase("owner_lock");
    // The same owner lock as location ingest and replay, so a replay never interleaves with a correction.
    await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [session.workspaceId, session.userId]);
    phase("effect");
    const table = request.subject === "place" ? "stay_segments" : "commute_segments";
    const row = await lockSegment(client, session, table, request.itemId);
    // A leg's mode changes only the trip's legs, so a trip's block keeps it too (its leg strip, step 16).
    if (request.kind !== "leg_mode" && await hasBlock(client, session, request.itemId, row)) {
      throw new TimelineCorrectionError(request.subject === "place"
        ? "This place is already in a block. Edit the block instead."
        : "This trip is already in a block. Edit the block instead.", 409);
    }
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
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
       values ($1, $2, 'manual_app', 'timeline_correction', now(), 'high', $3::jsonb, 'confirmed')
       returning id`,
      [session.workspaceId, session.userId, JSON.stringify({ subject: request.subject, kind: request.kind, itemId: request.itemId, target })]);
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
    await applyToSegment(client, session, table, row, request, legIndex, span);
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
        // A person's correction, as Review's own change of place: `manual`, so replay keeps it, Review names the
        // trips either side from it and learns names against it (Codex r3 on #566).
        `update stay_segments
            set place_id = $4, learned_place_id = $5, continuity_status = 'manual',
                metadata = metadata || jsonb_build_object('placeMatchKind', $6::text, 'setByYou', true, 'correctionSpan', $7::jsonb),
                updated_at = now()
          where id = $1 and workspace_id = $2 and user_id = $3`,
        [...scope, request.placeId, request.learnedPlaceId, request.placeId ? "saved" : request.learnedPlaceId ? "learned" : "unknown", spanJson]);
      // Its open Review suggestion, and its event, offer the place the person set: confirming it logs that
      // place, as Review's own "change place" does (Codex r2 on #566).
      await client.query(
        `with suggestion as (
           update review_items ri
              set suggested_place_id = $4,
                  title = coalesce((select ${placeDisplayNameSql("p")} from places p where p.id = $4 and p.workspace_id = $2),
                    (select lp.name from learned_places lp where lp.id = $5 and lp.workspace_id = $2 and lp.user_id = $3), ri.title)
            where ri.workspace_id = $2 and ri.user_id = $3 and ri.location_segment_id = $1 and ri.status = 'open'
            returning ri.event_id)
         update activity_events ae set suggested_place_id = $4
           from suggestion
          where ae.id = suggestion.event_id and ae.workspace_id = $2 and ae.user_id = $3`,
        [...scope, request.placeId, request.learnedPlaceId]);
      // The trips either side start or end at the place the person set (Codex r2 on #566).
      await client.query(`update commute_segments set from_place_id = $4, updated_at = now()
          where from_stay_segment_id = $1 and workspace_id = $2 and user_id = $3 and status <> 'superseded'`, [...scope, request.placeId]);
      await client.query(`update commute_segments set to_place_id = $4, updated_at = now()
          where to_stay_segment_id = $1 and workspace_id = $2 and user_id = $3 and status <> 'superseded'`, [...scope, request.placeId]);
      return;
    case "times":
      // Trusted table name from the subject.
      await client.query(
        `update ${table} set started_at = $4, stopped_at = $5, continuity_status = 'manual',
                metadata = metadata || jsonb_build_object('setByYou', true, 'correctionSpan', $6::jsonb), updated_at = now()
          where id = $1 and workspace_id = $2 and user_id = $3`,
        [...scope, iso(request.startedAt), iso(request.stoppedAt), spanJson]);
      // Its open Review suggestion offers the times the person set (Codex r2 on #566).
      await client.query(
        `update review_items set suggested_started_at = $4, suggested_stopped_at = $5
          where workspace_id = $2 and user_id = $3 and location_segment_id = $1 and status = 'open'`,
        [...scope, iso(request.startedAt), iso(request.stoppedAt)]);
      return;
    case "leg_mode":
      await client.query(
        `update commute_segments
            set metadata = jsonb_set(metadata, array['legs', $4::text],
                  ((metadata -> 'legs' -> $4::int) - 'runnerUp')
                    || jsonb_build_object('mode', $5::text, 'confidence', 'sure', 'setByYou', true)),
                updated_at = now()
          where id = $1 and workspace_id = $2 and user_id = $3`,
        [...scope, legIndex, request.mode]);
      return;
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
