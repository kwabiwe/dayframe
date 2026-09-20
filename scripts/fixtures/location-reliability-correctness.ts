import assert from "node:assert/strict";
import type pg from "pg";
import { LOCATION_ENGINE_V2_CONFIG, type LocationEvidence, type LocationEvidenceBatchRequest, runLocationEngine, EMPTY_LOCATION_ENGINE_STATE } from "@dayframe/shared";
import type { RequestSession } from "../../apps/web/src/lib/session";
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../../apps/web/src/lib/location/location-ingest-service";
import { parseLocationSyncDiagnostics } from "@dayframe/shared";
import { syncFailureMetadata } from "../../apps/web/src/lib/sync-transaction";
import { reliabilityHistory, RELIABILITY_CLOCK, RELIABILITY_CUTOVER, RELIABILITY_DEVICE } from "./location-reliability";

type Fixture = { database:pg.Pool;owner:()=>Promise<RequestSession>;batch:(e:LocationEvidence[])=>LocationEvidenceBatchRequest };
function interceptedPool(database:pg.Pool, before:(sql:string,raw:pg.PoolClient)=>Promise<void>) {
  return {connect:async()=>{
    const raw=await database.connect();
    return new Proxy(raw,{get(client,key){
      if(key==="query")return async(sql:string,params?:unknown[])=>{await before(sql,client);return params?client.query(sql,params):client.query(sql);};
      const value=Reflect.get(client,key);return typeof value==="function"?value.bind(client):value;
    }});
  }} as Pick<pg.Pool,"connect">;
}
async function evidenceRows(db:pg.Pool,owner:RequestSession){return (await db.query(`select client_evidence_id,client_batch_id,evidence_type,occurred_at,ended_at,
  ST_Y(coordinate::geometry) latitude,ST_X(coordinate::geometry) longitude,horizontal_accuracy_m,altitude_m,speed_mps,course_degrees,
  saved_place_id,geofence_identifier,accepted,rejection_reason,algorithm_version,time_zone,is_simulated,metadata,received_at,expires_at
  from location_evidence where workspace_id=$1 and user_id=$2 order by client_evidence_id`,[owner.workspaceId,owner.userId])).rows;}
