import { query } from "@/lib/db";
import type { RequestSession } from "@/lib/session";

/**
 * Store (or clear) the Apple venue the iPhone's ranker was confident about for an open Review
 * card's unsaved stay (location v3 PR 8, design §6.3). Place ID only: the iPhone looks the name up
 * next to an Apple map; web keeps "Unknown place". Never for a decided card, a saved place's stay
 * or someone else's item. Returns whether a stay took it.
 */
export async function setSuggestedVenue(reviewItemId: string, placeId: string | null, session: RequestSession) {
  const result = await query(
    `update stay_segments st
        set suggested_venue_place_id = $1, updated_at = now()
       from review_items ri
      where ri.id = $2 and ri.workspace_id = $3 and ri.user_id = $4
        and ri.status = 'open'
        and st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
        and st.place_id is null
        and st.suggested_venue_place_id is distinct from $1`,
    [placeId, reviewItemId, session.workspaceId, session.userId]
  );
  if ((result.rowCount ?? 0) > 0) return { stored: true };
  // Unchanged is fine; anything else (decided, saved place, not a stay, not theirs) is not found.
  const unchanged = await query(
    `select 1 from review_items ri
       join stay_segments st on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
      where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3 and ri.status = 'open' and st.place_id is null`,
    [reviewItemId, session.workspaceId, session.userId]
  );
  return (unchanged.rowCount ?? 0) > 0 ? { stored: true } : null;
}
