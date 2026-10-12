/**
 * A Reports refresh the app shell starts only because the viewer's time zone cookie changed
 * (first visit, or travel). The redrawn report is the same view in the right zone, so its blocks
 * appear at rest (`.codex/reference/motion.md`: no landing on hydration or reconciliation). A range
 * or filter the user chooses still lands as before.
 *
 * Client only. The mark names the page it was set on and lapses after a while, so a navigation
 * the user makes before the refresh arrives is never mistaken for it.
 */
const MAX_AGE_MS = 30_000;
let pending: { href: string; at: number } | null = null;

export function markReportsZoneSyncRefresh(href: string, now = Date.now()) {
  pending = { href, at: now };
}

export function isReportsZoneSyncRefresh(href: string, now = Date.now()) {
  return pending !== null && pending.href === href && now - pending.at < MAX_AGE_MS;
}

export function clearReportsZoneSyncRefresh() {
  pending = null;
}

/** The page a mark applies to: path and query, as the shell saw them. */
export function currentReportsHref() {
  return typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`;
}