export async function verifyReliabilityCorrectness({database,owner,batch}:Fixture) {
  const history=reliabilityHistory();
  const session=await owner();
  const mixed=history.slice(0,100).map((row,i)=>({...row,clientEvidenceId:`mixed-${i}`,
    ...(i===2?{horizontalAccuracyMeters:99999}:{}),
    ...(i===3?{kind:"provider_status" as const,latitude:undefined,longitude:undefined,altitudeMeters:undefined}:{}),
    ...(i===4?{kind:"visit" as const,endedAt:new Date(Date.parse(row.occurredAt)+60_000).toISOString()}:{}),
    ...(i===5?{isSimulated:true}:{}),metadata:{}}));
  // Within-batch duplicate: changed second row must not replace the first.
  mixed[99]={...mixed[0],altitudeMeters:99};
  const request=batch(mixed);
  const classification=runLocationEngine({priorState:EMPTY_LOCATION_ENGINE_STATE,evidence:mixed,savedPlaces:[],acceptedLearnedPlaces:[],config:LOCATION_ENGINE_V2_CONFIG,processingAt:RELIABILITY_CLOCK});
  const reasons=new Map(classification.rejectedEvidence.map(row=>[row.clientEvidenceId,row.reason]));
  const result=await ingestLocationEvidence(request,session,RELIABILITY_CLOCK);
  assert.deepEqual(result.acknowledgedEvidenceIds,mixed.map(row=>row.clientEvidenceId));
  const rows=await evidenceRows(database,session);assert.equal(rows.length,99);
  for(const row of rows){
    const source=mixed.find(item=>item.clientEvidenceId===row.client_evidence_id)!;
    const rejection=reasons.get(source.clientEvidenceId)??null;
    assert.equal(row.rejection_reason,rejection);assert.equal(row.accepted,!rejection);
    assert.equal(row.latitude,rejection?null:source.latitude??null);assert.equal(row.longitude,rejection?null:source.longitude??null);
    assert.equal(row.altitude_m,rejection?null:source.altitudeMeters??null);
    assert.equal(row.speed_mps,rejection?null:source.speedMetersPerSecond??null);
    assert.equal(row.course_degrees,rejection?null:source.courseDegrees??null);
    assert.equal(row.horizontal_accuracy_m,source.horizontalAccuracyMeters??null);
    assert.equal(row.evidence_type,source.kind);assert.equal(row.client_batch_id,request.clientBatchId);
    assert.equal(new Date(row.occurred_at).toISOString(),source.occurredAt);
    assert.equal(row.ended_at?new Date(row.ended_at).toISOString():null,source.endedAt??null);
    assert.equal(new Date(row.received_at).toISOString(),source.receivedAt);
    assert.equal(new Date(row.expires_at).toISOString(),"2026-09-21T00:00:00.000Z");
    assert.equal(row.is_simulated,source.isSimulated??null);assert.deepEqual(row.metadata,{});
    assert.equal(row.time_zone,request.timeZone);assert.equal(row.algorithm_version,request.algorithmVersion);
  }
  const retry=await ingestLocationEvidence(request,session,"2026-09-14T00:01:00.000Z");
  assert(retry.duplicateBatch);assert.deepEqual(await evidenceRows(database,session),rows,"Retries must not refresh fields or expiry");
  const overlap=batch([...mixed.slice(0,50),...history.slice(50,100).map((e,i)=>({...e,clientEvidenceId:`new-${i}`}))]);
  const acknowledged=await ingestLocationEvidence(overlap,session,RELIABILITY_CLOCK);assert.equal(acknowledged.acknowledgedEvidenceIds.length,100);
  assert.equal((await evidenceRows(database,session)).length,149);
  const secondOwner=await owner();
  await database.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'member')",[session.workspaceId,secondOwner.userId]);
  const sharedWorkspace={...secondOwner,workspaceId:session.workspaceId};
  await ingestLocationEvidence(request,sharedWorkspace,RELIABILITY_CLOCK);
  assert.equal((await evidenceRows(database,sharedWorkspace)).length,99);
  await ingestLocationEvidence(request,secondOwner,RELIABILITY_CLOCK);
  assert.equal((await evidenceRows(database,secondOwner)).length,99);
  const secondDevice={...request,deviceId:"second-synthetic-device",evidence:request.evidence.map(e=>({...e,deviceId:"second-synthetic-device"}))};
  await ingestLocationEvidence(secondDevice,session,RELIABILITY_CLOCK);
  assert.equal((await evidenceRows(database,session)).length,248);
  for(const invalid of [{...request,evidence:[]},{...request,evidence:Array(101).fill(history[0])},
    {...request,evidence:[{...history[0],deviceId:"wrong-device"}]},
    {...request,evidence:[{...history[0],occurredAt:"2027-01-01T00:00:00.000Z"}]}]) {
    await assert.rejects(ingestLocationEvidence(invalid,session,RELIABILITY_CLOCK));
  }
  const summary=(await database.query("select raw_payload from activity_events where workspace_id=$1",[session.workspaceId])).rows;
  assert(!/latitude|longitude|altitude|coordinate/.test(JSON.stringify(summary)));
  // Database failures, commit failure and cancellation must not acknowledge any partial summary/evidence.
  for(const fault of ["bulk","commit","cancel"]){
    const victim=await owner();const abort=new AbortController();
    const dbPool=interceptedPool(database,async(sql,raw)=>{
      if(fault==="bulk"&&/^\s*insert into location_evidence\s/i.test(sql))await raw.query("select 1/0");
      if(sql==="commit"){
        if(fault==="commit")await raw.query("select 1/0");
        if(fault==="cancel"){abort.abort();throw new Error("Synthetic cancellation");}
      }
    });
    await assert.rejects(ingestLocationEvidence(batch(history.slice(0,25)),victim,RELIABILITY_CLOCK,{databasePool:dbPool,signal:abort.signal}));
    assert.equal((await evidenceRows(database,victim)).length,0);
    assert.equal((await database.query("select count(*)::int n from activity_events where workspace_id=$1",[victim.workspaceId])).rows[0].n,0);
  }
  // Real FK failure cannot drop just one row or commit the summary.
  const invalid=await owner();
  await assert.rejects(ingestLocationEvidence(batch([{...history[0],savedPlaceId:"ffffffff-ffff-4fff-8fff-ffffffffffff"}]),invalid,RELIABILITY_CLOCK));
  assert.equal((await evidenceRows(database,invalid)).length,0);
  assert.equal((await database.query("select count(*)::int n from activity_events where workspace_id=$1",[invalid.workspaceId])).rows[0].n,0);
  // No return route/stay evidence: one outbound journey, never an invented return.
  const incomplete=await owner();
  await ingestLocationEvidence(batch(history.slice(0,30)),incomplete,RELIABILITY_CLOCK);
  const replayRequest={deviceId:RELIABILITY_DEVICE,algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,rolloutMode:"v2_review",semanticModeAcknowledgedAt:RELIABILITY_CUTOVER};
  await replayRetainedLocationEvidence(replayRequest,incomplete,RELIABILITY_CLOCK);
  assert.equal((await database.query("select count(*)::int n from commute_segments where workspace_id=$1",[incomplete.workspaceId])).rows[0].n,1);
  assert.equal((await database.query("select count(*)::int n from review_items where workspace_id=$1",[incomplete.workspaceId])).rows[0].n,1);
  // Hold the lock from a real upload while replay and an unrelated owner both execute.
  const contentionOwner=await owner();const other=await owner();
  let release!:()=>void, acquired!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});const ready=new Promise<void>(resolve=>{acquired=resolve;});
  const holdingPool=interceptedPool(database,async(sql)=>{if(/^\s*delete from location_evidence/i.test(sql)){acquired();await held;}});
  const holding=ingestLocationEvidence(batch(history.slice(0,25)),contentionOwner,RELIABILITY_CLOCK,{databasePool:holdingPool});
  await ready;
  const started=Date.now();
  try{
    const different=ingestLocationEvidence(batch(history.slice(0,25)),other,RELIABILITY_CLOCK);
    let blocked:unknown;
    try{await replayRetainedLocationEvidence(replayRequest,contentionOwner,RELIABILITY_CLOCK);}catch(e){blocked=e;}
    assert(blocked);assert(Date.now()-started<3000);
    assert.deepEqual(parseLocationSyncDiagnostics(syncFailureMetadata(blocked),"replay",503).phase,"owner_lock");
    assert.equal((blocked as {code:string}).code,"55P03");
    assert((await different).ok);
    console.log(JSON.stringify({contention:"upload-versus-replay",elapsedMs:Date.now()-started,phase:"owner_lock",sqlState:"55P03",differentOwner:"PASS"}));
  }finally{release();await holding;}
  assert((await replayRetainedLocationEvidence(replayRequest,contentionOwner,RELIABILITY_CLOCK)).ok);
  console.log("PASS: bulk field mapping, first duplicate/classification, mixed conflicts/rejections, expiry, FK/SQL/commit/cancel rollback, coordinate-free summary, unknown endpoints, absent return and bounded owner contention.");
}

