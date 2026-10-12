import type pg from "pg";
import { REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY } from "../review-decision-signal";
import type { RequestSession } from "../session";

/**
 * Suggested-title history for location Review items (E1, Codex r3).
 *
 * Replay may retitle an open suggestion ("Visit <old name>" → "Visit <new name>") while an editor
 * prefilled with the old title is still open, and older clients confirm without a proposal hash.
 * So the owner-authored comparison must cover every title Dayframe ever suggested for the item,
 * not only the current one. The history lives on the item's semantic event, as
 * `raw_payload.reviewSuggestedTitles` (first-seen order, distinct), and correction events carry
 * it forward. No migration: it reuses the existing jsonb payload.
 */

/**
 * For an `on conflict do update` of a semantic event: keep the accumulated history when the
 * payload is replaced (the new payload is server-built and never carries the key).
 */
export const PRESERVE_REVIEW_TITLE_HISTORY_SQL =
  `excluded.raw_payload || jsonb_strip_nulls(jsonb_build_object('${REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY}', activity_events.raw_payload -> '${REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY}'))`;

/**
 * Appends the current titles of these events' open Review items to their history. Call it before
 * a title update (to keep the outgoing title) and after an insert or update (to add the new one).
 */
export async function recordReviewTitleHistory(
  client: Pick<pg.PoolClient, "query">,
  session: Pick<RequestSession, "workspaceId" | "userId">,
  eventIds: readonly string[]
) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (ids.length === 0) return;
  await client.query(
    `update activity_events ae
     set raw_payload = coalesce(ae.raw_payload, '{}'::jsonb) || jsonb_build_object(
       '${REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY}',
       (
         select coalesce(jsonb_agg(merged.title order by merged.first_seen), '[]'::jsonb)
         from (
           select candidate.title, min(candidate.position) as first_seen
           from (
             select history.title, history.position
             from jsonb_array_elements_text(
               case when jsonb_typeof(ae.raw_payload -> '${REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY}') = 'array'
                    then ae.raw_payload -> '${REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY}'
                    else '[]'::jsonb end
             ) with ordinality as history(title, position)
             union all
             select open_review.title, 1000000000
             from review_items open_review
             where open_review.event_id = ae.id
               and open_review.workspace_id = ae.workspace_id
               and open_review.user_id = ae.user_id
               and open_review.status = 'open'
               and btrim(open_review.title) <> ''
           ) candidate
           group by candidate.title
         ) merged
       )
     )
     where ae.workspace_id = $1 and ae.user_id = $2 and ae.id = any($3::uuid[])
       and ae.source = 'location_learning'
       and exists (
         select 1 from review_items open_review
         where open_review.event_id = ae.id
           and open_review.workspace_id = ae.workspace_id
           and open_review.user_id = ae.user_id
           and open_review.status = 'open'
       )`,
    [session.workspaceId, session.userId, ids]
  );
}
