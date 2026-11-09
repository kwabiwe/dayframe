import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import { createUndoHoldLease, undoHoldDeliverAfter } from "./deletionUndoHold";
import { DELETION_UNDO_MS } from "./historyDeletion";
import { mobileAccountOwnersEqual, type MobileAccountOwner } from "./mobileAccount";
import { runningSplitBounds } from "./runningSplitBounds";
import {
  enqueueTimeEntrySplit,
  OPTIMISTIC_RUNNING_SPLIT_ID_PREFIX,
  releaseTimeEntryCommands,
  undoHeldTimeEntrySplit,
  type TimeEntryCommandHoldLease
} from "./timeEntryOutbox";
import { optimisticSplitTimeEntry } from "./timerPresentation";

export type HeldRunningSplit = {
  token: number;
  owner: MobileAccountOwner;
  generation: number;
  firstId: string;
  secondId: string;
  splitAt: string;
  title: string;
  swatchEntry: MobileTimeEntry;
  commandId: string;
};

/** A running Split is durable before it is shown. Undo cancels the held request before it can be sent. */
export function useRunningSplit(input: {
  read: () => MobileBootstrap | null;
  update: (change: (current: MobileBootstrap | null) => MobileBootstrap | null) => void;
  owner: (bootstrap: MobileBootstrap) => MobileAccountOwner;
  generation: () => number;
  persistedId: (entryId: string) => string | null;
  isOnline: () => boolean;
  deliver: (owner: MobileAccountOwner, commandId: string) => void;
  onStorageFailure: () => void;
}) {
  const [held, setHeld] = useState<HeldRunningSplit | null>(null);
  const heldRef = useRef<HeldRunningSplit | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lease = useRef<TimeEntryCommandHoldLease | null>(null);
  const changing = useRef(false);
  const undoFlight = useRef<Promise<boolean> | null>(null);
  const deps = useRef(input);
  deps.current = input;

  const show = useCallback((next: HeldRunningSplit | null) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  const isCurrentOwner = useCallback((owner: MobileAccountOwner, generation: number) => {
    const current = deps.current.read();
    return Boolean(current && deps.current.generation() === generation &&
      mobileAccountOwnersEqual(deps.current.owner(current), owner));
  }, []);

  const commit = useCallback((split: HeldRunningSplit) => {
    if (heldRef.current?.token === split.token) show(null);
    const online = isCurrentOwner(split.owner, split.generation) && deps.current.isOnline();
    const deliver = () => {
      if (isCurrentOwner(split.owner, split.generation)) deps.current.deliver(split.owner, split.commandId);
    };
    void releaseTimeEntryCommands([split.commandId], { owner: split.owner, requestImmediateDelivery: online })
      .then(deliver, deliver);
  }, [isCurrentOwner, show]);

  const getLease = useCallback(() => {
    if (!lease.current || lease.current.ended) {
      lease.current = createUndoHoldLease((commandId) => {
        const current = heldRef.current;
        if (current?.commandId === commandId) commit(current);
      });
    }
    return lease.current;
  }, [commit]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    lease.current?.end();
  }, []);

  const split = useCallback(async (entryId: string, atMs: number) => {
    const bootstrap = deps.current.read();
    const running = bootstrap?.activeEntry;
    if (changing.current || !bootstrap?.serverBuild?.runningEntrySplit || !running) return false;
    const identity = (id: string) => deps.current.persistedId(id) ?? id;
    if (identity(running.id) !== identity(entryId)) return false;
    const bounds = runningSplitBounds(Date.parse(running.startedAt), Date.now());
    if (!bounds || !Number.isFinite(atMs) || atMs % 60_000 || atMs < bounds.minMs || atMs > bounds.maxMs) return false;

    changing.current = true;
    const owner = deps.current.owner(bootstrap);
    const generation = deps.current.generation();
    const stillRunning = () => {
      const active = deps.current.read()?.activeEntry;
      return Boolean(active && identity(active.id) === identity(entryId) && isCurrentOwner(owner, generation));
    };
    const nextToken = ++token.current;
    const splitAt = new Date(atMs).toISOString();
    const secondId = `${OPTIMISTIC_RUNNING_SPLIT_ID_PREFIX}${Date.now()}:${nextToken}`;
    try {
      const persistedId = deps.current.persistedId(running.id);
      const command = await enqueueTimeEntrySplit({
        owner,
        target: persistedId ? { targetEntryId: persistedId } : { optimisticEntryId: running.id },
        splitAt,
        splitEntryLocalId: secondId,
        deliverAfter: undoHoldDeliverAfter(Date.now()),
        holdLease: getLease()
      });
      if (command.failureKind === "permanent") return false;
      if (!stillRunning()) {
        // The exact timer or owner changed while storage was pending. Cancel before the hold releases.
        await undoHeldTimeEntrySplit(owner, command.clientCommandId, () => true);
        return false;
      }
      if (timer.current) clearTimeout(timer.current);
      const earlier = heldRef.current;
      if (earlier) commit(earlier);
      const next = {
        token: nextToken, owner, generation, firstId: running.id, secondId, splitAt,
        title: running.description?.trim() || running.categoryName || "Block",
        swatchEntry: running, commandId: command.clientCommandId
      };
      deps.current.update((current) => current?.activeEntry && stillRunning()
        ? optimisticSplitTimeEntry(current, current.activeEntry.id, splitAt, secondId)
        : current);
      show(next);
      AccessibilityInfo.announceForAccessibility(`Split ${next.title}. Undo available.`);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (heldRef.current?.token === next.token) commit(next);
      }, DELETION_UNDO_MS);
      return true;
    } catch {
      if (isCurrentOwner(owner, generation)) deps.current.onStorageFailure();
      return false;
    } finally {
      changing.current = false;
    }
  }, [commit, getLease, isCurrentOwner, show]);

  const undoSplit = useCallback(async () => {
    const current = heldRef.current;
    if (!current || changing.current) return false;
    const stillRunning = () => isCurrentOwner(current.owner, current.generation) &&
      deps.current.read()?.activeEntry?.id === current.secondId;
    changing.current = true;
    try {
      if (!await undoHeldTimeEntrySplit(current.owner, current.commandId, stillRunning)) {
        commit(current);
        return false;
      }
      if (heldRef.current?.token === current.token) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        show(null);
      }
      if (stillRunning()) {
        const firstId = deps.current.persistedId(current.firstId) ?? current.firstId;
        deps.current.update((data) => joinOptimisticSplit(data, firstId, current.secondId));
      }
      return true;
    } catch {
      if (isCurrentOwner(current.owner, current.generation)) deps.current.onStorageFailure();
      return false;
    } finally {
      changing.current = false;
    }
  }, [commit, isCurrentOwner, show]);

  const undo = useCallback(() => {
    if (undoFlight.current) return undoFlight.current;
    const flight = undoSplit();
    undoFlight.current = flight;
    void flight.finally(() => {
      if (undoFlight.current === flight) undoFlight.current = null;
    });
    return flight;
  }, [undoSplit]);

  function finishBeforeTimerChange(entryId: string) {
    const current = heldRef.current;
    if (current?.secondId === entryId && isCurrentOwner(current.owner, current.generation)) commit(current);
  }

  return { held, split, undo, undoInFlight: () => undoFlight.current, finishBeforeTimerChange };
}

/** The first part takes its running end again. Edits to the discarded second part leave with it. */
function joinOptimisticSplit(data: MobileBootstrap | null, firstId: string, secondId: string): MobileBootstrap | null {
  if (!data || data.activeEntry?.id !== secondId) return data;
  const all = [...data.entries, ...(data.dayEntries ?? []), ...(data.weekEntries ?? [])];
  const first = all.find((entry) => entry.id === firstId);
  if (!first) return data;
  const joined: MobileTimeEntry = { ...first, stoppedAt: null, durationSeconds: 0 };
  const swap = (entries: MobileTimeEntry[]) =>
    entries.filter((entry) => entry.id !== secondId).map((entry) => entry.id === firstId ? joined : entry);
  return {
    ...data,
    activeEntry: joined,
    entries: swap(data.entries),
    dayEntries: data.dayEntries ? swap(data.dayEntries) : data.dayEntries,
    weekEntries: data.weekEntries ? swap(data.weekEntries) : data.weekEntries
  };
}
