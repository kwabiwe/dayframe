import { useEffect, useState } from "react";
import {
  readAcknowledgedTimelineCorrections,
  readPendingTimelineCorrections,
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
const waiting = (items: readonly PendingTimelineCorrection[]) => items.filter((item) => item.failureKind !== "permanent").length;

/**
 * The signed-in account's queued location timeline corrections (step 12), read again whenever the queue
 * changes, for the List to show over the timeline (`projectTimelineCorrections`) and to say why a refused
 * one came back. `acknowledged` are those the server has had for a few minutes: the List keeps showing them
 * until a timeline read after them lands. `delivered` counts the times the queue shrank (once per send pass),
 * so the List reads the timeline again then.
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
          return {
            key: ownerKey,
            items,
            acknowledged: readAcknowledgedTimelineCorrections({ userId, workspaceId }),
            delivered: (same ? previous.delivered : 0) + (shrank ? 1 : 0)
          };
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
  return { pending: mine?.items ?? NONE, acknowledged: mine?.acknowledged ?? NONE_ACKNOWLEDGED, delivered: mine?.delivered ?? 0 };
}
