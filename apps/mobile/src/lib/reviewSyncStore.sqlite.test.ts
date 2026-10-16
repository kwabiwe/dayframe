import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticId, syntheticReviewBootstrap, syntheticReviewEvidence } from "../../../../scripts/fixtures/review-performance";

const mocks = vi.hoisted(() => ({ open: vi.fn(), fetch: vi.fn(), session: vi.fn(), current: vi.fn(), failItem: "", interleave: [] as Array<{ match: string; run: () => void | Promise<void>; after?: boolean }> }));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: mocks.open }));
vi.mock("./backendIdentity", () => ({ DAYFRAME_BACKEND_ID: "dayframe-staging" }));
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
/** Runs a scripted step before (or, with `after`, after) the first query matching it. */
async function interleaved<Result>(sql: string, query: () => Result) {
  const index = mocks.interleave.findIndex(({ match }) => sql.includes(match));
  const step = index >= 0 ? mocks.interleave.splice(index, 1)[0] : null;
  if (step && !step.after) await step.run();
  const result = query();
  if (step?.after) await step.run();
  return result;
}
function adapter() {
  const value = {
    execAsync: async (sql: string) => { db.exec(sql); },
    getFirstAsync: (sql: string, ...args: never[]) => interleaved(sql, () => db.prepare(sql).get(...args) ?? null),
    getAllAsync: (sql: string, ...args: never[]) => interleaved(sql, () => db.prepare(sql).all(...args)),
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
  vi.resetAllMocks(); mocks.failItem = ""; mocks.interleave = [];
  directory = mkdtempSync(join(tmpdir(), "dayframe-review-test-"));
  db = new DatabaseSync(join(directory, "review.db"));
  mocks.open.mockImplementation(async () => adapter());
  mocks.current.mockReturnValue(true);
  mocks.session.mockResolvedValue({ status: "authenticated", snapshot: { token: "synthetic-token" } });
  await reopen(); await store.processReviewBootstrap(bootstrap());
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe("Review real SQLite transactions", () => {
  it("exposes only bounded safe presentation diagnostics for the active account and backend", async () => {
    const data = bootstrap();
    const owner = { backendId: "dayframe-staging", workspaceId: data.workspace.id, userId: data.user.id };
    store.recordReviewPresentationRead(owner, "today", "offline");
    store.recordReviewPresentationRead(owner, "backlog", "cache");
    let diagnostics = await store.getReviewSyncDiagnostics();
    expect(diagnostics.presentationReads).toEqual([
      { surface: "today", status: "offline", checkedAt: expect.any(String) },
      { surface: "backlog", status: "cache", checkedAt: expect.any(String) }
    ]);
    store.recordReviewPresentationRead(owner, "today", "raw private payload" as never);
    expect((await store.getReviewSyncDiagnostics()).presentationReads).toEqual(diagnostics.presentationReads);
    store.recordReviewPresentationRead(owner, "today", "success");
    store.recordReviewPresentationRead({ ...owner, backendId: "other" }, "backlog", "server");
    diagnostics = await store.getReviewSyncDiagnostics();
    expect(diagnostics.presentationReads).toEqual([{ surface: "today", status: "success", checkedAt: expect.any(String) }]);
    store.recordReviewPresentationRead({ ...owner, userId: syntheticId(999) }, "today", "server");
    expect((await store.getReviewSyncDiagnostics()).presentationReads).toEqual([]);
    expect(diagnostics.waitingCount).toBe(0);
    expect(count("review_mutation_outbox")).toBe(0);
  });
  it("reads Settings' remembered Review state only for the store's own active account (Codex r4 on #355)", async () => {
    const data = bootstrap();
    const ownerA = { userId: data.user.id, workspaceId: data.workspace.id };
    const ownerB = { userId: syntheticId(901), workspaceId: syntheticId(902) };
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(90), mutation: { action: "accept" } });
    db.exec("update review_mutation_outbox set state='needs_attention',resolution_status=null,last_http_status=422");
    const forA = await store.readReviewSyncStateForOwner(ownerA);
    expect(forA?.issues.map((issue) => issue.clientMutationId)).toEqual([syntheticId(90)]);
    expect(forA?.diagnostics.needsAttentionCount).toBe(1);
    // The app already belongs to B while this store still holds A: nothing of A's is read for B.
    expect(await store.readReviewSyncStateForOwner(ownerB)).toBeNull();
    // Once the store reconciles to B, A's reads come back empty-handed and B reads only its own.
    await store.activateReviewAccount({ ...ownerB, workspaceName: "B" });
    expect(await store.readReviewSyncStateForOwner(ownerA)).toBeNull();
    const forB = await store.readReviewSyncStateForOwner(ownerB);
    expect(forB?.issues).toEqual([]);
    expect(forB?.diagnostics.needsAttentionCount).toBe(0);
  });
  it("keys the evidence-cache numbers to the read's account, and drops a read the store switched under (Codex r5 on #355)", async () => {
    const data = bootstrap();
    const ownerA = { userId: data.user.id, workspaceId: data.workspace.id };
    const keyA = `${ownerA.workspaceId}:${ownerA.userId}`;
    const keyB = `${syntheticId(902)}:${syntheticId(901)}`;
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const evidence = db.prepare("insert into location_review_evidence_cache (account_key, review_item_id, evidence_json, fetched_at, expires_at, byte_size, last_accessed_at) values (?, ?, '{}', ?, ?, ?, ?)");
    evidence.run(keyA, syntheticId(70), now, later, 100, now);
    db.prepare("insert into review_account_context (account_key, workspace_id, user_id, workspace_name, configured_at, updated_at) values (?, ?, ?, 'B', ?, ?)")
      .run(keyB, syntheticId(902), syntheticId(901), now, now);
    for (let n = 0; n < 3; n++) evidence.run(keyB, syntheticId(80 + n), now, later, 1000, now);
    // A's own read: A's evidence only.
    const forA = await store.readReviewSyncStateForOwner(ownerA);
    expect(forA?.diagnostics.evidenceCacheItemCount).toBe(1);
    expect(forA?.diagnostics.evidenceCacheBytes).toBe(100);
    const activate = (key: string) => () => {
      db.prepare("update review_store_metadata set value = ? where key = 'active_account'").run(key);
    };
    // The store moves to B mid-read and back to A before the read ends: the evidence numbers are
    // still A's, because every query is keyed to the account the read captured.
    mocks.interleave = [
      { match: "count(*) filter (where state in ('pending', 'in_flight'))", run: activate(keyB) },
      { match: "from location_review_evidence_cache", run: () => queueMicrotask(activate(keyA)) }
    ];
    const switchedAndBack = await store.readReviewSyncStateForOwner(ownerA);
    expect(mocks.interleave).toEqual([]);
    expect(switchedAndBack?.diagnostics.evidenceCacheItemCount).toBe(1);
    expect(switchedAndBack?.diagnostics.evidenceCacheBytes).toBe(100);
    // The store moves to B mid-read and stays there: nothing is published for A.
    mocks.interleave = [{ match: "from location_review_evidence_cache", run: activate(keyB) }];
    expect(await store.readReviewSyncStateForOwner(ownerA)).toBeNull();
    expect(mocks.interleave).toEqual([]);
  });
  it("starts the in-process cache and mutation counters over when the store's account changes (Codex r5 on #355)", async () => {
    expect(await store.loadCachedReviewBootstrap()).not.toBeNull();
    expect((await store.getReviewSyncDiagnostics()).reviewCacheHitCount).toBeGreaterThan(0);
    await store.activateReviewAccount({ userId: syntheticId(901), workspaceId: syntheticId(902), workspaceName: "B" });
    const forB = await store.getReviewSyncDiagnostics();
    expect(forB.reviewCacheHitCount).toBe(0);
    expect(forB.lastLocalMutationAction).toBeNull();
  });
  it("never lets a late cache read or mutation from A write into B's in-process counters (Codex r6 on #355)", async () => {
    const data = bootstrap();
    const ownerB = { userId: syntheticId(901), workspaceId: syntheticId(902), workspaceName: "B" };
    const evidence = syntheticReviewEvidence(data)[0];
    await store.cacheLocationReviewEvidence({ expectedWorkspaceId: data.workspace.id, expectedUserId: data.user.id, reviewItemId: evidence.reviewItemId, evidence, fetchedAt: new Date().toISOString() });
    db.prepare("update location_review_evidence_cache set byte_size = 12345, expires_at = ?").run(new Date(Date.now() + 3_600_000).toISOString());
    // A's evidence hit: its row is read, then the store moves to B before the read finishes.
    mocks.interleave = [{ match: "select evidence_json", after: true, run: () => store.activateReviewAccount(ownerB) }];
    expect(await store.loadCachedLocationReviewEvidence(evidence.reviewItemId)).not.toBeNull();
    expect(mocks.interleave).toEqual([]);
    let forB = await store.getReviewSyncDiagnostics();
    expect(forB.evidenceCacheHitCount).toBe(0);
    expect(forB.lastEvidencePayloadBytes).toBeNull();
    expect(forB.lastEvidenceCacheAgeMs).toBeNull();
    // A's Review cache read, overtaken by the move to B mid-read: no miss or hit lands for B.
    await reopen(); await store.processReviewBootstrap(data);
    mocks.interleave = [{ match: "from review_item_cache", after: true, run: () => store.activateReviewAccount(ownerB) }];
    await store.loadCachedReviewBootstrap();
    expect(mocks.interleave).toEqual([]);
    forB = await store.getReviewSyncDiagnostics();
    expect(forB.reviewCacheHitCount + forB.reviewCacheMissCount).toBe(0);
    expect(forB.lastReviewCacheAgeMs).toBeNull();
    // A's evidence read overtaken by a clear: nothing lands after it.
    await reopen(); await store.processReviewBootstrap(data);
    await store.cacheLocationReviewEvidence({ expectedWorkspaceId: data.workspace.id, expectedUserId: data.user.id, reviewItemId: evidence.reviewItemId, evidence, fetchedAt: new Date().toISOString() });
    db.prepare("update location_review_evidence_cache set expires_at = ?").run(new Date(Date.now() + 3_600_000).toISOString());
    mocks.interleave = [{ match: "select evidence_json", after: true, run: () => store.clearActiveReviewAccountData() }];
    await store.loadCachedLocationReviewEvidence(evidence.reviewItemId);
    await store.activateReviewAccount(ownerB);
    forB = await store.getReviewSyncDiagnostics();
    expect(forB.evidenceCacheHitCount + forB.evidenceCacheMissCount).toBe(0);
    expect(forB.lastEvidencePayloadBytes).toBeNull();
    // A mutation whose commit is overtaken by a clear leaves no trace for B.
    await reopen(); await store.processReviewBootstrap(data);
    mocks.interleave = [{ match: "select account_key, review_item_id, request_json from review_mutation_outbox", run: () => { void store.clearActiveReviewAccountData(); } }];
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(95), mutation: { action: "accept" } });
    await store.activateReviewAccount(ownerB);
    forB = await store.getReviewSyncDiagnostics();
    expect(forB.lastLocalMutationAction).toBeNull();
    expect(forB.lastLocalMutationCommittedAt).toBeNull();
  });
  it("exports Review support details only for the exporting account (Codex r6 on #355)", async () => {
    const data = bootstrap();
    const ownerA = { userId: data.user.id, workspaceId: data.workspace.id };
    const ownerB = { userId: syntheticId(901), workspaceId: syntheticId(902) };
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(96), mutation: { action: "accept" } });
    db.exec("update review_mutation_outbox set state='needs_attention',resolution_status=null,last_http_status=422,last_error='A private detail'");
    const forA = await store.readReviewSupportExportForOwner(ownerA);
    expect(forA?.mutations.map((mutation) => mutation.clientMutationId)).toEqual([syntheticId(96)]);
    expect(forA?.diagnostics.needsAttentionCount).toBe(1);
    // The app is already B's while this store still holds A: B's export gets nothing of A's.
    expect(await store.readReviewSupportExportForOwner(ownerB)).toBeNull();
    // A switch to B in the middle of A's export drops it.
    mocks.interleave = [{ match: "reconciliation_attempt_count as \"reconciliationAttemptCount\"", after: true, run: () => { db.prepare("update review_store_metadata set value = ? where key = 'active_account'").run(`${ownerB.workspaceId}:${ownerB.userId}`); } }];
    expect(await store.readReviewSupportExportForOwner(ownerA)).toBeNull();
    expect(mocks.interleave).toEqual([]);
    await store.activateReviewAccount({ ...ownerB, workspaceName: "B" });
    const forB = await store.readReviewSupportExportForOwner(ownerB);
    expect(forB?.mutations).toEqual([]);
    expect(forB?.diagnostics.needsAttentionCount).toBe(0);
  });
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
  it("re-checks an unknown outcome on an ordinary pass after the pause, never immediately (I1)", async () => {
    const data = bootstrap();
    const clientMutationId = syntheticId(94);
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId, mutation: { action: "accept" } });
    db.exec(`update review_mutation_outbox set state='needs_attention',resolution_status='resolution_unknown',updated_at='${new Date().toISOString()}'`);
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).not.toHaveBeenCalled();
    const old = new Date(Date.now() - store.REVIEW_UNKNOWN_RECHECK_MS - 1000).toISOString();
    db.exec(`update review_mutation_outbox set updated_at='${old}'`);
    mocks.fetch.mockRejectedValue(new TypeError("Network request failed"));
    await store.synchroniseReviewMutations();
    expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain("/api/review/mutations/reconcile");
    // Still offline: the change is kept and waits for an ordinary retry, not the person.
    expect(count("review_mutation_outbox")).toBe(1);
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("retry_wait");
  });
  it("restores an unknown outcome when its re-check is signed out (401): retryable, never discardable (I1)", async () => {
    const data = bootstrap();
    const clientMutationId = syntheticId(95);
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId, mutation: { action: "accept" } });
    const old = new Date(Date.now() - store.REVIEW_UNKNOWN_RECHECK_MS - 1000).toISOString();
    db.exec(`update review_mutation_outbox set state='needs_attention',resolution_status='resolution_unknown',updated_at='${old}'`);
    mocks.fetch.mockResolvedValue({ status: 401, json: async () => ({}) });
    expect((await store.synchroniseReviewMutations()).outcome).toBe("authentication_required");
    expect(db.prepare("select state,resolution_status from review_mutation_outbox").get()).toEqual({ state: "needs_attention", resolution_status: "resolution_unknown" });
    expect(await store.listReviewSyncIssues()).toEqual([]);
    expect(await store.discardReviewSyncIssue(clientMutationId)).toBe(false);
    expect(count("review_mutation_outbox")).toBe(1);
  });
  it("restores an unknown outcome when its re-check is cancelled mid-request (I1)", async () => {
    const data = bootstrap();
    const clientMutationId = syntheticId(96);
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId, mutation: { action: "accept" } });
    const old = new Date(Date.now() - store.REVIEW_UNKNOWN_RECHECK_MS - 1000).toISOString();
    db.exec(`update review_mutation_outbox set state='needs_attention',resolution_status='resolution_unknown',updated_at='${old}'`);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    mocks.fetch.mockRejectedValue(abort);
    expect((await store.synchroniseReviewMutations()).outcome).toBe("cancelled");
    expect(db.prepare("select resolution_status from review_mutation_outbox").get()!.resolution_status).toBe("resolution_unknown");
    expect(await store.discardReviewSyncIssue(clientMutationId)).toBe(false);
    // A row left 'reconciling' by a crash is treated the same and repaired on the next pass.
    db.exec("update review_mutation_outbox set resolution_status='reconciling'");
    expect(await store.discardReviewSyncIssue(clientMutationId)).toBe(false);
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(0);
  });
  it("counts an unknown outcome as waiting with a re-check deadline, not attention (I1)", async () => {
    const data = bootstrap();
    const clientMutationId = syntheticId(97);
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId, mutation: { action: "accept" } });
    const updatedAt = "2026-10-12T10:00:00.000Z";
    db.exec(`update review_mutation_outbox set state='needs_attention',resolution_status='resolution_unknown',updated_at='${updatedAt}'`);
    const diagnostics = await store.getReviewSyncDiagnostics();
    expect(diagnostics.needsAttentionCount).toBe(0);
    expect(diagnostics.checkingCount).toBe(1);
    expect(diagnostics.waitingCount).toBe(1);
    expect(diagnostics.nextRetryAt).toBe(new Date(Date.parse(updatedAt) + store.REVIEW_UNKNOWN_RECHECK_MS).toISOString());
    expect((await store.getReviewItemSyncStates()).get(data.reviewItems[0].id)?.state).toBe("retry_wait");
    // A real rejection still needs attention.
    db.exec("update review_mutation_outbox set resolution_status='resolution_conflict'");
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(1);
    expect((await store.getReviewItemSyncStates()).get(data.reviewItems[0].id)?.state).toBe("needs_attention");
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
  it("keeps an acknowledged mutation until an explicit scoped handover proves its result", async () => {
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
    expect(count("review_mutation_outbox")).toBe(1);
  });
  it("settles a conflict quietly and brings back only the canonically open source", async () => {
    const input = mergeInput(); await store.enqueueReviewMutation(input);
    mocks.fetch.mockResolvedValue({ status: 409, json: async () => ({ code: "resolution_conflict", canonicalReviewStatuses: { [input.item.id]: "accepted", [input.mutation.adjacentReviewItemId]: "open" } }) });
    await store.synchroniseReviewMutations();
    const ids = (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map(x => x.id);
    expect(ids).not.toContain(input.item.id); expect(ids).toContain(input.mutation.adjacentReviewItemId);
    expect(count("review_mutation_outbox")).toBe(0);
    expect(await store.listReviewSyncIssues()).toEqual([]);
    const diagnostics = await store.getReviewSyncDiagnostics();
    expect(diagnostics.needsAttentionCount).toBe(0);
    expect(diagnostics.settledElsewhereCount).toBe(1);
  });
  it("does not use absence from a capped bootstrap as merge handover proof", async () => {
    const input = mergeInput(); await store.enqueueReviewMutation(input);
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true, action: "merge", status: "accepted", mergedSegmentId: syntheticId(99) }) });
    await store.synchroniseReviewMutations();
    await store.processReviewBootstrap({ ...input.bootstrap, reviewItems: input.bootstrap.reviewItems.filter(x => x.id !== input.item.id) });
    expect(count("review_mutation_outbox")).toBe(1);
    await store.processReviewBootstrap({ ...input.bootstrap, reviewItems: input.bootstrap.reviewItems.slice(0, 2) });
    expect(count("review_mutation_outbox")).toBe(1); expect(count("review_mutation_effects")).toBe(2);
  });
  it("upserts a partial bootstrap without deleting older cached Review sources", async () => {
    const data = bootstrap();
    await store.processReviewBootstrap({ ...data, reviewItems: [data.reviewItems[0]] });
    expect(count("review_item_cache")).toBe(4);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((item) => item.id))
      .toEqual(expect.arrayContaining(data.reviewItems.map((item) => item.id)));
  });
  it("requires explicit terminal evidence for every structural source before handover", async () => {
    const input = mergeInput();
    await store.enqueueReviewMutation(input);
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({
      ok: true, action: "merge", status: "accepted", mergedSegmentId: syntheticId(99)
    }) });
    await store.synchroniseReviewMutations();
    const owner = {
      workspaceId: input.bootstrap.workspace.id,
      userId: input.bootstrap.user.id,
      backendId: "staging-fixture"
    };
    await store.cacheReviewPresentation({
      owner,
      response: terminalPresentation(input.bootstrap, [input.item.id])
    });
    expect(count("review_mutation_outbox")).toBe(1);
    await store.cacheReviewPresentation({
      owner,
      response: terminalPresentation(input.bootstrap, [input.item.id, input.mutation.adjacentReviewItemId])
    });
    expect(count("review_mutation_outbox")).toBe(0);
    expect(count("review_mutation_effects")).toBe(0);
  });
  it("selects one complete acknowledged structural action for a bounded handover lookup", async () => {
    const input = mergeInput();
    await store.enqueueReviewMutation(input);
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({
      ok: true,
      action: "merge",
      status: "accepted",
      mergedSegmentId: syntheticId(99)
    }) });
    await store.synchroniseReviewMutations();

    await expect(store.readAcknowledgedReviewHandoverLookup({ owner: {
      workspaceId: input.bootstrap.workspace.id,
      userId: input.bootstrap.user.id,
      backendId: "staging-fixture"
    } })).resolves.toMatchObject({
      clientMutationId: input.clientMutationId,
      reviewItemIds: [input.item.id, input.mutation.adjacentReviewItemId].sort(),
      entryIds: []
    });
  });
  it("retires an accepted source with exact result proof outside the Dashboard cache", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    const entryId = syntheticId(996);
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(997), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true, action: "accept", status: "accepted", entryId }) });
    await store.synchroniseReviewMutations();
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "staging-fixture" };
    const result = terminalPresentation(data, [item.id], entryId);
    const canonicalProof = result.lookup.entries[0];
    const { source: _source, ...legacyFields } = canonicalProof;
    await store.cacheReviewPresentation({ owner, response: {
      ...result,
      lookup: { ...result.lookup, entries: [{
        kind: "legacy_review_entry", entryId, eventId: null, title: legacyFields.title,
        category: legacyFields.category, place: legacyFields.place, interval: legacyFields.interval,
        confidence: "low", status: "needs_review", updatedAt: result.capturedAt, linkedReviewItemId: item.id,
        editor: { projectId: null, projectName: null, projectColor: null, clientName: null, placeKind: null,
          source: "manual_app", description: null, durationSeconds: 1800, tagNames: [] }
      }] }
    } });
    expect(count("review_mutation_outbox")).toBe(1);
    await store.cacheReviewPresentation({ owner, response: result });
    expect(count("review_mutation_outbox")).toBe(0);
    const canonical = {
      ...data.entries[1],
      id: entryId,
      stoppedAt: "2026-08-28T17:30:00.000Z",
      startedAt: "2026-08-28T17:00:00.000Z"
    };
    await store.cacheDashboardBootstrap({ ...data, entries: [canonical] });
    await store.cacheReviewPresentation({ owner, response: result });
    expect(count("review_mutation_outbox")).toBe(0);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id)).not.toContain(item.id);
  });
  it("batches past an unmaterialised acknowledgement so a newer exact result can clear", async () => {
    const data = bootstrap();
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "staging-fixture" };
    for (let n = 0; n < 2; n++) {
      await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[n], clientMutationId: syntheticId(980 + n), mutation: { action: "accept" } });
      mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true, action: "accept", status: "accepted", entryId: syntheticId(990 + n) }) });
      await store.synchroniseReviewMutations();
    }
    const batch = await store.readAcknowledgedReviewHandoverLookup({ owner });
    expect(batch?.reviewItemIds).toEqual(data.reviewItems.slice(0, 2).map((item) => item.id).sort());
    expect(batch?.entryIds).toEqual([syntheticId(990), syntheticId(991)]);
    await store.cacheReviewPresentation({ owner, response: terminalPresentation(data, [data.reviewItems[1].id], syntheticId(991)) });
    expect(db.prepare("select client_mutation_id from review_mutation_outbox").all()).toEqual([{ client_mutation_id: syntheticId(980) }]);
    expect((await store.readAcknowledgedReviewHandoverLookup({ owner }))?.reviewItemIds).toEqual([data.reviewItems[0].id]);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((item) => item.id)).not.toContain(data.reviewItems[1].id);
    // Replaying the same proof neither recreates intent nor injects an entry into bootstrap.
    await store.cacheReviewPresentation({ owner, response: terminalPresentation(data, [data.reviewItems[1].id], syntheticId(991)) });
    expect(count("review_mutation_outbox")).toBe(1);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.entries.filter((entry) => entry.id === syntheticId(991))).toHaveLength(0);
  });
  it("follows an explicit source link before retiring an equivalent acknowledgement without an entry receipt", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    const entryId = syntheticId(995);
    await store.enqueueReviewMutation({
      bootstrap: data,
      item,
      clientMutationId: syntheticId(994),
      mutation: { action: "accept" }
    });
    mocks.fetch.mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        action: "accept",
        status: "accepted",
        alreadyResolved: true,
        equivalent: true
      })
    });
    await store.synchroniseReviewMutations();
    const owner = {
      workspaceId: data.workspace.id,
      userId: data.user.id,
      backendId: "staging-fixture"
    };
    const linked = terminalPresentation(data, [item.id], entryId);
    const sourceOnly = {
      ...linked,
      lookup: { ...linked.lookup, entries: [] }
    };

    await store.cacheReviewPresentation({ owner, response: sourceOnly });
    expect(count("review_mutation_outbox")).toBe(1);

    const canonical = {
      ...data.entries[1],
      id: entryId,
      startedAt: "2026-08-28T17:00:00.000Z",
      stoppedAt: "2026-08-28T17:30:00.000Z"
    };
    await store.cacheDashboardBootstrap({ ...data, entries: [canonical] });
    await store.cacheReviewPresentation({ owner, response: linked });

    expect(count("review_mutation_outbox")).toBe(0);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id)).not.toContain(item.id);
  });
  it("scopes terminal suppression to its backend and clears it on an authoritative open record", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "staging-fixture" };

    await store.cacheReviewPresentation({
      owner,
      response: terminalPresentation(data, [item.id])
    });
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id))
      .not.toContain(item.id);

    db.prepare("update review_presentation_terminal_source set backend_id = ? where review_item_id = ?")
      .run("other-backend", item.id);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id))
      .toContain(item.id);

    db.prepare("update review_presentation_terminal_source set backend_id = ? where review_item_id = ?")
      .run(owner.backendId, item.id);
    await store.cacheReviewPresentation({
      owner,
      response: openPresentation(data, item.id, "a".repeat(64))
    });

    expect(count("review_presentation_terminal_source")).toBe(1);
    await store.cacheReviewPresentation({
      owner,
      response: {
        ...openPresentation(data, item.id, "a".repeat(64)),
        capturedAt: "2026-08-28T18:01:00.000Z"
      }
    });

    expect(count("review_presentation_terminal_source")).toBe(0);
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id))
      .toContain(item.id);
  });
  it("records a missing_review lookup as explicit terminal evidence", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "staging-fixture" };
    const response = {
      ...terminalPresentation(data, [item.id]),
      links: [],
      lookup: {
        reviewItems: [{ kind: "missing_review" as const, reviewItemId: item.id }],
        entries: []
      }
    };

    await store.cacheReviewPresentation({ owner, response });

    expect(db.prepare("select status from review_presentation_terminal_source where review_item_id = ?")
      .get(item.id)!.status).toBe("missing");
  });
  it("compares a guarded Quick Confirm against the current cached presentation inside its transaction", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "staging-fixture" };
    const hash = "a".repeat(64);
    const response = openPresentation(data, item.id, hash);
    await store.cacheReviewPresentation({ owner, response });
    await store.enqueueReviewMutation({
      bootstrap: data,
      item,
      clientMutationId: syntheticId(998),
      mutation: { action: "accept", expectedProposalHash: hash },
      presentation: { backendId: owner.backendId, scope: response.scope }
    });
    expect(count("review_mutation_outbox")).toBe(1);
    await expect(store.enqueueReviewMutation({
      bootstrap: data,
      item: data.reviewItems[1],
      clientMutationId: syntheticId(999),
      mutation: { action: "accept", expectedProposalHash: "b".repeat(64) },
      presentation: { backendId: owner.backendId, scope: response.scope }
    })).rejects.toThrow("proposal changed");
    expect(count("review_mutation_outbox")).toBe(1);
  });
  it("restores only the explicitly open source when a guarded proposal changed remotely", async () => {
    const data = bootstrap();
    const item = data.reviewItems[0];
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "staging-fixture" };
    const response = openPresentation(data, item.id, "a".repeat(64));
    await store.cacheReviewPresentation({ owner, response });
    await store.enqueueReviewMutation({
      bootstrap: data,
      item,
      clientMutationId: syntheticId(1_001),
      mutation: { action: "accept", expectedProposalHash: "a".repeat(64) },
      presentation: { backendId: owner.backendId, scope: response.scope }
    });
    mocks.fetch.mockResolvedValue({ status: 409, json: async () => ({
      code: "proposal_changed",
      canonicalReviewStatuses: { [item.id]: "open" },
      canonicalStatus: "open"
    }) });
    await store.synchroniseReviewMutations();
    // A changed proposal on a still-open moment is a real rejection: the saved action is kept.
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("needs_attention");
    expect((await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((candidate) => candidate.id)).toContain(item.id);
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
    expect(db.prepare("pragma user_version").get()!.user_version).toBe(8);
    expect(count("review_mutation_effects")).toBe(1);
    expect(db.prepare("select request_json from review_mutation_outbox").get()!.request_json).toBe(request);
  });
  it("upgrades a direct v6 database atomically to v7 presentation tables", async () => {
    db.exec("drop table review_presentation_terminal_source; drop table review_presentation_context; pragma user_version=6;");
    await reopen();
    await store.loadCachedReviewBootstrap();
    expect(db.prepare("pragma user_version").get()!.user_version).toBe(8);
    expect(count("review_presentation_context")).toBe(0);
    expect(count("review_presentation_terminal_source")).toBe(0);
  });
  it("upgrades a v7 database to v8 open observations without touching queued work", async () => {
    await store.enqueueReviewMutation(mergeInput());
    db.exec("drop table review_source_open_observation; pragma user_version=7;");
    await reopen();
    await store.loadCachedReviewBootstrap();
    expect(db.prepare("pragma user_version").get()!.user_version).toBe(8);
    expect(count("review_source_open_observation")).toBe(0);
    expect(count("review_mutation_outbox")).toBe(1);
  });
  it("rejects cross-account effects and clears sensitive intent on account replacement", async () => {
    await store.enqueueReviewMutation(mergeInput());
    const data = bootstrap();
    await store.activateReviewAccount({ workspaceId: data.workspace.id, workspaceName: "Other synthetic", userId: syntheticId(9) });
    expect(count("review_mutation_effects")).toBe(0); expect(count("review_mutation_outbox")).toBe(0);
    await expect(store.enqueueReviewMutation(mergeInput())).rejects.toThrow("not configured");
  });
});

