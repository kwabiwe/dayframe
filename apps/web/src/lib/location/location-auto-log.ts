import type pg from "pg";
import { LOCATION_ENGINE_V2_CONFIG } from "@dayframe/shared";
import type { RequestSession } from "../session";

/**
 * Per-place "Log automatically" (owner decision 14 Oct 2026). A finalised stay at a saved place with
 * `places.auto_log` on becomes a block (this source) instead of a Review card when the conservative
 * checks pass (see `emitReviewSemanticSegments`). The block stays tied to its stay's event, and replay
 * may move it with the visit or remove it with the visit only while the person has not edited it
 * (owner decisions 15 Oct 2026); an edited or deleted block is a decision replay never touches.
 */
export const LOCATION_AUTO_LOG_SOURCE = "location_auto_log";

/**
 * Raw-payload key on a stay's event when replay retired the visit it auto-logged: the event is
 * ignored meanwhile, and if the same stay returns, emission offers it again as a new visit.
 */
export const AUTO_LOG_SUPERSEDED_PAYLOAD_KEY = "autoLogSuperseded";

/**
 * When a replay keeps auto-logged visits in step: only one that runs Review emission (which moves or
 * removes their blocks), and only for stays from `sinceAt` on — the current semantic cutover and no
 * older than evidence retention less a day, so the whole visit can still be rebuilt from retained
 * evidence (Codex r1 on #435). Any other replay, or older stay, keeps an auto-logged visit as a
 * decision, as before Log automatically.
 */
export type AutoLogReconciliation = { sinceAt: string };

export function autoLogReconciliation(processingAt: string, semanticCutoverAt: string): AutoLogReconciliation {
  const retained = Date.parse(processingAt) - (LOCATION_ENGINE_V2_CONFIG.rawEvidenceRetentionDays - 1) * 86_400_000;
  return { sinceAt: new Date(Math.max(retained, Date.parse(semanticCutoverAt))).toISOString() };
}

/**
 * SQL condition, for a segment alias with `workspace_id`, `user_id`, `created_from_event_id` and
 * `started_at`: within `reconciliation`, its event produced an auto-logged block the person has not
 * edited, so the segment is still replay's to move or remove, unlike a Review decision. Without a
 * reconciliation it never holds.
 */
export function autoLoggedUneditedSql(alias: string, reconciliation: AutoLogReconciliation | null | undefined) {
  if (!reconciliation) return "false";
  // An ISO instant this module made from Date: safe as a literal.
  const since = new Date(reconciliation.sinceAt).toISOString();
  return `(${alias}.started_at >= '${since}'::timestamptz and exists (select 1 from time_entries auto_entry
    where auto_entry.workspace_id = ${alias}.workspace_id and auto_entry.user_id = ${alias}.user_id
      and auto_entry.created_from_event_id = ${alias}.created_from_event_id
      and auto_entry.source = '${LOCATION_AUTO_LOG_SOURCE}' and auto_entry.user_edited_at is null))`;
}

/** An unedited auto-logged block whose visit replay no longer finds; re-linked to its replacement or removed. */
export type AutoLogOrphan = {
  entryId: string;
  placeId: string | null;
  startedAt: string;
  stoppedAt: string | null;
};

