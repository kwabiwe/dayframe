import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runLocationEngine } from "@dayframe/shared";
import { unknownVisitArrivalFixture } from "../packages/shared/test/fixtures/unknownVisitArrival";
import { pool } from "../apps/web/src/lib/db";
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../apps/web/src/lib/location/location-ingest-service";
import { resolveLocationReviewAction } from "../apps/web/src/lib/location/location-review-service";
import type { RequestSession } from "../apps/web/src/lib/session";

const target = new URL(process.env.DATABASE_URL ?? "invalid:");
assert(["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname.endsWith("_test") && !target.search,
  "An explicit disposable loopback *_test DATABASE_URL is required.");
process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";

const processingAt = "2026-09-27T12:00:00.000Z";
const acknowledgedAt = "2026-09-27T09:00:00.000Z";

async function scenario(completedFirst: boolean) {
  const fixture = unknownVisitArrivalFixture();
  const session: RequestSession = {
    workspaceId: randomUUID(), userId: randomUUID(), authMode: "token",
    scopes: ["app:read", "app:write", "events:write"]
  };
  const deviceId = randomUUID();
  fixture.evidence = fixture.evidence.map((evidence) => ({ ...evidence, deviceId }));
  const request = {
    deviceId,
    algorithmVersion: fixture.config.algorithmVersion,
    rolloutMode: "v2_review" as const,
    semanticModeAcknowledgedAt: acknowledgedAt
  };
  const owned = (sql: string, values: unknown[] = []) =>
    pool.query(sql, [session.workspaceId, session.userId, ...values]);
  const replay = () => replayRetainedLocationEvidence(request, session, processingAt);
  const ingest = (evidence: typeof fixture.evidence) => ingestLocationEvidence({
    ...request,
    clientBatchId: randomUUID(),
    timeZone: "Europe/London",
    evidence
  }, session, processingAt);
  try {
    await pool.query("insert into users(id,email,name) values($1,$2,'Synthetic visit')",
      [session.userId, `${session.userId}@visit.example.test`]);
    await pool.query("insert into workspaces(id,name) values($1,'Synthetic visit')", [session.workspaceId]);
    await owned("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')");
    await pool.query("insert into devices(id,user_id,platform,name) values($1,$2,'ios','Synthetic')",
      [deviceId, session.userId]);
    const place = fixture.savedPlaces[0];
    await pool.query(`insert into places(id,workspace_id,name,latitude,longitude,radius_meters,logging_enabled)
      values($1,$2,$3,$4,$5,$6,false)`,
    [place.id, session.workspaceId, place.name, place.latitude, place.longitude, place.radiusMeters]);

    const separate = completedFirst ? "visit-arrival" : "visit-completed";
    await ingest(fixture.evidence.filter((item) => item.clientEvidenceId !== separate));
    await replay();
    await ingest(fixture.evidence.filter((item) => item.clientEvidenceId === separate));
    await replay();

    const local = runLocationEngine(fixture);
    const expected = local.segmentUpserts.find((segment) => segment.kind === "stay" &&
      segment.evidenceIds.includes("visit-completed"))!;
    assert.equal(expected.kind, "stay");
    const stay = (await owned(`select id, client_segment_id, started_at, stopped_at,
      start_lower_bound_at, start_upper_bound_at, stop_lower_bound_at, stop_upper_bound_at
      from stay_segments where workspace_id=$1 and user_id=$2 and client_segment_id=$3`,
    [expected.clientSegmentId])).rows[0];
    assert(stay, "Unknown Visit stay was not persisted.");
    assert.equal(stay.started_at.toISOString(), expected.startedAt);
    assert.equal(stay.stopped_at.toISOString(), expected.stoppedAt);
    assert.equal(stay.start_lower_bound_at.toISOString(), expected.startLowerBoundAt);
    assert.equal(stay.start_upper_bound_at.toISOString(), expected.startUpperBoundAt);
    assert.equal(stay.stop_lower_bound_at.toISOString(), expected.stopLowerBoundAt);
    assert.equal(stay.stop_upper_bound_at.toISOString(), expected.stopUpperBoundAt);
    const inbound = (await owned(`select to_stay_segment_id, stopped_at,
      stop_lower_bound_at, stop_upper_bound_at, client_segment_id
      from commute_segments where workspace_id=$1 and user_id=$2 and to_stay_segment_id=$3`,
    [stay.id])).rows[0];
    assert(inbound, "Inbound commute lost its destination link.");
    assert.equal(inbound.stopped_at.toISOString(), expected.startedAt);
    assert.equal(inbound.stop_lower_bound_at.toISOString(), expected.startLowerBoundAt);
    assert.equal(inbound.stop_upper_bound_at.toISOString(), expected.startUpperBoundAt);
    const route = (await owned(`select le.client_evidence_id from location_segment_evidence lse
      join location_evidence le on le.id=lse.evidence_id and le.workspace_id=lse.workspace_id
        and le.user_id=lse.user_id
      where lse.workspace_id=$1 and lse.user_id=$2 and lse.commute_segment_id=
        (select id from commute_segments where workspace_id=$1 and user_id=$2 and client_segment_id=$3)
      order by lse.sequence_index`, [inbound.client_segment_id])).rows;
    assert.deepEqual(route.map((row) => row.client_evidence_id),
      ["route-1", "route-2", "route-last-moving"]);
    const review = (await owned(`select ri.id, ri.status, ri.event_id from review_items ri
      where ri.workspace_id=$1 and ri.user_id=$2 and ri.location_segment_id=$3`, [stay.id])).rows[0];
    assert.equal(review?.status, "open", "The estimated 23-minute unknown Visit must remain in Review.");
    assert.equal((await owned("select 1 from time_entries where workspace_id=$1 and user_id=$2")).rowCount, 0);

    const snapshot = async () => ({
      rows: Object.fromEntries(await Promise.all([
        "stay_segments", "commute_segments", "activity_events", "review_items"
      ].map(async (table) => [table, (await owned(`select to_jsonb(t) - 'updated_at' as row from ${table} t
        where workspace_id=$1 and user_id=$2 order by id`)).rows.map((row) => row.row)]))),
      lineage: (await owned(`select coalesce(st.client_segment_id, cs.client_segment_id) as segment,
        le.client_evidence_id as evidence, lse.role, lse.sequence_index
        from location_segment_evidence lse
        join location_evidence le on le.id=lse.evidence_id
        left join stay_segments st on st.id=lse.stay_segment_id
        left join commute_segments cs on cs.id=lse.commute_segment_id
        where lse.workspace_id=$1 and lse.user_id=$2
        order by segment, lse.sequence_index, evidence`)).rows
    });
    const before = await snapshot();
    await replay();
    assert.deepEqual(await snapshot(), before, "Identical retained replay changed persisted output.");

    if (!completedFirst) {
      // Fault injection for a same-ID candidate whose retained source interval is
      // corrected below Review eligibility. This is not a second ingest path.
      await owned(`update location_evidence set ended_at='2026-09-27T10:45:00.000Z'
        where workspace_id=$1 and user_id=$2 and client_evidence_id='visit-completed'`);
      const faultName = `dayframe_visit_fault_${randomUUID().replaceAll("-", "")}`;
      await pool.query(`create function ${faultName}() returns trigger language plpgsql as $$
        begin raise exception 'synthetic replay rollback'; end $$`);
      await pool.query(`create trigger ${faultName} before update on review_items
        for each row when (new.id = '${review.id}'::uuid and new.status = 'ignored')
        execute function ${faultName}()`);
      try {
        await assert.rejects(replay(), /synthetic replay rollback/);
        const rolledBack = (await owned(`select st.stopped_at, ri.status from stay_segments st
          join review_items ri on ri.location_segment_id=st.id
          where st.workspace_id=$1 and st.user_id=$2 and st.id=$3`, [stay.id])).rows[0];
        assert.equal(rolledBack.stopped_at.toISOString(), expected.stoppedAt);
        assert.equal(rolledBack.status, "open");
      } finally {
        await pool.query(`drop trigger ${faultName} on review_items`);
        await pool.query(`drop function ${faultName}()`);
      }
      await replay();
      const retired = (await owned(`select status from review_items
        where workspace_id=$1 and user_id=$2 and id=$3`, [review.id])).rows[0];
      assert.equal(retired?.status, "ignored", "An obsolete same-ID open Review was left actionable.");
      const retiredSnapshot = await snapshot();
      await replay();
      assert.deepEqual(await snapshot(), retiredSnapshot,
        "Repeated replay changed the retired proposal or corrected lineage.");
      assert.equal((await owned("select 1 from time_entries where workspace_id=$1 and user_id=$2")).rowCount, 0);
    }
    console.log(`PASS unknown Visit retained replay (${completedFirst ? "completed first" : "arrival first"})`);
  } finally {
    await pool.query("delete from workspaces where id=$1", [session.workspaceId]);
    await pool.query("delete from users where id=$1", [session.userId]);
  }
}

async function protectedVisitOnly(decision: "confirm" | "ignore_once_location" | "edit_and_confirm") {
  const fixture = unknownVisitArrivalFixture();
  const session: RequestSession = {
    workspaceId: randomUUID(), userId: randomUUID(), authMode: "token",
    scopes: ["app:read", "app:write", "events:write"]
  };
  const deviceId = randomUUID();
  fixture.evidence = fixture.evidence.filter((item) =>
    item.clientEvidenceId !== "visit-arrival" && item.clientEvidenceId !== "later-slow"
  ).map((evidence) => ({ ...evidence, deviceId }));
  const request = {
    deviceId,
    algorithmVersion: fixture.config.algorithmVersion,
    rolloutMode: "v2_review" as const,
    semanticModeAcknowledgedAt: acknowledgedAt
  };
  const owned = (sql: string, values: unknown[] = []) =>
    pool.query(sql, [session.workspaceId, session.userId, ...values]);
  try {
    await pool.query("insert into users(id,email,name) values($1,$2,'Synthetic visit protection')",
      [session.userId, `${session.userId}@visit.example.test`]);
    await pool.query("insert into workspaces(id,name) values($1,'Synthetic visit protection')", [session.workspaceId]);
    await owned("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')");
    await pool.query("insert into devices(id,user_id,platform,name) values($1,$2,'ios','Synthetic')",
      [deviceId, session.userId]);
    const place = fixture.savedPlaces[0];
    await pool.query(`insert into places(id,workspace_id,name,latitude,longitude,radius_meters,logging_enabled)
      values($1,$2,$3,$4,$5,$6,false)`,
    [place.id, session.workspaceId, place.name, place.latitude, place.longitude, place.radiusMeters]);
    await ingestLocationEvidence({
      ...request, clientBatchId: randomUUID(), timeZone: "Europe/London", evidence: fixture.evidence
    }, session, processingAt);
    await replayRetainedLocationEvidence(request, session, processingAt);
    const visitOnly = runLocationEngine(fixture).segmentUpserts.find((segment) =>
      segment.kind === "stay" && segment.evidenceIds.includes("visit-completed"))!;
    assert.deepEqual(visitOnly.evidenceIds, ["visit-completed"]);
    const protectedRow = (await owned(`select id, client_segment_id, started_at, stopped_at,
      start_lower_bound_at, start_upper_bound_at, continuity_status, created_from_event_id
      from stay_segments where workspace_id=$1 and user_id=$2 and client_segment_id=$3`,
    [visitOnly.clientSegmentId])).rows[0];
    const review = (await owned(`select id, event_id from review_items
      where workspace_id=$1 and user_id=$2 and location_segment_id=$3 and status='open'`,
    [protectedRow.id])).rows[0];
    assert(review);
    const action = decision === "edit_and_confirm"
      ? { action: decision, edit: { description: "Manual visit correction" } }
      : { action: decision };
    await resolveLocationReviewAction(review.id, action, session);
    const protectedSnapshot = async () => ({
      stay: (await owned(`select id, client_segment_id, started_at, stopped_at,
        start_lower_bound_at, start_upper_bound_at, continuity_status, created_from_event_id
        from stay_segments where workspace_id=$1 and user_id=$2 and id=$3`, [protectedRow.id])).rows[0],
      review: (await owned("select * from review_items where workspace_id=$1 and user_id=$2 and id=$3",
        [review.id])).rows[0],
      event: (await owned("select * from activity_events where workspace_id=$1 and user_id=$2 and id=$3",
        [review.event_id])).rows[0],
      entries: (await owned("select * from time_entries where workspace_id=$1 and user_id=$2 order by id")).rows,
      lineage: (await owned(`select le.client_evidence_id, lse.role, lse.sequence_index
        from location_segment_evidence lse join location_evidence le on le.id=lse.evidence_id
        where lse.workspace_id=$1 and lse.user_id=$2 and lse.stay_segment_id=$3
        order by lse.sequence_index`, [protectedRow.id])).rows
    });
    const before = await protectedSnapshot();
    assert.deepEqual(before.lineage.map((row) => row.client_evidence_id), ["visit-completed"]);
    const arrivalOnly = unknownVisitArrivalFixture().evidence.find((item) =>
      item.clientEvidenceId === "visit-arrival")!;
    await ingestLocationEvidence({
      ...request, clientBatchId: randomUUID(), timeZone: "Europe/London",
      evidence: [{ ...arrivalOnly, deviceId }]
    }, session, processingAt);
    await replayRetainedLocationEvidence(request, session, processingAt);
    assert.deepEqual(await protectedSnapshot(), before, "A changed-ID Visit replacement rewrote protected history.");
    assert.equal((await owned(`select 1 from review_items ri join stay_segments st on st.id=ri.location_segment_id
      where ri.workspace_id=$1 and ri.user_id=$2 and st.device_id=$3 and st.client_segment_id<>$4`,
    [deviceId, visitOnly.clientSegmentId])).rowCount, 0,
    "Visit-only protected lineage gained a competing Review.");
    assert.equal(before.entries.length, decision === "ignore_once_location" ? 0 : 1);
    console.log(`PASS Visit-only protected ${decision}`);
  } finally {
    await pool.query("delete from workspaces where id=$1", [session.workspaceId]);
    await pool.query("delete from users where id=$1", [session.userId]);
  }
}

async function main() {
  try {
    await scenario(false);
    await scenario(true);
    for (const decision of ["confirm", "ignore_once_location", "edit_and_confirm"] as const) {
      await protectedVisitOnly(decision);
    }
  } finally {
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
