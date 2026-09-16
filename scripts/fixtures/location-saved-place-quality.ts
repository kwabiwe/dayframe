import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { LOCATION_ENGINE_V2_CONFIG, runLocationEngine } from "@dayframe/shared";
import { incident, place, signal } from "../../packages/shared/src/location/savedPlaceQualityFixture";
import { pool } from "../../apps/web/src/lib/db";
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../../apps/web/src/lib/location/location-ingest-service";
import { resolveIdempotentReviewMutation } from "../../apps/web/src/lib/review-mutation-service";
import type { RequestSession } from "../../apps/web/src/lib/session";

/** Synthetic historical rows, not a second copy of the old engine or a real-account replay. */
export async function validateSavedPlaceQuality() {
  const previousMode = process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  try {
    for (const disposition of ["open", "accepted", "ignored", "manual"] as const) {
      const session: RequestSession = { workspaceId: randomUUID(), userId: randomUUID(), authMode: "token", scopes: ["app:read", "app:write", "events:write"] };
      const gymId = randomUUID();
      const fixture = incident();
      fixture.savedPlaces = [{ ...place, id: gymId }];
      fixture.evidence = fixture.evidence.map(e => ({ ...e, savedPlaceId: e.savedPlaceId ? gymId : null }));
      const request = { deviceId: fixture.evidence[0].deviceId, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
        rolloutMode: "v2_review" as const, semanticModeAcknowledgedAt: "2026-09-15T00:00:00.000Z" };
      try {
        await pool.query("insert into users(id,email,name) values($1,$2,'Synthetic saved-place quality')", [session.userId, `${session.userId}@example.test`]);
        await pool.query("insert into workspaces(id,name) values($1,'Synthetic saved-place quality')", [session.workspaceId]);
        await pool.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [session.workspaceId,session.userId]);
        await pool.query("insert into places(id,workspace_id,name,latitude,longitude,radius_meters,logging_enabled) values($1,$2,$3,$4,$5,$6,true)", [gymId,session.workspaceId,place.name,place.latitude,place.longitude,place.radiusMeters]);
        await ingestLocationEvidence({ ...request, clientBatchId: randomUUID(), timeZone: "Europe/London", evidence: fixture.evidence }, session, fixture.processingAt);
        const oldIds: string[] = [], reviewIds: string[] = [];
        const windows = [["11:55:29", "11:56:09", ["visit","inside-1","exit"]], ["11:58:52", "12:05:48", ["inside-2","inside-3"]], ["12:32:26", "12:40:47", ["inside-4","inside-5"]]] as const;
        for (const [index, [start, stop, evidenceIds]] of windows.entries()) {
          const segmentId = randomUUID(), eventId = randomUUID(), reviewId = randomUUID();
          oldIds.push(segmentId); reviewIds.push(reviewId);
          const startedAt = `2026-09-15T${start}.000Z`, stoppedAt = `2026-09-15T${stop}.000Z`;
          const clientId = `historical-fragment-${index}`;
          await pool.query(`insert into stay_segments(id,workspace_id,user_id,device_id,client_segment_id,algorithm_version,status,source,place_id,started_at,stopped_at,
            start_lower_bound_at,start_upper_bound_at,stop_lower_bound_at,stop_upper_bound_at,continuity_status,confidence,metadata)
            values($1,$2,$3,$4,$5,$6,'finalised','location_v2',$7,$8,$9,$8,$8,$9,$9,'uncertain_gap','medium_high','{"placeMatchKind":"saved"}')`,
          [segmentId,session.workspaceId,session.userId,request.deviceId,clientId,request.algorithmVersion,gymId,startedAt,stoppedAt]);
          await pool.query(`insert into activity_events(id,workspace_id,user_id,client_event_id,source,event_type,occurred_at,confidence,review_status,raw_payload)
            values($1,$2,$3,$4,'location_learning','geofence_exit',$5,'medium_high','needs_review',$6::jsonb)`,
          [eventId,session.workspaceId,session.userId,`location-segment:${clientId}`,startedAt,JSON.stringify({ clientSegmentId: clientId, startedAt, stoppedAt })]);
          await pool.query("update stay_segments set created_from_event_id=$1 where id=$2", [eventId,segmentId]);
          await pool.query(`insert into review_items(id,workspace_id,user_id,event_id,location_segment_id,type,title,suggested_place_id,suggested_started_at,suggested_stopped_at,confidence,status)
            values($1,$2,$3,$4,$5,'geofence_exit_suggestion','Visit at Synthetic gym',$6,$7,$8,'medium_high','open')`,
          [reviewId,session.workspaceId,session.userId,eventId,segmentId,gymId,startedAt,stoppedAt]);
          await pool.query(`insert into location_segment_evidence(workspace_id,user_id,evidence_id,stay_segment_id,sequence_index,role)
            select workspace_id,user_id,id,$1,row_number() over(order by occurred_at)::int,'inside' from location_evidence
            where workspace_id=$2 and user_id=$3 and client_evidence_id=any($4::text[])`, [segmentId,session.workspaceId,session.userId,evidenceIds]);
        }
        if (disposition === "accepted" || disposition === "ignored") {
          await resolveIdempotentReviewMutation(reviewIds[0], { clientMutationId: randomUUID(), mutation: { action: disposition === "accepted" ? "confirm" : "ignore_once_location" } }, session);
        } else if (disposition === "manual") {
          await pool.query("update stay_segments set continuity_status='manual', place_id=null where id=$1", [oldIds[0]]);
          await pool.query("update review_items set title='Manual correction',suggested_place_id=null where id=$1", [reviewIds[0]]);
        }
        if (disposition === "accepted") {
          // Model a later user time/description correction to the accepted historical entry.
          await pool.query(`update time_entries set started_at='2026-09-15T11:55:30Z',
            stopped_at='2026-09-15T11:56:00Z',description='User-corrected historical entry'
            where workspace_id=$1 and user_id=$2`, [session.workspaceId,session.userId]);
        } else if (disposition === "manual") {
          await pool.query(`update review_items set suggested_started_at='2026-09-15T11:55:30Z',
            suggested_stopped_at='2026-09-15T11:56:00Z' where id=$1`, [reviewIds[0]]);
        }
        const snapshot = async () => {
          const tables = ["stay_segments","commute_segments","activity_events","review_items","time_entries","location_segment_evidence","review_mutation_receipts"];
          return Object.fromEntries(await Promise.all(tables.map(async table => [table,(await pool.query(`select * from ${table} where workspace_id=$1 and user_id=$2 order by id`, [session.workspaceId,session.userId])).rows])));
        };
        const replay = (options = {}) => replayRetainedLocationEvidence(request, session, fixture.processingAt, options);
        if (disposition === "open") {
          const before = await snapshot();
          const failingPool = { connect: async () => {
            const raw = await pool.connect();
            return new Proxy(raw, { get(client, key) {
              if (key === "query") return async (sql: string, parameters?: unknown[]) => {
                if (/insert into review_items/.test(sql)) throw new Error("Synthetic failure after semantic write");
                return client.query(sql, parameters);
              };
              const value = Reflect.get(client,key); return typeof value === "function" ? value.bind(client) : value;
            } });
          } } as Pick<pg.Pool,"connect">;
          await assert.rejects(replay({ databasePool: failingPool }));
          assert.deepEqual(await snapshot(), before, "Replay failure must roll back retirement, segments, semantics and lineage");
        }
        const protectedBefore = await snapshot();
        await replay(); await replay();
        const after = await snapshot();
        if (disposition === "open") {
          const reviews = after.review_items.filter(r => r.status === "open");
          assert.equal(reviews.length, 1);
          const expected = runLocationEngine(fixture).segmentUpserts.find(s => s.kind === "stay")!;
          assert.equal(new Date(reviews[0].suggested_started_at).toISOString(), expected.startedAt);
          assert.equal(new Date(reviews[0].suggested_stopped_at).toISOString(), expected.stoppedAt);
          assert.equal(reviews[0].suggested_category_id, null);
          assert.equal(after.stay_segments.filter(s => s.status !== "superseded").length, 1);
          assert.equal(after.time_entries.length, 0, "Review-only cannot emit entries");
        } else {
          assert.deepEqual(after.stay_segments.find(s => s.id === oldIds[0]), protectedBefore.stay_segments.find(s => s.id === oldIds[0]));
          assert.deepEqual(after.review_items.find(r => r.id === reviewIds[0]), protectedBefore.review_items.find(r => r.id === reviewIds[0]));
          assert.deepEqual(after.time_entries, protectedBefore.time_entries);
          assert.deepEqual(after.review_mutation_receipts, protectedBefore.review_mutation_receipts);
          assert.deepEqual(after.location_segment_evidence.filter(l => l.stay_segment_id === oldIds[0]), protectedBefore.location_segment_evidence.filter(l => l.stay_segment_id === oldIds[0]));
          assert.equal(after.stay_segments.filter(s => !oldIds.includes(s.id)).length, 0, "Changed ID must not compete with the protected decision");
          // The same long Visit may support a genuinely separate later episode.
          const outside = [signal("outside-1", "11:57:10", { latitude: 51.503, speedMetersPerSecond: 4 }), signal("outside-2", "11:57:40", { latitude: 51.504, speedMetersPerSecond: 4 })];
          await ingestLocationEvidence({ ...request, clientBatchId: randomUUID(), timeZone: "Europe/London", evidence: outside }, session, fixture.processingAt);
          await replay();
          const separate = await pool.query("select suggested_started_at from review_items where workspace_id=$1 and status='open' and not(id=any($2::uuid[]))", [session.workspaceId,reviewIds]);
          assert.equal(separate.rowCount, 1, "Shared Visit alone cannot suppress a distinct later episode");
          assert.equal(new Date(separate.rows[0].suggested_started_at).toISOString(), "2026-09-15T11:58:52.000Z");
        }
      } finally {
        await pool.query("delete from workspaces where id=$1", [session.workspaceId]);
        await pool.query("delete from users where id=$1", [session.userId]);
      }
    }
    console.log("PASS: saved-place synthetic parity, open-fragment convergence, repeat replay, terminal/manual changed-ID protection, receipts/lineage preservation, later distinct Visit reuse and atomic rollback.");
  } finally {
    if (previousMode === undefined) delete process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;
    else process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = previousMode;
  }
}
