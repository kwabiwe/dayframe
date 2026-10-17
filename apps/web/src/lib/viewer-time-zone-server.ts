import { cookies } from "next/headers";
import { VIEWER_TIME_ZONE_COOKIE, normalizeViewerTimeZone, viewerTimeZoneFromCookieHeader } from "@/lib/viewer-time-zone";

/** The viewer's validated zone for a server-rendered page (UTC when the cookie is missing or unknown). */
export async function getViewerTimeZone() {
  const cookieStore = await cookies();
  return normalizeViewerTimeZone(cookieStore.get(VIEWER_TIME_ZONE_COOKIE)?.value);
}

/** The viewer's validated zone for a route handler's request (UTC without the cookie). */
export function viewerTimeZoneForRequest(request: Request) {
  return normalizeViewerTimeZone(viewerTimeZoneFromCookieHeader(request.headers.get("cookie")));
}

/**
 * The viewer's zone only when the browser has sent the cookie (null otherwise), for code that must
 * keep its earlier behaviour without it: the iPhone never sends the cookie.
 */
export async function getViewerTimeZoneIfSent() {
  const cookieStore = await cookies();
  const value = cookieStore.get(VIEWER_TIME_ZONE_COOKIE)?.value;
  return value ? normalizeViewerTimeZone(value) : null;
}

/** As `getViewerTimeZoneIfSent`, for a route handler's request. */
export function viewerTimeZoneIfSentForRequest(request: Request) {
  const value = viewerTimeZoneFromCookieHeader(request.headers.get("cookie"));
  return value ? normalizeViewerTimeZone(value) : null;
}
