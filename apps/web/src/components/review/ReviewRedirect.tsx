"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { reviewHashItemId, reviewRedirectHref, type ReviewRedirectTarget } from "@/lib/review-redirect";
import { browserTimeZone, FALLBACK_TIME_ZONE, syncViewerTimeZoneCookie } from "@/lib/viewer-time-zone";

/**
 * An old /review link (location v4 step 15), sent on in the browser: the day comes from the browser's own zone, never
 * a zone cookie the server may lack or hold stale (Codex r1 on #613), and the cookie is brought up to date first so
 * Calendar draws that day. A bare /review may carry an older palette's `#review-<id>`, which only the browser sees: it
 * goes through /review?check=<id> so the server finds the item. Replaces the history entry, so Back never returns here.
 */
export function ReviewRedirect({ itemId, startedAt = null }: ReviewRedirectTarget) {
  const router = useRouter();
  useEffect(() => {
    const hashItemId = itemId ? null : reviewHashItemId(window.location.hash);
    if (hashItemId) {
      router.replace(`/review?check=${encodeURIComponent(hashItemId)}`);
      return;
    }
    syncViewerTimeZoneCookie(document, window.location.protocol === "https:");
    router.replace(reviewRedirectHref({ itemId, startedAt }, browserTimeZone() ?? FALLBACK_TIME_ZONE, Date.now()));
  }, [itemId, router, startedAt]);
  return <p className="sr-only" role="status">Opening Calendar…</p>;
}
