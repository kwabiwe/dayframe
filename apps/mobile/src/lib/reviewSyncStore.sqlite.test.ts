import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticId, syntheticReviewBootstrap } from "../../../../scripts/fixtures/review-performance";

const mocks = vi.hoisted(() => ({ open: vi.fn(), fetch: vi.fn(), session: vi.fn(), current: vi.fn(), failItem: "" }));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: mocks.open }));
vi.mock("./secure-session", () => ({ readOwnedAuthenticatedSessionSnapshot: mocks.session, invalidateMobileSessionIfCurrent: vi.fn(), isAuthenticatedSessionSnapshotCurrent: mocks.current }));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://local-fixture.invalid" }));
vi.mock("./mobile-network", () => ({ mobileFetchWithTimeout: mocks.fetch, MobileRequestTimeoutError: class extends Error {} }));
let db: DatabaseSync;
let directory: string;
let store: typeof import("./reviewSyncStore");
const bootstrap = () => syntheticReviewBootstrap(4);
const mergeInput = () => {
  const data = bootstrap();
  return { bootstrap: data, item: data.reviewItems[2], affectedItems: data.reviewItems.slice(2),
    clientMutationId: syntheticId(10), mutation: { action: "merge" as const, adjacentReviewItemId: data.reviewItems[3].id, acknowledgeContradictoryEvidence: false } };
};
function adapter() {
  const value = {
    execAsync: async (sql: string) => { db.exec(sql); },
    getFirstAsync: async (sql: string, ...args: never[]) => db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql: string, ...args: never[]) => db.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: never[]) => {
      if (mocks.failItem && sql.includes("insert into review_mutation_effects") && args.includes(mocks.failItem as never)) throw new Error("simulated disk failure");
      return db.prepare(sql).run(...args);
    },
    withExclusiveTransactionAsync: async (fn: (transaction: unknown) => Promise<void>) => {
      db.exec("BEGIN IMMEDIATE");
      try { await fn(value); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  };
  return value;
}
const count = (table: string) => Number(db.prepare(`select count(*) as n from ${table}`).get()!.n);
async function reopen() {
  vi.resetModules();
  store = await import("./reviewSyncStore");
}
beforeEach(async () => {
  vi.resetAllMocks(); mocks.failItem = "";
  directory = mkdtempSync(join(tmpdir(), "dayframe-review-test-"));
  db = new DatabaseSync(join(directory, "review.db"));
  mocks.open.mockImplementation(async () => adapter());
  mocks.current.mockReturnValue(true);
  mocks.session.mockResolvedValue({ status: "authenticated", snapshot: { token: "synthetic-token" } });
  await reopen(); await store.processReviewBootstrap(bootstrap());
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe("Review real SQLite transactions", () => {
  it("atomically hides both merge sources and survives reopening", async () => {
    await store.enqueueReviewMutation(mergeInput());
    expect(count("review_mutation_outbox")).toBe(1); expect(count("review_mutation_effects")).toBe(2);
    await reopen();
    expect((await store.loadCachedReviewBootstrap())?.bootstrap.reviewItems.map(x => x.id)).toEqual(bootstrap().reviewItems.slice(0, 2).map(x => x.id));
    expect((await store.getReviewItemSyncStates()).size).toBe(2);
  });
  it("rolls back the whole merge when the second effect fails", async () => {
    mocks.failItem = mergeInput().affectedItems[1].id;
    await expect(store.enqueueReviewMutation(mergeInput())).rejects.toThrow("disk failure");
    expect(count("review_mutation_outbox")).toBe(0); expect(count("review_mutation_effects")).toBe(0);
    expect((await store.loadCachedReviewBootstrap())?.bootstrap.reviewItems).toHaveLength(4);
  });
  it("rejects missing, busy or invalid sources without hiding another card", async () => {
    await expect(store.enqueueReviewMutation({ ...mergeInput(), affectedItems: [mergeInput().item] })).rejects.toThrow();
    const data = bootstrap();
    await expect(store.enqueueReviewMutation({ ...mergeInput(), item: data.reviewItems[0], affectedItems: [data.reviewItems[0], data.reviewItems[3]] })).rejects.toThrow("Only saved Location");
    await store.enqueueReviewMutation(mergeInput());
    const input = mergeInput();
    await expect(store.enqueueReviewMutation({ ...input, clientMutationId: syntheticId(11), item: input.affectedItems[1], affectedItems: undefined, mutation: { action: "confirm" } })).rejects.toThrow("already exists");
    expect(count("review_mutation_outbox")).toBe(1);
  });
  it("binds stable IDs to the exact action and primary source", async () => {
    const input = mergeInput(); await store.enqueueReviewMutation(input);
    expect((await store.enqueueReviewMutation(input)).idempotent).toBe(true);
    await expect(store.enqueueReviewMutation({ ...input, mutation: { ...input.mutation, acknowledgeContradictoryEvidence: true } })).rejects.toThrow("different data");
    await expect(store.enqueueReviewMutation({ ...input, item: input.affectedItems[1], mutation: { ...input.mutation, adjacentReviewItemId: input.item.id } })).rejects.toThrow("different data");
  });
  it("restores only canonically open sources after a permanent conflict", async () => {
    const input = mergeInput(); await store.enqueueReviewMutation(input);
    mocks.fetch.mockResolvedValue({ status: 409, json: async () => ({ code: "resolution_conflict", canonicalReviewStatuses: { [input.item.id]: "accepted", [input.mutation.adjacentReviewItemId]: "open" } }) });
    await store.synchroniseReviewMutations();
    const ids = (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map(x => x.id);
    expect(ids).not.toContain(input.item.id); expect(ids).toContain(input.mutation.adjacentReviewItemId);
    expect(count("review_mutation_outbox")).toBe(1);
    await store.discardReviewSyncIssue(input.clientMutationId);
    const afterDiscard = (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map(x => x.id);
    expect(afterDiscard).not.toContain(input.item.id);
    expect(afterDiscard).toContain(input.mutation.adjacentReviewItemId);
  });
  it("retains acknowledged merge tombstones until both source IDs disappear", async () => {
    const input = mergeInput(); await store.enqueueReviewMutation(input);
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true }) });
    await store.synchroniseReviewMutations();
    await store.processReviewBootstrap({ ...input.bootstrap, reviewItems: input.bootstrap.reviewItems.filter(x => x.id !== input.item.id) });
    expect(count("review_mutation_outbox")).toBe(1);
    await store.processReviewBootstrap({ ...input.bootstrap, reviewItems: input.bootstrap.reviewItems.slice(0, 2) });
    expect(count("review_mutation_outbox")).toBe(0); expect(count("review_mutation_effects")).toBe(0);
  });
  it("keeps intent pending without dispatch when the session changes during local preparation", async () => {
    await store.enqueueReviewMutation(mergeInput());
    mocks.current.mockReturnValue(false);
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("pending");
    expect(count("review_mutation_effects")).toBe(2);
  });
  it("backfills a v4 pending action without changing its stable ID or request", async () => {
    const data = bootstrap();
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(20), mutation: { action: "accept" } });
    const request = db.prepare("select request_json from review_mutation_outbox").get()!.request_json;
    db.exec("drop table review_mutation_effects; drop index review_mutation_owner_idx; pragma user_version=4;");
    await reopen(); await store.loadCachedReviewBootstrap();
    expect(db.prepare("pragma user_version").get()!.user_version).toBe(5);
    expect(count("review_mutation_effects")).toBe(1);
    expect(db.prepare("select request_json from review_mutation_outbox").get()!.request_json).toBe(request);
  });
  it("rejects cross-account effects and clears sensitive intent on account replacement", async () => {
    await store.enqueueReviewMutation(mergeInput());
    const data = bootstrap();
    await store.activateReviewAccount({ workspaceId: data.workspace.id, workspaceName: "Other synthetic", userId: syntheticId(9) });
    expect(count("review_mutation_effects")).toBe(0); expect(count("review_mutation_outbox")).toBe(0);
    await expect(store.enqueueReviewMutation(mergeInput())).rejects.toThrow("not configured");
  });
});
