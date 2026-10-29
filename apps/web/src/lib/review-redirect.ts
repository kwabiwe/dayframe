import { reviewCheckHref } from "@/lib/calendar-checks";
import { zonedDateKey } from "@/lib/viewer-time-zone";

/**
 * Location v4 step 15: the web Review page is gone; every "?" is answered in Calendar › List. Old /review links
 * (bookmarks, history, an older palette's `/review#review-<id>`) land on the List, at their question when they name one.
 */
export const CALENDAR_LIST_HREF = "/timeline?view=list&scope=day";

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

export type ReviewRedirectTarget = {
  /** A Review item id, `first` (today's first "?"), or null for the List. */
  itemId: string | null;
  /** The named item's suggested start, when the server found it for this workspace and user. */
  startedAt?: string | null;
};

/**
 * Where an old /review link goes, its day in the browser's own zone (Codex r1 on #613): the server's zone cookie may
 * be missing on a first visit or stale after travel, so the day is never taken from it. The List at the named "?" on
 * the day it starts; `first` is today's first "?" (the List opens today's, never an older one); otherwise today.
 */
export function reviewRedirectHref(target: ReviewRedirectTarget, timeZone: string, nowMs: number) {
  const today = zonedDateKey(nowMs, timeZone);
  if (!target.itemId) return `${CALENDAR_LIST_HREF}&date=${today}`;
  if (target.itemId === "first") return `${CALENDAR_LIST_HREF}&date=${today}&check=first`;
  const startedMs = target.startedAt ? Date.parse(target.startedAt) : Number.NaN;
  return reviewCheckHref(target.itemId, Number.isFinite(startedMs) ? zonedDateKey(startedMs, timeZone) : today);
}
