import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  readAcknowledgedTimelineCorrections,
  readTimelineCorrectionRefreshRevision,
  readPendingTimelineCorrections,
  retirePlaceLogReceipts,
  subscribeTimelineCorrectionOutbox,
  type AcknowledgedTimelineCorrection,
  type PendingTimelineCorrection
} from "./timelineCorrectionOutbox";

type Stored = {
  key: string;
  items: readonly PendingTimelineCorrection[];
  acknowledged: readonly AcknowledgedTimelineCorrection[];
  delivered: number;
};
const NONE: readonly PendingTimelineCorrection[] = [];
const NONE_ACKNOWLEDGED: readonly AcknowledgedTimelineCorrection[] = [];

/**
 * The signed-in account's queued location timeline corrections (step 12), read again whenever the queue
 * changes, for the List to show over the timeline (`projectTimelineCorrections`) and to say why a refused
 * one came back. `acknowledged` are those the server has had for a few minutes: the List keeps showing them
 * until a timeline read after them lands. `delivered` is the queue's refresh revision (up once per
 * send pass that delivered), so the List reads the timeline again then.
 */
export function useTimelineCorrectionQueue(owner: { userId: string; workspaceId: string } | null,
  canonicalEntryIds?: ReadonlySet<string>) {
  const [stored, setStored] = useState<Stored | null>(null);
  const userId = owner?.userId ?? null;
  const workspaceId = owner?.workspaceId ?? null;
  const key = userId && workspaceId ? `${workspaceId}:${userId}` : null;
  useEffect(() => {
    if (!userId || !workspaceId) return;
    const ownerKey = `${workspaceId}:${userId}`;
    let current = true;
    const read = () => {
      void readPendingTimelineCorrections({ userId, workspaceId }).then((items) => {
        if (!current) return;
        setStored(() => {
          // The timeline is read again once per send pass that delivered something (the queue's own revision); a
          // refusal shows from the queue alone (Codex r2 and r3 on #598).
          const acknowledged = readAcknowledgedTimelineCorrections({ userId, workspaceId });
          return { key: ownerKey, items, acknowledged, delivered: readTimelineCorrectionRefreshRevision() };
        });
      }, () => undefined);
    };
    read();
    const unsubscribe = subscribeTimelineCorrectionOutbox(read);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [userId, workspaceId]);
  const mine = stored && stored.key === key ? stored : null;
  const receipts = mine?.acknowledged ?? NONE_ACKNOWLEDGED;
  // Even if retirement is still writing, a just-deleted block must never bring its receipt back.
  const retired = useRef<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const retiredIds = retired.current?.key === key ? retired.current?.ids : undefined;
  const isOnScreen = (item: AcknowledgedTimelineCorrection) => item.loggedPlaceEntryIds?.some((id) => canonicalEntryIds?.has(id));
  const settled = receipts.filter((item) => item.placeLogReceipt && (retiredIds?.has(item.clientCorrectionId) || isOnScreen(item)));
  useLayoutEffect(() => {
    if (!key || !userId || !workspaceId || !settled.length) return;
    const ids = settled.map((item) => item.clientCorrectionId);
    retired.current = { key, ids: new Set(ids) };
    void retirePlaceLogReceipts({ userId, workspaceId }, ids).catch(() => undefined);
    // These are the exact observed receipts; neither a rerender nor a clipped date window can acknowledge another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId, workspaceId, receipts, canonicalEntryIds]);
  return {
    pending: mine?.items ?? NONE,
    // Pass the receipt through the first canonical render so List can reuse the
    // provisional row's key. After deletion, hide receipts already seen in this lifetime.
    acknowledged: retiredIds ? receipts.filter((item) => !retiredIds.has(item.clientCorrectionId) || isOnScreen(item)) : receipts,
    delivered: mine?.delivered ?? 0
  };
}
