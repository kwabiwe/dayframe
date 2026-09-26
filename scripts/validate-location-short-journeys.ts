import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runLocationEngine } from "@dayframe/shared";
import { shortAt, shortJourneysFixture } from "../packages/shared/test/fixtures/shortJourneys";
import { pool } from "../apps/web/src/lib/db";
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../apps/web/src/lib/location/location-ingest-service";
import { resolveIdempotentReviewMutation } from "../apps/web/src/lib/review-mutation-service";
import type { RequestSession } from "../apps/web/src/lib/session";

const target = new URL(process.env.DATABASE_URL ?? "invalid:");
assert(["localhost","127.0.0.1"].includes(target.hostname) && target.pathname.endsWith("_test") && !target.search,
  "Explicit disposable loopback *_test DATABASE_URL without query overrides required.");

async function scenario(saved: boolean, mode: "v2_review" | "v2_enabled" | "v2_shadow", decision?: "confirm" | "ignore_once_location" | "edit_and_confirm", cutover = shortAt(-1), trusted = false) {
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = mode;
  const input = shortJourneysFixture(saved);
  const session: RequestSession = {workspaceId:randomUUID(),userId:randomUUID(),authMode:"token",scopes:["app:read","app:write","events:write"]};
  const deviceId = randomUUID();
  const placeIds = new Map(input.savedPlaces.map(p=>[p.id,randomUUID()]));
  input.savedPlaces = input.savedPlaces.map(p=>({...p,id:placeIds.get(p.id)!,loggingEnabled:trusted}));
  input.evidence = input.evidence.map(e=>({...e,deviceId}));
  const request = {deviceId,algorithmVersion:input.config.algorithmVersion,rolloutMode:mode,semanticModeAcknowledgedAt:cutover};
  const query = (sql:string, values:unknown[] = []) => pool.query(sql, [session.workspaceId,session.userId,...values]);
  const replay = () => replayRetainedLocationEvidence(request,session,input.processingAt);
  const stored = async () => (await query(`select c.id,c.client_segment_id,c.started_at,c.stopped_at,c.created_from_event_id,
    e.id as event_id,e.review_status,e.raw_payload,r.id as review_id,r.status as review_status
    from commute_segments c left join activity_events e on e.id=c.created_from_event_id
    left join review_items r on r.event_id=e.id where c.workspace_id=$1 and c.user_id=$2 order by c.started_at`)).rows;
  try {
    await pool.query("insert into users(id,email,name) values($1,$2,'Synthetic short trips')",[session.userId,`${session.userId}@short-trip.example.test`]);
    await pool.query("insert into workspaces(id,name) values($1,'Synthetic short trips')",[session.workspaceId]);
    await query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')");
    await pool.query("insert into devices(id,user_id,platform,name) values($1,$2,'ios','Synthetic')",[deviceId,session.userId]);
    for(const p of input.savedPlaces) await pool.query(`insert into places(id,workspace_id,name,latitude,longitude,radius_meters,logging_enabled)
      values($1,$2,$3,$4,$5,$6,$7)`,[p.id,session.workspaceId,p.name,p.latitude,p.longitude,p.radiusMeters,trusted]);
    await ingestLocationEvidence({...request,clientBatchId:randomUUID(),timeZone:"UTC",evidence:input.evidence},session,input.processingAt);
    await replay();
    const commutes = runLocationEngine(input).segmentUpserts.filter(s=>s.kind==='commute');
    assert.equal(commutes.length,2);
    const rows = await stored();assert.equal(rows.length,2);
    const silent = mode==='v2_shadow' || cutover===shortAt(2_000_000);
    for(let i=0;i<2;i++) {
      const row=rows[i], expected=commutes[i];
      assert.equal(row.client_segment_id,expected.clientSegmentId);
      assert.equal(row.started_at.toISOString(),expected.startedAt);assert.equal(row.stopped_at.toISOString(),expected.stoppedAt);
      const lineage = (await query(`select le.client_evidence_id from location_segment_evidence lse
        join location_evidence le on le.id=lse.evidence_id and le.workspace_id=lse.workspace_id and le.user_id=lse.user_id
        where lse.workspace_id=$1 and lse.user_id=$2 and lse.commute_segment_id=$3 order by lse.sequence_index`,[row.id])).rows;
      assert.deepEqual(lineage.map(r=>r.client_evidence_id),expected.evidenceIds);
      if(silent) { assert.equal(row.event_id,null); assert.equal(row.review_id,null); }
      else {
        assert(row.event_id && row.review_id);assert.equal(row.review_status,'open');
        assert.equal(row.raw_payload.clientSegmentId,expected.clientSegmentId);
        assert.equal(row.raw_payload.semanticReason,mode==='v2_enabled'?'short_journey_review_only':'review_mode');
      }
    }
    assert.equal((await query("select te.* from time_entries te join activity_events e on e.id=te.created_from_event_id where te.workspace_id=$1 and te.user_id=$2 and e.event_type='commute_detected'")).rowCount,0);
    // Ten-minute unknown endpoint remains an endpoint, not a visit Review or learned place.
    assert.equal((await query('select * from learned_places where workspace_id=$1 and user_id=$2')).rowCount,0);
    assert.equal((await query("select * from activity_events where workspace_id=$1 and user_id=$2 and event_type='unknown_stay'")).rowCount,0);
    await replay(); assert.deepEqual(await stored(),rows);
    if(!silent) assert.equal((await query("select r.* from review_items r join activity_events e on e.id=r.event_id where r.workspace_id=$1 and r.user_id=$2 and e.event_type='commute_detected'")).rowCount,2);
    if(decision) {
      const envelopes=rows.map(row=>({clientMutationId:randomUUID(),mutation:decision==='edit_and_confirm'
        ? {action:decision,edit:{description:'Owner corrected synthetic trip',startedAt:row.started_at.toISOString(),stoppedAt:row.stopped_at.toISOString(),tags:[]}}
        : {action:decision}}));
      const results=[];
      for(let i=0;i<2;i++) results.push(await resolveIdempotentReviewMutation(rows[i].review_id,envelopes[i],session));
      // Existing enabled-mode event relink refreshes commute updated_at even for terminal sources.
      // Exclude only that maintenance timestamp, never decision/entry/receipt/lineage fields.
      const snapshot=async()=>Object.fromEntries(await Promise.all(['activity_events','review_items','time_entries','review_mutation_receipts','commute_segments','location_segment_evidence'].map(async table=>[table,(await query(`select ${table==='commute_segments'?"to_jsonb(t) - 'updated_at' as row":'*'} from ${table} t where workspace_id=$1 and user_id=$2 ${table==='location_segment_evidence'?'and commute_segment_id is not null':''} order by id`)).rows])));
      const before=await snapshot();
      await replay();assert.deepEqual(await snapshot(),before,'Same-identity replay altered terminal decision/entry/receipt/lineage');
      for(let i=0;i<2;i++) assert.deepEqual(await resolveIdempotentReviewMutation(rows[i].review_id,envelopes[i],session),results[i]);
      assert.deepEqual(await snapshot(),before,'Receipt retry altered protected source');
      // Deliberately new synthetic catalogue input changes endpoint/commute IDs.
      if(saved) {
        await pool.query('update places set latitude=1 where id=$1',[input.savedPlaces[1].id]);
        input.savedPlaces[1].latitude=1;
      } else {
        const p={...input.savedPlaces[0],id:randomUUID(),latitude:0.009,name:'New synthetic saved endpoint'};
        await pool.query(`insert into places(id,workspace_id,name,latitude,longitude,radius_meters,logging_enabled) values($1,$2,$3,$4,0,60,false)`,[p.id,session.workspaceId,p.name,p.latitude]);
        input.savedPlaces.push(p);
      }
      const changed=runLocationEngine(input).segmentUpserts.filter(s=>s.kind==='commute');
      assert.equal(changed.length,2);assert(changed.every(s=>!commutes.some(old=>s.clientSegmentId===old.clientSegmentId)));
      await replay();assert.deepEqual(await snapshot(),before,'Changed-ID replacement altered protected source or created competing semantics');
      assert.equal((await query('select * from time_entries where workspace_id=$1 and user_id=$2')).rowCount,decision==='ignore_once_location'?0:2);
    }
    console.log(`PASS short trips: ${mode}, ${saved?'saved/saved':'saved/unknown'}, ${decision??(silent?'silent':'stable open')}, logging=${trusted}, persisted lineage and retry verified`);
  } finally {
    await pool.query('delete from workspaces where id=$1',[session.workspaceId]);
    await pool.query('delete from users where id=$1',[session.userId]);
  }
}
async function main(){
  for(const mode of ['v2_review','v2_enabled','v2_shadow'] as const) await scenario(true,mode,undefined,shortAt(-1),true);
  for(const saved of [false,true]) {
    for(const mode of ['v2_review','v2_enabled','v2_shadow'] as const) await scenario(saved,mode);
    for(const decision of ['confirm','ignore_once_location','edit_and_confirm'] as const) await scenario(saved,'v2_enabled',decision);
    await scenario(saved,'v2_review',undefined,shortAt(2_000_000));
  }
}
main().finally(()=>pool.end()).catch(error=>{console.error(error);process.exitCode=1;});
