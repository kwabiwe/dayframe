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