describe("Review actions for moments decided elsewhere (12 Oct 2026 superseded Commutes)", () => {
  const visibleIds = async () => (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((item) => item.id);
  const reconcileReply = (state: string, reason?: string) => async (url: string, init: { body: string }) => {
    const { mutations } = JSON.parse(init.body);
    return { status: 200, json: async () => ({ ok: true, results: [{ clientMutationId: mutations[0].clientMutationId,
      reviewItemId: mutations[0].reviewItemId, state, ...(reason ? { reason } : {}), checkedAt: "2026-10-12T18:46:00.000Z" }] }) };
  };
  async function parkAsOlderBuildDid(clientMutationId: string, lastError: string, resolutionStatus: string, status: number) {
    db.prepare(`update review_mutation_outbox set state='needs_attention', last_error=?, resolution_status=?, last_http_status=?
      where client_mutation_id=?`).run(lastError, resolutionStatus, status, clientMutationId);
  }

  it("settles a confirm on a superseded item without an issue, and the card stays gone", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(501), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 409, json: async () => ({ ok: false, code: "resolution_conflict", canonicalStatus: "ignored", reviewItemId: item.id }) });
    const result = await store.synchroniseReviewMutations();
    expect(result.needsAttentionCount).toBe(0);
    expect(result.outcome).toBe("complete");
    expect(await store.listReviewSyncIssues()).toEqual([]);
    expect(count("review_mutation_outbox")).toBe(0);
    expect(db.prepare("select count(*) as n from review_item_cache where review_item_id=?").get(item.id)!.n).toBe(0);
    expect(await visibleIds()).not.toContain(item.id);
    // A later bootstrap that still carries a stale open copy cannot bring it back either.
    expect((await store.processReviewBootstrap(data)).reviewItems.map((candidate) => candidate.id)).not.toContain(item.id);
    const diagnostics = await store.getReviewSyncDiagnostics();
    expect(diagnostics.settledElsewhereCount).toBe(1);
    expect(diagnostics.lastSettledElsewhereAt).toEqual(expect.any(String));
    expect(diagnostics.lastSuccessfulSyncAt).toEqual(expect.any(String));
  });

  it("brings a settled item back when a later read lists it open again (replay reopened it)", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(502), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 409, headers: { get: () => "Mon, 12 Oct 2026 18:46:00 GMT" }, json: async () => ({ code: "resolution_conflict", canonicalStatus: "ignored" }) });
    await store.synchroniseReviewMutations();
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "dayframe-staging" };
    await store.cacheReviewPresentation({ owner, response: { ...openPresentation(data, item.id, "b".repeat(64)), capturedAt: "2026-10-12T18:45:00.000Z" } });
    expect(await visibleIds()).not.toContain(item.id);
    await store.cacheReviewPresentation({ owner, response: { ...openPresentation(data, item.id, "b".repeat(64)), capturedAt: "2026-10-12T18:47:00.000Z" } });
    expect(await visibleIds()).toContain(item.id);
  });

  it("settles a 404 for a missing single-source item", async () => {
    const data = bootstrap(); const item = data.reviewItems[1];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(503), mutation: { action: "ignore_once" } });
    mocks.fetch.mockResolvedValue({ status: 404, json: async () => ({ code: "review_item_not_found" }) });
    await store.synchroniseReviewMutations();
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(0);
    expect(await visibleIds()).not.toContain(item.id);
  });

  it("re-checks a resolution conflict an older build parked and settles it on an ordinary pass", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(504), mutation: { action: "accept" } });
    await parkAsOlderBuildDid(syntheticId(504), "HTTP 409 · resolution_conflict", "HTTP 409 · resolution_conflict", 409);
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(1);
    mocks.fetch.mockImplementation(reconcileReply("conflict", "different_final_decision"));
    await store.synchroniseReviewMutations();
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("/api/review/mutations/reconcile");
    expect(count("review_mutation_outbox")).toBe(0);
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(0);
    expect(await visibleIds()).not.toContain(item.id);
  });

  it("re-checks a reconcile conflict an older build parked as resolution_conflict, and a missing source", async () => {
    const data = bootstrap();
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(505), mutation: { action: "accept" } });
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[1], clientMutationId: syntheticId(506), mutation: { action: "accept" } });
    await parkAsOlderBuildDid(syntheticId(505), "resolution_conflict", "resolution_conflict", 200);
    await parkAsOlderBuildDid(syntheticId(506), "canonical_missing", "canonical_missing", 200);
    mocks.fetch.mockImplementation(async (url: string, init: { body: string }) => {
      const { mutations } = JSON.parse(init.body);
      return reconcileReply(mutations[0].clientMutationId === syntheticId(505) ? "conflict" : "missing",
        mutations[0].clientMutationId === syntheticId(505) ? "different_final_decision" : undefined)(url, init);
    });
    await store.synchroniseReviewMutations();
    expect(count("review_mutation_outbox")).toBe(0);
    expect((await store.getReviewSyncDiagnostics()).settledElsewhereCount).toBe(2);
  });

  it("keeps a mutation-ID conflict as a real rejection and does not re-check it again", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(507), mutation: { action: "accept" } });
    await parkAsOlderBuildDid(syntheticId(507), "resolution_conflict", "resolution_conflict", 200);
    mocks.fetch.mockImplementation(reconcileReply("conflict", "mutation_id_conflict"));
    await store.synchroniseReviewMutations();
    expect(await store.listReviewSyncIssues()).toEqual([expect.objectContaining({ resolutionStatus: "mutation_id_conflict" })]);
    mocks.fetch.mockClear();
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("still parks validation rejections for the person", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(508), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 422, json: async () => ({ code: "invalid_action" }) });
    await store.synchroniseReviewMutations();
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(1);
    expect((await store.getReviewSyncDiagnostics()).settledElsewhereCount).toBe(0);
  });
});

