import { describe, expect, it } from "vitest";
import { ReviewMutationEnvelopeSchema, ReviewReconciliationRequestSchema, validReviewAcknowledgement } from "./reviewMutations";
const envelope = { clientMutationId: "92000000-0000-4000-8000-000000000001", mutation: { action: "accept" as const } };
const reviewId = "92000000-0000-4000-8000-000000000002";
describe("durable Review acknowledgement contract", () => {
  it.each([null, "<html>OK</html>", {ok:false}, {ok:true}, {ok:true,action:"accept",status:"accepted"},
    {ok:true,action:"accept",status:"accepted",entryId:"entry",partial:true},
    {ok:true,action:"accept",status:"accepted",entryId:"entry",clientMutationId:"wrong"},
    {ok:true,action:"ignore_once",status:"ignored"}])("rejects incomplete or conflicting proof %j", body => {
    expect(validReviewAcknowledgement(body,envelope,reviewId)).toBe(false);
  });
  it("accepts valid existing server success without requiring newly added identity fields", () => {
    expect(validReviewAcknowledgement({ok:true,action:"accept",status:"accepted",entryId:"entry"},envelope,reviewId)).toBe(true);
    expect(validReviewAcknowledgement({ok:true,action:"accept",status:"accepted",alreadyResolved:true,equivalent:true},envelope,reviewId)).toBe(true);
  });
  it("bounds reconciliation input before any owner-scoped database work", () => {
    expect(ReviewReconciliationRequestSchema.safeParse({mutations:Array.from({length:26},()=>({...envelope,reviewItemId:reviewId}))}).success).toBe(false);
  });
  it("keeps historical envelopes valid while requiring exact proof for guarded Quick Confirm", () => {
    const guarded = ReviewMutationEnvelopeSchema.parse({
      clientMutationId: envelope.clientMutationId,
      mutation: { action: "accept", expectedProposalHash: "a".repeat(64) }
    });
    expect(validReviewAcknowledgement({
      ok: true, action: "accept", status: "accepted", entryId: "entry",
      clientMutationId: guarded.clientMutationId, reviewItemId: reviewId,
      expectedProposalHash: "a".repeat(64)
    }, guarded, reviewId)).toBe(true);
    expect(validReviewAcknowledgement({
      ok: true, action: "accept", status: "accepted", entryId: "entry"
    }, guarded, reviewId)).toBe(false);
    expect(ReviewMutationEnvelopeSchema.safeParse({
      clientMutationId: envelope.clientMutationId,
      mutation: { action: "confirm", expectedProposalHash: "not-a-hash" }
    }).success).toBe(false);
  });
});
