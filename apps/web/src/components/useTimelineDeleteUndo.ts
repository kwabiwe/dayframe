"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useReportDeletedBlocks } from "@/components/location/ListChecks";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { clientFetch } from "@/lib/client-auth-fetch";
import { onBeforeSessionChange } from "@/lib/session-change";
import {
  TimelineDeleteUndoController,
  initialTimelineDeleteUndoState,
  type TimelineDeleteRequest,
  type TimelineDeleteTransaction,
  type TimelineDeleteUndoState
} from "@/lib/timeline-delete-undo-controller";

type SyncDeleted = (entryIds: readonly string[]) => Promise<void>;
type SharedDeleteUndo = {
  controller: TimelineDeleteUndoController;
  state: TimelineDeleteUndoState;
  registerSync: (sync: SyncDeleted) => () => void;
};

const DeleteUndoContext = createContext<SharedDeleteUndo | null>(null);
const EMPTY_STATE = initialTimelineDeleteUndoState();

function createDeleteLifetime(owner: string, publish: (snapshot: Pick<SharedDeleteUndo, "controller" | "state">) => void) {
  let activeSync: { run: SyncDeleted } | null = null;
  let fallbackSync: SyncDeleted | null = null;
  let mounted = false;
  const controller: TimelineDeleteUndoController = new TimelineDeleteUndoController(async (transaction, options) => {
    await commitTimelineDelete(transaction, options);
    // A previous account cannot refresh the new one after a late reply.
    const sync = mounted ? activeSync?.run ?? fallbackSync : null;
    if (sync) await refreshAfterDelete(sync, transaction.ids);
  }, (state) => { if (mounted) publish({ controller, state }); });

  return {
    owner,
    controller,
    registerSync: (run: SyncDeleted) => {
      const registration = { run };
      activeSync = registration;
      return () => { if (activeSync === registration) activeSync = null; };
    },
    setFallbackSync: (sync: SyncDeleted) => { fallbackSync = sync; },
    connect: () => {
      mounted = true;
      return () => {
        mounted = false;
        // React can replay the mount effect without ending this owner. On a real owner change,
        // abandon pending state. Explicit workspace changes and pagehide dispatch first.
        queueMicrotask(() => { if (!mounted) controller.dispose(false); });
      };
    }
  };
}

/** Keeps one Undo and one delivery owner across routes, scoped to the shell's account and workspace. */
export function TimelineDeleteUndoProvider({ children, onSynced, owner }: {
  children: ReactNode;
  onSynced: SyncDeleted;
  owner: string;
}) {
  const [published, setPublished] = useState<Pick<SharedDeleteUndo, "controller" | "state"> | null>(null);
  const [lifetime, setLifetime] = useState(() => createDeleteLifetime(owner, setPublished));
  if (lifetime.owner !== owner) setLifetime(createDeleteLifetime(owner, setPublished));
  const { controller, registerSync, setFallbackSync, connect } = lifetime;
  const state = published?.controller === controller ? published.state : EMPTY_STATE;
  useLayoutEffect(() => { setFallbackSync(onSynced); }, [onSynced, setFallbackSync]);
  useLayoutEffect(connect, [connect]);
  useEffect(() => {
    const finalizeForPageHide = () => controller.finalizePendingDelete();
    window.addEventListener("pagehide", finalizeForPageHide);
    const unregister = onBeforeSessionChange(async () => finalizeForPageHide());
    return () => {
      unregister();
      window.removeEventListener("pagehide", finalizeForPageHide);
    };
  }, [controller]);

  useReportDeletedBlocks(state.hiddenEntryIds);
  const value = useMemo(() => ({ controller, registerSync, state }), [controller, registerSync, state]);
  return createElement(DeleteUndoContext.Provider, { value }, children);
}

/** A pending delete still has Undo and error feedback on pages without their own block list. */
export function TimelineDeleteFallbackNotice() {
  const shared = useContext(DeleteUndoContext);
  if (!shared) return null;
  const { controller, state } = shared;
  if (state.notice) return createElement(BlocksToast, {
    actionLabel: "Undo", exiting: state.notice.isExiting, key: state.notice.token, message: state.notice.label,
    onAction: () => controller.undoPendingDelete()
  });
  if (!state.error) return null;
  return createElement(BlocksToast, {
    actionLabel: "Dismiss", message: state.error, onAction: () => controller.dismissError(), tone: "error"
  });
}

export function useTimelineDeleteUndo({
  entryIds,
  onSynced
}: {
  entryIds: ReadonlySet<string>;
  /** After a delete commits, with the deleted blocks' ids. */
  onSynced: SyncDeleted;
}) {
  const shared = useContext(DeleteUndoContext);
  const [localState, setLocalState] = useState(EMPTY_STATE);
  // Standalone surfaces still work without the authenticated shell.
  const [local] = useState(() => {
    if (shared) return null;
    let latestOnSynced = onSynced;
    const setSync = (next: SyncDeleted) => { latestOnSynced = next; };
    const controller = new TimelineDeleteUndoController(
      async (transaction, options) => {
        await commitTimelineDelete(transaction, options);
        await refreshAfterDelete(latestOnSynced, transaction.ids);
      },
      setLocalState
    );
    return { controller, setSync };
  });
  const controller = shared?.controller ?? local!.controller;
  const state = shared?.state ?? localState;
  const registerSync = shared?.registerSync;
  useLayoutEffect(() => {
    local?.setSync(onSynced);
    return registerSync?.(onSynced);
  }, [local, onSynced, registerSync]);

  useEffect(() => {
    if (!local) return;
    const finalizeForPageHide = () => local.controller.finalizePendingDelete();
    window.addEventListener("pagehide", finalizeForPageHide);
    return () => {
      window.removeEventListener("pagehide", finalizeForPageHide);
      local.controller.dispose();
    };
  }, [local]);

  useEffect(() => {
    controller.reconcileEntryIds(entryIds);
  }, [controller, entryIds]);

  // Deleted here and held for Undo: their "block ran into your trip" stops asking at once (Codex r1 on #618).
  useReportDeletedBlocks(local ? localState.hiddenEntryIds : EMPTY_STATE.hiddenEntryIds);

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

async function refreshAfterDelete(sync: SyncDeleted, ids: readonly string[]) {
  try {
    await sync(ids);
  } catch {
    // The server commit succeeded. Keep the transaction hidden until a later reconciliation.
  }
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
