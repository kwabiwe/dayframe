import { useEffect } from "react";
import type { MobileAccountOwner } from "./mobileAccount";

/**
 * Owner item 13 (28 Oct 2026): the end-of-day reminder counts what the Calendar badge counts (the "?" from the
 * last 7 days), noted by the Dashboard for the signed-in account. The reminder is a one-shot: once it fires,
 * nothing is scheduled again until the count is noted again, so it is noted again each time Dayframe comes to the
 * front and when the day changes, not only when the count or the account changes (Codex r1 on #610).
 */
export function useReviewNudgeCount(owner: MobileAccountOwner | null, count: number, { dayKey, foreground }: { dayKey: string; foreground: boolean }) {
  const ownerKey = owner ? `${owner.workspaceId}:${owner.userId}` : null;
  useEffect(() => {
    if (!owner || !foreground) return;
    void import("./reviewNudge").then(({ noteReviewCount }) => noteReviewCount(owner, count)).catch(() => undefined);
    // The owner by its key: a new object for the same account is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, dayKey, foreground, ownerKey]);
}
