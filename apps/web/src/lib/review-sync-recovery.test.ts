import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock("./db", async (original) => ({
  ...await original<typeof import("./db")>(),
  pool: { connect: mocks.connect, query: mocks.query }
}));
const { resolveIdempotentReviewMutation, reconcileReviewMutations } = await import("./review-mutation-service");
const session = {
  workspaceId: "91000000-0000-4000-8000-000000000001",
  userId: "91000000-0000-4000-8000-000000000002",
  authMode: "provider" as const, scopes: ["app:write"]
};
const reviewId = "91000000-0000-4000-8000-000000000003";
const envelope = { clientMutationId: "91000000-0000-4000-8000-000000000004", mutation: { action: "accept" } };

describe("Review failure truth at the mutation boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue({ rows: [] }); });
  function clientFor(options: { busy?: boolean; failure?: Error }) {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: !options.busy }] };
        if (sql.includes('location_segment_id as "locationSegmentId"')) throw options.failure;
        return { rows: [] };
      }), release: vi.fn(), on: vi.fn(), removeListener: vi.fn()
    };
    mocks.connect.mockResolvedValue(client);
    return client;
  }
  it("does not claim an open canonical card when only a mutation try-lock failed", async () => {
    clientFor({ busy: true });
    await expect(resolveIdempotentReviewMutation(reviewId, envelope, session)).rejects.toMatchObject({
      code: "review_item_locked", status: 409,
      details: { canonicalStatus: "unknown", reason: "mutation_in_progress" }
    });
  });
  it("does not call an unrelated SQL cancellation a Review row lock", async () => {
    clientFor({ failure: Object.assign(new Error("canceling statement due to user request"), { code: "57014" }) });
    await expect(resolveIdempotentReviewMutation(reviewId, envelope, session)).rejects.toMatchObject({
      code: "review_query_cancelled", status: 503,
      details: { canonicalStatus: "unknown", reason: "query_cancelled", sqlState: "57014" }
    });
  });
  it("replays an exact receipt committed by another request during rollback", async () => {
    const result = { ok: true, action: "accept", status: "accepted", entryId: "canonical-entry" };
    const first = clientFor({ busy: true });
    let rolledBack = false;
    const query = first.query.getMockImplementation()!;
    first.query.mockImplementation(async sql => {
      if (sql === "rollback") rolledBack = true;
      if (rolledBack && sql.includes("from review_mutation_receipts")) return { rows: [{
        reviewItemId: reviewId, actionKey: "accept",
        requestHash: createHash("sha256").update('{"action":"accept"}').digest("hex"),
        resultJson: result
      }] } as never;
      return query(sql);
    });
    await expect(resolveIdempotentReviewMutation(reviewId,envelope,session)).resolves.toEqual(result);
    expect(first.query.mock.calls.some(([sql])=>sql.includes("insert into time_entries"))).toBe(false);
  });
  it("does not treat an accepted row alone as equivalent receipt proof", async () => {
    const client=clientFor({});
    client.query.mockImplementation(async sql=>({ rows: sql.startsWith("select id, status") ? [{id:reviewId,status:"accepted"}] : [] }) as never);
    const result=await reconcileReviewMutations({mutations:[{...envelope,reviewItemId:reviewId}]},session);
    expect(result.results[0]).toMatchObject({state:"unknown",reason:"effect_requires_receipt",retryOriginal:true});
    expect(client.query.mock.calls.some(([sql])=>/insert |update |delete /i.test(sql))).toBe(false);
  });
});
