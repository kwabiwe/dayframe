import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({session:vi.fn(),reconcile:vi.fn()}));
vi.mock("@/lib/ingest-auth",()=>({resolveRequestSession:mocks.session}));
vi.mock("@/lib/review-mutation-service",()=>({reconcileReviewMutations:mocks.reconcile}));
const { POST }=await import("./route");
const owner={workspaceId:"93000000-0000-4000-8000-000000000001",userId:"93000000-0000-4000-8000-000000000002"};
const item={reviewItemId:"93000000-0000-4000-8000-000000000003",clientMutationId:"93000000-0000-4000-8000-000000000004",mutation:{action:"accept"}};
const request=(body:unknown)=>new Request("https://staging.test/api/review/mutations/reconcile",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue(owner);mocks.reconcile.mockResolvedValue({ok:true,results:[]});});
it("passes only validated envelopes and authenticated owner with a finite deadline",async()=>{
  const response=await POST(request({mutations:[item]}));
  expect(response.status).toBe(200);
  expect(mocks.reconcile).toHaveBeenCalledWith({mutations:[item]},owner,expect.objectContaining({signal:expect.any(AbortSignal),deadlineAt:expect.any(Number)}));
});
it("rejects malformed and oversized batches without a reconciliation read",async()=>{
  expect((await POST(request({mutations:Array(26).fill(item)}))).status).toBe(400);
  expect((await POST(request({mutations:[{...item,workspaceId:owner.workspaceId}]}))).status).toBe(400);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