describe("Settling decided-elsewhere moments: Codex r1 on #370", () => {
  const visibleIds = async () => (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((item) => item.id);
  const owner = () => { const data = bootstrap(); return { workspaceId: data.workspace.id, userId: data.user.id, backendId: "dayframe-staging" }; };
  const headers = (date: string) => ({ get: (name: string) => name.toLowerCase() === "date" ? date : null });

  it("keeps a resolution conflict on a still-open moment as a real rejection with its saved action", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(701), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 409, json: async () => ({ code: "resolution_conflict", canonicalStatus: "open" }) });
    await store.synchroniseReviewMutations();
    expect(count("review_mutation_outbox")).toBe(1);
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(1);
  });

  it("removes a settled moment from Today's cached snapshot and its counts", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    const response = { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:00:00.000Z" };
    await store.cacheReviewPresentation({ owner: owner(), response });
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(702), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 409, headers: headers("Mon, 12 Oct 2026 18:46:00 GMT"), json: async () => ({ code: "resolution_conflict", canonicalStatus: "ignored" }) });
    await store.synchroniseReviewMutations();
    const snapshot = (await store.readReviewPresentationSnapshot({ owner: owner(), response }))!;
    expect(snapshot.response.outstanding.openReviewItemIds).not.toContain(item.id);
    expect(snapshot.response.outstanding.globalCount).toBe(0);
    expect(JSON.stringify(snapshot.response.records)).not.toContain(item.id);
  });

  it("keeps a merge parked when reconcile cannot say which source was decided", async () => {
    const input = mergeInput(); await store.enqueueReviewMutation(input);
    db.prepare("update review_mutation_outbox set state='needs_attention', resolution_status='resolution_conflict', last_error='resolution_conflict' where client_mutation_id=?").run(input.clientMutationId);
    mocks.fetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const { mutations } = JSON.parse(init.body);
      return { status: 200, json: async () => ({ ok: true, results: [{ clientMutationId: mutations[0].clientMutationId, reviewItemId: mutations[0].reviewItemId, state: "conflict", reason: "different_final_decision", checkedAt: "2026-10-12T18:46:00.000Z" }] }) };
    });
    await store.synchroniseReviewMutations();
    expect(count("review_mutation_outbox")).toBe(1);
    expect(count("review_mutation_effects")).toBe(2);
  });

  it("uses the server's per-source statuses for a 404", async () => {
    const input = mergeInput(); await store.enqueueReviewMutation(input);
    mocks.fetch.mockResolvedValue({ status: 404, json: async () => ({ code: "review_item_not_found", canonicalReviewStatuses: { [input.item.id]: "missing", [input.mutation.adjacentReviewItemId]: "open" } }) });
    await store.synchroniseReviewMutations();
    expect(count("review_mutation_outbox")).toBe(0);
    const ids = await visibleIds();
    expect(ids).not.toContain(input.item.id); expect(ids).toContain(input.mutation.adjacentReviewItemId);

    const data = bootstrap(); const single = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item: single, clientMutationId: syntheticId(703), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 404, json: async () => ({ code: "review_item_not_found", canonicalReviewStatuses: { [single.id]: "open" } }) });
    await store.synchroniseReviewMutations();
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(1);
  });

  it("rounds a whole-second Date up, so an open snapshot from earlier that second cannot clear the settlement", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(704), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 409, headers: headers("Mon, 12 Oct 2026 18:46:00 GMT"), json: async () => ({ code: "resolution_conflict", canonicalStatus: "ignored" }) });
    await store.synchroniseReviewMutations();
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:46:00.500Z" } });
    expect(await visibleIds()).not.toContain(item.id);
  });

  it("never lowers terminal evidence with a delayed older lookup", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(705), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 409, headers: headers("Mon, 12 Oct 2026 18:46:00 GMT"), json: async () => ({ code: "resolution_conflict", canonicalStatus: "ignored" }) });
    await store.synchroniseReviewMutations();
    await store.cacheReviewPresentation({ owner: owner(), response: { ...terminalPresentation(data, [item.id]), capturedAt: "2026-10-12T18:40:00.000Z" } });
    expect(db.prepare("select captured_at from review_presentation_terminal_source where review_item_id=?").get(item.id)!.captured_at).toBe("2026-10-12T18:46:00.999Z");
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:45:00.000Z" } });
    expect(await visibleIds()).not.toContain(item.id);
  });

  it("re-checks an older build's parked conflict only once when it is still a real rejection", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(707), mutation: { action: "accept" } });
    db.prepare("update review_mutation_outbox set state='needs_attention', last_error='HTTP 409 · resolution_conflict', resolution_status='HTTP 409 · resolution_conflict', last_http_status=409 where client_mutation_id=?").run(syntheticId(707));
    mocks.fetch.mockImplementation(async (url: string, init: { body: string }) => {
      if (String(url).includes("/reconcile")) {
        const { mutations } = JSON.parse(init.body);
        return { status: 200, json: async () => ({ ok: true, results: [{ clientMutationId: mutations[0].clientMutationId, reviewItemId: mutations[0].reviewItemId, state: "open", checkedAt: "2026-10-12T18:46:00.000Z" }] }) };
      }
      return { status: 409, json: async () => ({ code: "resolution_conflict", canonicalStatus: "open" }) };
    });
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect((await store.getReviewSyncDiagnostics()).needsAttentionCount).toBe(1);
    mocks.fetch.mockClear();
    await store.synchroniseReviewMutations();
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("lets a newer cached open read win over a delayed settlement", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(706), mutation: { action: "accept" } });
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:50:00.000Z" } });
    mocks.fetch.mockResolvedValue({ status: 409, headers: headers("Mon, 12 Oct 2026 18:46:00 GMT"), json: async () => ({ code: "resolution_conflict", canonicalStatus: "ignored" }) });
    await store.synchroniseReviewMutations();
    expect(count("review_mutation_outbox")).toBe(0);
    expect(count("review_presentation_terminal_source")).toBe(0);
    expect(await visibleIds()).toContain(item.id);
  });
});

