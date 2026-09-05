import assert from "node:assert/strict";
import pg from "pg";
import { pool } from "../apps/web/src/lib/db";
import { reprocessHealthReviewItems } from "../apps/web/src/lib/event-service";
const url=new URL(process.env.DATABASE_URL ?? "");
assert(["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname.endsWith("_test"),"Disposable local *_test database required.");
const workspace="94000000-0000-4000-8000-000000000001", user="94000000-0000-4000-8000-000000000002";
const id=(n:number)=>`94100000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function main(){
 const monitor=new pg.Client({connectionString:url.toString()});
 try {
  await monitor.connect();
  await pool.query("insert into users(id,email,name) values($1,'sync-units@example.test','Synthetic sync units')",[user]);
  await pool.query("insert into workspaces(id,name) values($1,'Synthetic sync units')",[workspace]);
  await pool.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",[workspace,user]);
  for(let n=1;n<=30;n++){
   await pool.query(`insert into activity_events(id,workspace_id,user_id,source,event_type,occurred_at,confidence,raw_payload,review_status)
     values($1,$2,$3,'health_workout','health_workout_import','2026-09-01T12:00:00Z','high',$4::jsonb,'needs_review')`,
     [id(100+n),workspace,user,JSON.stringify({workoutType:"walking",startedAt:"2026-09-01T12:00:00Z",stoppedAt:"2026-09-01T13:00:00Z",durationSeconds:3600})]);
   await pool.query(`insert into review_items(id,workspace_id,user_id,event_id,type,title,suggested_started_at,suggested_stopped_at,confidence,status)
     values($1,$2,$3,$4,'health',$5,'2026-09-01T12:00:00Z','2026-09-01T13:00:00Z','high','open')`,[id(n),workspace,user,id(100+n),n===1?"Synthetic slow unit":"Synthetic walk"]);
  }
  await pool.query("update review_items set created_at=\'2026-09-01\'::timestamptz - (right(id::text, 12)::int * interval \'1 second\') where workspace_id=$1",[workspace]);
  await pool.query(`create function dayframe_test_slow_health_unit() returns trigger language plpgsql as $$ begin
    if new.description='Synthetic slow unit' then perform pg_sleep(4); end if; return new; end $$`);
  await pool.query(`create trigger dayframe_test_slow_health_unit before insert on time_entries for each row execute function dayframe_test_slow_health_unit()`);
  const run=reprocessHealthReviewItems({limit:25,preferences:{sleep:false}}, {workspaceId:workspace,userId:user,authMode:"provider",scopes:["app:write"]});
  // Prove the first unit is inside its SQL effect before probing a later row.
  let sleeping=false;const deadline=Date.now()+2000;
  while(Date.now()<deadline){
   const r=await monitor.query("select 1 from pg_stat_activity where application_name='dayframe.sync.health_reprocess_unit' and wait_event='PgSleep'");
   if(r.rows.length){sleeping=true;break;}await new Promise(r=>setTimeout(r,10));
  }
  assert(sleeping,"Did not observe the controlled first-unit effect");
  await monitor.query("begin");
  await monitor.query("select id from review_items where id=$1 for update nowait",[id(25)]);
  await monitor.query("rollback");
  const first=await run;
  assert.equal(first.confirmedCount,24);assert.equal(first.failedCount,1);assert.equal(first.hasMore,true);assert.equal(first.nextCursor,id(25));
  const next=await reprocessHealthReviewItems({limit:25,cursor:first.nextCursor,preferences:{sleep:false}}, {workspaceId:workspace,userId:user,authMode:"provider",scopes:["app:write"]});
  assert.equal(next.confirmedCount,5);assert.equal(next.remaining,1);assert.equal(next.stopReason,"end_of_scan");
  const count=await pool.query("select count(*)::int as count from time_entries where workspace_id=$1 and user_id=$2",[workspace,user]);assert.equal(count.rows[0].count,29);
  console.log("PASS real Health SQL failure: later candidate row remains unlocked; 24 independent commits progress; cursor reaches final five; failed intent remains open");
 }finally{
  await monitor.query("rollback").catch(()=>{});await monitor.end();
  await pool.query("drop trigger if exists dayframe_test_slow_health_unit on time_entries");
  await pool.query("drop function if exists dayframe_test_slow_health_unit()");
  await pool.query("delete from workspaces where id=$1",[workspace]);await pool.query("delete from users where id=$1",[user]);await pool.end();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
