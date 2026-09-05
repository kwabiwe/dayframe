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
vi.mock("./mobile-network", () => ({ mobileJsonRequest: async (...args: unknown[]) => { const response = await mocks.fetch(...args); return {response,body:await response.json()}; }, MobileRequestTimeoutError: class extends Error {}, StaleMobileSessionResponseError: class extends Error {}, isMobileTransportFailure: (error: unknown) => error instanceof TypeError }));
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
  it("selects the latest failure by timestamp rather than alphabetic error text", async () => {
    const data=bootstrap();
    for(let n=0;n<2;n++) await store.enqueueReviewMutation({bootstrap:data,item:data.reviewItems[n],clientMutationId:syntheticId(94+n),mutation:{action:"accept"}});
    db.prepare("update review_mutation_outbox set last_error='z older',updated_at='2026-01-01' where client_mutation_id=?").run(syntheticId(94));
    db.prepare("update review_mutation_outbox set last_error='a latest',updated_at='2026-01-02' where client_mutation_id=?").run(syntheticId(95));
    expect((await store.getReviewSyncDiagnostics()).lastError).toBe("a latest");
  });
  it("reconciles a recently interrupted delivery after reopening without replacing its envelope", async () => {
    const data = bootstrap();
    const clientMutationId = syntheticId(91);
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId, mutation: { action: "accept" } });
    db.exec("update review_mutation_outbox set state='in_flight',resolution_status='delivery_unknown',attempt_count=1");
    const before = db.prepare("select request_json,created_at from review_mutation_outbox").get()!;
    await reopen();
    const receipt = { ok: true, action: "accept", status: "accepted", entryId: syntheticId(99) };
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true, results: [{
      clientMutationId, reviewItemId: data.reviewItems[0].id, checkedAt: new Date().toISOString(), state: "applied", result: receipt
    }] }) });
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][0]).toContain("/reconcile");
    const after = db.prepare("select request_json,created_at,state,acknowledgement_json from review_mutation_outbox").get()!;
    expect(after).toMatchObject({ ...before, state: "acknowledged" });
    expect(JSON.parse(String(after.acknowledgement_json))).toEqual(receipt);
  });
  it("does not discard an ambiguous server outcome or restore its hidden card", async () => {
    const data = bootstrap();
    const clientMutationId = syntheticId(92);
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId, mutation: { action: "accept" } });
    db.exec("update review_mutation_outbox set state='needs_attention',resolution_status='resolution_unknown'");
    expect(await store.discardReviewSyncIssue(clientMutationId)).toBe(false);
    expect(count("review_mutation_outbox")).toBe(1);
    expect((await store.loadCachedReviewBootstrap())?.bootstrap.reviewItems.some(item => item.id === data.reviewItems[0].id)).toBe(false);
  });
  it("treats session generation replacement separately from rejected authentication", async () => {
    const data = bootstrap();
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(93), mutation: { action: "accept" } });
    mocks.session.mockResolvedValue({ status: "changed" });
    expect((await store.synchroniseReviewMutations()).outcome).toBe("cancelled");
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("pending");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("retains an HTML or unsuccessful 200 instead of acknowledging durable intent", async () => {
    const data = bootstrap();
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(81), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: false }) });
    await store.synchroniseReviewMutations();
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).not.toBe("acknowledged");
  });
  it("escalates an old 21-attempt immutable intent into receipt reconciliation", async () => {
    const data = bootstrap();
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(82), mutation: { action: "accept" } });
    db.exec("update review_mutation_outbox set attempt_count=21, created_at='2026-01-01T00:00:00Z'");
    mocks.fetch.mockResolvedValue({ status: 409, json: async () => ({ code: "review_item_locked" }) });
    await store.synchroniseReviewMutations();
    expect(mocks.fetch.mock.calls[0][0]).toContain("/api/review/mutations/reconcile");
    const row=db.prepare("select client_mutation_id,attempt_count,created_at,state from review_mutation_outbox").get()!;
    expect(row.client_mutation_id).toBe(syntheticId(82));
    expect(row.created_at).toBe("2026-01-01T00:00:00Z");
    expect(row.state).toBe("needs_attention");
  });
  it("delivers independent Review siblings after one server-busy response", async () => {
    const data = bootstrap();
    for(let n=0;n<2;n++) await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[n], clientMutationId: syntheticId(83+n), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValueOnce({status:409,json:async()=>({code:"review_item_locked"})})
      .mockResolvedValue({status:200,json:async()=>({ok:true,action:"accept",status:"accepted",entryId:syntheticId(99)})});
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(db.prepare("select count(*) as n from review_mutation_outbox where state='acknowledged'").get()!.n).toBe(1);
  });
  it("runs exactly one manual follow-up when forced during an ordinary pass", async () => {
    const data=bootstrap();
    await store.enqueueReviewMutation({bootstrap:data,item:data.reviewItems[0],clientMutationId:syntheticId(85),mutation:{action:"accept"}});
    let finish!:()=>void;
    mocks.fetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({status:409,json:async()=>({code:"review_item_locked"})});}))
      .mockResolvedValue({status:200,json:async()=>({ok:true,action:"accept",status:"accepted",entryId:syntheticId(99)})});
    const ordinary=store.synchroniseReviewMutations();
    await vi.waitFor(()=>expect(mocks.fetch).toHaveBeenCalledOnce());
    const manual=store.synchroniseReviewMutations({force:true});
    const repeated=store.synchroniseReviewMutations({force:true});
    finish(); await Promise.all([ordinary,manual,repeated]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("acknowledged");
  });

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
  it("coalesces a repeated local action onto the existing durable intent", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    const first = await store.enqueueReviewMutation({
      bootstrap: data,
      item,
      clientMutationId: syntheticId(40),
      mutation: { action: "accept" }
    });
    const repeated = await store.enqueueReviewMutation({
      bootstrap: data,
      item,
      clientMutationId: syntheticId(41),
      mutation: { action: "accept" }
    });
    expect(first.idempotent).toBe(false);
    expect(repeated.idempotent).toBe(true);
    expect(repeated.envelope.clientMutationId).toBe(first.envelope.clientMutationId);
    expect(count("review_mutation_outbox")).toBe(1);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id)).not.toContain(item.id);
  });
  it("ordinary triggers join one active Review pass", async () => {
    const data = bootstrap();
    await store.enqueueReviewMutation({
      bootstrap: data,
      item: data.reviewItems[0],
      clientMutationId: syntheticId(42),
      mutation: { action: "accept" }
    });
    let releaseResponse!: () => void;
    mocks.fetch.mockImplementation(() => new Promise((resolve) => {
      releaseResponse = () => resolve({
        status: 409,
        json: async () => ({ code: "review_item_locked" })
      });
    }));
    const first = store.synchroniseReviewMutations();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    const repeated = store.synchroniseReviewMutations();
    releaseResponse();
    await Promise.all([first, repeated]);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(db.prepare("select attempt_count from review_mutation_outbox").get()!.attempt_count).toBe(1);
  });
  it("keeps a locked mutation hidden until a later retry is acknowledged", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    await store.enqueueReviewMutation({
      bootstrap: data,
      item,
      clientMutationId: syntheticId(43),
      mutation: { action: "accept" }
    });
    mocks.fetch
      .mockResolvedValueOnce({
        status: 409,
        json: async () => ({ code: "review_item_locked" })
      })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true, action: "accept", status: "accepted", entryId: syntheticId(99) }) });

    await store.synchroniseReviewMutations();
    await store.processReviewBootstrap(data);
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("retry_wait");
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id)).not.toContain(item.id);

    await store.synchroniseReviewMutations({ force: true });
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("acknowledged");
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id)).not.toContain(item.id);

    await store.processReviewBootstrap({
      ...data,
      reviewItems: data.reviewItems.filter((candidate) => candidate.id !== item.id)
    });
    expect(count("review_mutation_outbox")).toBe(0);
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
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true, action: "merge", status: "accepted", mergedSegmentId: syntheticId(99) }) });
    await store.synchroniseReviewMutations();
    await store.processReviewBootstrap({ ...input.bootstrap, reviewItems: input.bootstrap.reviewItems.filter(x => x.id !== input.item.id) });
    expect(count("review_mutation_outbox")).toBe(1);
    await store.processReviewBootstrap({ ...input.bootstrap, reviewItems: input.bootstrap.reviewItems.slice(0, 2) });
    expect(count("review_mutation_outbox")).toBe(0); expect(count("review_mutation_effects")).toBe(0);
  });
  it("repairs a server-rejected split that an older client queued for a commute", async () => {
    const data = bootstrap();
    const visit = data.reviewItems[2];
    await store.enqueueReviewMutation({
      bootstrap: data,
      item: visit,
      clientMutationId: syntheticId(30),
      mutation: { action: "split", splitAt: visit.suggestedStartedAt! }
    });
    db.prepare(`update review_mutation_outbox set state = 'needs_attention', last_http_status = 422,
      last_error = 'HTTP 422 · invalid_action'`).run();
    await store.processReviewBootstrap({
      ...data,
      reviewItems: data.reviewItems.map((item) => item.id === visit.id
        ? { ...item, eventType: "commute_detected" }
        : item)
    });
    expect(count("review_mutation_outbox")).toBe(0);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((item) => item.id)).toContain(visit.id);
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
    for (const column of ["contention_count","reconciliation_attempt_count","last_reconciled_at","resolution_status","acknowledgement_json"]) db.exec(`alter table review_mutation_outbox drop column ${column}`);
    db.exec("drop table review_mutation_effects; drop index review_mutation_owner_idx; pragma user_version=4;");
    await reopen(); await store.loadCachedReviewBootstrap();
    expect(db.prepare("pragma user_version").get()!.user_version).toBe(6);
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
