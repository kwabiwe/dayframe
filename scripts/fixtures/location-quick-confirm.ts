import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { LOCATION_ENGINE_V2_CONFIG, type ReviewProposalPresentation } from "@dayframe/shared";
import { pool } from "../../apps/web/src/lib/db";
import type { RequestSession } from "../../apps/web/src/lib/session";
import { canonicalJson } from "../../apps/web/src/lib/review-proposal-hash";
import { getReviewPresentation } from "../../apps/web/src/lib/review-presentation-service";
import { resolveIdempotentReviewMutation } from "../../apps/web/src/lib/review-mutation-service";
import { resolveLocationReviewAction } from "../../apps/web/src/lib/location/location-review-service";
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../../apps/web/src/lib/location/location-ingest-service";
import { reliabilityHistory, RELIABILITY_CLOCK, RELIABILITY_CUTOVER, RELIABILITY_DEVICE } from "./location-reliability";

// Frozen pre-correction Location fingerprint format, used only to construct historical fixtures.
function previousHash(row: ReviewProposalPresentation) {
  return createHash("sha256").update(canonicalJson({version:1,reviewItemId:row.reviewItemId,
    eventId:row.eventId,locationSegmentId:row.locationSegmentId,sourceKind:row.sourceKind,title:row.title,
    categoryId:row.category.id,placeId:row.place.id,startedAt:row.interval.start,stoppedAt:row.interval.end,
    confidence:row.confidence,eventSource:row.eventSource,eventType:row.eventType,semanticRevision:row.semanticRevision})).digest("hex");
}
const rejectsCode = (code: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);