describe("Review cache eviction on complete reads (12 Oct 2026 stale superseded cards)", () => {
  const visibleIds = async () => (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((item) => item.id);
  const owner = () => { const data = bootstrap(); return { backendId: "dayframe-staging", workspaceId: data.workspace.id, userId: data.user.id }; };
  function backlog(openIds: string[], capturedAt = "2026-10-12T18:46:00.000Z", complete = true) {
    const data = bootstrap();
    return {
      version: 1 as const,
      scope: { mode: "backlog" as const, timeZone: "Europe/London" },
      snapshotToken: `backlog-${openIds.length}-${capturedAt}`,
      capturedAt,
      nextCursor: null,
      completeness: { records: complete, outstandingCounts: complete, completedToday: false, partialReason: complete ? null : "bounded_collection" as const },
      outstanding: { globalCount: openIds.length, todayCount: 0, openReviewItemIds: complete ? openIds : [] },
      records: openIds.map((id) => ({ ...presentationReview(data.reviewItems.find((item) => item.id === id)!), status: "open" as const, proposalHash: "a".repeat(64) })),
      links: openIds.map((reviewItemId) => ({ reviewItemId, entryIds: [], status: "open" as const })),
      lookup: { reviewItems: [], entries: [] }
    };
  }
  const later = () => new Date(Date.now() + 60_000).toISOString();

  it("evicts a cached item the complete open set no longer lists, and the bootstrap/cached projections agree", async () => {
    const data = bootstrap(); const zombie = data.reviewItems[0]; const open = data.reviewItems.slice(1).map((item) => item.id);
    expect(await visibleIds()).toContain(zombie.id);
    await store.cacheReviewPresentation({ owner: owner(), response: backlog(open), requestedAt: later() });
    expect(await visibleIds()).toEqual(open);
    expect((await store.getReviewSyncDiagnostics()).reviewCacheEvictedCount).toBe(1);
  });

  it("evicts every stale item when nothing is open (the owner's 0-open, 34-card deck)", async () => {
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([]), requestedAt: later() });
    expect(await visibleIds()).toEqual([]);
    expect(count("review_item_cache")).toBe(0);
  });

  it("keeps an item cached after the request started, and evicts nothing from an incomplete open set", async () => {
    const data = bootstrap();
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([]), requestedAt: "2000-01-01T00:00:00.000Z" });
    expect(count("review_item_cache")).toBe(4);
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([], undefined, false), requestedAt: later() });
    expect(await visibleIds()).toEqual(expect.arrayContaining(data.reviewItems.map((item) => item.id)));
  });

  it("does not evict without a recorded request time", async () => {
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([]) });
    expect(count("review_item_cache")).toBe(4);
  });

  it("caches an evicted item again when a later read lists it open (replay reopened it)", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([]), requestedAt: later() });
    expect(await visibleIds()).not.toContain(item.id);
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([item.id], "2026-10-12T18:50:00.000Z"), requestedAt: later() });
    expect(await visibleIds()).toEqual([item.id]);
  });

  it("brings a restored card back when a later read lists it open again (Codex r1 on #371)", async () => {
    const data = bootstrap(); const item = data.reviewItems[1];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(611), mutation: { action: "accept" } });
    db.prepare("update review_mutation_outbox set state='needs_attention', updated_at='2026-01-01T00:00:00.000Z' where client_mutation_id=?").run(syntheticId(611));
    db.prepare("update review_mutation_effects set local_effect='restore' where client_mutation_id=?").run(syntheticId(611));
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([], "2026-10-12T18:46:00.000Z"), requestedAt: later() });
    expect(await visibleIds()).not.toContain(item.id);
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([item.id], "2026-10-12T18:50:00.000Z"), requestedAt: later() });
    expect(await visibleIds()).toContain(item.id);
  });

  it("keeps a restored card when a newer open read arrived before a delayed absence (Codex r2 on #371)", async () => {
    const data = bootstrap(); const item = data.reviewItems[1];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(621), mutation: { action: "accept" } });
    db.prepare("update review_mutation_outbox set state='needs_attention', updated_at='2026-01-01T00:00:00.000Z' where client_mutation_id=?").run(syntheticId(621));
    db.prepare("update review_mutation_effects set local_effect='restore' where client_mutation_id=?").run(syntheticId(621));
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:50:00.000Z" } });
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([], "2026-10-12T18:46:00.000Z"), requestedAt: later() });
    expect(await visibleIds()).toContain(item.id);
  });

  it("removes an evicted restored card from Today's snapshot effects (Codex r2 on #371)", async () => {
    const data = bootstrap(); const item = data.reviewItems[1];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(622), mutation: { action: "accept" } });
    db.prepare("update review_mutation_outbox set state='needs_attention', updated_at='2026-01-01T00:00:00.000Z' where client_mutation_id=?").run(syntheticId(622));
    db.prepare("update review_mutation_effects set local_effect='restore' where client_mutation_id=?").run(syntheticId(622));
    const response = backlog([], "2026-10-12T18:46:00.000Z");
    await store.cacheReviewPresentation({ owner: owner(), response, requestedAt: later() });
    const snapshot = (await store.readReviewPresentationSnapshot({ owner: owner(), response }))!;
    expect(snapshot.effects.map((effect) => effect.reviewItemId)).not.toContain(item.id);
    expect(count("review_mutation_outbox")).toBe(1);
  });

  it("removes an evicted card from an older cached Today snapshot (Codex r3 on #371)", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    const today = { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:40:00.000Z" };
    await store.cacheReviewPresentation({ owner: owner(), response: today });
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([], "2026-10-12T18:46:00.000Z"), requestedAt: later() });
    const snapshot = (await store.readReviewPresentationSnapshot({ owner: owner(), response: today }))!;
    expect(snapshot.response.outstanding.openReviewItemIds).not.toContain(item.id);
  });

  it("does not let a delayed older open response bring back an evicted card, while a newer one does (Codex r3 on #371)", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([], "2026-10-12T18:46:00.000Z"), requestedAt: later() });
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:44:00.000Z" } });
    expect(await visibleIds()).not.toContain(item.id);
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:48:00.000Z" } });
    expect(await visibleIds()).toContain(item.id);
  });

  it("leaves a hidden local decision alone and hides a restored card that is no longer open", async () => {
    const data = bootstrap();
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[0], clientMutationId: syntheticId(601), mutation: { action: "accept" } });
    await store.enqueueReviewMutation({ bootstrap: data, item: data.reviewItems[1], clientMutationId: syntheticId(602), mutation: { action: "accept" } });
    db.prepare("update review_mutation_outbox set state='needs_attention', updated_at='2026-01-01T00:00:00.000Z' where client_mutation_id=?").run(syntheticId(602));
    db.prepare("update review_mutation_effects set local_effect='restore' where client_mutation_id=?").run(syntheticId(602));
    expect(await visibleIds()).toContain(data.reviewItems[1].id);
    await store.cacheReviewPresentation({ owner: owner(), response: backlog([data.reviewItems[0].id]), requestedAt: later() });
    expect(await visibleIds()).not.toContain(data.reviewItems[1].id);
    expect(count("review_mutation_outbox")).toBe(2);
    expect(db.prepare("select local_effect from review_mutation_effects where client_mutation_id=?").get(syntheticId(601))!.local_effect).toBe("hidden");
  });
});

