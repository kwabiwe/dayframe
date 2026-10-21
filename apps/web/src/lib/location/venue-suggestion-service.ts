import { pool } from "@/lib/db";
import type { RequestSession } from "@/lib/session";

/**
 * Store (or clear) the Apple venue the iPhone's ranker was confident about for an open Review
 * card's unsaved stay (location v3 PR 8, design §6.3). Place ID only: the iPhone looks the name up
 * next to an Apple map; web keeps "Unknown place". Never for a decided card, a saved place's stay
 * or someone else's item.
 *
 * The card's row and its stay are locked in the same short transaction as the write, skipping a
 * row a decision holds, so a suggestion can never land after a decision (Codex r1 on #519).
 * Returns "stored", "busy" (a decision is in progress) or null (not found / not eligible).
 */
export async function setSuggestedVenue(
  reviewItemId: string,
  placeId: string | null,
  session: RequestSession
): Promise<"stored" | "busy" | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '3s'");
    const locked = await client.query<{ segmentId: string }>(
      `select st.id as "segmentId"
         from review_items ri
         join stay_segments st
           on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
        where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3
          and ri.status = 'open' and st.place_id is null
        for update of ri, st skip locked`,
      [reviewItemId, session.workspaceId, session.userId]
    );
    if (!locked.rows[0]) {
      await client.query("rollback");
      // Skipped because a decision holds it, or not eligible at all: tell them apart.
      const exists = await client.query(
        `select 1 from review_items ri
           join stay_segments st on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
          where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3 and ri.status = 'open' and st.place_id is null`,
        [reviewItemId, session.workspaceId, session.userId]
      );
      return (exists.rowCount ?? 0) > 0 ? "busy" : null;
    }
    await client.query(
      `update stay_segments set suggested_venue_place_id = $1, updated_at = now()
        where id = $2 and suggested_venue_place_id is distinct from $1`,
      [placeId, locked.rows[0].segmentId]
    );
    await client.query("commit");
    return "stored";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
