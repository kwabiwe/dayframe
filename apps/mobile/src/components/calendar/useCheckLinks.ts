import { useCallback, useEffect, useRef, useState } from "react";
import { reviewLinkLookupable } from "../../lib/reviewLinks";

/** The account a link is answered for; `backendId` is null in a build without a backend identity (no lookup then). */
export type CheckLinkOwner = { workspaceId: string; userId: string; backendId: string | null };

type Request = { check: string; request: number };

/**
 * Old Review links in Calendar › List (location v4 step 15; Codex r1 on #615). A link is held until the app is signed in
 * and its bootstrap is in (`ready`), then answered once, for the account then signed in:
 * - `first`: today's first "?" with today selected (`openTodayFirst`), even one that started yesterday;
 * - a "?" the List has (`openCheck` returns true): on its day with its question or sheet open;
 * - anything else: one owner-scoped read of when the item starts (`lookupStart`; decided, or beyond the bootstrap's
 *   100 open items), then the List on that day. A failed or empty read, a non-UUID id, or an account change while
 *   reading opens today's List instead; a newer link wins over an older read; nothing opens once signed out.
 * Every callback is read at the moment it is used, so a read finishing later uses the current List.
 */
export function useCheckLinks(input: {
  ready: boolean;
  owner: CheckLinkOwner | null;
  todayKey: string;
  openCheck: (reviewItemId: string) => boolean;
  openDay: (dayKey: string) => void;
  openTodayFirst: () => void;
  lookupStart: (owner: CheckLinkOwner, reviewItemId: string) => Promise<string | null>;
  dayKeyOf: (instant: string) => string | null;
}) {
  const [pending, setPending] = useState<Request | null>(null);
  const requests = useRef(0);
  const latest = useRef(input);
  latest.current = input;
  const ownerKey = input.owner ? `${input.owner.backendId}:${input.owner.workspaceId}:${input.owner.userId}` : null;
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;

  const openCheckLink = useCallback((check: string) => {
    requests.current += 1;
    setPending({ check, request: requests.current });
  }, []);

  useEffect(() => {
    const owner = input.owner;
    if (!pending || !input.ready || !owner) return;
    setPending(null);
    const { check, request } = pending;
    const now = latest.current;
    if (check === "first") {
      now.openTodayFirst();
      return;
    }
    if (now.openCheck(check)) return;
    if (!reviewLinkLookupable(check)) {
      now.openDay(now.todayKey);
      return;
    }
    const readFor = ownerKey;
    void now.lookupStart(owner, check).catch(() => null).then((start) => {
      if (request !== requests.current) return;
      const current = latest.current;
      if (!ownerKeyRef.current) return;
      const dayKey = ownerKeyRef.current === readFor && start ? current.dayKeyOf(start) : null;
      current.openDay(dayKey ?? current.todayKey);
    });
    // Answered once per request; the account and readiness only gate when.
  }, [pending, input.ready, input.owner, ownerKey]);

  return openCheckLink;
}
