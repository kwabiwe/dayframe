import assert from "node:assert/strict";
import pg from "pg";
import { pool } from "../apps/web/src/lib/db";
import { processActivityEvent } from "../apps/web/src/lib/event-service";
import { syncFailureMetadata } from "../apps/web/src/lib/sync-transaction";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"), "Disposable local *_test database required.");
const workspaceId="94300000-0000-4000-8000-000000000001",userId="94300000-0000-4000-8000-000000000002";
const session={workspaceId,userId,authMode:"provider" as const,scopes:["events:write"]};
const event={source:"health_workout",type:"health_workout_import",clientEventId:"synthetic-health-bounded-1",occurredAt:"2026-09-01T12:00:00Z",
  description:"Synthetic slow Health ingestion",rawPayload:{provider:"healthkit",externalSampleId:"synthetic-workout-1",autoConfirm:true,workoutType:"walking",startedAt:"2026-09-01T12:00:00Z",stoppedAt:"2026-09-01T13:00:00Z",durationSeconds:3600}};
async function main(){
  const monitor=new pg.Client({connectionString:url.toString()});
  try{
    await monitor.connect();
    await pool.query("insert into users(id,email,name) values($1,'health-bounds@example.test','Synthetic Health bounds')",[userId]);
    await pool.query("insert into workspaces(id,name) values($1,'Synthetic Health bounds')",[workspaceId]);
    await pool.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",[workspaceId,userId]);
    await pool.query(`create function dayframe_test_slow_health_ingest() returns trigger language plpgsql as $$ begin
      if new.description='Synthetic slow Health ingestion' then perform pg_sleep(5); end if; return new; end $$`);
    await pool.query("create trigger dayframe_test_slow_health_ingest before insert on time_entries for each row execute function dayframe_test_slow_health_ingest()");
    const started=Date.now();
    // PostgreSQL 17's transaction deadline can win the race with the JS guard.
    // Both must expose the same timeout/phase contract and roll back all effects.
    await assert.rejects(processActivityEvent(event,session,{deadlineAt:Date.now()+900,cleanupReserveMs:100}),
      error=>syncFailureMetadata(error).reason==="operation_timeout" && syncFailureMetadata(error).phase==="effect");
    assert(Date.now()-started<1800,"Whole ingestion did not settle within its budget");
    await monitor.query("set statement_timeout='1500ms'");
    // A separate transaction can acquire the same user row immediately after cancellation.
    await monitor.query("begin");await monitor.query("select id from users where id=$1 for update",[userId]);await monitor.query("rollback");
    const empty=await monitor.query("select count(*)::int as n from activity_events where workspace_id=$1",[workspaceId]);assert.equal(empty.rows[0].n,0);
    await pool.query("drop trigger dayframe_test_slow_health_ingest on time_entries");
    const first=await processActivityEvent(event,session);
    const retry=await processActivityEvent(event,session);
    assert.equal(retry.eventId,first.eventId);assert.equal(retry.timeEntryId,first.timeEntryId);assert.equal(retry.duplicate,true);
    const concurrent={...event,clientEventId:"synthetic-health-bounded-2",rawPayload:{...event.rawPayload,externalSampleId:"synthetic-workout-2"}};
    const twins=await Promise.all([processActivityEvent(concurrent,session),processActivityEvent(concurrent,session)]);
    assert.equal(twins[0].eventId,twins[1].eventId);
    const counts=await pool.query("select (select count(*)::int from activity_events where workspace_id=$1) as events,(select count(*)::int from time_entries where workspace_id=$1) as entries",[workspaceId]);
    assert.deepEqual(counts.rows[0],{events:2,entries:2});
    console.log("PASS bounded Health ingestion: cancelled SQL releases ownership and rolls back all effects; same-ID and concurrent retries preserve one event/entry per intent.");
  }finally{
    await monitor.query("rollback").catch(()=>{});await monitor.end();
    await pool.query("drop trigger if exists dayframe_test_slow_health_ingest on time_entries");
    await pool.query("drop function if exists dayframe_test_slow_health_ingest()");
    await pool.query("delete from workspaces where id=$1",[workspaceId]);await pool.query("delete from users where id=$1",[userId]);await pool.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
