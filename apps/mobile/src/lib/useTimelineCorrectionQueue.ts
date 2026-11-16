import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LocationTimeline } from "@dayframe/shared";
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
export function useTimelineCorrectionQueue(owner: { userId: string; workspaceId: string } | null) {
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
  return {
    pending: mine?.items ?? NONE,
    acknowledged: mine?.acknowledged ?? NONE_ACKNOWLEDGED,
    delivered: mine?.delivered ?? 0
  };
}

/** Keep a logged place until its own entry can take over, or a later read confirms it was deleted. */
export function usePlaceLogReceipts(
  owner: { userId: string; workspaceId: string } | null,
  receipts: readonly AcknowledgedTimelineCorrection[],
  canonicalEntryIds: ReadonlySet<string> | undefined,
  timeline: LocationTimeline | null,
  requestedAt: number | null
) {
  const userId = owner?.userId;
  const workspaceId = owner?.workspaceId;
  const key = userId && workspaceId ? `${workspaceId}:${userId}` : null;
  // Even if retirement is still writing, a just-deleted block must never bring its receipt back.
  const retired = useRef<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const retiredIds = retired.current?.key === key ? retired.current?.ids : undefined;
  const { visible, settled } = useMemo(() => {
    const places = new Map(timeline?.items.flatMap((item) => item.kind === "place" ? [[item.id, item] as const] : []));
    const settled: string[] = [];
    const visible = receipts.filter((item) => {
      if (!item.placeLogReceipt || item.request.kind !== "log_place") return true;
      const { clientCorrectionId, loggedPlaceEntryIds } = item;
      const place = places.get(item.request.itemId);
      // A returned place contains all linked entries, including any that were moved to another day.
      // A failed read or a day without this place can't tell us that an entry was deleted.
      const fullPlaceRead = place && requestedAt !== null && requestedAt > item.acknowledgedAt;
      const deleted = fullPlaceRead && loggedPlaceEntryIds?.length &&
        !loggedPlaceEntryIds.some((id) => place.blockIds.includes(id));
      // Older API receipts lack separate place IDs. Use the exact timeline links once the new read arrives.
      const entryIds = loggedPlaceEntryIds ?? (fullPlaceRead ? place.blockIds : []);
      const onScreen = entryIds.some((id) => canonicalEntryIds?.has(id));
      const retired = retiredIds?.has(clientCorrectionId);
      if (deleted || onScreen || retired) settled.push(clientCorrectionId);
      // Pass through the first replacement render so List can keep the same row key.
      return !deleted && (!retired || onScreen);
    });
    return { visible, settled };
  }, [canonicalEntryIds, receipts, requestedAt, retiredIds, timeline]);
  useLayoutEffect(() => {
    if (!key || !userId || !workspaceId || !settled.length) return;
    retired.current = { key, ids: new Set(settled) };
    void retirePlaceLogReceipts({ userId, workspaceId }, settled).catch(() => undefined);
  }, [key, userId, workspaceId, settled]);
  return visible;
}
