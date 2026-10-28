import type pg from "pg";
import {
  LOCATION_ENGINE_V2_CONFIG, TIMER_TRIP_CLASH_EVENT_TYPE, TIMER_TRIP_CLASH_REVIEW_TYPE, timerTripClash, timerTripClashClientEventId,
  timerTripClashTitle, type TimerTripClash
} from "@dayframe/shared";
import type { RequestSession } from "../session";
import { PERSON_SET_END_SQL, TIMER_STARTED_SQL } from "../time-entry-provenance";

/**
 * A timer left running into a trip (location v4 design §7) asks once, on the block: "Team sync ran 18m into
 * your trip · End it at 14:22 · Keep it". Event first: a `timer_trip_clash` activity event per block, with a
 * generic Review item (no location segment) behind its "?". This keeps those items true to the blocks and
 * trips as they are now: it adds a missing one, refreshes or reopens one it retired, and retires one that no
 * longer holds. An answered one is never touched, so Keep it is final. The caller holds the user's timer lock
 * (replay and Review mutations take the same owner lock).
 */

/** How far back a replay looks again: the badge's 7 days and the day before. */
export const TIMER_TRIP_CLASH_REPLAY_LOOKBACK_MS = 8 * 86_400_000;
/** A block that started this long before a trip is still looked at (a timer left on overnight). */
const ENTRY_LOOKBACK_MS = 2 * 86_400_000;

type EntryRow = {
  id: string; startedAt: Date; stoppedAt: Date | null; source: string; eventType: string | null; reviewStatus: string;
  categoryId: string | null; categoryName: string | null; categoryStarterKey: string | null; description: string | null;
  timerEnd: boolean;
};
type TripRow = { id: string; startedAt: Date; stoppedAt: Date };
type QuestionRow = {
  eventId: string; clientEventId: string; payload: Record<string, unknown>; reviewId: string | null; status: string | null;
  title: string | null; suggestedStartedAt: Date | null; suggestedStoppedAt: Date | null; retiredByReconcile: boolean;
};

export type TimerTripClashScope = { entryIds: readonly string[] } | { from: string; to: string };

const iso = (value: Date | string | null) => value == null ? null : new Date(value).toISOString();

