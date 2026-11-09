"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useReportDeletedBlocks } from "@/components/location/ListChecks";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  TimelineDeleteUndoController,
  initialTimelineDeleteUndoState,
  type TimelineDeleteRequest,
  type TimelineDeleteTransaction,
  type TimelineDeleteUndoState
} from "@/lib/timeline-delete-undo-controller";

export function useTimelineDeleteUndo({
  entryIds,
  onSynced
}: {
  entryIds: ReadonlySet<string>;
  /** After a delete commits, with the deleted blocks' ids. */
  onSynced: (entryIds: readonly string[]) => Promise<void>;
}) {
  const [state, setState] = useState<TimelineDeleteUndoState>(initialTimelineDeleteUndoState);
  // The controller outlives renders; a delete that commits after a period change must reload the
  // period shown then, so it calls the newest onSynced, never the first render's (WEB-UI-3).
  const [{ controller, latest }] = useState(() => {
    let latestOnSynced = onSynced;
    const latest = { set: (next: (entryIds: readonly string[]) => Promise<void>) => { latestOnSynced = next; } };
    const controller = new TimelineDeleteUndoController(
      async (transaction, options) => {
        await commitTimelineDelete(transaction, options);
        try {
          await latestOnSynced(transaction.ids);
        } catch {
          // The server commit succeeded. Keep the transaction hidden until a later reconciliation.
        }
      },
      setState
    );
    return { controller, latest };
  });
  useLayoutEffect(() => {
    latest.set(onSynced);
  }, [latest, onSynced]);

  useEffect(() => {
    const finalizeForPageHide = () => controller.finalizePendingDelete();
    window.addEventListener("pagehide", finalizeForPageHide);
    return () => {
      window.removeEventListener("pagehide", finalizeForPageHide);
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.reconcileEntryIds(entryIds);
  }, [controller, entryIds]);

  // Deleted here and held for Undo: their "block ran into your trip" stops asking at once (Codex r1 on #618).
  useReportDeletedBlocks(state.hiddenEntryIds);

  const requestDelete = useCallback((request: TimelineDeleteRequest) => {
    controller.requestDelete(request);
  }, [controller]);

  return {
    error: state.error,
    failedDelete: state.failed,
    hiddenEntryIds: state.hiddenEntryIds,
    pendingNotice: state.notice,
    requestDelete,
    dismissDeleteError: () => controller.dismissError(),
    undoPendingDelete: () => controller.undoPendingDelete()
  };
}

async function commitTimelineDelete(
  transaction: TimelineDeleteTransaction,
  options: { keepalive: boolean }
) {
  const response = transaction.ids.length === 1
    ? await clientFetch(`/api/time-entries/${transaction.ids[0]}`, {
      keepalive: options.keepalive,
      method: "DELETE"
    })
    : await clientFetch("/api/time-entries/batch-delete", {
      body: JSON.stringify({ ids: transaction.ids }),
      headers: { "Content-Type": "application/json" },
      keepalive: options.keepalive,
      method: "POST"
    });

  if (response.ok) return;
  let message = `Unable to delete this ${transaction.ids.length === 1 ? "entry" : "group"}: ${response.status}`;
  try {
    const payload = await response.json() as { error?: string };
    message = payload.error ?? message;
  } catch {
    // Failed requests do not always carry a JSON response body.
  }
  throw new Error(message);
}
