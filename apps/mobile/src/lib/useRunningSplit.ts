import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import { createUndoHoldLease, undoHoldDeliverAfter } from "./deletionUndoHold";
import { DELETION_UNDO_MS } from "./historyDeletion";
import type { MobileAccountOwner } from "./mobileAccount";
import {
  enqueueTimeEntrySplit,
  readPendingTimeEntryCommands,
  releaseTimeEntryCommands,
  removeTimeEntryCommands,
  wereTimeEntryCommandsDispatched,
  type TimeEntryCommandHoldLease
} from "./timeEntryOutbox";
import { OPTIMISTIC_TIMER_ID_PREFIX, optimisticSplitTimeEntry } from "./timerPresentation";

/** A split shown with its Undo: the block it ended, its running second part and the held command. */
export type HeldRunningSplit = {
  token: number;
  firstId: string;
  secondId: string;
  splitAt: string;
  title: string;
  swatchEntry: MobileTimeEntry;
  commandId: string | null;
};

/**
 * Split for the running block on iPhone (owner 28 Oct 2026, as Toggl). The split shows at once (no spinner):
 * the block ends at the chosen minute and its second part keeps running under a local id. The command is
 * durable at once but held for the Undo window, as a sheet Delete is (a force-quit keeps it, and it goes when
 * the window would have closed). Undo, while nothing was sent and the second part still runs, removes it and
 * shows one running block again; otherwise the window closing releases it to the outbox, which sends it and
 * records the second part's server id, so a Stop or Edit made of that part follows it.
 */
