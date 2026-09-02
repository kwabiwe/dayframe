import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ReviewMutation } from "@dayframe/shared";
import { pool } from "../apps/web/src/lib/db";
import { resolveIdempotentReviewMutation } from "../apps/web/src/lib/review-mutation-service";
import type { RequestSession } from "../apps/web/src/lib/session";

/** Called only by the guarded disposable-local Review database validator. */
export async function validateComplexReviewMutations(session: RequestSession, categoryId: string) {
  const start = "2026-08-28T08:00:00.000Z", stop = "2026-08-28T09:00:00.000Z";
  const edit = { startedAt: start, stoppedAt: stop, categoryId, description: "Synthetic correction", tags: ["synthetic-correction"] };
  const place = await pool.query<{ id: string }>(
    `insert into places (workspace_id, name, latitude, longitude, radius_meters)
     values ($1, 'Synthetic existing place', 51.5, -0.1, 80) returning id`, [session.workspaceId]
  );
  const placeId = place.rows[0].id;
  async function source(stream: string, at = start, until = stop) {
    const event = await pool.query<{ id: string }>(
      `insert into activity_events (workspace_id,user_id,source,event_type,occurred_at,confidence,raw_payload,review_status)
       values ($1,$2,'location_learning','unknown_stay',$3,'medium_high','{}','needs_review') returning id`,
      [session.workspaceId, session.userId, at]
    );
    const segment = await pool.query<{ id: string }>(
      `insert into stay_segments (workspace_id,user_id,device_id,client_segment_id,algorithm_version,status,source,
       started_at,stopped_at,centre,radius_m,confidence,continuity_status,created_from_event_id)
       values ($1,$2,$3,$4,'location-v2.0','finalised','location_v2',$5,$6,ST_SetSRID(ST_MakePoint(-0.1,51.5),4326)::geography,80,'medium_high','continuous',$7) returning id`,
      [session.workspaceId, session.userId, stream, randomUUID(), at, until, event.rows[0].id]
    );
    const review = await pool.query<{ id: string }>(
      `insert into review_items (workspace_id,user_id,event_id,location_segment_id,type,title,suggested_category_id,
       suggested_started_at,suggested_stopped_at,confidence,status)
       values ($1,$2,$3,$4,'location','Synthetic visit',$5,$6,$7,'medium_high','open') returning id`,
      [session.workspaceId, session.userId, event.rows[0].id, segment.rows[0].id, categoryId, at, until]
    );
    return review.rows[0].id;
  }
  async function counts() {
    const result: Record<string, number> = {};
    for (const table of ['activity_events','review_items','time_entries','stay_segments','commute_segments','location_segment_evidence','place_match_feedback','audit_log','review_mutation_receipts']) {
      const rows = await pool.query<{ n: number }>(`select count(*)::int as n from ${table} where workspace_id=$1 and user_id=$2`, [session.workspaceId,session.userId]);
      result[table] = rows.rows[0].n;
    }
    result.places = (await pool.query<{ n: number }>('select count(*)::int as n from places where workspace_id=$1',[session.workspaceId])).rows[0].n;
    result.tags = (await pool.query<{ n: number }>('select count(*)::int as n from tags where workspace_id=$1',[session.workspaceId])).rows[0].n;
    result.tagLinks = (await pool.query<{ n: number }>('select count(*)::int as n from time_entry_tags where workspace_id=$1',[session.workspaceId])).rows[0].n;
    return result;
  }
  const actions: ReviewMutation[] = [
    { action: 'confirm' }, { action: 'ignore_once_location' }, { action: 'edit_and_confirm', edit },
    { action: 'change_place_and_confirm', placeId, edit }, { action: 'record_once', edit },
    { action: 'record_poi_once', name: 'Synthetic one-time POI', edit },
    { action: 'save_place_and_confirm', name: 'Synthetic saved POI', latitude:51.5,longitude:-0.1,radiusMeters:80,edit },
    { action: 'split', splitAt:'2026-08-28T08:30:00.000Z' },
    { action: 'split_and_confirm', splitAt:'2026-08-28T08:30:00.000Z', left:{ categoryId }, right:{ categoryId } },
    { action:'merge', adjacentReviewItemId:randomUUID(), acknowledgeContradictoryEvidence:false },
    { action:'merge_and_confirm', adjacentReviewItemId:randomUUID(), acknowledgeContradictoryEvidence:false }
  ];
  for (const mutation of actions) {
    const stream = randomUUID(), id = await source(stream);
    if (mutation.action === 'merge' || mutation.action === 'merge_and_confirm') mutation.adjacentReviewItemId = await source(stream, stop, '2026-08-28T10:00:00.000Z');
    const envelope = { clientMutationId:randomUUID(), mutation };
    const first = await resolveIdempotentReviewMutation(id,envelope,session);
    const after = await counts();
    assert.deepEqual(await resolveIdempotentReviewMutation(id,envelope,session),first,`${mutation.action} lost-response replay changed IDs/results`);
    assert.deepEqual(await counts(),after,`${mutation.action} replay duplicated side effects`);
    await assert.rejects(()=>resolveIdempotentReviewMutation(id,{...envelope,mutation:{action:mutation.action === 'ignore_once_location' ? 'confirm' : 'ignore_once_location'}},session), (error:unknown)=>Boolean(error && typeof error==='object' && 'code' in error && error.code==='mutation_id_conflict'));
    assert.deepEqual(await counts(),after,'Changed payload wrote side effects');
    if (['change_place_and_confirm','save_place_and_confirm','split','split_and_confirm','merge','merge_and_confirm','record_once'].includes(mutation.action)) {
      await assert.rejects(()=>resolveIdempotentReviewMutation(id,{...envelope,clientMutationId:randomUUID()},session), (error:unknown)=>Boolean(error && typeof error==='object' && 'code' in error && error.code==='resolution_conflict'));
      assert.deepEqual(await counts(),after,'Unproven equivalence wrote side effects');
    }
  }
  const failureId=await source(randomUUID());
  const before=await counts();
  const failure={clientMutationId:randomUUID(),mutation:{action:'save_place_and_confirm',name:'Synthetic must rollback',latitude:51.5,longitude:-0.1,radiusMeters:80,edit:{categoryId:randomUUID()}}};
  await assert.rejects(()=>resolveIdempotentReviewMutation(failureId,failure,session));
  assert.deepEqual(await counts(),before,'Failed place correction left side effects/receipt');
  console.log('Complex Review: all 11 actions, exact receipt replay, payload identity, unproven equivalence and save-place rollback passed.');
}