/** Only called inside the existing disposable-local Review validator. */
export async function validateLocationQuickConfirm(session: RequestSession, other: RequestSession) {
  const previousMode=process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE="v2_review";
  try {
    const request={deviceId:RELIABILITY_DEVICE,algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode:"v2_review",semanticModeAcknowledgedAt:RELIABILITY_CUTOVER};
    const history=reliabilityHistory().slice(0,150);
    for(let offset=0;offset<history.length;offset+=100) await ingestLocationEvidence({...request,rolloutMode:"v2_review",
      clientBatchId:randomUUID(),timeZone:"Europe/London",evidence:history.slice(offset,offset+100)},session,RELIABILITY_CLOCK);
    const replay=()=>replayRetainedLocationEvidence(request,session,RELIABILITY_CLOCK);
    await replay();
    const ids=(await pool.query<{id:string}>(`select ri.id from review_items ri join commute_segments cs on cs.id=ri.location_segment_id
      where ri.workspace_id=$1 and ri.user_id=$2 and cs.device_id=$3 order by ri.suggested_started_at`,
    [session.workspaceId,session.userId,RELIABILITY_DEVICE])).rows.map(row=>row.id);
    assert.equal(ids.length,5);
    const read=async(id:string,scope=session)=>{
      const response=await getReviewPresentation(scope,{version:1,mode:"lookup",timeZone:"Europe/London",limit:100,reviewItemIds:[id]});
      const row=response.lookup.reviewItems[0];assert.equal(row.kind,"review");return row as ReviewProposalPresentation;
    };
    const envelope=(hash:string)=>({clientMutationId:randomUUID(),mutation:{action:"confirm" as const,expectedProposalHash:hash}});
    const count=async(id:string)=>(await pool.query<{n:number}>(`select count(*)::int n from time_entries te join review_items ri on ri.event_id=te.created_from_event_id
      where ri.id=$1 and te.workspace_id=$2 and te.user_id=$3`,[id,session.workspaceId,session.userId])).rows[0].n;
    const first=await read(ids[0]),second=await read(ids[1]);
    const one=envelope(first.proposalHash!),two=envelope(second.proposalHash!);
    const firstResult=await resolveIdempotentReviewMutation(ids[0],one,session);
    // A code-version segmentation correction can change client identity. Preserve a resolved journey.
    await pool.query("update commute_segments set client_segment_id='historical-' || client_segment_id where id=$1",[first.locationSegmentId]);
    await pool.query("update activity_events set client_event_id='historical-' || client_event_id where id=$1",[first.eventId]);
    const protectedCommute=(await pool.query("select * from commute_segments where id=$1",[first.locationSegmentId])).rows;
    const protectedLinks=(await pool.query("select * from location_segment_evidence where commute_segment_id=$1 order by id",[first.locationSegmentId])).rows;

    // Separate committed transactions and a real clock gap: updated_at must actually advance.
    await pool.query("select pg_sleep(0.01)");await replay();
    const refreshed=await read(ids[1]);assert.notEqual(refreshed.semanticRevision,second.semanticRevision);
    assert.notEqual(previousHash(refreshed),previousHash(second),"Old helper invalidated timestamp-only replay");
    assert.equal(refreshed.proposalHash,second.proposalHash);
    const content=({semanticRevision: _revision,updatedAt: _updated,...row}:ReviewProposalPresentation)=>row;
    assert.deepEqual(content(refreshed),content(second));
    assert.deepEqual((await pool.query("select * from commute_segments where id=$1",[first.locationSegmentId])).rows,protectedCommute);
    assert.deepEqual((await pool.query("select * from location_segment_evidence where commute_segment_id=$1 order by id",[first.locationSegmentId])).rows,protectedLinks);
    const secondResult=await resolveIdempotentReviewMutation(ids[1],two,session);
    assert.deepEqual(await resolveIdempotentReviewMutation(ids[0],one,session),firstResult);
    assert.deepEqual(await resolveIdempotentReviewMutation(ids[1],two,session),secondResult);
    assert.equal(await count(ids[0]),1);assert.equal(await count(ids[1]),1);

    const changed=await read(ids[2]);
    await pool.query("update review_items set suggested_stopped_at=suggested_stopped_at+interval '1 minute' where id=$1",[ids[2]]);
    await assert.rejects(resolveIdempotentReviewMutation(ids[2],envelope(changed.proposalHash!),session),rejectsCode("proposal_changed"));
    assert.equal(await count(ids[2]),0);
    const old=await read(ids[3]);const oldRequest=envelope(previousHash(old));assert.notEqual(oldRequest.mutation.expectedProposalHash,old.proposalHash);
    await assert.rejects(resolveIdempotentReviewMutation(ids[3],oldRequest,session),rejectsCode("proposal_changed"));
    assert.equal(await count(ids[3]),0);
    assert.equal((await pool.query("select id from review_mutation_receipts where client_mutation_id=$1",[oldRequest.clientMutationId])).rowCount,0);
    await assert.rejects(resolveIdempotentReviewMutation(ids[3],envelope(old.proposalHash!),other),rejectsCode("review_item_not_found"));
    const missing=await getReviewPresentation(other,{version:1,mode:"lookup",timeZone:"Europe/London",limit:100,reviewItemIds:[ids[3]]});
    assert.equal(missing.lookup.reviewItems[0].kind,"missing_review");
    await resolveLocationReviewAction(ids[3],{action:"ignore_once_location"},session);
    await assert.rejects(resolveIdempotentReviewMutation(ids[3],envelope(old.proposalHash!),session),rejectsCode("resolution_conflict"));
    assert.equal(await count(ids[3]),0);

    // Construct a committed pre-deployment receipt fixture, with its original timestamp-bearing
    // request hash and response. No production receipt or envelope migration is performed.
    const historical=await read(ids[4]);const legacy=envelope(previousHash(historical));
    const applied=await resolveLocationReviewAction(ids[4],{action:"confirm"},session);
    const result={...applied,clientMutationId:legacy.clientMutationId,reviewItemId:ids[4],expectedProposalHash:legacy.mutation.expectedProposalHash};
    const requestHash=createHash("sha256").update(canonicalJson(legacy.mutation)).digest("hex");
    await pool.query(`insert into review_mutation_receipts(workspace_id,user_id,client_mutation_id,review_item_id,action_key,request_hash,result_json)
      values($1,$2,$3,$4,'confirm',$5,$6::jsonb)`,[session.workspaceId,session.userId,legacy.clientMutationId,ids[4],requestHash,JSON.stringify(result)]);
    const receipt=await pool.query("select * from review_mutation_receipts where client_mutation_id=$1",[legacy.clientMutationId]);
    await pool.query("update time_entries set description='Later user edit' where created_from_event_id=$1",[historical.eventId]);
    assert.deepEqual(await resolveIdempotentReviewMutation(ids[4],legacy,session),result);
    assert.deepEqual((await pool.query("select * from review_mutation_receipts where client_mutation_id=$1",[legacy.clientMutationId])).rows,receipt.rows);
    assert.equal(await count(ids[4]),1);
    assert.equal((await pool.query("select description from time_entries where created_from_event_id=$1",[historical.eventId])).rows[0].description,"Later user edit");
    await assert.rejects(resolveIdempotentReviewMutation(ids[4],{...legacy,mutation:{action:"confirm",expectedProposalHash:historical.proposalHash}},session),rejectsCode("mutation_id_conflict"));
    console.log("PASS: Location timestamp-only replay, consecutive Quick Confirms, genuine change rejection, old-format receipt replay/fail-closed pending hash, terminal decisions and owner isolation.");
  } finally {
    if(previousMode===undefined)delete process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;else process.env.DAYFRAME_LOCATION_ROLLOUT_MODE=previousMode;
  }
}