export function useRunningSplit(input: {
  read: () => MobileBootstrap | null;
  update: (change: (current: MobileBootstrap | null) => MobileBootstrap | null) => void;
  owner: (bootstrap: MobileBootstrap) => MobileAccountOwner;
  /** The block's server id, or null while its Start is still queued (then its local id is the target). */
  persistedId: (entryId: string) => string | null;
  isOnline: () => boolean;
  /** Runs after the window closes: the outbox's delivery and a reload, in the dashboard's timer order. */
  deliver: (owner: MobileAccountOwner) => void;
  onStorageFailure: () => void;
}) {
  const [held, setHeld] = useState<HeldRunningSplit | null>(null);
  const heldRef = useRef<HeldRunningSplit | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lease = useRef<TimeEntryCommandHoldLease | null>(null);
  const deps = useRef(input);
  deps.current = input;

  const show = useCallback((next: HeldRunningSplit | null) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  /** Lets the held split go: its Undo has closed. */
  const commit = useCallback((split: HeldRunningSplit) => {
    if (heldRef.current?.token === split.token) show(null);
    if (!split.commandId) return;
    const bootstrap = deps.current.read();
    if (!bootstrap) return;
    const owner = deps.current.owner(bootstrap);
    void releaseTimeEntryCommands([split.commandId], { owner, requestImmediateDelivery: deps.current.isOnline() })
      .then(() => deps.current.deliver(owner))
      .catch(() => deps.current.deliver(owner));
  }, [show]);

  const getLease = useCallback(() => {
    if (!lease.current || lease.current.ended) {
      // A hold that ran past its bound is about to be delivered: its Undo closes as if it expired.
      lease.current = createUndoHoldLease((commandId) => {
        const current = heldRef.current;
        if (current?.commandId === commandId) commit(current);
      });
    }
    return lease.current;
  }, [commit]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    // The dashboard going away (sign-out, teardown): the split stands, unheld, as after a force-quit.
    lease.current?.end();
  }, []);

  /** Splits the running block at `atMs`; false when there is nothing running to split. */
  const split = useCallback(async (atMs: number) => {
    const bootstrap = deps.current.read();
    const running = bootstrap?.activeEntry;
    if (!bootstrap || !running) return false;
    const splitAt = new Date(atMs).toISOString();
    const startedMs = Date.parse(running.startedAt);
    if (!(atMs > startedMs && atMs < Date.now())) return false;
    // An earlier split still in its window goes now: one Undo at a time.
    const earlier = heldRef.current;
    if (timer.current) clearTimeout(timer.current);
    if (earlier) commit(earlier);
    const next: HeldRunningSplit = {
      token: ++token.current,
      firstId: running.id,
      // The timer's local id prefix: a Stop or Edit of it waits for the server's id, as for a queued Start.
      secondId: `${OPTIMISTIC_TIMER_ID_PREFIX}split:${Date.now()}:${token.current}`,
      splitAt,
      title: running.description?.trim() || running.categoryName || "Block",
      swatchEntry: running,
      commandId: null
    };
    deps.current.update((current) => optimisticSplitTimeEntry(current, next.firstId, splitAt, next.secondId));
    show(next);
    AccessibilityInfo.announceForAccessibility(`Split ${next.title}. Undo available.`);
    timer.current = setTimeout(() => {
      timer.current = null;
      const current = heldRef.current;
      if (current?.token === next.token) commit(current);
    }, DELETION_UNDO_MS);
    const owner = deps.current.owner(bootstrap);
    const persistedId = deps.current.persistedId(running.id);
    try {
      const command = await enqueueTimeEntrySplit({
        owner,
        target: persistedId ? { targetEntryId: persistedId } : { optimisticEntryId: running.id },
        splitAt,
        splitEntryLocalId: next.secondId,
        deliverAfter: undoHoldDeliverAfter(Date.now()),
        holdLease: getLease()
      });
      const current = heldRef.current;
      if (current?.token === next.token) {
        const withCommand = { ...current, commandId: command.clientCommandId };
        heldRef.current = withCommand;
        setHeld(withCommand);
      } else {
        // Its window already closed while it was written: it goes now.
        commit({ ...next, commandId: command.clientCommandId });
      }
      return true;
    } catch {
      if (heldRef.current?.token === next.token) show(null);
      deps.current.update((current) => joinOptimisticSplit(current, next.firstId, next.secondId));
      deps.current.onStorageFailure();
      return false;
    }
  }, [commit, getLease, show]);

  /**
   * Undo: one running block again. Only while the second part is the running block and nothing was sent;
   * Edits made to the second part in the window go with it. False when it is too late.
   */
  const undo = useCallback(async () => {
    const current = heldRef.current;
    if (!current?.commandId) return false;
    const bootstrap = deps.current.read();
    if (
      !bootstrap ||
      bootstrap.activeEntry?.id !== current.secondId ||
      wereTimeEntryCommandsDispatched([current.commandId])
    ) {
      commit(current);
      return false;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    show(null);
    const owner = deps.current.owner(bootstrap);
    const forSecond = (await readPendingTimeEntryCommands(owner))
      .filter((command) => command.optimisticEntryId === current.secondId)
      .map((command) => command.clientCommandId);
    await removeTimeEntryCommands([current.commandId, ...forSecond]);
    deps.current.update((data) => joinOptimisticSplit(data, current.firstId, current.secondId));
    return true;
  }, [commit, show]);

  return { held, split, undo };
}

/** The split's parts shown as one again: the first takes the second's end (running when it ran). */
export function joinOptimisticSplit(data: MobileBootstrap | null, firstId: string, secondId: string): MobileBootstrap | null {
  if (!data) return data;
  const all = [data.activeEntry, ...data.entries, ...(data.dayEntries ?? []), ...(data.weekEntries ?? [])];
  const first = all.find((entry) => entry?.id === firstId);
  const second = all.find((entry) => entry?.id === secondId);
  if (!first || !second) return data;
  // The first part's details: Edits made to the second part in the window go with it.
  const joined: MobileTimeEntry = { ...first, stoppedAt: second.stoppedAt };
  const swap = (entries: MobileTimeEntry[]) =>
    entries.filter((entry) => entry.id !== secondId).map((entry) => entry.id === firstId ? joined : entry);
  return {
    ...data,
    activeEntry: data.activeEntry?.id === secondId ? joined : data.activeEntry,
    entries: swap(data.entries),
    dayEntries: data.dayEntries ? swap(data.dayEntries) : data.dayEntries,
    weekEntries: data.weekEntries ? swap(data.weekEntries) : data.weekEntries
  };
}
