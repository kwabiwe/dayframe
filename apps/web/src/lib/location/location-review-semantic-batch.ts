import type pg from "pg";
import {
  AUTOMATIC_LOCATION_POLICY_VERSION, LOCATION_ENGINE_V2_CONFIG, assessAutomaticOverlap,
  type LocationSegment, type StaySegment
} from "@dayframe/shared";
import type { RequestSession } from "../session";
import { ensureCommuteCategoryId } from "../automatic-category-service";
import { locationSemanticDisposition } from "./location-semantic-policy";

// Bounded row sets, including reads. All work uses the caller's owner-locked transaction.
const SEMANTIC_CHUNK_SIZE = 250;
function* chunks<T>(rows: T[]) {
  for (let offset = 0; offset < rows.length; offset += SEMANTIC_CHUNK_SIZE) {
    yield rows.slice(offset, offset + SEMANTIC_CHUNK_SIZE);
  }
}
type Place = {
  id: string; name: string; categoryId: string | null;
  description: string | null; loggingEnabled: boolean;
};
type LearnedPlace = { id: string; name: string; saved: Place | null };

async function displayContext(client: pg.PoolClient, session: RequestSession, segments: LocationSegment[]) {
  const stays = segments.filter((segment): segment is StaySegment => segment.kind === "stay");
  const places = new Map<string, Place>();
  const learned = new Map<string, LearnedPlace>();
  const placeIds = [...new Set(stays.flatMap(s => s.placeId ? [s.placeId] : []))].sort();
  const learnedIds = [...new Set(stays.flatMap(s => s.learnedPlaceId ? [s.learnedPlaceId] : []))].sort();
  // Saved places belong to a workspace; learned places additionally belong to a user.
  for (const ids of chunks(placeIds)) {
    const result = await client.query<Place>(`select id, name, default_category_id as "categoryId",
      default_activity_description as description, logging_enabled as "loggingEnabled"
      from places where workspace_id = $1 and id = any($2::uuid[])`, [session.workspaceId, ids]);
    for (const row of result.rows) places.set(row.id, row);
  }
  for (const ids of chunks(learnedIds)) {
    const result = await client.query<LearnedPlace>(`select lp.id, lp.name,
      case when p.id is null then null else jsonb_build_object('id',p.id,'name',coalesce(p.name,lp.name),
        'categoryId',p.default_category_id,'description',p.default_activity_description,
        'loggingEnabled',p.logging_enabled) end as saved
      from learned_places lp left join places p on p.id = lp.place_id and p.workspace_id = lp.workspace_id
        and lp.status = 'accepted'
      where lp.workspace_id = $1 and lp.user_id = $2 and lp.id = any($3::uuid[])`,
    [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) learned.set(row.id, row);
  }
  return (segment: LocationSegment) => {
    if (segment.kind === "commute") return { trusted: null, title: "Commute" };
    const trusted = segment.placeMatchKind === "saved" && segment.placeId
      ? places.get(segment.placeId) ?? null
      : segment.placeMatchKind === "learned" && segment.learnedPlaceId
        ? learned.get(segment.learnedPlaceId)?.saved ?? null : null;
    const learnedName = segment.learnedPlaceId ? learned.get(segment.learnedPlaceId) : null;
    const saved = segment.placeId ? places.get(segment.placeId) : null;
    const title = trusted ? trusted.description?.trim() || `Visit ${trusted.name}`
      : learnedName ? `Visit ${learnedName.name}`
        : !segment.placeId ? segment.placeMatchKind === "ambiguous" ? "Visit near saved places" : "Visit at an unknown place"
          : saved ? `Visit ${saved.name}` : "Visit at a saved place";
    return { trusted, title };
  };
}

/** Dedicated review-only persistence. The v2_enabled automatic emitter remains separate. */
export async function emitReviewSemanticSegments(
  client: pg.PoolClient, session: RequestSession, segments: LocationSegment[],
  stayIds: Map<string, string>, commuteIds: Map<string, string>
): Promise<number> {
  const candidates = segments.flatMap(segment => {
    const segmentId = (segment.kind === "stay" ? stayIds : commuteIds).get(segment.clientSegmentId);
    if (!segmentId) return [];
    if (segment.kind === "stay" && segment.placeMatchKind === "unknown" &&
      Date.parse(segment.stoppedAt ?? segment.startedAt) - Date.parse(segment.startedAt) < LOCATION_ENGINE_V2_CONFIG.unknownStayReviewDwellMs) return [];
    return [{ segment, segmentId, clientEventId: `location-segment:${segment.clientSegmentId}`.slice(0, 160) }];
  }).sort((a, b) => a.clientEventId < b.clientEventId ? -1 : a.clientEventId > b.clientEventId ? 1 : 0);
  if (!candidates.length) return 0;
  const context = await displayContext(client, session, candidates.map(row => row.segment));
  const eligible = candidates.filter(row => context(row.segment).trusted?.loggingEnabled !== false);
  const existing = new Map<string, { id: string; reviewStatus: string }>();
  for (const batch of chunks(eligible)) {
    const result = await client.query<{ id: string; clientEventId: string; reviewStatus: string }>(
      `select id, client_event_id as "clientEventId", review_status as "reviewStatus" from activity_events
       where workspace_id = $1 and user_id = $2 and client_event_id = any($3::text[])
       order by client_event_id for update`, [session.workspaceId, session.userId, batch.map(row => row.clientEventId)]);
    for (const row of result.rows) existing.set(row.clientEventId, row);
  }
  const commuteCategoryId = eligible.some(row => row.segment.kind === "commute")
    ? await ensureCommuteCategoryId(client, session) : null;
  const rows = eligible.map(({ segment, segmentId, clientEventId }) => {
    const { trusted, title } = context(segment);
    const categoryId = segment.kind === "commute" ? commuteCategoryId : trusted?.categoryId ?? null;
    const placeId = trusted?.id ?? (segment.kind === "stay" ? segment.placeId ?? null : null);
    const disposition = locationSemanticDisposition("v2_review", segment);
    // Same pure overlap result as the original review path; never read time entries here.
    const overlapDecision = assessAutomaticOverlap({kind: segment.kind === "commute" ? "location_commute" : "location_stay",
      startedAt: segment.startedAt, stoppedAt: segment.stoppedAt!, placeId, clientEventId}, []);
    const overlapsConfirmedTime = !overlapDecision.allowed;
    const semanticReason = overlapsConfirmedTime ? overlapDecision.reason : disposition.reason;
    const policyEvidence = {
      policyVersion: AUTOMATIC_LOCATION_POLICY_VERSION,
      confidenceTier: disposition.confidenceTier,
      startUncertaintySeconds: disposition.boundary.startUncertaintyMs == null ? null : disposition.boundary.startUncertaintyMs / 1_000,
      stopUncertaintySeconds: disposition.boundary.stopUncertaintyMs == null ? null : disposition.boundary.stopUncertaintyMs / 1_000,
      maximumObservationGapSeconds: segment.kind === "commute" ? segment.maximumObservationGapSeconds ?? null : null,
      maximumOverlapSeconds: overlapDecision.maximumOverlapMs / 1_000,
      overlapReason: overlapDecision.reason,
      overlapClass: overlapDecision.overlapClass
    };
    const rawPayload = segment.kind === "stay"
      ? {
          ...policyEvidence,
          clientSegmentId: segment.clientSegmentId,
          algorithmVersion: segment.algorithmVersion,
          placeMatchKind: segment.placeMatchKind,
          evidenceCount: segment.evidenceIds.length,
          continuityStatus: segment.continuityStatus,
          startedAt: segment.startedAt,
          stoppedAt: segment.stoppedAt,
          semanticDisposition: "needs_review",
          semanticReason
        }
      : {
          ...policyEvidence,
          clientSegmentId: segment.clientSegmentId,
          algorithmVersion: segment.algorithmVersion,
          fromStaySegmentId: segment.fromStaySegmentId,
          toStaySegmentId: segment.toStaySegmentId,
          routeSampleCount: segment.routeSampleCount,
          qualificationReason: segment.qualificationReason ?? null,
          continuityStatus: segment.continuityStatus,
          startedAt: segment.startedAt,
          stoppedAt: segment.stoppedAt,
          semanticDisposition: "needs_review",
          semanticReason
        };
    const eventType = segment.kind === "commute" ? "commute_detected" : segment.placeMatchKind === "learned"
      ? "learned_place_visit" : segment.placeMatchKind === "saved" ? "geofence_exit" : "unknown_stay";
    return { client_event_id: clientEventId, segment_id: segmentId, kind: segment.kind,
      event_type: eventType, occurred_at: segment.startedAt, stopped_at: segment.stoppedAt,
      confidence: segment.confidence, raw_payload: rawPayload, category_id: categoryId, place_id: placeId, title,
      review_status: existing.get(clientEventId)?.reviewStatus ?? "needs_review",
      notes: overlapsConfirmedTime
        ? `Automatic logging paused because this ${segment.kind === "commute" ? "commute" : "visit"} conflicts with tracked time by more than five minutes. You can still confirm it from Review.`
        : segment.continuityStatus === "uncertain_gap"
        ? "The boundary includes an evidence gap; inspect the timeline before confirming."
        : "Ordered location evidence supports this suggestion." };
  });
  const eventIds = new Map<string, string>();
  for (const batch of chunks(rows)) {
    const events = await client.query<{id: string; clientEventId: string}>(`
      insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at,
        confidence, raw_payload, suggested_category_id, suggested_place_id, review_status)
      select $1, $2, r.client_event_id, 'location_learning', r.event_type, r.occurred_at,
        r.confidence, r.raw_payload, r.category_id, r.place_id, 'needs_review'
      from jsonb_to_recordset($3::jsonb) as r(client_event_id text, event_type text, occurred_at timestamptz,
        confidence text, raw_payload jsonb, category_id uuid, place_id uuid)
     on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null
     do update set
       occurred_at = case
         when activity_events.review_status = 'needs_review' then excluded.occurred_at
         else activity_events.occurred_at
       end,
       confidence = case
         when activity_events.review_status = 'needs_review' then excluded.confidence
         else activity_events.confidence
       end,
       raw_payload = case
         when activity_events.review_status = 'needs_review' then excluded.raw_payload
         else activity_events.raw_payload
       end,
       suggested_category_id = case
         when activity_events.review_status = 'needs_review' then excluded.suggested_category_id
         else activity_events.suggested_category_id
       end,
       suggested_place_id = case
         when activity_events.review_status = 'needs_review' then excluded.suggested_place_id
         else activity_events.suggested_place_id
       end

      returning id, client_event_id as "clientEventId"`, [session.workspaceId, session.userId, JSON.stringify(batch)]);
    for (const event of events.rows) eventIds.set(event.clientEventId, event.id);
  }
  const linked = rows.map(row => ({ ...row, event_id: eventIds.get(row.client_event_id)! }));
  for (const batch of chunks(linked.filter(row => row.review_status === "needs_review"))) {
    const parameters = [session.workspaceId, session.userId, JSON.stringify(batch)];
    await client.query(`insert into review_items (workspace_id,user_id,event_id,location_segment_id,type,title,
      suggested_category_id,suggested_place_id,suggested_started_at,suggested_stopped_at,confidence,status,notes)
      select $1,$2,r.event_id,r.segment_id,r.event_type || '_suggestion',r.title,r.category_id,r.place_id,
        r.occurred_at,r.stopped_at,r.confidence,'open',r.notes
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid,event_type text,title text,
        category_id uuid,place_id uuid,occurred_at timestamptz,stopped_at timestamptz,confidence text,notes text)
      where not exists (select 1 from review_items where workspace_id=$1 and user_id=$2 and event_id=r.event_id)`, parameters);
    // Preserve the original update list: in particular type and status are never changed.
    await client.query(`update review_items target set location_segment_id=r.segment_id,title=r.title,
      suggested_category_id=r.category_id,suggested_place_id=r.place_id,suggested_started_at=r.occurred_at,
      suggested_stopped_at=r.stopped_at,confidence=r.confidence,notes=r.notes
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid,title text,category_id uuid,place_id uuid,
        occurred_at timestamptz,stopped_at timestamptz,confidence text,notes text)
      where target.workspace_id=$1 and target.user_id=$2 and target.event_id=r.event_id and target.status='open'`, parameters);
  }
  for (const batch of chunks(linked.filter(row => row.kind === "stay"))) {
    await client.query(`update stay_segments target set created_from_event_id=r.event_id,
      review_status=r.review_status,updated_at=now()
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid,review_status text)
      where target.workspace_id=$1 and target.user_id=$2 and target.id=r.segment_id`,
    [session.workspaceId, session.userId, JSON.stringify(batch)]);
  }
  for (const batch of chunks(linked.filter(row => row.kind === "commute"))) {
    await client.query(`update commute_segments target set created_from_event_id=r.event_id,updated_at=now()
      from jsonb_to_recordset($3::jsonb) as r(event_id uuid,segment_id uuid)
      where target.workspace_id=$1 and target.user_id=$2 and target.id=r.segment_id`,
    [session.workspaceId, session.userId, JSON.stringify(batch)]);
  }
  return rows.length;
}
