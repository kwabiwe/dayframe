import { afterEach, describe, expect, it, vi } from "vitest";
import { withSyncTransaction } from "./sync-transaction";

function lease(query = vi.fn(async () => ({ rows: [] }))) {
  const client = { query, release: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  return { client, pool: pool as unknown as import("pg").Pool };
}
afterEach(() => vi.useRealTimers());

describe("bounded sync ownership", () => {
  it("settles a successful lease once, with the receipt committed before release", async () => {
    const { client, pool } = lease();
    await withSyncTransaction("test", async ({ client }) => { await client.query("insert receipt"); }, { databasePool: pool });
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    const calls = client.query.mock.calls as unknown as string[][];
    expect(calls.findIndex(([sql]) => sql === "insert receipt")).toBeLessThan(calls.findIndex(([sql]) => sql === "commit"));
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
