import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type pg from "pg";
import type { RequestSession } from "../../apps/web/src/lib/session";
import { replayLocationEvidence } from "../../apps/web/src/lib/location/location-replay-service";
import { withSyncTransaction } from "../../apps/web/src/lib/sync-transaction";
import { LOCATION_ENGINE_V2_CONFIG } from "@dayframe/shared";
import { RELIABILITY_CLOCK, RELIABILITY_DEVICE } from "./location-reliability";

/** Complete stored business fields, normalising only generated database identities/timestamps. */
export async function segmentPersistenceFingerprint(db:pg.Pool, session:RequestSession) {
  const stays=(await db.query(`select to_jsonb(s)-array['id','workspace_id','user_id','created_at','updated_at','created_from_event_id'] as value
    from stay_segments s where workspace_id=$1 and user_id=$2 order by client_segment_id`,[session.workspaceId,session.userId])).rows;
  const commutes=(await db.query(`select (to_jsonb(c)-array['id','workspace_id','user_id','created_at','updated_at','created_from_event_id','from_stay_segment_id','to_stay_segment_id']) ||
    jsonb_build_object('from_client_segment_id',f.client_segment_id,'to_client_segment_id',t.client_segment_id) as value
    from commute_segments c join stay_segments f on f.id=c.from_stay_segment_id join stay_segments t on t.id=c.to_stay_segment_id
    where c.workspace_id=$1 and c.user_id=$2 order by c.client_segment_id`,[session.workspaceId,session.userId])).rows;
  const semantics=(await db.query(`select client_event_id,event_type,occurred_at,confidence,review_status,raw_payload,
    (select name from categories where id=e.suggested_category_id) category
    from activity_events e where workspace_id=$1 and user_id=$2 and event_type <> 'location_evidence_batch' order by client_event_id`,[session.workspaceId,session.userId])).rows;
  return createHash("sha256").update(JSON.stringify({stays,commutes,semantics})).digest("hex");
}

