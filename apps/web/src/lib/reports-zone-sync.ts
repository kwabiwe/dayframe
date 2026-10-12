/**
 * A Reports refresh the app shell starts only because the viewer's time zone cookie changed
 * (first visit, or travel). The redrawn report is the same view in the right zone, so its blocks
 * appear at rest (`.codex/reference/motion.md`: no landing on hydration or reconciliation). A range
 * or filter the user chooses still lands as before.
 *
 * Client only. The mark names the route it was set on, in the router's own terms
 * (`reportsRouteHref`). The panel compares it with the route its render is for (`usePathname`,
 * `useSearchParams`), never `window.location`: Next updates the address after the new route has
 * rendered, so a user's navigation renders while the address still shows the marked page (Codex r2
 * on #367). The first report data after the mark settles it either way (the refresh, or a
 * navigation that superseded it), and a mark nothing consumed lapses.
 */
const MAX_AGE_MS = 30_000;
let pending: { href: string; at: number } | null = null;

/** A route's identity: its path and its query, normalised as `URLSearchParams` writes it. */
export function reportsRouteHref(pathname: string | null | undefined, search: string | URLSearchParams | null | undefined) {
  const query = new URLSearchParams(search ?? "").toString();
  return `${pathname ?? ""}${query ? `?${query}` : ""}`;
}

export function markReportsZoneSyncRefresh(href: string, now = Date.now()) {
  pending = { href, at: now };
}

/** Whether report data rendered for `href` is the marked refresh (does not consume the mark). */
export function isReportsZoneSyncRefresh(href: string, now = Date.now()) {
  return pending !== null && pending.href === href && now - pending.at < MAX_AGE_MS;
}

export function clearReportsZoneSyncRefresh() {
  pending = null;
}
