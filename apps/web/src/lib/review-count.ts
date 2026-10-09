import { pool } from "@/lib/db";
import type { RequestSession } from "@/lib/session";

const REVIEW_COUNT_TIMEOUT_MS = 500;

/**
 * How many suggestions are waiting in Review for this user, for the phone's evening reminder.
 * Counted like bootstrap's `stats.reviewCount`. Best effort and bounded: integration tokens get
 * nothing; waiting for a pooled connection and the query itself are each capped at 500 ms (the
 * query by `statement_timeout`, so the database stops too), and a slow or failed count is left out
 * rather than delaying or failing the reply it rides on.
 */
export async function openReviewCountFor(session: RequestSession): Promise<number | undefined> {
  if (session.authMode === "token") return undefined;
  const client = await connectWithin(REVIEW_COUNT_TIMEOUT_MS);
  if (!client) return undefined;
  let failed = false;
  try {
    await client.query("begin read only");
    await client.query(`set local statement_timeout = ${REVIEW_COUNT_TIMEOUT_MS}`);
    const result = await client.query<{ reviewCount: number }>(
      `select count(*)::int as "reviewCount"
         from review_items
        where workspace_id = $1 and user_id = $2 and status = 'open'`,
      [session.workspaceId, session.userId]
    );
    await client.query("commit");
    const value = result.rows[0]?.reviewCount;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
  } catch {
    failed = true;
    await client.query("rollback").catch(() => undefined);
    return undefined;
  } finally {
    // A connection whose rollback may not have run is dropped rather than reused.
    client.release(failed ? true : undefined);
  }
}

/** A pooled connection, or null when none is free in time (a late one is released at once). */
async function connectWithin(ms: number) {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connecting = pool.connect().then(
    (client) => {
      if (timedOut) {
        client.release();
        return null;
      }
      return client;
    },
    () => null
  );
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([connecting, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The reply body with `reviewCount` added when it is known. */
export function withReviewCount<T extends object>(body: T, reviewCount: number | undefined): T & { reviewCount?: number } {
  return reviewCount === undefined ? body : { ...body, reviewCount };
}
