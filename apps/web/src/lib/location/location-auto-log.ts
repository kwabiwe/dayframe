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
export type AutoLogReconciliation = { sinceAt: string; semanticCutoverAt: string };

export function autoLogReconciliation(processingAt: string, semanticCutoverAt: string): AutoLogReconciliation {
  const retained = Date.parse(processingAt) - (LOCATION_ENGINE_V2_CONFIG.rawEvidenceRetentionDays - 1) * 86_400_000;
  return { sinceAt: new Date(Math.max(retained, Date.parse(semanticCutoverAt))).toISOString(), semanticCutoverAt };
}

type Interval = { startedAt: string; stoppedAt?: string | null };

function overlaps(a: Interval, b: Interval) {
  const end = (value: Interval) => value.stoppedAt ? Date.parse(value.stoppedAt) : Number.POSITIVE_INFINITY;
  return Date.parse(a.startedAt) < end(b) && end(a) > Date.parse(b.startedAt);
}

type PlacedInterval = Interval & { placeId: string | null; candidatePlaceIds: readonly string[] };

/**
 * The stays replay produces, split by whether Review emission offers them now (finalised, from the
 * semantic cutover on) or holds them (not finalised, or before the cutover), each with the saved
 * place emission would log it at — its saved place, or the saved place its learned place is
 * accepted as (`learnedToSaved`), as emission resolves it — and the saved places it may yet become
 * (its candidates, learned ones through the same link; Codex r6 on #435).
 */
export type AutoLogStayTiming = {
  offered: PlacedInterval[]; held: PlacedInterval[];
  /** Moves replay produces (PRD D19), offered now or held, for the blocks of Moves that log themselves. */
  moves?: { offered: Interval[]; held: Interval[] };
};

export function autoLogStayTiming(
  segments: ReadonlyArray<{
    kind: string; status: string; startedAt: string; stoppedAt?: string | null;
    placeMatchKind?: string | null; placeId?: string | null; learnedPlaceId?: string | null; candidatePlaceIds?: string[];
  }>,
  reconciliation: AutoLogReconciliation,
  learnedToSaved: ReadonlyMap<string, string>
): AutoLogStayTiming {
  const timing: AutoLogStayTiming = { offered: [], held: [], moves: { offered: [], held: [] } };
  for (const segment of segments) {
    if (segment.kind !== "stay") {
      const move = { startedAt: segment.startedAt, stoppedAt: segment.stoppedAt ?? null };
      const offered = segment.status === "finalised" && Date.parse(segment.startedAt) >= Date.parse(reconciliation.semanticCutoverAt);
      (offered ? timing.moves!.offered : timing.moves!.held).push(move);
      continue;
    }
    const placeId = segment.placeMatchKind === "saved" && segment.placeId ? segment.placeId
      : segment.placeMatchKind === "learned" && segment.learnedPlaceId ? learnedToSaved.get(segment.learnedPlaceId) ?? null
        : null;
    const stay = {
      startedAt: segment.startedAt, stoppedAt: segment.stoppedAt ?? null, placeId,
      candidatePlaceIds: [segment.placeId, segment.learnedPlaceId, ...(segment.candidatePlaceIds ?? [])]
        .flatMap((id) => id ? [learnedToSaved.get(id) ?? id] : [])
    };
    const offered = segment.status === "finalised" && Date.parse(segment.startedAt) >= Date.parse(reconciliation.semanticCutoverAt);
    (offered ? timing.offered : timing.held).push(stay);
  }
  return timing;
}

/**
 * Whether a block at `placeId` waits for a replacement Review emission does not offer yet: no offered
 * stay at its place overlaps it (one that does takes the block now), and a held stay overlapping it
 * is, or may yet become, that place (directly or through an accepted learned place). Such a visit has not vanished, so its stay is not retired and
 * stays live and linked until a later replay offers the replacement (Codex r2/r4/r5 on #435).
 */
