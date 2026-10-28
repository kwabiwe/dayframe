import type pg from "pg";
import {
  TIMER_TRIP_CLASH_EVENT_TYPE, TIMER_TRIP_CLASH_LEAD_MS, TIMER_TRIP_CLASH_OVERLAP_MS, TIMER_TRIP_CLASH_REVIEW_TYPE, timerTripClash, timerTripClashClientEventId,
  timerTripClashTitle, type TimerTripClash, type TimerTripClashTrip
} from "@dayframe/shared";
import type { RequestSession } from "../session";
import { PERSON_SET_END_SQL, TIMER_STARTED_SQL } from "../time-entry-provenance";

/**
 * A timer left running into a trip (location v4 design §7) asks once, on the block: "Team sync ran 18m into
 * your trip · End it at 14:22 · Keep it". Event first: a `timer_trip_clash` activity event per block, with a
 * generic Review item (no location segment) behind its "?". This keeps those items true to the blocks and
 * trips as they are now: it adds a missing one, refreshes or reopens one it retired, and retires one that no
 * longer holds. An answered one is never touched, so Keep it is final.
 *
 * Lock order, the same in every caller: the blocks (an edit, delete or Stop holds its own already), then the
 * questions' events, then their Review items. Replay, corrections and answers share the owner lock; an
 * answer holds its Review item and then wants the block, so the edit paths skip an item being answered.
 */

/**
 * Off until the List and Grid show the "?" on the block and the Review deck is gone (v4 step 15): the deck
 * and older iPhone builds would offer it as an ordinary card (Codex r1 on #611).
 */
export function timerTripChecksEnabled() {
  return process.env.DAYFRAME_TIMER_TRIP_CHECKS === "on";
}

/** How far back a replay looks again: the badge's 7 days and the day before. */
export const TIMER_TRIP_CLASH_REPLAY_LOOKBACK_MS = 8 * 86_400_000;
/**
 * A window pass reads finished blocks that started up to this long before the window (as the timeline reads
 * stays) and every running block; an edit, delete or Stop judges its own block whatever its length.
 */
const FINISHED_BLOCK_LOOKBACK_MS = 31 * 86_400_000;

type EntryRow = {
  id: string; startedAt: Date; stoppedAt: Date | null; source: string; eventType: string | null; reviewStatus: string;
  categoryId: string | null; categoryName: string | null; categoryStarterKey: string | null; description: string | null;
  timerEnd: boolean;
};
type QuestionRow = { eventId: string; clientEventId: string; payload: Record<string, unknown> };
type ReviewRow = {
  id: string; eventId: string; status: string; title: string; suggestedStartedAt: Date | null; suggestedStoppedAt: Date | null;
};

export type TimerTripClashScope = { entryIds: readonly string[] } | { from: string; to: string };

const iso = (value: Date | string | null) => value == null ? null : new Date(value).toISOString();
const ANSWERED = new Set(["accepted", "ignored"]);