/** Returns how many questions it added, changed or retired (the app's refresh signal). */
export async function reconcileTimerTripClashes(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, scope: TimerTripClashScope, now: Date | string = new Date()
): Promise<number> {
  const nowIso = new Date(now).toISOString();
  const byIds = "entryIds" in scope;
  if (byIds && !scope.entryIds.length) return 0;
  // The blocks in scope: the ones named, or those running in the window (started up to two days before it).
  const entries = await client.query<EntryRow>(
    `select te.id, te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.source, ae.event_type as "eventType",
            te.review_status as "reviewStatus", te.category_id as "categoryId", c.name as "categoryName",
            c.starter_key as "categoryStarterKey", te.description,
            -- Only an end a timer gave asks: a block added by hand, or an end a person set, is theirs (PRD D20).
            (${TIMER_STARTED_SQL} and (te.stopped_at is null or not ${PERSON_SET_END_SQL})) as "timerEnd"
       from time_entries te
       left join activity_events ae on ae.id = te.created_from_event_id and ae.workspace_id = te.workspace_id
       left join categories c on c.id = te.category_id and c.workspace_id = te.workspace_id
      where te.workspace_id = $1 and te.user_id = $2
        and ${byIds ? "te.id = any($3::uuid[])"
          : `te.review_status = 'confirmed' and te.started_at < $4::timestamptz
             and coalesce(te.stopped_at, $5::timestamptz) > $3::timestamptz
             and (te.started_at >= $3::timestamptz - make_interval(secs => $6::double precision / 1000) or te.stopped_at is null)`}
      order by te.id`,
    byIds ? [session.workspaceId, session.userId, scope.entryIds]
      : [session.workspaceId, session.userId, scope.from, scope.to, nowIso, ENTRY_LOOKBACK_MS]);
  // Questions already asked: about these blocks, or (for a window) about trips that started in it, so a
  // question whose block was deleted is retired too.
  const clientIds = [...new Set([...(byIds ? scope.entryIds : []), ...entries.rows.map((row) => row.id)])]
    .map(timerTripClashClientEventId);
  const asked = await readQuestions(client, session, clientIds, byIds ? null : scope);
  const blocks = new Map(entries.rows.map((row) => [row.id, row]));
  const windowFrom = Math.min(...entries.rows.map((row) => row.startedAt.getTime()));
  const windowTo = Math.max(...entries.rows.map((row) => (row.stoppedAt ?? new Date(nowIso)).getTime()));
  const trips = entries.rows.length ? (await client.query<TripRow>(
    `select c.client_segment_id as "id", c.started_at as "startedAt", c.stopped_at as "stoppedAt"
       from commute_segments c
      where c.workspace_id = $1 and c.user_id = $2 and c.status <> 'superseded'
        and c.started_at >= $3::timestamptz - make_interval(secs => $5::double precision / 1000)
        and c.started_at < $4::timestamptz and c.stopped_at > $3::timestamptz
      order by c.started_at, c.client_segment_id`,
    [session.workspaceId, session.userId, new Date(windowFrom).toISOString(), new Date(windowTo).toISOString(),
      LOCATION_ENGINE_V2_CONFIG.commuteMaximumDurationMs])).rows.map((row) => ({
    id: row.id, startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString()
  })) : [];
  const wanted = new Map<string, { entry: EntryRow; clash: TimerTripClash }>();
  for (const entry of entries.rows) {
    const clash = timerTripClash({
      id: entry.id, startedAt: entry.startedAt.toISOString(), stoppedAt: iso(entry.stoppedAt), source: entry.source,
      eventType: entry.eventType, reviewStatus: entry.reviewStatus, categoryStarterKey: entry.categoryStarterKey,
      timerEnd: entry.timerEnd
    }, trips, new Date(nowIso));
    if (clash) wanted.set(timerTripClashClientEventId(entry.id), { entry, clash });
  }
  // Create the missing events first (do nothing on a concurrent insert), then lock every question in
  // client-id order before deciding anything.
  const missing = [...wanted.keys()].filter((id) => !asked.has(id)).sort();
  for (const clientEventId of missing) {
    const { clash } = wanted.get(clientEventId)!;
    await client.query(
      `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence,
         raw_payload, review_status)
       values ($1, $2, $3, 'location_learning', $4, $5::timestamptz, 'high', $6::jsonb, 'needs_review')
       on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null do nothing`,
      [session.workspaceId, session.userId, clientEventId, TIMER_TRIP_CLASH_EVENT_TYPE, clash.tripStartedAt, JSON.stringify(clash)]);
  }
  const touched = [...new Set([...wanted.keys(), ...asked.keys()])].sort();
  if (!touched.length) return 0;
  const locked = await readQuestions(client, session, touched, null, true);
  // An answer (End it) holds its Review item and then wants the block, while an edit here holds the block
  // and then wants the item: skip an item being answered right now instead of waiting for it. Replay and
  // answers share the owner lock, so only the edit, delete and Stop paths ever skip.
  const reviewIds = [...locked.values()].flatMap((question) => question.reviewId ? [question.reviewId] : []);
  const free = new Set(reviewIds.length ? (await client.query<{ id: string }>(
    `select id from review_items where id = any($1::uuid[]) and workspace_id = $2 and user_id = $3
      order by id for update skip locked`,
    [reviewIds, session.workspaceId, session.userId])).rows.map((row) => row.id) : []);
  let changes = 0;
  for (const clientEventId of touched) {
    const question = locked.get(clientEventId);
    if (!question || (question.reviewId && !free.has(question.reviewId))) continue;
    const want = wanted.get(clientEventId);
    // A block outside this scope (a window reconcile of a question whose block is elsewhere) is judged only
    // when its block was read; a deleted block retires its question.
    const timeEntryId = typeof question.payload.timeEntryId === "string" ? question.payload.timeEntryId : null;
    if (!want && timeEntryId && !blocks.has(timeEntryId) && !byIds && await blockExists(client, session, timeEntryId)) continue;
    if (question.status && question.status !== "open" && !(question.status === "superseded" && question.retiredByReconcile)) continue;
    if (!want) {
      if (question.status === "open") {
        await retire(client, session, question);
        changes += 1;
      }
      continue;
    }
    const { entry, clash } = want;
    const title = timerTripClashTitle(entry.description || entry.categoryName, clash.overlapSeconds);
    const payload = { ...clash };
    if (!question.reviewId) {
      await client.query(
        `insert into review_items (workspace_id, user_id, event_id, type, title, suggested_category_id,
           suggested_started_at, suggested_stopped_at, confidence, status, notes)
         values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, 'high', 'open', $9)`,
        [session.workspaceId, session.userId, question.eventId, TIMER_TRIP_CLASH_REVIEW_TYPE, title, entry.categoryId,
          entry.startedAt.toISOString(), clash.tripStartedAt, "This block was still running when you left."]);
      await updateEvent(client, session, question.eventId, payload, clash.tripStartedAt, "needs_review");
      changes += 1;
      continue;
    }
    const same = question.status === "open" && question.title === title &&
      iso(question.suggestedStartedAt) === entry.startedAt.toISOString() && iso(question.suggestedStoppedAt) === clash.tripStartedAt &&
      (Object.keys(payload) as Array<keyof TimerTripClash>).every((key) => question.payload[key] === payload[key]) &&
      question.payload.retiredByReconcile === undefined;
    if (same) continue;
    await client.query(
      `update review_items
          set title = $4, suggested_category_id = $5, suggested_started_at = $6::timestamptz,
              suggested_stopped_at = $7::timestamptz, status = 'open', resolved_at = null
        where id = $1 and workspace_id = $2 and user_id = $3`,
      [question.reviewId, session.workspaceId, session.userId, title, entry.categoryId, entry.startedAt.toISOString(), clash.tripStartedAt]);
    await updateEvent(client, session, question.eventId, payload, clash.tripStartedAt, "needs_review");
    changes += 1;
  }
  return changes;
}

