import { redirect } from "next/navigation";
import { ReviewHashRedirect } from "@/components/review/ReviewHashRedirect";
import { resolvePageSession } from "@/lib/auth/server";
import { query } from "@/lib/db";
import { isReviewItemId, reviewLinkItemId, reviewRedirectHref } from "@/lib/review-redirect";
import { zonedDateKey } from "@/lib/viewer-time-zone";
import { getViewerTimeZone } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

/**
 * Location v4 step 15: the Review page and its card deck are gone on the web; Calendar › List answers every "?".
 * An old /review link that names its item in the query (`?check=`, `?item=`, …) opens on that item's own day in the
 * viewer's zone, read under the signed-in workspace and user. A bare /review may carry an older palette's
 * `#review-<id>`, which only the browser sees, so it is read there.
 */
export default async function ReviewRedirectPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const itemId = reviewLinkItemId(params);
  if (!itemId) return <ReviewHashRedirect />;
  if (!isReviewItemId(itemId)) redirect(reviewRedirectHref(itemId));
  const session = await resolvePageSession();
  const result = await query<{ suggestedStartedAt: Date | string | null }>(
    `select suggested_started_at as "suggestedStartedAt"
       from review_items
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [itemId, session.workspaceId, session.userId]
  );
  const startedAt = result.rows[0]?.suggestedStartedAt;
  const startedMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  const dateKey = Number.isFinite(startedMs) ? zonedDateKey(startedMs, await getViewerTimeZone()) : null;
  redirect(reviewRedirectHref(itemId, dateKey));
}
