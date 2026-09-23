/** Local C20 schedules against real, independently selected application source.
 * No benchmark adapter, production seam, timeout override or mocked SQL.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import type { RequestSession } from "../apps/web/src/lib/session";
import { replayScalabilityHistory, REPLAY_SCALABILITY_CLOCK as CLOCK,
  REPLAY_SCALABILITY_CUTOVER as CUTOVER, REPLAY_SCALABILITY_DEVICE as DEVICE,
  REPLAY_SCALABILITY_PLACE_A as A, REPLAY_SCALABILITY_PLACE_B as B } from "./fixtures/location-replay-scalability";

const BASE = "791e57ea3d806c1474407b7b3546d05a42bd0153";
const root = resolve(process.argv.find(a => a.startsWith("--runtime-root="))?.slice(15) ?? ".");
const source = process.argv.find(a => a.startsWith("--source="))?.slice(9) ?? "candidate";
assert(["base", "candidate"].includes(source));
const url = new URL(process.env.DATABASE_URL ?? "file:///missing");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "54323");
assert.equal(url.pathname, "/dayframe_saved_place_test");
assert.equal(url.search, "");
const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (source === "base") assert.equal(head, BASE);
assert.equal(execFileSync("git", ["-C", root, "diff", "HEAD", "--", "apps/web/src/lib", "packages/shared/src"], { encoding: "utf8" }), "");
const sharedResolution = realpathSync(createRequire(`${root}/package.json`).resolve("@dayframe/shared"));
assert(sharedResolution.startsWith(realpathSync(`${root}/packages/shared`) + "/"), "Runtime must resolve its own shared source.");
process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
const database = new pg.Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 1_500 });
const owned: RequestSession[] = [];
type Reader = Pick<pg.PoolClient, "query">;
type Target = { id: string; segmentId: string; eventId: string; clientId: string; placeId: string | null; kind: "stay" | "commute" };
type Row = Record<string, unknown>;
type Trace = Record<string, unknown>[];
const load = (file: string) => import(pathToFileURL(`${root}/${file}.ts`).href);
let ingest!: typeof import("../apps/web/src/lib/location/location-ingest-service");
let mutations!: typeof import("../apps/web/src/lib/review-mutation-service");
let presentation!: typeof import("../apps/web/src/lib/review-presentation-service");
let shared!: typeof import("../packages/shared/src/index");
let appPool!: pg.Pool;
const normalized = (sql: string) => sql.replace(/\s+/g, " ").trim();
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isProtected = (sql: string) => sql.includes("for update of s");
const isObsolete = (sql: string) => sql.includes('ri.id as "reviewId"');
const family = (sql: string) => isProtected(sql) ? "protected_lookup" : isObsolete(sql) ? "obsolete_selection"
  : sql.includes("pg_try_advisory_xact_lock") ? "try_advisory" : sql.includes("pg_advisory_xact_lock") ? "owner_lock"
  : /^commit$/i.test(sql) ? "commit" : sql.includes("insert into review_mutation_receipts") ? "receipt_write" : "other";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function barrier() {
  const reached = deferred<number>(), release = deferred<void>();
  let fired = false;
  return { reached: reached.promise, release: () => release.resolve(),
    async hold(pid: number) { assert(!fired, "Barrier must fire once"); fired = true; reached.resolve(pid); await release.promise; } };
}
async function bounded<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Harness watchdog: ${label}`)), 9_000);
    })]);
  } finally { clearTimeout(timer); }
}
function instrument(trace: Trace, actor: string, hooks: {
  before?: (sql: string, params: unknown[], raw: pg.PoolClient) => Promise<void>;
  after?: (sql: string, rows: Row[], raw: pg.PoolClient) => Promise<void>;
} = {}) {
  const connected = deferred<number>();
  return { connected: connected.promise, pool: { connect: async () => {
    const raw = await database.connect();
    const pid = (raw as pg.PoolClient & { processID: number }).processID;
    connected.resolve(pid);
    trace.push({ actor, event: "connect", pid });
    return new Proxy(raw, { get(client, key) {
      if (key === "query") return async (input: string | pg.QueryConfig, values?: unknown[]) => {
        const sql = normalized(typeof input === "string" ? input : input.text);
        const params = values ?? (typeof input === "string" ? [] : input.values ?? []);
        const kind = family(sql);
        if (kind !== "other") trace.push({ actor, pid, event: "dispatch", family: kind });
        await hooks.before?.(sql, params, raw);
        const result = typeof input === "string" ? await client.query(input, values) : await client.query(input);
        if (kind !== "other") trace.push({ actor, pid, event: "completed", family: kind,
          ...(kind === "try_advisory" ? { acquired: result.rows[0]?.acquired } : {}) });
        await hooks.after?.(sql, result.rows, raw);
        return result;
      };
      const value = Reflect.get(client, key);
      return typeof value === "function" ? value.bind(client) : value;
    } });
  } } as Pick<pg.Pool, "connect"> };
}
async function blocked(waiter: number, blocker: number, trace: Trace) {
  const until = performance.now() + 900;
  while (performance.now() < until) {
    const row = (await database.query(`select pid,wait_event_type,wait_event,pg_blocking_pids(pid) as blockers
      from pg_stat_activity where pid=$1`, [waiter])).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(blocker)) {
      trace.push({ event: "database_blocking_observed", ...row, expectedBlocker: blocker });
      return;
    }
    await new Promise(done => setTimeout(done, 10));
  }
  assert.fail(`Required overlap NOT REACHED: ${waiter} blocked by ${blocker}`);
}
const request = () => ({ deviceId: DEVICE, algorithmVersion: shared.LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
  rolloutMode: "v2_review", semanticModeAcknowledgedAt: CUTOVER });
async function upload(session: RequestSession, rows: ReturnType<typeof replayScalabilityHistory>) {
  for (let i = 0; i < rows.length; i += 100) await ingest.ingestLocationEvidence({ ...request(),
    clientBatchId: randomUUID(), timeZone: "Europe/London", evidence: rows.slice(i, i + 100) }, session, CLOCK);
}
async function fixture(kind: Target["kind"]) {
  const session: RequestSession = { workspaceId: randomUUID(), userId: randomUUID(), authMode: "token", scopes: ["app:read", "app:write", "events:write"] };
  const placeIds = { placeAId: randomUUID(), placeBId: randomUUID() };
  owned.push(session);
  await database.query("insert into users(id,email,name) values($1,$2,'C20 synthetic')", [session.userId, `${session.userId}@example.test`]);
  await database.query("insert into workspaces(id,name) values($1,'C20 synthetic')", [session.workspaceId]);
  await database.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [session.workspaceId, session.userId]);
  for (const [id, p] of [[placeIds.placeAId, A], [placeIds.placeBId, B]] as const) await database.query(
    `insert into places(id,workspace_id,name,latitude,longitude,radius_meters,priority,logging_enabled)
     values($1,$2,$3,$4,$5,$6,5,true)`, [id, session.workspaceId, p.name, p.latitude, p.longitude, p.radiusMeters]);
  const history = replayScalabilityHistory(placeIds, 1, 3);
  await upload(session, history);
  await ingest.replayRetainedLocationEvidence(request(), session, CLOCK);
  const table = kind === "stay" ? "stay_segments" : "commute_segments";
  const target = (await database.query<Target>(`select ri.id,ri.event_id as "eventId",s.id as "segmentId",
    s.client_segment_id as "clientId", ${kind === "stay" ? "s.place_id" : "null::uuid"} as "placeId"
    from review_items ri join ${table} s on s.id=ri.location_segment_id
    where ri.workspace_id=$1 and ri.user_id=$2 and ri.status='open' order by s.started_at asc limit 1`,
  [session.workspaceId, session.userId])).rows[0];
  assert(target, `Missing ${kind} Review`); target.kind = kind;
  const view = await presentation.getReviewPresentation(session, { version: 1, mode: "lookup", timeZone: "Europe/London", limit: 100, reviewItemIds: [target.id] });
  const proposal = view.lookup.reviewItems[0]; assert.equal(proposal.kind, "review");
  const envelope = { clientMutationId: randomUUID(), mutation: kind === "stay"
    ? { action: "change_place_and_confirm", placeId: placeIds.placeBId, edit: { description: "C20 corrected stay" } }
    : { action: "confirm", expectedProposalHash: (proposal as { proposalHash: string }).proposalHash } };
  if (kind === "stay") assert.notEqual(target.placeId, envelope.mutation.placeId, "Correction must actually change place");
  const first = history[0];
  const changed = { ...first, clientEvidenceId: "c20-changed-first-witness",
    occurredAt: new Date(Date.parse(first.occurredAt) - 30_000).toISOString() };
  const engine = shared.runLocationEngine({ priorState: shared.EMPTY_LOCATION_ENGINE_STATE,
    evidence: [...history, changed], savedPlaces: [
      { id: placeIds.placeAId, ...A, priority: 5, loggingEnabled: true },
      { id: placeIds.placeBId, ...B, priority: 5, loggingEnabled: true }
    ], acceptedLearnedPlaces: [], config: shared.LOCATION_ENGINE_V2_CONFIG, processingAt: CLOCK });
  assert(!engine.segmentUpserts.some(s => s.clientSegmentId === target.clientId), "Fixture must genuinely change target identity");
  assert(engine.segmentUpserts.some(s => s.kind === kind && s.evidenceIds.includes(changed.clientEvidenceId)) || kind === "commute");
  await upload(session, [changed]);
  return { session, target, envelope, table, history, changed, engineIds: engine.segmentUpserts.map(s => s.clientSegmentId) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(f: Fixture, reader: Reader = database) {
  const { workspaceId: w, userId: u } = f.session;
  const rows: Record<string, Row[]> = {};
  for (const table of [f.table, "activity_events", "review_items", "time_entries", "review_mutation_receipts", "location_segment_evidence"] as const) {
    const predicate = table === f.table ? "id=$3" : table === "activity_events" ? "id=$3"
      : table === "review_items" ? "id=$3" : table === "time_entries" ? "created_from_event_id=$3"
      : table === "review_mutation_receipts" ? "review_item_id=$3"
      : `${f.target.kind}_segment_id=$3`;
    const id = ["activity_events", "time_entries"].includes(table) ? f.target.eventId
      : ["review_items", "review_mutation_receipts"].includes(table) ? f.target.id : f.target.segmentId;
    rows[table] = (await reader.query(`select * from ${table} where workspace_id=$1 and user_id=$2 and ${predicate} order by id`, [w, u, id])).rows;
  }
  return json(rows);
}
async function cleanup(f: Fixture) {
  await database.query("delete from workspaces where id=$1", [f.session.workspaceId]);
  await database.query("delete from users where id=$1", [f.session.userId]);
}
function settled<T>(promise: Promise<T>) { return promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })); }
function ok<T>(result: Awaited<ReturnType<typeof settled<T>>>) { if (!result.ok) throw result.error; return result.value; }
async function replay(f: Fixture, pool?: Pick<pg.Pool, "connect">) {
  return ingest.replayRetainedLocationEvidence(request(), f.session, CLOCK, pool ? { databasePool: pool } : {});
}
async function decide(f: Fixture, pool?: Pick<pg.Pool, "connect">) {
  return mutations.resolveIdempotentReviewMutation(f.target.id, f.envelope, f.session, pool ? { databasePool: pool } : {});
}
async function receiptInvariant(f: Fixture, expected: Record<string, Row[]>, result: unknown) {
  assert.equal(expected.time_entries.length, 1);
  assert.equal(expected.review_mutation_receipts.length, 1);
  assert.equal(expected.review_items[0].status, "accepted");
  assert.equal(expected[f.table][0].continuity_status, "manual");
  if (f.target.kind === "stay") {
    assert.equal(expected[f.table][0].place_id, f.envelope.mutation.placeId);
    assert.notEqual(expected[f.table][0].place_id, f.target.placeId);
  }
  assert(expected.location_segment_evidence.length > 1, "Mixed multi-ID provenance required");
  assert.equal(expected.time_entries[0].created_from_event_id, f.target.eventId);
  assert.equal(expected[f.table][0].created_from_event_id, f.target.eventId);
  assert.deepEqual(await snapshot(f), expected, "Committed protected state changed");
  assert.deepEqual(json(await decide(f)), json(result), "Acknowledged request must replay the receipt");
  assert.deepEqual(await snapshot(f), expected, "Receipt retry changed canonical state");
}
/** Probe the actual selected-source retirement SELECT, inside rolled-back local
 * savepoints. These are predicate checks, not additional concurrency claims. */
