import assert from "node:assert/strict";
import { pool } from "../apps/web/src/lib/db";
import {
  processActivityEvent,
  resolveReviewItem,
} from "../apps/web/src/lib/event-service";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.endsWith("_test"),
  "Disposable local *_test database required.",
);
const workspaceId = "94400000-0000-4000-8000-000000000001",
  userId = "94400000-0000-4000-8000-000000000002";
const session = {
  workspaceId,
  userId,
  authMode: "provider" as const,
  scopes: ["app:write", "events:write"],
};
function workout(sampleId: string, revision: number, autoConfirm = true) {
  return {
    source: "health_workout",
    type: "health_workout_import",
    clientEventId: `synthetic-health:${sampleId}:${revision}`,
    occurredAt: "2026-09-01T12:00:00Z",
    description: "Synthetic walk",
    rawPayload: {
      provider: "healthkit",
      workoutType: "walking",
      externalSampleId: sampleId,
      sourceSampleIds: [sampleId],
      autoConfirm,
      startedAt: "2026-09-01T12:00:00Z",
      stoppedAt: "2026-09-01T13:00:00Z",
      durationSeconds: 3600,
    },
  };
}
async function entries() {
  return (
    await pool.query(
      "select id,description,user_edited_at from time_entries where workspace_id=$1 order by id",
      [workspaceId],
    )
  ).rows;
}
async function main() {
  try {
    const column = await pool.query(
      "select 1 from information_schema.columns where table_name='activity_events' and column_name='resolved_time_entry_id'",
    );
    assert(
      column.rowCount,
      "Apply server PR188's additive provenance migration to this disposable database first.",
    );
    await pool.query(
      "insert into users(id,email,name) values($1,'health-source@example.test','Synthetic source decisions')",
      [userId],
    );
    await pool.query(
      "insert into workspaces(id,name) values($1,'Synthetic source decisions')",
      [workspaceId],
    );
    await pool.query(
      "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
      [workspaceId, userId],
    );
    const original = await processActivityEvent(
      workout("native-workout", 1),
      session,
    );
    const entry = (await entries())[0];
    assert(entry);
    await pool.query(
      "update time_entries set description='Later user edit',user_edited_at=now() where id=$1",
      [entry.id],
    );
    const edited = await entries();
    const revision = await processActivityEvent(
      workout("native-workout", 2),
      session,
    );
    assert.equal(
      (await entries()).length,
      1,
      "A source revision must not create a second workout entry",
    );
    assert.equal(revision.timeEntryId, entry.id);
    assert.deepEqual(await entries(), edited);
    const retry = await processActivityEvent(
      workout("native-workout", 2),
      session,
    );
    assert.equal(retry.eventId, revision.eventId);
    assert.equal(retry.timeEntryId, entry.id);
    // The old source event remains the entry's original provenance.
    const provenance = await pool.query(
      "select created_from_event_id from time_entries where id=$1",
      [entry.id],
    );
    assert.equal(provenance.rows[0].created_from_event_id, original.eventId);
    await pool.query("delete from time_entries where id=$1", [entry.id]);
    const unavailable = await processActivityEvent(
      workout("native-workout", 3),
      session,
    );
    assert.equal(
      unavailable.processingDisposition,
      "prior_resolution_unavailable",
    );
    assert.equal((await entries()).length, 0);
    const unavailableRetry = await processActivityEvent(
      workout("native-workout", 3),
      session,
    );
    assert.equal(
      unavailableRetry.processingDisposition,
      "prior_resolution_unavailable",
    );

    const pending = await processActivityEvent(
      workout("ignored-source", 1, false),
      session,
    );
    const review = await pool.query(
      "select id from review_items where event_id=$1",
      [pending.eventId],
    );
    assert(review.rows[0]);
    await resolveReviewItem(review.rows[0].id, "ignore_once", session);
    const ignored = await processActivityEvent(
      workout("ignored-source", 2),
      session,
    );
    assert.equal(ignored.processingDisposition, "prior_ignore_preserved");
    assert.equal((await entries()).length, 0);
    const open = await pool.query(
      "select count(*)::int as n from review_items where workspace_id=$1 and status='open'",
      [workspaceId],
    );
    assert.equal(open.rows[0].n, 0);

    // Three separate arriving phases must all retain canonical provenance.
    const sleep = (phase: number) => ({
      source:"health_sleep",type:"health_sleep_import",clientEventId:`synthetic-sleep-phase:${phase}`,
      occurredAt:"2026-09-02T00:00:00Z",description:"Sleep",
      rawPayload:{provider:"healthkit",sleepStage:"asleep_unspecified",sourceName:"Synthetic Watch",sourceBundleIdentifier:"test.watch",
        externalSampleId:`synthetic-sleep-revision-${phase}`,sourceSampleIds:Array.from({length:phase},(_,n)=>`sleep-${n+1}`),
        startedAt:"2026-09-02T00:00:00Z",stoppedAt:`2026-09-02T0${phase+4}:00:00Z`,durationSeconds:(phase+4)*3600,autoConfirm:true,
        samples:Array.from({length:phase},(_,n)=>({externalSampleId:`sleep-${n+1}`,sleepStage:"asleep_core",startedAt:"2026-09-02T00:00:00Z",stoppedAt:`2026-09-02T0${n+5}:00:00Z`}))}
    });
    const phases=[];
    for(let phase=1;phase<=3;phase++) phases.push(await processActivityEvent(sleep(phase),session));
    const sleepEntry=(await entries())[0];assert(sleepEntry);
    for (const result of phases.slice(1)) assert.equal(result.timeEntryId,sleepEntry.id,"Every revision, including the third phase, resolves to the same entry");
    const links=await pool.query("select resolved_time_entry_id from activity_events where id=any($1::uuid[]) order by client_event_id",[phases.slice(1).map(result=>result.eventId)]);
    assert(links.rows.every(row=>row.resolved_time_entry_id===phases[0].timeEntryId),"Every later phase has a durable resolution link");
    const finalSleep=await pool.query("select stopped_at from time_entries where id=$1",[phases[0].timeEntryId]);
    assert.equal(finalSleep.rows[0].stopped_at.toISOString(),"2026-09-02T07:00:00.000Z");
    const repeatedPhase=await processActivityEvent(sleep(3),session);
    assert.equal(repeatedPhase.eventId,phases[2].eventId);assert.equal(repeatedPhase.timeEntryId,phases[0].timeEntryId);
    console.log(
      "PASS Health repair source decisions: source IDs retain a later edit and original provenance, unavailable entries are not recreated, ignored samples create no replacement entry or Review card, same-ID receipts preserve the outcome.",
    );
  } finally {
    await pool.query("delete from workspaces where id=$1", [workspaceId]);
    await pool.query("delete from users where id=$1", [userId]);
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
