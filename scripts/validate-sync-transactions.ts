import assert from "node:assert/strict";
import pg from "pg";
import { withSyncTransaction, SyncOperationError } from "../apps/web/src/lib/sync-transaction";
import { pool } from "../apps/web/src/lib/db";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"),
  "Use a disposable local *_test database; this script never targets hosted data.");
const monitor = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 1_500 });
const key = 940604;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function lockAvailable() {
  const r = await monitor.query("select pg_try_advisory_lock($1) as acquired", [key]);
  if (r.rows[0].acquired) await monitor.query("select pg_advisory_unlock($1)", [key]);
  return r.rows[0].acquired;
}
async function eventuallyUnlocked() {
  const end = Date.now() + 4_000;
  while (Date.now() < end) { if (await lockAvailable()) return; await pause(25); }
  assert.fail("Destroyed client retained its transaction lock");
}

async function main() {
try {
  await monitor.connect();
  await withSyncTransaction("settings", async ({ client }) => {
    const r = await client.query("select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock, current_setting('idle_in_transaction_session_timeout') as idle");
    assert.equal(r.rows[0].statement, "3s"); assert.equal(r.rows[0].lock, "1500ms"); assert.equal(r.rows[0].idle, "5s");
  });
  console.log("PASS transaction-local statement/lock/idle guards on installed PostgreSQL");

  const controller = new AbortController();
  let acquired!: () => void;
  const locked = new Promise<void>(resolve => { acquired = resolve; });
  const result = withSyncTransaction("cancel_test", async ({ client }) => {
    await client.query("select pg_advisory_xact_lock($1)", [key]);
    acquired();
    await client.query("select pg_sleep(20)");
  }, { signal: controller.signal });
  const rejected = assert.rejects(result, error => error instanceof SyncOperationError && error.reason === "cancelled");
  await locked;
  assert.equal(await lockAvailable(), false);
  controller.abort();
  await rejected;
  await eventuallyUnlocked();
  console.log("PASS abort destroys client connection; server lock releases within the 3s statement guard");

  const start = Date.now();
  await assert.rejects(withSyncTransaction("whole_budget", async ({ client }) => {
    await client.query("select pg_advisory_xact_lock($1)", [key]);
    for (let i = 0; i < 15; i++) await client.query("select pg_sleep(0.12)");
  }, { deadlineAt: start + 650, cleanupReserveMs: 100 }));
  assert(Date.now() - start < 1_200);
  await eventuallyUnlocked();
  console.log("PASS cumulative operation budget bounds many individually short statements");

  // This connection deliberately has NO JavaScript cleanup callback. The server
  // must terminate it while idle and free its lock without application help.
  const abandoned = new pg.Client({ connectionString: url.toString() });
  abandoned.on("error", () => {});
  await abandoned.connect();
  await abandoned.query("begin; set local idle_in_transaction_session_timeout='200ms'");
  await abandoned.query("select pg_advisory_xact_lock($1)", [key]);
  assert.equal(await lockAvailable(), false);
  await pause(350);
  assert.equal(await lockAvailable(), true);
  await abandoned.end();
  console.log("PASS database-enforced idle expiry releases locks without a finally callback");
} finally { await monitor.end(); await pool.end(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