export async function verifySegmentPersistence(db:pg.Pool,session:RequestSession,peers:RequestSession[]) {
  const peerRows = () => Promise.all(peers.map(async peer => ({
    stays:(await db.query("select * from stay_segments where workspace_id=$1 and user_id=$2 order by id",[peer.workspaceId,peer.userId])).rows,
    commutes:(await db.query("select * from commute_segments where workspace_id=$1 and user_id=$2 order by id",[peer.workspaceId,peer.userId])).rows
  })));
  const untouchedPeers=await peerRows();
  const rows=async(table:"stay_segments"|"commute_segments")=>(await db.query(`select * from ${table}
    where workspace_id=$1 and user_id=$2 and device_id=$3 order by client_segment_id`,[session.workspaceId,session.userId,RELIABILITY_DEVICE])).rows;
  const stays=await rows("stay_segments"),commutes=await rows("commute_segments");
  assert.equal(stays.length,56);assert.equal(commutes.length,28);
  const replay=async(databasePool:Pick<pg.Pool,"connect">=db)=>withSyncTransaction("location_segment_regression",async({client,phase})=>{
    phase("owner_lock");await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))",[session.workspaceId,session.userId]);phase("effect");
    return replayLocationEvidence(client,session,{deviceId:RELIABILITY_DEVICE,algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,processingAt:RELIABILITY_CLOCK});
  },{databasePool});
  // Only replay persistence is exercised here: semantic emission must not obscure protected updated_at checks.
  const mutableStay=stays[0],manualStay=stays[1],terminalStay=stays[2],openStay=stays[3];
  const mutableCommute=commutes[0],manualCommute=commutes[1],terminalCommute=commutes[2];
  const eventId=mutableCommute.created_from_event_id;
  assert(eventId);
  await db.query("update stay_segments set radius_m=9876 where id=$1",[mutableStay.id]);
  await db.query("update stay_segments set continuity_status='manual',radius_m=5432 where id=$1",[manualStay.id]);
  await db.query("update stay_segments set created_from_event_id=$2,radius_m=4321 where id=$1",[terminalStay.id,eventId]);
  await db.query("update stay_segments set created_from_event_id=$2,radius_m=3210 where id=$1",[openStay.id,eventId]);
  // The exact existing predicate is any owner-scoped open Review for the segment, irrespective of its event.
  await db.query("update review_items set location_segment_id=$2 where event_id=$1",[eventId,openStay.id]);
  // Keep mutable commute open as well, using another already-open synthetic review row.
  await db.query("update review_items set location_segment_id=$2 where event_id=$1",[commutes[3].created_from_event_id,mutableCommute.id]);
  await db.query("update commute_segments set route_distance_m=9876 where id=$1",[mutableCommute.id]);
  await db.query("update commute_segments set continuity_status='manual',route_distance_m=5432 where id=$1",[manualCommute.id]);
  await db.query("update review_items set status='ignored' where location_segment_id=$1",[terminalCommute.id]);
  await db.query("update commute_segments set route_distance_m=4321 where id=$1",[terminalCommute.id]);
  const beforeStays=await rows("stay_segments"),beforeCommutes=await rows("commute_segments");
  const lineage=async()=>(await db.query("select * from location_segment_evidence where workspace_id=$1 order by id",[session.workspaceId])).rows;
  const oldLinks=await lineage();
  const decisions = async () => ({
    reviews:(await db.query("select * from review_items where workspace_id=$1 and user_id=$2 order by id",[session.workspaceId,session.userId])).rows,
    events:(await db.query("select * from activity_events where workspace_id=$1 and user_id=$2 order by id",[session.workspaceId,session.userId])).rows
  });
  const oldDecisions=await decisions();
  // Existing owner/workspace/device lookups must not collect a same-client-ID peer.
  const otherDevice="segment-isolation-device";
  const peer=(await db.query(`insert into stay_segments(workspace_id,user_id,device_id,client_segment_id,algorithm_version,status,started_at,continuity_status,radius_m)
    select workspace_id,user_id,$2,client_segment_id,algorithm_version,status,started_at,'manual',9999 from stay_segments where id=$1 returning *`,[mutableStay.id,otherDevice])).rows[0];
  let writes=0;
  const faultPool={connect:async()=>{
    const raw=await db.connect();return new Proxy(raw,{get(client,key){
      if(key==="query")return async(sql:string,params?:unknown[])=>{
        if(/^\s*insert into (stay|commute)_segments/i.test(sql)&&++writes===2)await client.query("select 1/0");
        return params?client.query(sql,params):client.query(sql);
      };const v=Reflect.get(client,key);return typeof v==="function"?v.bind(client):v;
    }});
  }} as Pick<pg.Pool,"connect">;
  await assert.rejects(replay(faultPool));assert.equal(writes,2);
  assert.deepEqual(await rows("stay_segments"),beforeStays);assert.deepEqual(await rows("commute_segments"),beforeCommutes);assert.deepEqual(await lineage(),oldLinks);assert.deepEqual(await decisions(),oldDecisions);
  const result=await replay();
  const afterStays=await rows("stay_segments"),afterCommutes=await rows("commute_segments");
  for(const row of [manualStay,terminalStay])assert.deepEqual(afterStays.find(s=>s.id===row.id),beforeStays.find(s=>s.id===row.id));
  for(const row of [manualCommute,terminalCommute])assert.deepEqual(afterCommutes.find(s=>s.id===row.id),beforeCommutes.find(s=>s.id===row.id));
  for(const row of [mutableStay,openStay])assert.equal(afterStays.find(s=>s.id===row.id)!.radius_m,row.radius_m);
  assert.equal(afterCommutes.find(s=>s.id===mutableCommute.id)!.route_distance_m,mutableCommute.route_distance_m);
  for(const segment of result.segments){
    if(segment.kind!=="commute")continue;
    const row=afterCommutes.find(c=>c.id===result.commuteIds.get(segment.clientSegmentId))!;
    assert.equal(row.from_stay_segment_id,result.stayIds.get(segment.fromStaySegmentId));
    assert.equal(row.to_stay_segment_id,result.stayIds.get(segment.toStaySegmentId));
  }
  for(const row of [manualStay,terminalStay])assert.equal(result.stayIds.get(row.client_segment_id),row.id);
  for(const row of [manualCommute,terminalCommute])assert.equal(result.commuteIds.get(row.client_segment_id),row.id);
  const protectedIds=new Set([manualStay.id,terminalStay.id,manualCommute.id,terminalCommute.id]);
  const protectedLinks=(links:typeof oldLinks)=>links.filter(l=>protectedIds.has(l.stay_segment_id)||protectedIds.has(l.commute_segment_id));
  assert.deepEqual(protectedLinks(await lineage()),protectedLinks(oldLinks));
  assert.deepEqual((await db.query("select * from stay_segments where id=$1",[peer.id])).rows[0],peer);
  assert.deepEqual(await peerRows(),untouchedPeers);
  const repeated=await replay();assert.deepEqual(repeated.stayIds,result.stayIds);assert.deepEqual(repeated.commuteIds,result.commuteIds);
  const stripClock=(values:typeof afterStays)=>values.map(({updated_at,...value})=>value);
  for(const original of [mutableStay,openStay]) {
    const before=beforeStays.find(row=>row.id===original.id)!;
    assert.deepEqual(stripClock([afterStays.find(row=>row.id===original.id)!]),stripClock([{...before,radius_m:original.radius_m}]));
  }
  assert.deepEqual(stripClock([afterCommutes.find(row=>row.id===mutableCommute.id)!]),stripClock([{...beforeCommutes.find(row=>row.id===mutableCommute.id)!,route_distance_m:mutableCommute.route_distance_m}]));
  assert.deepEqual(stripClock(await rows("stay_segments")),stripClock(afterStays));assert.deepEqual(stripClock(await rows("commute_segments")),stripClock(afterCommutes));
  console.log("PASS: multiple/mutable/open-Review/protected stays and commutes, actual FK maps, exact protected rows/links, owner/workspace/device isolation, idempotency and segment-write rollback.");
}