function iso(value: Date | string | null) {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Stays this device's replay no longer produces whose unedited auto-logged block remains, within the
 * reconciliation window: from the current semantic cutover (so their replacement can be emitted) and
 * young enough that none of their evidence has expired (so a visit that only ageing evidence hides is
 * never mistaken for one that vanished; Codex r1 on #435), with lineage still retained. Each stay is
 * superseded and detached from its event (so a returning stay is never mistaken for a decision), the
 * event is ignored with the superseded marker, and the blocks are returned for emission to move with
 * their replacement visit or for the caller to remove. Stays are locked first, then the blocks in
 * entry-id order, the order every multi-block lock uses; a block edited meanwhile is left alone.
 */
export async function retireAutoLoggedMissingStays(
  client: pg.PoolClient,
  session: RequestSession,
  options: { deviceId: string; algorithmVersion: string; processingAt: string; reconciliation: AutoLogReconciliation },
  stayClientIds: string[]
): Promise<AutoLogOrphan[]> {
  const stays = (await client.query<{ segmentId: string; eventId: string }>(
    `select st.id as "segmentId", st.created_from_event_id as "eventId"
     from stay_segments st
     where st.workspace_id = $1 and st.user_id = $2 and st.device_id = $3 and st.algorithm_version = $4
       and st.continuity_status <> 'manual' and st.status <> 'superseded'
       and not (st.client_segment_id = any($5::text[]))
       and ${autoLoggedUneditedSql("st", options.reconciliation)}
       and exists (
         select 1 from location_segment_evidence lse
         join location_evidence le
           on le.id = lse.evidence_id and le.workspace_id = lse.workspace_id and le.user_id = lse.user_id
         where lse.workspace_id = st.workspace_id and lse.user_id = st.user_id and lse.stay_segment_id = st.id
           and le.accepted = true and le.device_id = $3 and le.algorithm_version = $4
           and le.expires_at > $6::timestamptz)
     order by st.id
     for update of st`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, stayClientIds, options.processingAt]
  )).rows;
  if (stays.length === 0) return [];
  const entries = (await client.query<{
    entryId: string; eventId: string; placeId: string | null; startedAt: Date | string; stoppedAt: Date | string | null;
  }>(
    `select id as "entryId", created_from_event_id as "eventId", place_id as "placeId",
            started_at as "startedAt", stopped_at as "stoppedAt"
     from time_entries
     where workspace_id = $1 and user_id = $2 and created_from_event_id = any($3::uuid[])
       and source = '${LOCATION_AUTO_LOG_SOURCE}' and user_edited_at is null
     order by id
     for update`,
    [session.workspaceId, session.userId, stays.map((stay) => stay.eventId)]
  )).rows;
  // A block edited between the two reads keeps its stay a decision.
  const eventsWithBlocks = new Set(entries.map((entry) => entry.eventId));
  const rows = stays.filter((stay) => eventsWithBlocks.has(stay.eventId));
  if (rows.length === 0) return [];
  await client.query(
    `update stay_segments set status = 'superseded', created_from_event_id = null, updated_at = now()
     where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])`,
    [session.workspaceId, session.userId, [...new Set(rows.map((row) => row.segmentId))]]
  );
  await client.query(
    `update activity_events
     set review_status = 'ignored', raw_payload = raw_payload || jsonb_build_object('${AUTO_LOG_SUPERSEDED_PAYLOAD_KEY}', true)
     where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'confirmed'`,
    [session.workspaceId, session.userId, [...new Set(rows.map((row) => row.eventId))]]
  );
  return entries.map((entry) => ({
    entryId: entry.entryId,
    placeId: entry.placeId,
    startedAt: iso(entry.startedAt)!,
    stoppedAt: iso(entry.stoppedAt)
  }));
}

/**
 * Removes the orphaned blocks emission did not move to a replacement visit (owner decision 15 Oct
 * 2026: a visit replay no longer finds takes its unedited block with it). Edited blocks are kept.
 */
export async function removeUnusedAutoLogOrphans(
  client: pg.PoolClient, session: RequestSession, orphans: AutoLogOrphan[], used: ReadonlySet<string>
) {
  const unused = orphans.map((orphan) => orphan.entryId).filter((id) => !used.has(id));
  if (unused.length === 0) return 0;
  const removed = await client.query(
    `delete from time_entries
     where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])
       and source = '${LOCATION_AUTO_LOG_SOURCE}' and user_edited_at is null`,
    [session.workspaceId, session.userId, unused]
  );
  return removed.rowCount ?? 0;
}
