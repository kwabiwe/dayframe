import { afterEach, describe, expect, it, vi } from "vitest";
import { withSyncTransaction } from "./sync-transaction";

function lease(query = vi.fn(async () => ({ rows: [] }))) {
  const client = { query, release: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  return { client, pool: pool as unknown as import("pg").Pool };
}
type QueryCall = [statement: string, params?: unknown[]];
const queryCalls = (client: ReturnType<typeof lease>["client"]) =>
  client.query.mock.calls as unknown as QueryCall[];
afterEach(() => vi.useRealTimers());

describe("bounded sync ownership", () => {
  it("settles a successful lease once, with the receipt committed before release", async () => {
    const { client, pool } = lease();
    await withSyncTransaction("test", async ({ client }) => { await client.query("insert receipt"); }, { databasePool: pool });
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    const calls = client.query.mock.calls as unknown as string[][];
    expect(calls[0]?.[0]).toMatch(/^begin;/i);
    expect(calls.findIndex(([sql]) => sql === "insert receipt")).toBeLessThan(calls.findIndex(([sql]) => sql === "commit"));
  });
  it("observes transaction boundaries without changing the SQL sequence", async () => {
    const baseline = lease();
    await withSyncTransaction("baseline", async ({client}) => { await client.query("effect"); }, {databasePool:baseline.pool});
    const observed = lease(); const events: string[] = [];
    await withSyncTransaction("observed", async ({client}) => { await client.query("effect"); }, {
      databasePool: observed.pool,
      onSyncTiming: event => events.push(`${event.stage}:${event.state}`)
    });
    const observedSql = observed.client.query.mock.calls as unknown as string[][];
    const baselineSql = baseline.client.query.mock.calls as unknown as string[][];
    expect(observedSql.map(call=>call[0])).toEqual(baselineSql.map(call=>call[0]));
    expect(events).toEqual([
      "connection_acquisition:started","connection_acquisition:completed",
      "transaction_configuration:started","transaction_configuration:completed",
      "transaction_commit:started","transaction_commit:completed"
    ]);
  });
  it("ignores timing observer failures", async () => {
    const {client,pool}=lease();
    await expect(withSyncTransaction("test",async ({client})=>{await client.query("effect");},{
      databasePool:pool,onSyncTiming:()=>{throw new Error("observer failed");}
    })).resolves.toBeUndefined();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("preserves the original transaction failure when timing observation also fails", async () => {
    const failure = Object.assign(new Error("query failed"), {code:"57014"});
    const {pool}=lease(vi.fn(async (sql:string)=>{
      if(sql==="effect") throw failure;
      return {rows:[]};
    }) as never);
    await expect(withSyncTransaction("test",async ({client})=>{await client.query("effect");},{
      databasePool:pool,onSyncTiming:()=>{throw new Error("observer failed");}
    })).rejects.toBe(failure);
  });
  it("applies the typed repeatable-read option at BEGIN before configuration queries", async () => {
    const { client, pool } = lease();
    await withSyncTransaction("snapshot", async () => undefined, {
      databasePool: pool,
      isolationLevel: "repeatable read",
      readOnly: true
    });
    const calls = client.query.mock.calls as unknown as string[][];
    expect(calls[0]?.[0]).toMatch(/^begin isolation level repeatable read read only;/i);
    expect(calls.slice(1).some(([sql]) => sql.includes("set_config('application_name'"))).toBe(true);
  });
  it("keeps per-query timeout configuration for callers without the replay opt-in", async () => {
    const { client, pool } = lease();
    await withSyncTransaction("default", async ({ client }) => {
      await client.query("select first_effect");
      await client.query("select second_effect");
    }, { databasePool: pool });

    const configurationCalls = queryCalls(client).filter(([sql]) =>
      String(sql).includes("set_config('statement_timeout'"));
    expect(configurationCalls).toHaveLength(2);
  });
  it("reuses only the known full-cap timeout pair for the explicit replay opt-in", async () => {
    const { client, pool } = lease();
    await withSyncTransaction("replay", async ({ client }) => {
      await client.query("select first_effect");
      await client.query("select second_effect");
    }, { databasePool: pool, reuseFullCapTimeoutPair: true });

    const sql = queryCalls(client).map(([statement]) => String(statement));
    expect(sql[0]).toMatch(/set local statement_timeout = '3000ms'; set local lock_timeout = '1500ms'/i);
    expect(sql).toContain("select first_effect");
    expect(sql).toContain("select second_effect");
    expect(sql.indexOf("select first_effect")).toBeLessThan(sql.indexOf("select second_effect"));
    expect(sql.filter(statement => statement.includes("set_config('statement_timeout'"))).toHaveLength(0);
  });
  it("falls back to the existing configuration calls when the budget is finite and near its deadline", async () => {
    vi.useFakeTimers();
    const query = vi.fn(async () => {
      vi.advanceTimersByTime(5);
      return { rows: [] };
    });
    const { client, pool } = lease(query as never);
    await withSyncTransaction("finite", async ({ client }) => {
      await client.query("select first_effect");
      await client.query("select second_effect");
    }, {
      databasePool: pool,
      deadlineAt: Date.now() + 85,
      cleanupReserveMs: 0,
      reuseFullCapTimeoutPair: true
    });

    const configurationCalls = queryCalls(client).filter(([sql]) =>
      String(sql).includes("set_config('statement_timeout'"));
    expect(configurationCalls).toHaveLength(2);
    expect(configurationCalls.every(([, params]) => String((params as string[])[0]).endsWith("ms"))).toBe(true);
  });
  it("invalidates the replay cache after savepoint recovery and timeout-setting SQL", async () => {
    const savepoint = lease();
    await withSyncTransaction("savepoint", async ({ client }) => {
      await client.query("savepoint nested");
      await client.query("select after_savepoint");
    }, { databasePool: savepoint.pool, reuseFullCapTimeoutPair: true });
    expect(queryCalls(savepoint.client).filter(([sql]) =>
      String(sql).includes("set_config('statement_timeout'"))).toHaveLength(1);

    const setting = lease();
    await withSyncTransaction("setting", async ({ client }) => {
      await client.query("select set_config($1, $2, true)", ["statement_timeout", "3000ms"]);
      await client.query("select after_setting");
    }, { databasePool: setting.pool, reuseFullCapTimeoutPair: true });
    expect(queryCalls(setting.client).filter(([sql]) =>
      String(sql).includes("set_config('statement_timeout', $1"))).toHaveLength(1);
  });
  it("destroys a lease when rollback fails without masking the original SQLSTATE", async () => {
    const failure = Object.assign(new Error("private detail"), { code: "57014" });
    const query = vi.fn(async (sql: string) => {
      if (sql === "effect") throw failure;
      if (sql === "rollback") throw new Error("connection lost");
      return { rows: [] };
    });
    const { client, pool } = lease(query as never);
    await expect(withSyncTransaction("test", async ({ client }) => { await client.query("effect"); }, { databasePool: pool })).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(failure).toMatchObject({ code: "57014", syncPhase: "effect" });
  });
  it("times out acquisition and destroys a late-arriving lease without starting SQL", async () => {
    vi.useFakeTimers();
    const { client, pool } = lease();
    let arrive!: (client: unknown) => void;
    vi.mocked(pool.connect).mockReturnValue(new Promise(resolve => { arrive = resolve; }) as never);
    const result = withSyncTransaction("test", async () => {}, { databasePool: pool, deadlineAt: Date.now() + 200, cleanupReserveMs: 50 });
    const rejection = expect(result).rejects.toMatchObject({ reason: "operation_deadline", phase: "acquire" });
    await vi.advanceTimersByTimeAsync(151); await rejection;
    arrive(client); await vi.advanceTimersByTimeAsync(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.query).not.toHaveBeenCalled();
  });
  it("does not let a late body continue SQL after cancellation", async () => {
    const { client, pool } = lease(); const controller = new AbortController();
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const body = new Promise<void>(resolve => { finish = resolve; });
    const result = withSyncTransaction("test", async ({ client }) => {
      entered(); await body; await client.query("late effect");
    }, { databasePool: pool, signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({ reason: "cancelled" });
    await ready; controller.abort(); await rejection; finish();
    await Promise.resolve(); await Promise.resolve();
    expect(client.query).not.toHaveBeenCalledWith("late effect");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("fails closed when a supported transaction timeout setting is rejected", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("current_setting")) return { rows: [{ transaction_timeout: "0" }] };
      if (sql.includes("set_config('transaction_timeout'")) throw Object.assign(new Error("denied"), { code: "42501" });
      return { rows: [] };
    });
    const { client, pool } = lease(query as never); const work = vi.fn();
    await expect(withSyncTransaction("test", work, { databasePool: pool })).rejects.toMatchObject({ code: "42501", syncPhase: "configure" });
    expect(work).not.toHaveBeenCalled(); expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe("sync failure domains", () => {
  it("classifies acquisition failure as service availability, not query cancellation", async () => {
    const { pool } = lease();
    vi.mocked(pool.connect).mockRejectedValueOnce(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }) as never);
    await expect(withSyncTransaction("test", async () => {}, { databasePool: pool })).rejects.toMatchObject({
      reason: "connection_unavailable", phase: "acquire"
    });
  });
});
