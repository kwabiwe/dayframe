import { reviewCheckHref } from "@/lib/calendar-checks";

/**
 * Location v4 step 15: the web Review page is gone; every "?" is answered in Calendar › List. Old /review links
 * (bookmarks, history, an older palette's `/review#review-<id>`) land on the List, at their question when they name one.
 */
export const CALENDAR_LIST_HREF = "/timeline?view=list&scope=day";

/** Today's first "?" in the List (Today's chip uses the same link when it has no oldest question). */
export const FIRST_CHECK_HREF = `${CALENDAR_LIST_HREF}&check=first`;

/** The query names an old /review link could carry a Review item id in, in order of preference. */
const ITEM_PARAMS = ["check", "item", "reviewItemId", "review", "id"] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReviewItemId(value: string) {
  return UUID_PATTERN.test(value);
}

/** The Review item an old /review link names (`?check=`, `?item=`, … or `check=first`), or null for a bare /review. */
export function reviewLinkItemId(params: Record<string, string | string[] | undefined>): string | null {
  for (const name of ITEM_PARAMS) {
    const raw = params[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value && (value === "first" || isReviewItemId(value))) return value;
  }
  return null;
}

/** The item an older palette's hash names (`#review-<id>`), or null. */
export function reviewHashItemId(hash: string): string | null {
  const match = /^#review-(.+)$/.exec(hash);
  if (!match) return null;
  let value: string;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isReviewItemId(value) ? value : null;
}

/** Where an old /review link goes: the List at its "?" (on its own day, `YYYY-MM-DD`, when known), or the List. */
export function reviewRedirectHref(itemId: string | null, dateKey?: string | null) {
  if (!itemId) return CALENDAR_LIST_HREF;
  if (itemId === "first") return FIRST_CHECK_HREF;
  return reviewCheckHref(itemId, dateKey);
}
