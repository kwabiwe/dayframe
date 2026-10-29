"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CALENDAR_LIST_HREF, reviewHashItemId } from "@/lib/review-redirect";

/**
 * A bare /review (location v4 step 15): the List, or — for an older palette's `/review#review-<id>` — that item,
 * through /review?check=<id> so the server finds its day. Replaces the history entry, so Back never returns here.
 */
export function ReviewHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const itemId = reviewHashItemId(window.location.hash);
    router.replace(itemId ? `/review?check=${encodeURIComponent(itemId)}` : CALENDAR_LIST_HREF);
  }, [router]);
  return <p className="sr-only" role="status">Opening Calendar…</p>;
}
