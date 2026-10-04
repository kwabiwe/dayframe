import type pg from "pg";
import type { RequestSession } from "../session";

/**
 * `review_items.ignored_scope` for a Review that replay retired because its
 * segment disappeared from corrected output. Users ignore 'once' or by
 * 'source', so this marks the system's retirement, never a user decision.
 */
export const SUPERSEDED_REVIEW_SCOPE = "superseded";

/**
 * Reopens Reviews that replay retired as superseded once their segment is back
 * in the output and offered again (for example when later evidence revokes the
 * iOS proof that briefly changed a stay's identity). User decisions are never
 * reopened. Returns the reopened event IDs.
 */
export async function reopenSupersededReviews(client: pg.PoolClient, session: RequestSession, eventIds: string[]) {
  if (eventIds.length === 0) return new Set<string>();
  const reopened = await client.query<{ eventId: string }>(
    `update review_items set status = 'open', resolved_at = null, ignored_scope = null
     where workspace_id = $1 and user_id = $2 and event_id = any($3::uuid[])
       and status = 'ignored' and ignored_scope = $4
     returning event_id as "eventId"`,
    [session.workspaceId, session.userId, eventIds, SUPERSEDED_REVIEW_SCOPE]
  );
  const ids = [...new Set(reopened.rows.map((row) => row.eventId))];
  if (ids.length > 0) {
    await client.query(
      `update activity_events set review_status = 'needs_review'
       where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'ignored'`,
      [session.workspaceId, session.userId, ids]
    );
  }
  return new Set(ids);
}