async function eligibilityChecks(f: Fixture, sql: string, params: unknown[], raw: pg.PoolClient, trace: Trace) {
  assert((await raw.query(sql, params)).rows.some(row => row.reviewId === f.target.id), "Positive eligibility control");
  for (const filter of ["expiry", "device", "algorithm", "accepted", "provenance", "owner"] as const) {
    await raw.query("savepoint c20_filter");
    try {
      const queryParams = [...params];
      if (filter === "owner") { queryParams[0] = randomUUID(); queryParams[1] = randomUUID(); }
      else if (filter === "provenance") await raw.query(
        `delete from location_segment_evidence where workspace_id=$1 and user_id=$2 and ${f.target.kind}_segment_id=$3`,
        [f.session.workspaceId, f.session.userId, f.target.segmentId]);
      else {
        const assignment = { expiry: "expires_at = '2000-01-01'", device: "device_id = 'c20-other-device'",
          algorithm: "algorithm_version = 'c20-other-algorithm'", accepted: "accepted = false" }[filter];
        await raw.query(`update location_evidence set ${assignment} where workspace_id=$1 and user_id=$2
          and id in (select evidence_id from location_segment_evidence where ${f.target.kind}_segment_id=$3)`,
        [f.session.workspaceId, f.session.userId, f.target.segmentId]);
      }
      assert(!(await raw.query(sql, queryParams)).rows.some(row => row.reviewId === f.target.id), `${filter} filter failed`);
      trace.push({ event: "actual_retirement_predicate_check", filter, excludedTarget: true });
    } finally { await raw.query("rollback to savepoint c20_filter"); await raw.query("release savepoint c20_filter"); }
  }
  const plan = (await raw.query(`explain (analyze, buffers, format json) ${sql}`, params)).rows[0]["QUERY PLAN"];
  trace.push({ event: "actual_query_plan", family: "obsolete_selection", plan });
}
async function runCase(kind: Target["kind"], schedule: "row-lock" | "review-first" | "replay-first-protection" | "replay-first-obsolete") {
  const f = await fixture(kind), trace: Trace = [];
  const gate = barrier();
  const pending: Promise<unknown>[] = [];
  let holder: pg.PoolClient | undefined;
  const before = await snapshot(f);
  let protectedState: Record<string, Row[]> | undefined;
  let result: unknown;
  let failure: unknown;
  try {
    if (schedule === "row-lock") {
      result = await decide(f); protectedState = await snapshot(f);
      holder = await database.connect();
      await holder.query("begin");
      await holder.query(`select id from ${f.table} where id=$1 for update`, [f.target.segmentId]);
      const holderPid = (holder as pg.PoolClient & { processID: number }).processID;
      trace.push({ actor: "holder", pid: holderPid, event: "segment_row_lock", table: f.table, ownerAdvisory: false });
      let sourceObserved = false;
      let protectedParams: unknown[] = [];
      const wrapped = instrument(trace, "replay", {
        before: async (sql, params) => { if (isProtected(sql)) protectedParams = params; },
        after: async (sql, rows, raw) => {
        if (isProtected(sql)) {
          if (rows.some(row => row.clientSegmentId === f.target.clientId)) sourceObserved = true;
          const plan = (await raw.query(`explain (analyze, buffers, format json) ${sql}`, protectedParams)).rows[0]["QUERY PLAN"];
          trace.push({ event: "actual_query_plan", family: "protected_lookup", plan });
        }
      } });
      const operation = settled(replay(f, wrapped.pool)); pending.push(operation);
      const pid = await bounded(wrapped.connected, "replay connection");
      assert.notEqual(pid, holderPid);
      await blocked(pid, holderPid, trace);
      assert(trace.some(e => e.event === "dispatch" && e.family === "protected_lookup"));
      await holder.query("commit"); holder.release(); holder = undefined;
      ok(await bounded(operation, "row lock replay"));
      assert(sourceObserved, "Actual protected read did not return target source");
      await receiptInvariant(f, protectedState, result);
    } else if (schedule === "review-first") {
      const review = instrument(trace, "review", { before: async (sql, _params, raw) => {
        if (sql.toLowerCase() === "commit") {
          protectedState = await snapshot(f, raw);
          await gate.hold((raw as pg.PoolClient & { processID: number }).processID);
        }
      } });
      const decision = settled(decide(f, review.pool)); pending.push(decision);
      const reviewPid = await bounded(gate.reached, "Review receipt/commit barrier");
      let obsoleteObserved = false;
      const wrapped = instrument(trace, "replay", { after: async (sql, rows) => {
        if (isObsolete(sql)) {
          obsoleteObserved = true;
          assert(!rows.some(row => row.reviewId === f.target.id), "Committed decision selected as obsolete");
          trace.push({ event: "committed_decision_excluded_from_obsolete_selection" });
        }
      } });
      const operation = settled(replay(f, wrapped.pool)); pending.push(operation);
      const replayPid = await bounded(wrapped.connected, "replay connection");
      assert.notEqual(reviewPid, replayPid);
      await blocked(replayPid, reviewPid, trace);
      gate.release();
      result = ok(await bounded(decision, "Review commit"));
      ok(await bounded(operation, "Review-first replay"));
      assert(obsoleteObserved);
      assert(protectedState); await receiptInvariant(f, protectedState, result);
      trace.push({ event: "committed_decision_survived_changed_id_replay" });
    } else {
      let paused = false;
      const wrapped = instrument(trace, "replay", {
        before: async (sql, params, raw) => {
          if (schedule === "replay-first-obsolete" && isObsolete(sql)) await eligibilityChecks(f, sql, params, raw, trace);
        },
        after: async (sql, rows, raw) => {
        const sensitive = schedule === "replay-first-protection" ? isProtected(sql) : isObsolete(sql);
        if (sensitive && !paused) {
          if (isObsolete(sql)) assert(rows.some(row => row.reviewId === f.target.id), "Target was not actually selected as obsolete");
          paused = true;
          trace.push({ event: "barrier_reached", family: family(sql), targetSelected: rows.some(row => row.reviewId === f.target.id) });
          await gate.hold((raw as pg.PoolClient & { processID: number }).processID);
        }
      } });
      const operation = settled(replay(f, wrapped.pool)); pending.push(operation);
      const replayPid = await bounded(gate.reached, "sensitive replay barrier");
      const review = instrument(trace, "review");
      const decision = settled(decide(f, review.pool)); pending.push(decision);
      const reviewPid = await bounded(review.connected, "Review connection");
      assert.notEqual(reviewPid, replayPid);
      const lost = await bounded(decision, "nonblocking Review owner conflict");
      assert(!lost.ok); assert.equal(lost.error.code, "review_item_locked");
      assert.equal(lost.error.details.reason, "owner_busy");
      assert(trace.some(e => e.actor === "review" && e.family === "try_advisory" && e.acquired === false));
      const locks = (await database.query("select pid,locktype,mode,granted from pg_locks where pid=$1 and locktype='advisory'", [replayPid])).rows;
      assert(locks.some(row => row.granted));
      trace.push({ event: "nonblocking_owner_conflict_observed", replayPid, reviewPid, locks, code: lost.error.code,
        reason: lost.error.details.reason, waitExpected: false });
      gate.release(); ok(await bounded(operation, "replay-first commit"));
      const after = await snapshot(f);
      assert.equal(after.review_items[0].status, "ignored");
      assert.equal(after[f.table][0].status, "superseded");
      assert.equal(after.time_entries.length, 0); assert.equal(after.review_mutation_receipts.length, 0);
      const retry = await settled(decide(f)); assert(!retry.ok); assert.equal(retry.error.code, "resolution_conflict");
      assert.deepEqual(await snapshot(f), after);
      trace.push({ event: "stale_decision_retry", code: retry.error.code, receiptCount: 0 });
    }
  } catch (error) { failure = error; }
  finally {
    gate.release();
    if (holder) { await holder.query("rollback"); holder.release(); }
    await Promise.allSettled(pending);
    const after = await snapshot(f);
    console.log(JSON.stringify({ c20: { source, head, kind, schedule, outcome: failure ? "FAIL" : "PASS",
      trace, before, protectedState, after, beforeHash: hash(before), afterHash: hash(after),
      changedClientIdentity: f.target.clientId, proposedClientIdentities: f.engineIds,
      ...(failure ? { failure: { name: (failure as Error).name, message: (failure as Error).message,
        code: (failure as { code?: string }).code } } : {}) } }));
    await cleanup(f);
  }
  if (failure) throw failure;
}
async function main() {
  ingest = await load("apps/web/src/lib/location/location-ingest-service");
  mutations = await load("apps/web/src/lib/review-mutation-service");
  presentation = await load("apps/web/src/lib/review-presentation-service");
  shared = await load("packages/shared/src/index");
  appPool = (await load("apps/web/src/lib/db")).pool;
  const schema = await database.query("select current_database() as database,current_setting('server_version') as postgres,postgis_lib_version() as postgis");
  console.log(JSON.stringify({ c20Runtime: { source, head, root, sharedResolution, schema: schema.rows[0] } }));
  try {
    for (const kind of ["stay", "commute"] as const) for (const schedule of ["row-lock", "review-first", "replay-first-protection", "replay-first-obsolete"] as const) {
      await runCase(kind, schedule);
    }
    console.log(JSON.stringify({ c20Summary: { source, head, outcome: "PASS", cases: 8,
      limitation: "Finite exercised schedules, not universal deadlock proof." } }));
  } finally {
    for (const session of owned) {
      await database.query("delete from workspaces where id=$1", [session.workspaceId]);
      await database.query("delete from users where id=$1", [session.userId]);
    }
    await database.end(); await appPool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