describe("Terminal evidence against newer open reads: Codex r2 on #370", () => {
  const visibleIds = async () => (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.map((item) => item.id);
  const owner = (backendId = "dayframe-staging") => { const data = bootstrap(); return { workspaceId: data.workspace.id, userId: data.user.id, backendId }; };
  const headers = (date: string) => ({ get: (name: string) => name.toLowerCase() === "date" ? date : null });
  const settleAt = async (id: number, item: import("./api").MobileReviewItem, date = "Mon, 12 Oct 2026 18:46:00 GMT") => {
    const data = bootstrap();
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(id), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 409, headers: headers(date), json: async () => ({ code: "resolution_conflict", canonicalStatus: "ignored" }) });
    await store.synchroniseReviewMutations();
  };

  it("drops a source from a Today snapshot captured at the same time as its terminal evidence", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    const response = { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:46:00.999Z" };
    await store.cacheReviewPresentation({ owner: owner(), response });
    db.prepare("delete from review_source_open_observation").run();
    await settleAt(801, item);
    const snapshot = (await store.readReviewPresentationSnapshot({ owner: owner(), response }))!;
    expect(snapshot.response.outstanding.openReviewItemIds).not.toContain(item.id);
  });

  it("keeps a reopened source open after its display context was pruned, when an older settlement arrives late", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:50:00.000Z" } });
    db.prepare("delete from review_presentation_context").run();
    await settleAt(802, item);
    expect(await visibleIds()).toContain(item.id);
  });

  it("ignores another backend's open read when recording this backend's settlement", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:00:00.000Z" } });
    db.prepare("insert into review_source_open_observation (account_key, review_item_id, backend_id, observed_at) select account_key, ?, 'other-backend', '2026-10-12T19:00:00.000Z' from review_account_context").run(item.id);
    await settleAt(803, item);
    expect(db.prepare("select count(*) as n from review_presentation_terminal_source where review_item_id=?").get(item.id)!.n).toBe(1);
    expect(await visibleIds()).not.toContain(item.id);
  });

  it("keeps a reopened source open when a delayed older terminal lookup arrives after it", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.cacheReviewPresentation({ owner: owner(), response: { ...terminalPresentation(data, [item.id]), capturedAt: "2026-10-12T18:40:00.000Z" } });
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:50:00.000Z" } });
    await store.cacheReviewPresentation({ owner: owner(), response: { ...terminalPresentation(data, [item.id]), snapshotToken: "late", capturedAt: "2026-10-12T18:45:00.000Z" } });
    expect(await visibleIds()).toContain(item.id);
  });

  it("keeps a reopened source cached when a delayed older handover lookup retires its acknowledged intent (Codex r3 on #370)", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(805), mutation: { action: "accept" } });
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true, action: "accept", status: "accepted", entryId: syntheticId(99) }) });
    await store.synchroniseReviewMutations();
    expect(db.prepare("select state from review_mutation_outbox").get()!.state).toBe("acknowledged");
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:50:00.000Z" } });
    await store.cacheReviewPresentation({ owner: owner(), response: { ...terminalPresentation(data, [item.id], syntheticId(99)), capturedAt: "2026-10-12T18:45:00.000Z" } });
    expect(count("review_mutation_outbox")).toBe(0);
    expect(await visibleIds()).toContain(item.id);
  });

  it("drops open observations that newer terminal evidence makes irrelevant", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.cacheReviewPresentation({ owner: owner(), response: { ...openPresentation(data, item.id, "a".repeat(64)), capturedAt: "2026-10-12T18:40:00.000Z" } });
    expect(count("review_source_open_observation")).toBe(1);
    await store.cacheReviewPresentation({ owner: owner(), response: { ...terminalPresentation(data, [item.id]), capturedAt: "2026-10-12T18:45:00.000Z" } });
    expect(count("review_source_open_observation")).toBe(0);
  });

  it("consumes the one-time re-check on a forced pass too", async () => {
    const data = bootstrap(); const item = data.reviewItems[0];
    await store.enqueueReviewMutation({ bootstrap: data, item, clientMutationId: syntheticId(804), mutation: { action: "accept" } });
    db.prepare("update review_mutation_outbox set state='needs_attention', last_error='HTTP 409 · resolution_conflict', resolution_status='HTTP 409 · resolution_conflict', last_http_status=409 where client_mutation_id=?").run(syntheticId(804));
    mocks.fetch.mockImplementation(async (url: string, init: { body: string }) => {
      if (String(url).includes("/reconcile")) {
        const { mutations } = JSON.parse(init.body);
        return { status: 200, json: async () => ({ ok: true, results: [{ clientMutationId: mutations[0].clientMutationId, reviewItemId: mutations[0].reviewItemId, state: "open", checkedAt: "2026-10-12T18:46:00.000Z" }] }) };
      }
      return { status: 409, json: async () => ({ code: "resolution_conflict", canonicalStatus: "open" }) };
    });
    await store.synchroniseReviewMutations({ force: true });
    mocks.fetch.mockClear();
    await store.synchroniseReviewMutations();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("Review cache keeps one shape per proposal (12 Oct 2026 footnote flicker)", () => {
  it("keeps earlier reason fields under a time-away subtype the presentation supplies", async () => {
    const data = bootstrap(); const item = data.reviewItems[1];
    await store.processReviewBootstrap({ ...data, reviewItems: data.reviewItems.map((candidate) => candidate.id === item.id
      ? { ...candidate, rawPayload: { semanticReason: "time_away_review_only" } } : candidate) });
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "dayframe-staging" };
    const response = openPresentation(data, item.id, "a".repeat(64));
    response.lookup.reviewItems[0] = { ...response.lookup.reviewItems[0], timeAway: { stopCount: 1 } } as never;
    await store.cacheReviewPresentation({ owner, response });
    const cached = (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.find((candidate) => candidate.id === item.id)!;
    expect(cached.rawPayload).toEqual(expect.objectContaining({ semanticReason: "time_away_review_only", qualificationReason: "same_place_outing", stopCount: 1 }));
  });
  it("keeps the bootstrap's reason fields when a presentation read rewrites the same proposal, and drops them for a changed one", async () => {
    const data = bootstrap(); const item = data.reviewItems[1];
    await store.processReviewBootstrap({ ...data, reviewItems: data.reviewItems.map((candidate) => candidate.id === item.id
      ? { ...candidate, rawPayload: { ...candidate.rawPayload, semanticReason: "review_mode", travelMode: "car", routeLabel: "Home → Gym" } } : candidate) });
    const owner = { workspaceId: data.workspace.id, userId: data.user.id, backendId: "dayframe-staging" };
    await store.cacheReviewPresentation({ owner, response: openPresentation(data, item.id, "a".repeat(64)) });
    let cached = (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.find((candidate) => candidate.id === item.id)!;
    expect(cached.rawPayload).toEqual(expect.objectContaining({ semanticReason: "review_mode", travelMode: "car", routeLabel: "Home → Gym" }));
    const moved = { ...item, suggestedStartedAt: "2026-08-28T09:00:00.000Z" };
    await store.cacheReviewPresentation({ owner, response: { ...openPresentation({ ...data, reviewItems: data.reviewItems.map((candidate) => candidate.id === item.id ? moved : candidate) }, item.id, "b".repeat(64)), capturedAt: "2026-08-28T18:05:00.000Z" } });
    cached = (await store.loadCachedReviewBootstrap())!.bootstrap.reviewItems.find((candidate) => candidate.id === item.id)!;
    expect(cached.rawPayload).toBeNull();
  });
});

function terminalPresentation(
  data: ReturnType<typeof bootstrap>,
  reviewIds: string[],
  entryId?: string
) {
  return {
    version: 1 as const,
    scope: { mode: "lookup" as const, timeZone: "Europe/London" },
    snapshotToken: `snapshot-${reviewIds.join("-")}-${entryId ?? "none"}`,
    capturedAt: "2026-08-28T18:00:00.000Z",
    nextCursor: null,
    completeness: { records: true, outstandingCounts: true, completedToday: false, partialReason: null },
    outstanding: { globalCount: 0, todayCount: 0, openReviewItemIds: [] },
    records: [],
    links: reviewIds.map((reviewItemId) => ({ reviewItemId, entryIds: entryId ? [entryId] : [], status: "accepted" as const })),
    lookup: {
      reviewItems: reviewIds.map((id) => presentationReview(data.reviewItems.find((item) => item.id === id)!, entryId)),
      entries: entryId ? [presentationEntry(data, entryId)] : []
    }
  };
}

function openPresentation(data: ReturnType<typeof bootstrap>, reviewItemId: string, hash: string) {
  const item = data.reviewItems.find((candidate) => candidate.id === reviewItemId)!;
  return {
    version: 1 as const,
    scope: { mode: "lookup" as const, timeZone: "Europe/London" },
    snapshotToken: `open-${reviewItemId}`,
    capturedAt: "2026-08-28T18:00:00.000Z",
    nextCursor: null,
    completeness: { records: true, outstandingCounts: true, completedToday: false, partialReason: null },
    outstanding: { globalCount: 1, todayCount: 0, openReviewItemIds: [reviewItemId] },
    records: [],
    links: [{ reviewItemId, entryIds: [], status: "open" as const }],
    lookup: {
      reviewItems: [{
        ...presentationReview(item),
        status: "open" as const,
        proposalHash: hash
      }],
      entries: []
    }
  };
}

function presentationReview(item: import("./api").MobileReviewItem, entryId?: string) {
  return {
    kind: "review" as const,
    reviewItemId: item.id,
    eventId: null,
    locationSegmentId: null,
    sourceKind: "generic" as const,
    eventSource: item.eventSource,
    eventType: item.eventType,
    title: item.title,
    category: { id: item.suggestedCategoryId, name: item.categoryName, color: item.categoryColor ?? null },
    place: { id: item.suggestedPlaceId, label: item.placeName },
    interval: { start: item.suggestedStartedAt, end: item.suggestedStoppedAt },
    confidence: item.confidence,
    status: "accepted" as const,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
    proposalHash: null,
    canonicalEntryIds: entryId ? [entryId] : [],
    semanticRevision: item.createdAt
  };
}

function presentationEntry(data: ReturnType<typeof bootstrap>, entryId: string) {
  const entry = data.entries[1];
  return {
    kind: "completed_entry" as const,
    entryId,
    eventId: null,
    title: entry.description ?? "Synthetic entry",
    category: { id: entry.categoryId, name: entry.categoryName, color: entry.categoryColor ?? null },
    place: { id: null, label: entry.placeName },
    interval: { start: "2026-08-28T17:00:00.000Z", end: "2026-08-28T17:30:00.000Z" },
    confidence: entry.confidence,
    reviewStatus: "confirmed" as const,
    updatedAt: "2026-08-28T18:00:00.000Z",
    source: entry.source
  };
}
