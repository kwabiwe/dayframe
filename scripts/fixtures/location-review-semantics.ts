import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { EMPTY_LOCATION_ENGINE_STATE, LOCATION_ENGINE_V2_CONFIG, runLocationEngine, type LocationSegment, type StaySegment, type CommuteSegment } from "@dayframe/shared";
import type { RequestSession } from "../../apps/web/src/lib/session";
import { withSyncTransaction } from "../../apps/web/src/lib/sync-transaction";
import { emitReviewSemanticSegments } from "../../apps/web/src/lib/location/location-review-semantic-batch";
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../../apps/web/src/lib/location/location-ingest-service";
import { reliabilityHistory, RELIABILITY_CLOCK, RELIABILITY_CUTOVER, RELIABILITY_DEVICE } from "./location-reliability";

export async function verifyReviewSemantics(db: pg.Pool, owner: () => Promise<RequestSession>) {
  const session = await owner(), other = await owner();
  const output = runLocationEngine({ priorState: EMPTY_LOCATION_ENGINE_STATE, evidence: reliabilityHistory(),
    savedPlaces: [], acceptedLearnedPlaces: [], config: LOCATION_ENGINE_V2_CONFIG, processingAt: RELIABILITY_CLOCK });
  const stay = output.segmentUpserts.find((s): s is StaySegment => s.kind === "stay")!;
  const commute = output.segmentUpserts.find((s): s is CommuteSegment => s.kind === "commute")!;
  const category = randomUUID(), place = randomUUID(), disabled = randomUUID(), learned = randomUUID(), foreignLearned = randomUUID();
  await db.query("insert into categories(id,workspace_id,name,color) values($1,$2,'Semantic test','sky')", [category,session.workspaceId]);
  await db.query(`insert into places(id,workspace_id,name,default_category_id,default_activity_description,logging_enabled)
    values($1,$2,'Saved display',$3,'  Saved activity  ',true),($4,$2,'Disabled',$3,null,false)`, [place,session.workspaceId,category,disabled]);
  for (const [id,userId] of [[learned,session.userId],[foreignLearned,other.userId]]) {
    await db.query(`insert into learned_places(id,workspace_id,user_id,place_id,cluster_key,name,latitude,longitude,first_seen_at,last_seen_at,status)
      values($1,$2,$3,$4,$1::uuid::text,'Learned display',0,0,$5,$5,'accepted')`, [id,session.workspaceId,userId,place,RELIABILITY_CLOCK]);
  }
  const makeStay = (name: string, overrides: Partial<StaySegment> = {}): StaySegment => ({ ...stay,
    clientSegmentId: name, status: "finalised", stoppedAt: new Date(Date.parse(stay.startedAt)+7_200_000).toISOString(), ...overrides });
  const segments: LocationSegment[] = [
    makeStay("saved", {placeMatchKind:"saved",placeId:place}),
    makeStay("learned", {placeMatchKind:"learned",learnedPlaceId:learned}),
    makeStay("unknown"), makeStay("short", {stoppedAt:new Date(Date.parse(stay.startedAt)+60_000).toISOString()}),
    makeStay("disabled", {placeMatchKind:"saved",placeId:disabled}),
    makeStay("unpersisted"), makeStay("accepted"), makeStay("ignored"), makeStay("confirmed"),
    makeStay("terminal-review"), makeStay("manual", {continuityStatus:"manual"}),
    makeStay("foreign-learned", {placeMatchKind:"learned",learnedPlaceId:foreignLearned}),
    ...["commute-a","commute-b"].map(clientSegmentId => ({...commute,clientSegmentId}))
  ];
  const stayIds = new Map<string,string>(), commuteIds = new Map<string,string>();
  async function persistFixtures(items: LocationSegment[]) {
    for (const segment of items) {
      if (segment.clientSegmentId === "unpersisted") continue;
      const table = segment.kind === "stay" ? "stay_segments" : "commute_segments";
      if (segment.kind === "commute") {
        const result = await db.query(`insert into commute_segments(workspace_id,user_id,device_id,client_segment_id,started_at,stopped_at,from_stay_segment_id,to_stay_segment_id,algorithm_version)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[session.workspaceId,session.userId,RELIABILITY_DEVICE,segment.clientSegmentId,segment.startedAt,segment.stoppedAt,stayIds.get("saved"),stayIds.get("unknown"),segment.algorithmVersion]);
        commuteIds.set(segment.clientSegmentId,result.rows[0].id);continue;
      }
      const result = await db.query(`insert into ${table}(workspace_id,user_id,device_id,client_segment_id,started_at,stopped_at,continuity_status)
        values($1,$2,$3,$4,$5,$6,$7) returning id`, [session.workspaceId,session.userId,RELIABILITY_DEVICE,segment.clientSegmentId,segment.startedAt,segment.stoppedAt,segment.continuityStatus]);
      (segment.kind === "stay" ? stayIds : commuteIds).set(segment.clientSegmentId,result.rows[0].id);
    }
  }
  await persistFixtures(segments);
  const queries: string[] = [];
  const tracedPool = {connect: async () => {
    const raw = await db.connect();
    return new Proxy(raw,{get(client,key){
      if(key === "query") return async (sql: string, params?: unknown[]) => { queries.push(sql); return params ? client.query(sql,params) : client.query(sql); };
      const value = Reflect.get(client,key); return typeof value === "function" ? value.bind(client) : value;
    }});
  }} as Pick<pg.Pool,"connect">;
  const emit = (items=segments) => withSyncTransaction("review_semantic_regression",async({client,phase}) => {
    phase("owner_lock");await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))",[session.workspaceId,session.userId]);
    phase("effect");return emitReviewSemanticSegments(client,session,items,stayIds,commuteIds);
  },{databasePool:tracedPool});
  const snapshot = async (scope=session) => {
    const tables = ["activity_events","review_items","stay_segments","commute_segments","time_entries","location_segment_evidence"] as const;
    return Object.fromEntries(await Promise.all(tables.map(async table => [table,(await db.query(`select * from ${table}
      where workspace_id=$1 and user_id=$2 order by id`,[scope.workspaceId,scope.userId])).rows])));
  };
  // Same client IDs in another user and another workspace must not be read or written.
  const peers = [{...other,workspaceId:session.workspaceId},{...session,workspaceId:other.workspaceId}];
  for(const peer of peers) {
    await db.query(`insert into activity_events(workspace_id,user_id,client_event_id,source,event_type,occurred_at,confidence,review_status)
      values($1,$2,'location-segment:saved','location_learning','geofence_exit',$3,'low','ignored')`,[peer.workspaceId,peer.userId,RELIABILITY_CLOCK]);
  }
  const peerBefore = await Promise.all(peers.map(snapshot));
  assert.equal(await emit(),11);
  const initial = await snapshot();
  assert.equal(initial.review_items.length,11);assert.equal(initial.time_entries.length,0);
  const eventFor = (name:string) => initial.activity_events.find(row => row.client_event_id === `location-segment:${name}`)!;
  const reviewFor = (name:string) => initial.review_items.find(row => row.event_id === eventFor(name).id)!;
  for(const name of ["saved","learned"]) {
    assert.equal(reviewFor(name).title,"Saved activity");assert.equal(reviewFor(name).suggested_category_id,category);
    assert.equal(reviewFor(name).suggested_place_id,place);assert.equal(reviewFor(name).location_segment_id,stayIds.get(name));
  }
  assert.equal(eventFor("learned").event_type,"learned_place_visit");assert.equal(eventFor("saved").event_type,"geofence_exit");
  assert.equal(reviewFor("foreign-learned").title,"Visit at an unknown place");assert.equal(reviewFor("foreign-learned").suggested_place_id,null);
  assert.equal(reviewFor("unknown").title,"Visit at an unknown place");
  for(const name of ["short","disabled","unpersisted"]) assert.equal(eventFor(name),undefined);
  for(const name of ["commute-a","commute-b"]) {
    assert.equal(reviewFor(name).title,"Commute");assert.equal(reviewFor(name).location_segment_id,commuteIds.get(name));
    assert.equal(reviewFor(name).suggested_place_id,null);
  }
  assert.equal(reviewFor("commute-a").suggested_category_id,reviewFor("commute-b").suggested_category_id);
  assert.equal(queries.filter(sql => sql.includes("hashtextextended")).length,1,"Acquire the existing Commute category lock once");
  assert(!queries.some(sql => /from time_entries/i.test(sql)),"Review-only semantics must not read overlaps");
  for(const segment of segments) {
    const event=eventFor(segment.clientSegmentId);if(!event)continue;
    const table=segment.kind === "stay" ? initial.stay_segments : initial.commute_segments;
    assert.equal(table.find(row=>row.client_segment_id === segment.clientSegmentId)!.created_from_event_id,event.id);
    assert.equal(event.raw_payload.semanticDisposition,"needs_review");
  }
  // Exact updates for existing open decisions, and exact non-updates for terminal decisions.
  await db.query("update places set default_activity_description='Changed activity' where id=$1",[place]);
  await db.query("update activity_events set confidence='hint',raw_payload='{}' where id=$1",[eventFor("saved").id]);
  await db.query("update review_items set title='stale',notes='stale',confidence='hint',type='keep-existing-type' where event_id=$1",[eventFor("saved").id]);
  for(const status of ["accepted","ignored","confirmed"]) {
    await db.query("update activity_events set review_status=$2,raw_payload='{\"terminal\":true}' where id=$1",[eventFor(status).id,status]);
    await db.query("update review_items set status=$2,title='terminal-title' where event_id=$1",[eventFor(status).id,status === "confirmed" ? "accepted" : status]);
  }
  await db.query("update review_items set status='ignored',title='terminal-review-title' where event_id=$1",[eventFor("terminal-review").id]);
  const before = await snapshot();queries.length=0;
  await emit();const after=await snapshot();
  for(const status of ["accepted","ignored","confirmed"]) {
    assert.deepEqual(after.activity_events.find(row=>row.id===eventFor(status).id),before.activity_events.find(row=>row.id===eventFor(status).id));
    assert.deepEqual(after.review_items.find(row=>row.event_id===eventFor(status).id),before.review_items.find(row=>row.event_id===eventFor(status).id));
    assert.equal(after.stay_segments.find(row=>row.id===stayIds.get(status))!.review_status,status);
  }
  assert.deepEqual(after.review_items.find(row=>row.event_id===eventFor("terminal-review").id),before.review_items.find(row=>row.event_id===eventFor("terminal-review").id));
  const refreshed = after.review_items.find(row=>row.event_id===eventFor("saved").id)!;
  assert.equal(refreshed.title,"Changed activity");assert.equal(refreshed.type,"keep-existing-type");assert.equal(refreshed.status,"open");
  assert.equal(refreshed.confidence,stay.confidence);assert.notEqual(refreshed.notes,"stale");
  assert.deepEqual(after.activity_events.find(row=>row.id===eventFor("saved").id)!.raw_payload,eventFor("saved").raw_payload);
  assert.equal(after.review_items.length,11);assert.equal(after.activity_events.length,11);assert.equal(after.time_entries.length,0);
  const manualBefore=before.stay_segments.find(row=>row.id===stayIds.get("manual"))!;
  const {updated_at: _clock,...manualAfter}=after.stay_segments.find(row=>row.id===stayIds.get("manual"))!;
  const {updated_at: _oldClock,...manualExpected}=manualBefore;assert.deepEqual(manualAfter,manualExpected);
  assert.deepEqual(await Promise.all(peers.map(snapshot)),peerBefore);
  assert.equal(queries.filter(sql=>sql.includes("hashtextextended")).length,1);
  assert.equal((await db.query("select count(*)::int n from categories where workspace_id=$1 and name='Commute'",[session.workspaceId])).rows[0].n,1);
  // A terminal source without a Review row must never recreate one.
  await db.query("delete from review_items where event_id=$1",[eventFor("confirmed").id]);
  await emit();assert(!(await snapshot()).review_items.some(row=>row.event_id===eventFor("confirmed").id));
  // Linked learned trust uses the saved logging switch; candidate display must not inherit trust.
  await db.query("update places set logging_enabled=false where id=$1",[place]);
  const suppressedBefore=await snapshot();
  assert.equal(await emit(segments.filter(row=>["saved","learned"].includes(row.clientSegmentId))),0);
  assert.deepEqual(await snapshot(),suppressedBefore);
  await db.query("update places set logging_enabled=true,default_activity_description='  ' where id=$1",[place]);
  await db.query("update learned_places set status='candidate' where id=$1",[learned]);
  await emit(segments.filter(row=>["saved","learned"].includes(row.clientSegmentId)));
  const display=await snapshot();
  assert.equal(display.review_items.find(row=>row.event_id===eventFor("saved").id)!.title,"Visit Saved display");
  const candidate=display.review_items.find(row=>row.event_id===eventFor("learned").id)!;
  assert.equal(candidate.title,"Visit Learned display");assert.equal(candidate.suggested_category_id,null);assert.equal(candidate.suggested_place_id,null);
  // Exercise an actual second chunk, including locking reads, events, Review, and links.
  const many=Array.from({length:251},(_,i)=>makeStay(`bounded-${String(i).padStart(3,"0")}`));
  await persistFixtures(many);queries.length=0;assert.equal(await emit(many),251);
  assert.equal(queries.filter(sql=>/^\s*insert into activity_events/i.test(sql)).length,2);
  assert.equal(queries.filter(sql=>sql.includes("order by client_event_id for update")).length,2);
  await emit(many);assert.equal((await snapshot()).review_items.length,261);

  // Full replay failure after semantic writes and segment links: every earlier stage rolls back.
  const victim=await owner();const history=reliabilityHistory();
  for(let offset=0;offset<history.length;offset+=100) await ingestLocationEvidence({clientBatchId:randomUUID(),deviceId:RELIABILITY_DEVICE,
    algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,timeZone:"Europe/London",rolloutMode:"v2_review",
    semanticModeAcknowledgedAt:RELIABILITY_CUTOVER,evidence:history.slice(offset,offset+100)},victim,RELIABILITY_CLOCK);
  const request={deviceId:RELIABILITY_DEVICE,algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,rolloutMode:"v2_review",semanticModeAcknowledgedAt:RELIABILITY_CUTOVER};
  for(const existing of [false,true]) {
    if(existing) await replayRetainedLocationEvidence(request,victim,RELIABILITY_CLOCK);
    const original=await snapshot(victim);let injected=false;
    const failPool={connect:async()=>{
      const raw=await db.connect();return new Proxy(raw,{get(client,key){
        if(key==="query")return async(sql:string,params?:unknown[])=>{
          const result=params?await client.query(sql,params):await client.query(sql);
          if(/^\s*update commute_segments target set created_from_event_id/i.test(sql)){injected=true;await client.query("select 1/0");}
          return result;
        };const value=Reflect.get(client,key);return typeof value==="function"?value.bind(client):value;
      }});
    }} as Pick<pg.Pool,"connect">;
    await assert.rejects(replayRetainedLocationEvidence(request,victim,RELIABILITY_CLOCK,{databasePool:failPool}));
    assert(injected);assert.deepEqual(await snapshot(victim),original);
  }
  console.log("PASS: bounded v2_review emission, refresh/terminal decisions, dwell/logging suppression, saved/learned context, category ownership, ID links, isolation, 251-row chunks and complete semantic rollback.");
}
