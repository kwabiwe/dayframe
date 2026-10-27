import { useEffect, useState } from "react";
import {
  readPendingTimelineCorrections,
  subscribeTimelineCorrectionOutbox,
  type PendingTimelineCorrection
} from "./timelineCorrectionOutbox";

type Stored = { key: string; items: readonly PendingTimelineCorrection[]; delivered: number };
const NONE: readonly PendingTimelineCorrection[] = [];
const waiting = (items: readonly PendingTimelineCorrection[]) => items.filter((item) => item.failureKind !== "permanent").length;

/**
 * The signed-in account's queued location timeline corrections (step 12), read again whenever the queue
 * changes, for the List to show over the timeline (`projectTimelineCorrections`) and to say why a refused
 * one came back. `delivered` counts the times the queue shrank, so the List reads the timeline again then.
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
        setStored((previous) => {
          const same = previous?.key === ownerKey;
          const shrank = same && waiting(items) < waiting(previous.items);
          return { key: ownerKey, items, delivered: (same ? previous.delivered : 0) + (shrank ? 1 : 0) };
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
  return { pending: mine?.items ?? NONE, delivered: mine?.delivered ?? 0 };
}
