import { ReviewRedirect } from "@/components/review/ReviewRedirect";
import { resolvePageSession } from "@/lib/auth/server";
import { query } from "@/lib/db";
import { isReviewItemId, reviewLinkItemId } from "@/lib/review-redirect";

export const dynamic = "force-dynamic";

/**
 * Location v4 step 15: the Review page and its card deck are gone on the web; Calendar › List answers every "?".
 * An old /review link that names its item in the query (`?check=`, `?item=`, …) has its start read here, under the
 * signed-in workspace and user; the browser then turns it into a day in its own zone (never the zone cookie, which
 * may be missing or stale; Codex r1 on #613) and opens the List there. A bare /review is read in the browser too,
 * for an older palette's `#review-<id>`.
 */
export default async function ReviewRedirectPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const itemId = reviewLinkItemId(params);
  if (!itemId || !isReviewItemId(itemId)) return <ReviewRedirect itemId={itemId} />;
  const session = await resolvePageSession();
  const result = await query<{ suggestedStartedAt: Date | string | null }>(
    `select suggested_started_at as "suggestedStartedAt"
       from review_items
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [itemId, session.workspaceId, session.userId]
  );
  const startedAt = result.rows[0]?.suggestedStartedAt;
  const startedMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  return <ReviewRedirect itemId={itemId} startedAt={Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : null} />;
}