function awaitsHeldReplacement(block: Interval, placeId: string | null, timing: AutoLogStayTiming, kind: "stay" | "commute" = "stay") {
  // A Move's block waits while no offered Move overlaps it and a held one does (Moves have no place).
  if (kind === "commute") {
    const moves = timing.moves ?? { offered: [], held: [] };
    return !moves.offered.some((move) => overlaps(move, block)) && moves.held.some((move) => overlaps(move, block));
  }
  if (!placeId) return false;
  if (timing.offered.some((stay) => stay.placeId === placeId && overlaps(stay, block))) return false;
  return timing.held.some((stay) => overlaps(stay, block) &&
    (stay.placeId === placeId || (!stay.placeId && stay.candidatePlaceIds.includes(placeId))));
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
  /** Whether a visit's or (PRD D19) a Move's block; only a replacement of the same kind takes it. */
  kind: "stay" | "commute";
  placeId: string | null;
  startedAt: string;
  stoppedAt: string | null;
};

function iso(value: Date | string | null) {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Every unedited auto-logged block this replay may move or remove — those of this device's live stays
 * from the reconciliation window on — locked in one statement in entry-id order (the order grouped
 * edits and batch deletes use), before replay reads which stays are decisions or changes anything
 * (Codex r2/r3 on #435). A block the person deletes or edits meanwhile is waited for and then left
 * out, so the statements after this one see its visit as a decision and never re-create it. No later
 * step locks another block.
 */
export async function lockAutoLoggedBlocks(
  client: pg.PoolClient,
  session: RequestSession,
  options: { deviceId: string; algorithmVersion: string; reconciliation: AutoLogReconciliation }
): Promise<Set<string>> {
  // Visits' blocks and, since Moves log themselves (PRD D19), Moves' blocks.
  const segmentOf = (table: "stay_segments" | "commute_segments") => `exists (select 1 from ${table} sg
       where sg.workspace_id = te.workspace_id and sg.user_id = te.user_id and sg.created_from_event_id = te.created_from_event_id
         and sg.device_id = $3 and sg.algorithm_version = $4 and sg.status <> 'superseded' and sg.started_at >= $5::timestamptz)`;
  const rows = (await client.query<{ id: string }>(
    `select te.id
     from time_entries te
     where te.workspace_id = $1 and te.user_id = $2
       and te.source = '${LOCATION_AUTO_LOG_SOURCE}' and te.user_edited_at is null
       and (${segmentOf("stay_segments")} or ${segmentOf("commute_segments")})
     order by te.id
     for update of te`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, options.reconciliation.sinceAt]
  )).rows;
  return new Set(rows.map((row) => row.id));
}

/**
 * The visits (and, since Moves log themselves, the Moves) this replay retires: within the reconciliation window — from the current semantic
 * cutover and young enough that none of the visit's evidence has expired, so a visit only ageing
 * evidence hides is never mistaken for one that vanished, with lineage still retained (Codex r1 on
 * #435) — every stay it no longer produces whose block `lockAutoLoggedBlocks` holds unedited. A block
 * the person deleted or edited keeps its visit a decision, and a block awaiting a held replacement
 * (`awaitsHeldReplacement`) keeps its stay live and linked until a later replay offers it. A retired stay is superseded and detached
 * from its event (so a returning stay is never mistaken for a decision) and the event is ignored with
 * the superseded marker; its block is returned for emission to move with its replacement or for the
 * caller to remove.
 */
export async function retireAutoLoggedMissingStays(
  client: pg.PoolClient,
  session: RequestSession,
  options: { deviceId: string; algorithmVersion: string; processingAt: string; reconciliation: AutoLogReconciliation },
  stayClientIds: string[],
  locked: ReadonlySet<string>,
  timing: AutoLogStayTiming,
  commuteClientIds: string[] = []
): Promise<AutoLogOrphan[]> {
  // Retained lineage: a stay's own evidence; a Move's own, or both its endpoint stays' (a Move only
  // Motion & Fitness timed may have little of its own).
  const retained = (predicate: string) => `exists (
         select 1 from location_segment_evidence lse
         join location_evidence le
           on le.id = lse.evidence_id and le.workspace_id = lse.workspace_id and le.user_id = lse.user_id
         where lse.workspace_id = sg.workspace_id and lse.user_id = sg.user_id and ${predicate}
           and le.accepted = true and le.device_id = $3 and le.algorithm_version = $4
           and le.expires_at > $6::timestamptz)`;
  const missing = async (table: "stay_segments" | "commute_segments", clientIds: string[]) => (await client.query<{ segmentId: string; eventId: string }>(
    `select sg.id as "segmentId", sg.created_from_event_id as "eventId"
     from ${table} sg
     where sg.workspace_id = $1 and sg.user_id = $2 and sg.device_id = $3 and sg.algorithm_version = $4
       and sg.continuity_status <> 'manual' and sg.status <> 'superseded'
       and not (sg.client_segment_id = any($5::text[]))
       and ${autoLoggedUneditedSql("sg", options.reconciliation)}
       and ${table === "stay_segments" ? retained("lse.stay_segment_id = sg.id")
         : `(${retained("lse.commute_segment_id = sg.id")} or (${retained("lse.stay_segment_id = sg.from_stay_segment_id")}
           and ${retained("lse.stay_segment_id = sg.to_stay_segment_id")}))`}
     order by sg.id
     for update of sg`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, clientIds, options.processingAt]
  )).rows.map((row) => ({ ...row, table }));
  const stays = [...await missing("stay_segments", stayClientIds), ...await missing("commute_segments", commuteClientIds)];
  if (stays.length === 0) return [];
  const entries = (await client.query<{
    entryId: string; eventId: string; placeId: string | null; startedAt: Date | string; stoppedAt: Date | string | null;
  }>(
    `select te.id as "entryId", te.created_from_event_id as "eventId", te.place_id as "placeId",
            te.started_at as "startedAt", te.stopped_at as "stoppedAt"
     from time_entries te
     where te.workspace_id = $1 and te.user_id = $2 and te.id = any($3::uuid[])
       and te.created_from_event_id = any($4::uuid[])`,
    [session.workspaceId, session.userId, [...locked], stays.map((stay) => stay.eventId)]
  )).rows;
  const blockInterval = (entry: (typeof entries)[number]) => ({ startedAt: iso(entry.startedAt)!, stoppedAt: iso(entry.stoppedAt) });
  const kindOf = new Map(stays.map((stay) => [stay.eventId, stay.table === "stay_segments" ? "stay" as const : "commute" as const]));
  const eventsWithBlocks = new Set(entries.map((entry) => entry.eventId));
  for (const entry of entries) {
    if (awaitsHeldReplacement(blockInterval(entry), entry.placeId, timing, kindOf.get(entry.eventId))) eventsWithBlocks.delete(entry.eventId);
  }
  const rows = stays.filter((stay) => eventsWithBlocks.has(stay.eventId));
  if (rows.length === 0) return [];
  for (const table of ["stay_segments", "commute_segments"] as const) {
    const ids = [...new Set(rows.filter((row) => row.table === table).map((row) => row.segmentId))];
    if (ids.length === 0) continue;
    await client.query(
      `update ${table} set status = 'superseded', created_from_event_id = null, updated_at = now()
       where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])`,
      [session.workspaceId, session.userId, ids]
    );
  }
  const retiredEvents = new Set(rows.map((row) => row.eventId));
  await client.query(
    `update activity_events
     set review_status = 'ignored', raw_payload = raw_payload || jsonb_build_object('${AUTO_LOG_SUPERSEDED_PAYLOAD_KEY}', true)
     where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'confirmed'`,
    [session.workspaceId, session.userId, [...retiredEvents]]
  );
  return entries.filter((entry) => retiredEvents.has(entry.eventId)).map((entry) => ({
    entryId: entry.entryId,
    kind: kindOf.get(entry.eventId) ?? "stay",
    placeId: entry.placeId,
    startedAt: iso(entry.startedAt)!,
    stoppedAt: iso(entry.stoppedAt)
  }));
}

/**
 * Removes the orphaned blocks emission did not move to a replacement visit (owner decision 15 Oct
 * 2026: a visit replay no longer finds takes its unedited block with it). Only blocks replay locked
 * unedited; edited blocks are never removed.
 */
export async function removeUnusedAutoLogOrphans(
  client: pg.PoolClient, session: RequestSession, orphans: AutoLogOrphan[], used: ReadonlySet<string>,
  locked: ReadonlySet<string>
) {
  const unused = orphans.filter((orphan) => locked.has(orphan.entryId) && !used.has(orphan.entryId))
    .map((orphan) => orphan.entryId);
  if (unused.length === 0) return 0;
  const removed = await client.query(
    `delete from time_entries
     where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])
       and source = '${LOCATION_AUTO_LOG_SOURCE}' and user_edited_at is null`,
    [session.workspaceId, session.userId, unused]
  );
  return removed.rowCount ?? 0;
}