/** Returns how many questions it added, changed or retired (the app's refresh signal). */
export async function reconcileTimerTripClashes(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, scope: TimerTripClashScope, now: Date | string = new Date()
): Promise<number> {
  if (!timerTripChecksEnabled()) return 0;
  const nowIso = new Date(now).toISOString();
  const byIds = "entryIds" in scope;
  if (byIds && !scope.entryIds.length) return 0;
  // The blocks in scope, unlocked: the ones named, or those running in the window.
  const entries = await readBlocks(client, session, byIds ? { ids: scope.entryIds } : { window: scope, now: nowIso });
  // Questions already asked: about these blocks, or (for a window) about trips that started in it, so a
  // question whose block was deleted is retired too.
  const clientIds = [...new Set([...(byIds ? scope.entryIds : []), ...entries.map((row) => row.id)])].map(timerTripClashClientEventId);
  const asked = await readQuestions(client, session, clientIds, byIds ? null : scope);
  const askedStatus = await readReviews(client, session, [...asked.values()].map((question) => question.eventId));
  const answered = (clientEventId: string) => {
    const question = asked.get(clientEventId);
    return Boolean(question && ANSWERED.has(askedStatus.get(question.eventId)?.status ?? ""));
  };
  // An answered block is final: never read its trips again.
  const open = entries.filter((entry) => !answered(timerTripClashClientEventId(entry.id)));
  const firstGuess = clashesFor(open, await readFirstTrips(client, session, open, nowIso), nowIso);
  // Lock the blocks this may write about (those it would ask about now, and those with a question still
  // unanswered) in id order, then read them again: a delete or edit that committed meanwhile is seen, and one
  // that comes after waits and settles its own question. A window pass (replay, a correction) holds other
  // blocks already, so it skips a block another transaction holds instead of waiting for it (Codex r2 on
  // #611); that transaction settles the block's question itself.
  const unanswered = [...asked.entries()].flatMap(([clientEventId, question]) =>
    !answered(clientEventId) && typeof question.payload.timeEntryId === "string" ? [question.payload.timeEntryId] : []);
  const lockIds = [...new Set([...firstGuess.keys(), ...unanswered])].sort();
  const blocks = lockIds.length ? await lockAndReadBlocks(client, session, lockIds, byIds ? "wait" : "skip") : [];
  const live = blocks.filter((entry) => !answered(timerTripClashClientEventId(entry.id)));
  const proposed = clashesFor(live, await readFirstTrips(client, session, live, nowIso), nowIso);
  const present = new Set(blocks.map((entry) => entry.id));
  // Create the missing events (do nothing on a concurrent insert), then lock every question's event and
  // Review item, in client-id order, before deciding anything.
  const missing = [...proposed.keys()].map(timerTripClashClientEventId).filter((id) => !asked.has(id)).sort();
  const created = new Set<string>();
  for (const clientEventId of missing) {
    const { clash } = proposed.get(clientEventId.slice("timer-trip-clash:".length))!;
    const inserted = await client.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence,
         raw_payload, review_status)
       values ($1, $2, $3, 'location_learning', $4, $5::timestamptz, 'high', $6::jsonb, 'needs_review')
       on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null do nothing
       returning id`,
      [session.workspaceId, session.userId, clientEventId, TIMER_TRIP_CLASH_EVENT_TYPE, clash.tripStartedAt, JSON.stringify(clash)]);
    if (inserted.rows[0]) created.add(inserted.rows[0].id);
  }
  const touched = [...new Set([...[...proposed.keys()].map(timerTripClashClientEventId), ...asked.keys()])].sort();
  if (!touched.length) return 0;
  const locked = await readQuestions(client, session, touched, null, true);
  // The trips again, now that every question is locked: a transaction that changed a trip and held one of
  // these questions has committed, so its trip is seen (Codex r3 on #611).
  const wanted = clashesFor(live, await readFirstTrips(client, session, live, nowIso), nowIso);
  // Each Review item's status is read under its own lock, never from an earlier snapshot, so an answer that
  // committed while this waited is never undone (Codex r1 on #611). One held by an answer right now is skipped.
  const reviews = await readReviews(client, session, [...locked.values()].map((question) => question.eventId), true);
  const reviewed = new Set([...locked.values()].flatMap((question) => reviews.has(question.eventId) ? [] : [question.eventId]));
  const unlocked = reviewed.size ? await readReviews(client, session, [...reviewed]) : new Map<string, ReviewRow>();
  let changes = 0;
  for (const clientEventId of touched) {
    const question = locked.get(clientEventId);
    if (!question) continue;
    if (unlocked.has(question.eventId)) continue;
    const review = reviews.get(question.eventId);
    const timeEntryId = typeof question.payload.timeEntryId === "string" ? question.payload.timeEntryId : null;
    if (review && ANSWERED.has(review.status)) continue;
    if (review && review.status !== "open" && !(review.status === "superseded" && question.payload.retiredByReconcile === true)) continue;
    const want = timeEntryId ? wanted.get(timeEntryId) : undefined;
    if (!want) {
      // An event this pass created for a clash that the fresh trips no longer show goes again.
      if (!review && created.has(question.eventId)) {
        await client.query(`delete from activity_events where id = $1 and workspace_id = $2 and user_id = $3`,
          [question.eventId, session.workspaceId, session.userId]);
        continue;
      }
      // A question whose block this pass didn't lock (a window pass, its block held or elsewhere) is left to
      // that block's own transaction, unless its block is gone or the trip it asks about is gone or moved: a
      // pass that changed the trip retires it now (Codex r3 on #611), and a later pass asks again if it holds.
      if (timeEntryId && !present.has(timeEntryId) && !byIds && await blockExists(client, session, timeEntryId) &&
        await tripStillAsked(client, session, question.payload)) continue;
      if (review?.status === "open") {
        await retire(client, session, review.id, question.eventId);
        changes += 1;
      }
      continue;
    }
    const { entry, clash } = want;
    const title = timerTripClashTitle(entry.description || entry.categoryName, clash.overlapSeconds);
    if (!review) {
      await client.query(
        `insert into review_items (workspace_id, user_id, event_id, type, title, suggested_category_id,
           suggested_started_at, suggested_stopped_at, confidence, status, notes)
         values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, 'high', 'open', $9)`,
        [session.workspaceId, session.userId, question.eventId, TIMER_TRIP_CLASH_REVIEW_TYPE, title, entry.categoryId,
          entry.startedAt.toISOString(), clash.tripStartedAt, "This block was still running when you left."]);
      await updateEvent(client, session, question.eventId, clash);
      changes += 1;
      continue;
    }
    const same = review.status === "open" && review.title === title &&
      iso(review.suggestedStartedAt) === entry.startedAt.toISOString() && iso(review.suggestedStoppedAt) === clash.tripStartedAt &&
      (Object.keys(clash) as Array<keyof TimerTripClash>).every((key) => question.payload[key] === clash[key]) &&
      question.payload.retiredByReconcile === undefined;
    if (same) continue;
    await client.query(
      `update review_items
          set title = $4, suggested_category_id = $5, suggested_started_at = $6::timestamptz,
              suggested_stopped_at = $7::timestamptz, status = 'open', resolved_at = null
        where id = $1 and workspace_id = $2 and user_id = $3`,
      [review.id, session.workspaceId, session.userId, title, entry.categoryId, entry.startedAt.toISOString(), clash.tripStartedAt]);
    await updateEvent(client, session, question.eventId, clash);
    changes += 1;
  }
  return changes;
}

/**
 * Whether an answer's question still holds for the block and trip as they are now (End it checks this
 * under the block's lock before it changes anything): the same trip, at the same start.
 */
export async function timerTripClashStillHolds(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, payload: Record<string, unknown>, now: Date | string = new Date()
) {
  const timeEntryId = typeof payload.timeEntryId === "string" ? payload.timeEntryId : null;
  const tripId = typeof payload.tripId === "string" ? payload.tripId : null;
  if (!timeEntryId || !tripId) return false;
  const nowIso = new Date(now).toISOString();
  const [entry] = await lockAndReadBlocks(client, session, [timeEntryId], "wait");
  if (!entry) return false;
  const trip = await client.query<{ startedAt: Date; stoppedAt: Date }>(
    `select started_at as "startedAt", stopped_at as "stoppedAt" from commute_segments
      where workspace_id = $1 and user_id = $2 and client_segment_id = $3 and status <> 'superseded'
      order by started_at limit 1`,
    [session.workspaceId, session.userId, tripId]);
  const row = trip.rows[0];
  if (!row) return false;
  const clash = clashesFor([entry], new Map([[timeEntryId, [{ id: tripId, startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString() }]]]), nowIso)
    .get(timeEntryId)?.clash;
  return Boolean(clash && clash.tripStartedAt === payload.tripStartedAt);
}

function clashesFor(entries: readonly EntryRow[], tripsByEntry: ReadonlyMap<string, readonly TimerTripClashTrip[]>, nowIso: string) {
  const clashes = new Map<string, { entry: EntryRow; clash: TimerTripClash }>();
  for (const entry of entries) {
    const trips = tripsByEntry.get(entry.id) ?? [];
    const clash = timerTripClash({
      id: entry.id, startedAt: entry.startedAt.toISOString(), stoppedAt: iso(entry.stoppedAt), source: entry.source,
      eventType: entry.eventType, reviewStatus: entry.reviewStatus, categoryStarterKey: entry.categoryStarterKey,
      timerEnd: entry.timerEnd
    }, trips, new Date(nowIso));
    if (clash) clashes.set(entry.id, { entry, clash });
  }
  return clashes;
}

/**
 * Locks the blocks first and reads where their ends came from in a fresh statement: a statement that waits
 * for a row lock sees the row as committed but keeps its earlier snapshot for subqueries, so it would miss the
 * audit row of an edit it waited for (as `stopEntryAt` notes; Codex r2 on #611).
 */
async function lockAndReadBlocks(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, ids: readonly string[], held: "wait" | "skip"
) {
  const locked = await client.query<{ id: string }>(
    `select id from time_entries where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])
      order by id for share${held === "skip" ? " skip locked" : ""}`,
    [session.workspaceId, session.userId, ids]);
  return locked.rows.length ? readBlocks(client, session, { ids: locked.rows.map((row) => row.id) }) : [];
}

async function readBlocks(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  scope: { ids: readonly string[] } | { window: { from: string; to: string }; now: string }
) {
  const byIds = "ids" in scope;
  const result = await client.query<EntryRow>(
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
    byIds ? [session.workspaceId, session.userId, scope.ids]
      : [session.workspaceId, session.userId, scope.window.from, scope.window.to, scope.now, FINISHED_BLOCK_LOOKBACK_MS]);
  return result.rows;
}

/**
 * Each block's first trip it could have run into: the first completed trip that started at least 5 minutes
 * after the block and that the block ran on into by more than 5 minutes, one index range read per block
 * (with a limit), however old a running block is (Codex r3 on #611).
 */
async function readFirstTrips(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, entries: readonly EntryRow[], nowIso: string
): Promise<Map<string, TimerTripClashTrip[]>> {
  if (!entries.length) return new Map();
  const result = await client.query<{ entryId: string; id: string; startedAt: Date; stoppedAt: Date }>(
    `select b.id as "entryId", t.client_segment_id as "id", t.started_at as "startedAt", t.stopped_at as "stoppedAt"
       from unnest($3::uuid[], $4::timestamptz[], $5::timestamptz[]) as b(id, started_at, ends_at)
       cross join lateral (
         select c.client_segment_id, c.started_at, c.stopped_at from commute_segments c
          where c.workspace_id = $1 and c.user_id = $2 and c.status <> 'superseded'
            and c.started_at >= b.started_at + make_interval(secs => $6::double precision / 1000)
            and c.started_at < b.ends_at
            and least(b.ends_at, c.stopped_at) > c.started_at + make_interval(secs => $7::double precision / 1000)
          order by c.started_at, c.client_segment_id
          limit 1
       ) t`,
    [session.workspaceId, session.userId, entries.map((row) => row.id), entries.map((row) => row.startedAt.toISOString()),
      entries.map((row) => (row.stoppedAt ?? new Date(nowIso)).toISOString()), TIMER_TRIP_CLASH_LEAD_MS / 1000, TIMER_TRIP_CLASH_OVERLAP_MS / 1000]);
  const trips = new Map<string, TimerTripClashTrip[]>();
  for (const row of result.rows) {
    trips.set(row.entryId, [{ id: row.id, startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString() }]);
  }
  return trips;
}

/** Whether the trip a question asks about is still there, at the start it was asked with. */
async function tripStillAsked(client: Pick<pg.PoolClient, "query">, session: RequestSession, payload: Record<string, unknown>) {
  if (typeof payload.tripId !== "string" || typeof payload.tripStartedAt !== "string") return false;
  const result = await client.query(
    `select 1 from commute_segments
      where workspace_id = $1 and user_id = $2 and client_segment_id = $3 and status <> 'superseded'
        and started_at = $4::timestamptz
      limit 1`,
    [session.workspaceId, session.userId, payload.tripId, payload.tripStartedAt]);
  return Boolean(result.rows[0]);
}

async function readQuestions(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, clientIds: readonly string[],
  window: { from: string; to: string } | null, lock = false
) {
  const result = await client.query<QuestionRow>(
    `select ae.id as "eventId", ae.client_event_id as "clientEventId", ae.raw_payload as "payload"
       from activity_events ae
      where ae.workspace_id = $1 and ae.user_id = $2 and ae.event_type = $3
        and (ae.client_event_id = any($4::text[])
          ${window ? "or (ae.occurred_at >= $5::timestamptz and ae.occurred_at < $6::timestamptz)" : ""})
      order by ae.client_event_id
      ${lock ? "for update" : ""}`,
    window ? [session.workspaceId, session.userId, TIMER_TRIP_CLASH_EVENT_TYPE, clientIds, window.from, window.to]
      : [session.workspaceId, session.userId, TIMER_TRIP_CLASH_EVENT_TYPE, clientIds]);
  return new Map(result.rows.map((row) => [row.clientEventId, row]));
}

/** Each event's Review item; with `lock`, only those not held by another transaction, read under the lock. */
async function readReviews(client: Pick<pg.PoolClient, "query">, session: RequestSession, eventIds: readonly string[], lock = false) {
  if (!eventIds.length) return new Map<string, ReviewRow>();
  const result = await client.query<ReviewRow>(
    `select id, event_id as "eventId", status, title, suggested_started_at as "suggestedStartedAt",
            suggested_stopped_at as "suggestedStoppedAt"
       from review_items
      where workspace_id = $1 and user_id = $2 and event_id = any($3::uuid[]) and type = $4
      order by id
      ${lock ? "for update skip locked" : ""}`,
    [session.workspaceId, session.userId, eventIds, TIMER_TRIP_CLASH_REVIEW_TYPE]);
  return new Map(result.rows.map((row) => [row.eventId, row]));
}

async function blockExists(client: Pick<pg.PoolClient, "query">, session: RequestSession, id: string) {
  const result = await client.query(`select 1 from time_entries where id = $1 and workspace_id = $2 and user_id = $3`,
    [id, session.workspaceId, session.userId]);
  return Boolean(result.rows[0]);
}

async function retire(client: Pick<pg.PoolClient, "query">, session: RequestSession, reviewId: string, eventId: string) {
  await client.query(
    `update review_items set status = 'superseded', resolved_at = now()
      where id = $1 and workspace_id = $2 and user_id = $3 and status = 'open'`,
    [reviewId, session.workspaceId, session.userId]);
  await client.query(
    `update activity_events set review_status = 'ignored', raw_payload = raw_payload || '{"retiredByReconcile": true}'::jsonb
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [eventId, session.workspaceId, session.userId]);
}

async function updateEvent(client: Pick<pg.PoolClient, "query">, session: RequestSession, eventId: string, clash: TimerTripClash) {
  await client.query(
    `update activity_events set raw_payload = $4::jsonb, occurred_at = $5::timestamptz, review_status = 'needs_review'
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [eventId, session.workspaceId, session.userId, JSON.stringify(clash), clash.tripStartedAt]);
}

/** The window a replay looks at again: the last 8 days, never before the semantic cutover. */
export function timerTripClashReplayWindow(processingAt: string, semanticCutoverAt: string) {
  const to = new Date(processingAt);
  const from = new Date(Math.max(to.getTime() - TIMER_TRIP_CLASH_REPLAY_LOOKBACK_MS, Date.parse(semanticCutoverAt)));
  return from < to ? { from: from.toISOString(), to: to.toISOString() } : null;
}
