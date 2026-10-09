import { query } from "@/lib/db";
import type { RequestSession } from "@/lib/session";

const REVIEW_COUNT_TIMEOUT_MS = 500;

/**
 * How many suggestions are waiting in Review for this user, for the phone's evening reminder.
 * Counted like bootstrap's `stats.reviewCount`. Best effort: integration tokens get nothing, and a
 * slow or failed count is left out rather than delaying or failing the reply it rides on.
 */
export async function openReviewCountFor(session: RequestSession): Promise<number | undefined> {
  if (session.authMode === "token") return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const count = query<{ reviewCount: number }>(
      `select count(*)::int as "reviewCount"
         from review_items
        where workspace_id = $1 and user_id = $2 and status = 'open'`,
      [session.workspaceId, session.userId]
    ).then((result) => result.rows[0]?.reviewCount, () => undefined);
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), REVIEW_COUNT_TIMEOUT_MS);
    });
    const value = await Promise.race([count, timeout]);
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The reply body with `reviewCount` added when it is known. */
export function withReviewCount<T extends object>(body: T, reviewCount: number | undefined): T & { reviewCount?: number } {
  return reviewCount === undefined ? body : { ...body, reviewCount };
}