export async function verifyLineageRollback(database:pg.Pool,session:RequestSession,read:()=>Promise<unknown[]>,replayRequest:unknown) {
  const before=await read();let lineageWrites=0;let executedWrite=false;
  const databasePool={connect:async()=>{
    const raw=await database.connect();
    return new Proxy(raw,{get(client,key){
      if(key==="query")return async(sql:string,params?:unknown[])=>{
        if(/^\s*insert into location_segment_evidence/i.test(sql)){
          lineageWrites += 1;
          if (params) await client.query(sql,params); else await client.query(sql);
          executedWrite = true;
          // The 840-link S0 fixture is intentionally below the new 2,048-row
          // cap. Fail only after the single batch has really executed so the
          // rollback proof cannot pass without reaching the injection seam.
          throw new Error("Synthetic lineage failure after executed write");
        }
        return params ? client.query(sql,params) : client.query(sql);
      };
      const value=Reflect.get(client,key);return typeof value==="function"?value.bind(client):value;
    }});
  }} as Pick<pg.Pool,"connect">;
  await assert.rejects(replayRetainedLocationEvidence(replayRequest,session,RELIABILITY_CLOCK,{databasePool}));
  assert.equal(lineageWrites,1);assert(executedWrite,"Lineage fault did not execute its write before failing.");
  assert.deepEqual(await read(),before,"Executed lineage write must restore deleted links on rollback");
  // Exact link protection for both manual correction and terminal Review decisions.
  await database.query("update stay_segments set continuity_status='manual' where workspace_id=$1",[session.workspaceId]);
  await database.query("update review_items set status='ignored' where workspace_id=$1",[session.workspaceId]);
  await database.query("update activity_events set review_status='ignored' where workspace_id=$1 and event_type='commute_detected'",[session.workspaceId]);
  // Make protected lineage observably different from the engine's next output.
  await database.query("update location_segment_evidence set sequence_index=sequence_index+1000 where workspace_id=$1",[session.workspaceId]);
  const protectedLinks=await read();
  await replayRetainedLocationEvidence(replayRequest,session,RELIABILITY_CLOCK);
  assert.deepEqual(await read(),protectedLinks);
  assert.equal((await database.query("select count(*)::int n from review_items where workspace_id=$1 and status='open'",[session.workspaceId])).rows[0].n,0);
  console.log("PASS: executed-batch rollback and exact protected/manual/terminal lineage with no resurrected Review.");
}