async function readQuestions(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, clientIds: readonly string[],
  window: { from: string; to: string } | null, lock = false
) {
  const result = await client.query<QuestionRow>(
    `select ae.id as "eventId", ae.client_event_id as "clientEventId", ae.raw_payload as "payload",
            ri.id as "reviewId", ri.status, ri.title, ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            coalesce((ae.raw_payload->>'retiredByReconcile')::boolean, false) as "retiredByReconcile"
       from activity_events ae
       left join lateral (
         select r.id, r.status, r.title, r.suggested_started_at, r.suggested_stopped_at from review_items r
          where r.event_id = ae.id and r.workspace_id = ae.workspace_id and r.user_id = ae.user_id
          order by r.created_at desc limit 1
       ) ri on true
      where ae.workspace_id = $1 and ae.user_id = $2 and ae.event_type = $3
        and (ae.client_event_id = any($4::text[])
          ${window ? "or (ae.occurred_at >= $5::timestamptz and ae.occurred_at < $6::timestamptz)" : ""})
      order by ae.client_event_id
      ${lock ? "for update of ae" : ""}`,
    window ? [session.workspaceId, session.userId, TIMER_TRIP_CLASH_EVENT_TYPE, clientIds, window.from, window.to]
      : [session.workspaceId, session.userId, TIMER_TRIP_CLASH_EVENT_TYPE, clientIds]);
  return new Map(result.rows.map((row) => [row.clientEventId, row]));
}

async function blockExists(client: Pick<pg.PoolClient, "query">, session: RequestSession, id: string) {
  const result = await client.query(`select 1 from time_entries where id = $1 and workspace_id = $2 and user_id = $3`,
    [id, session.workspaceId, session.userId]);
  return Boolean(result.rows[0]);
}

async function retire(client: Pick<pg.PoolClient, "query">, session: RequestSession, question: QuestionRow) {
  await client.query(
    `update review_items set status = 'superseded', resolved_at = now()
      where id = $1 and workspace_id = $2 and user_id = $3 and status = 'open'`,
    [question.reviewId, session.workspaceId, session.userId]);
  await client.query(
    `update activity_events set review_status = 'ignored', raw_payload = raw_payload || '{"retiredByReconcile": true}'::jsonb
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [question.eventId, session.workspaceId, session.userId]);
}

async function updateEvent(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, eventId: string, payload: TimerTripClash, occurredAt: string,
  reviewStatus: string
) {
  await client.query(
    `update activity_events set raw_payload = $4::jsonb, occurred_at = $5::timestamptz, review_status = $6
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [eventId, session.workspaceId, session.userId, JSON.stringify(payload), occurredAt, reviewStatus]);
}

/** The window a replay looks at again: the last 8 days, never before the semantic cutover. */
export function timerTripClashReplayWindow(processingAt: string, semanticCutoverAt: string) {
  const to = new Date(processingAt);
  const from = new Date(Math.max(to.getTime() - TIMER_TRIP_CLASH_REPLAY_LOOKBACK_MS, Date.parse(semanticCutoverAt)));
  return from < to ? { from: from.toISOString(), to: to.toISOString() } : null;
}
