import { verifyReviewSemantics } from "./fixtures/location-review-semantics";
import { segmentPersistenceFingerprint, verifySegmentPersistence } from "./fixtures/location-segment-persistence";
import { verifyReliabilityCorrectness, verifyLineageRollback } from "./fixtures/location-reliability-correctness";
/** Opt-in, finite, synthetic PostgreSQL/PostGIS reliability measurements. No hosted credentials. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { LOCATION_ENGINE_V2_CONFIG, type LocationEvidence } from "@dayframe/shared";
import { reliabilityHistory, RELIABILITY_CLOCK, RELIABILITY_CUTOVER, RELIABILITY_DEVICE } from "./fixtures/location-reliability";
import type { RequestSession } from "../apps/web/src/lib/session";
const target = process.env.DATABASE_URL;
assert(target, "Explicit DATABASE_URL required");
const url = new URL(target);
assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"), "Disposable loopback *_test database required");
const baseline = false;
const correctnessOnly = process.argv.includes("--correctness-only");
let stressFailed = false;
const database = new pg.Pool({ connectionString: target, max: 6, connectionTimeoutMillis: 1500 });
const owners: RequestSession[] = [];
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../apps/web/src/lib/location/location-ingest-service";
import { syncFailureMetadata } from "../apps/web/src/lib/sync-transaction";
import { pool } from "../apps/web/src/lib/db";
const batch = (evidence: LocationEvidence[], id = randomUUID()) => ({clientBatchId:id,deviceId:RELIABILITY_DEVICE,
  algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,timeZone:"Europe/London",rolloutMode:"v2_review" as const,
  semanticModeAcknowledgedAt:RELIABILITY_CUTOVER,evidence});
const replayRequest = {deviceId:RELIABILITY_DEVICE,algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
  rolloutMode:"v2_review",semanticModeAcknowledgedAt:RELIABILITY_CUTOVER};
async function owner() {
  const session:RequestSession={workspaceId:randomUUID(),userId:randomUUID(),authMode:"token",scopes:["app:read","app:write","events:write"]};
  owners.push(session);
  await database.query("insert into users(id,email,name) values($1,$2,'Synthetic reliability')",[session.userId,`${session.userId}@example.test`]);
  await database.query("insert into workspaces(id,name) values($1,'Synthetic reliability')",[session.workspaceId]);
  await database.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",[session.workspaceId,session.userId]);
  return session;
}
async function measure(label:string, session:RequestSession, evidence:LocationEvidence[]|null, delayMs=0) {
  let stage="transaction",queries=0,inserts=0,lineageInserts=0;
  const stages:Record<string,{queries:number;ms:number}>={};
  const began=performance.now();let last=began;
  const checkpoint=()=>{ const now=performance.now();(stages[stage]??={queries:0,ms:0}).ms+=now-last;last=now; };
  const databasePool={connect:async()=>{
    const raw=await database.connect();let released=false;
    return new Proxy(raw,{get(client,key){
      if(key==="query")return async(sql:string,params?:unknown[])=>{
        if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));
        if(released)throw new Error("Synthetic connection released");
        queries++;(stages[stage]??={queries:0,ms:0}).queries++;
        if(/^\s*insert into location_evidence\s/i.test(sql))inserts++;
        if(/^\s*insert into location_segment_evidence\s/i.test(sql))lineageInserts++;
        return params?client.query(sql,params):client.query(sql);
      };
      if(key==="release")return (destroy?:boolean)=>{released=true;client.release(destroy);};
      const value=Reflect.get(client,key);return typeof value==="function"?value.bind(client):value;
    }});
  }} as Pick<pg.Pool,"connect">;
  let result:unknown,error:unknown;
  try {
    const options={databasePool,onLocationStage:(next:string)=>{checkpoint();stage=next;}};
    result=evidence?await ingestLocationEvidence(batch(evidence),session,RELIABILITY_CLOCK,options)
      :await replayRetainedLocationEvidence(replayRequest,session,RELIABILITY_CLOCK,options);
  }catch(e){error=e;}
  checkpoint();
  const report={label,baseline,delayMs,observations:evidence?.length??860,outcome:error?"FAIL":"PASS",
    elapsedMs:Math.round(performance.now()-began),queries,evidenceInserts:inserts,lineageInserts,
    stages:Object.fromEntries(Object.entries(stages).map(([name,v])=>[name,{queries:v.queries,ms:Math.round(v.ms)}])),
    ...(error?{failure:{...syncFailureMetadata(error),locationStage:stage}}:{})};
  console.log(JSON.stringify(report));
  if(!error&&evidence)assert.equal(inserts,baseline?evidence.length:1);
  if(!delayMs)assert.ifError(error);
  if(delayMs && error)stressFailed = true;
  return {result,error,report};
}
async function lineage(session:RequestSession) {
  return (await database.query(`select e.client_evidence_id, coalesce(s.client_segment_id,c.client_segment_id) as segment,
    l.sequence_index,l.role from location_segment_evidence l join location_evidence e on e.id=l.evidence_id
    left join stay_segments s on s.id=l.stay_segment_id left join commute_segments c on c.id=l.commute_segment_id
    where l.workspace_id=$1 and l.user_id=$2 order by segment,l.sequence_index,l.role,e.client_evidence_id`,[session.workspaceId,session.userId])).rows;
}
async function run() {
  const version=await database.query("select current_setting('server_version_num')::int as version,postgis_version() as postgis");
  assert(version.rows[0].version>=170000&&version.rows[0].version<180000,"PostgreSQL 17 required");
  console.log(JSON.stringify({database:version.rows[0],clock:RELIABILITY_CLOCK,syntheticLatency:true}));
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE="v2_review";
  const history=reliabilityHistory();assert.equal(history.length,860);
  for(const n of [1,25,100])await measure(`upload-${n}`,await owner(),history.slice(0,n));
  for(const delay of correctnessOnly ? [] : [20,40])await measure("upload-100",await owner(),history.slice(0,100),delay);
  const retained=await owner();
  // 555 stored plus exactly seven immutable batches totalling 305, in two finite passes (5 + 2).
  for(let i=0;i<555;i+=100)await ingestLocationEvidence(batch(history.slice(i,Math.min(i+100,555))),retained,RELIABILITY_CLOCK);
  const pending=[...Array(7)].map((_,i)=>batch(history.slice(555+i*44,i===6?860:555+(i+1)*44)));
  for(const pass of [pending.slice(0,5),pending.slice(5)])for(const b of pass){
    const first=await ingestLocationEvidence(b,retained,RELIABILITY_CLOCK);
    const retry=await ingestLocationEvidence(b,retained,RELIABILITY_CLOCK);
    assert.deepEqual(retry.acknowledgedEvidenceIds,first.acknowledgedEvidenceIds);assert(retry.duplicateBatch);
  }
  const count=await database.query("select count(*)::int n from location_evidence where workspace_id=$1",[retained.workspaceId]);assert.equal(count.rows[0].n,860);
  const local=await measure("replay-860",retained,null);
  const links=await lineage(retained);
  const counts=(await database.query(`select
    (select count(*)::int from stay_segments where workspace_id=$1) stays,
    (select count(*)::int from commute_segments where workspace_id=$1) commutes,
    (select count(*)::int from review_items where workspace_id=$1) reviews,
    (select count(*)::int from time_entries where workspace_id=$1) entries`,[retained.workspaceId])).rows[0];
  assert.deepEqual(counts,{stays:56,commutes:28,reviews:28,entries:0});
  assert.equal(counts.entries,0);assert(links.length>500);assert(local.result);
  console.log(JSON.stringify({fixture:"seven-day-860",...counts,lineage:links.length,lineageHash:createHash("sha256").update(JSON.stringify(links)).digest("hex")}));
  const segmentAndSemanticHash = await segmentPersistenceFingerprint(database,retained);
  assert.equal(segmentAndSemanticHash,"79008808b7458bde476a813ec5ba3419e2c692dd01121351dca894c27ca5a1e3","Stored fields/semantics differ from reviewed-head baseline");
  assert.equal(createHash("sha256").update(JSON.stringify(links)).digest("hex"),"2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899");
  console.log(JSON.stringify({segmentAndSemanticHash}));
  for(const delay of correctnessOnly ? [] : [20,40]){
    await measure("replay-860",retained,null,delay);
    assert.deepEqual(await lineage(retained),links,"Failed replay must rollback; successful replay must preserve exact lineage");
  }
  const isolationOwner=await owner();
  const peers=[{...isolationOwner,workspaceId:retained.workspaceId},{...retained,workspaceId:isolationOwner.workspaceId}];
  for (const peer of peers) {
    await ingestLocationEvidence(batch(history.slice(0,30)),peer,RELIABILITY_CLOCK);
    await replayRetainedLocationEvidence(replayRequest,peer,RELIABILITY_CLOCK);
  }
  await verifyReviewSemantics(database,owner);
  await verifySegmentPersistence(database,retained,peers);
  // The focused protection fixture changes Review ownership intentionally; the existing independent lineage check follows.
  await verifyLineageRollback(database,retained,()=>lineage(retained),replayRequest);
  await verifyReliabilityCorrectness({database,owner,batch});
  if(stressFailed){ console.log("FAIL: synthetic-latency replay budget remains blocked; stop for scope decision."); process.exitCode=1; }
  console.log("PASS: finite 555 + seven/305 backlog, response-loss identities, real Review-only replay and exact lineage equivalence.");
}
async function main() { try {await run();} finally {
  for(const session of owners){await database.query("delete from workspaces where id=$1",[session.workspaceId]);await database.query("delete from users where id=$1",[session.userId]);}
  await database.end();await pool.end();
}

}
void main().catch(error => { console.error(error); process.exitCode=1; });
