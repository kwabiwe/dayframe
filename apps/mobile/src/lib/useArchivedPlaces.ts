import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { createArchivedReadGate } from "./activitiesPage";
import { AuthRequiredError, fetchArchivedPlaces, setPlaceArchived, type MobileArchivedPlace } from "./api";
import { friendlyMobileErrorMessage } from "./friendlyError";
import { currentMobileAccountEpoch, mobileAccountKey, readActiveMobileAccount } from "./mobileAccount";
import {
  createPlaceRestoreGate,
  restoredNotMonitoredMessage,
  restoredNotRefreshedMessage,
  type RestoreRefreshOutcome
} from "./placesPage";

type ArchivedPlace = { id: string; name: string };
/**
 * A restored place whose monitoring hasn't been refreshed from a list that has it (Codex r3/r4 on
 * #508). Every one keeps the page retrying until monitoring is refreshed, whatever went wrong.
 * `waiting` is presentation only: its own refresh didn't apply, so it shows under Saved places
 * (when the list shown lacks it). `warned`: it was announced with a warning, so its recovery is
 * announced too.
 */
type UnmonitoredRestore = ArchivedPlace & { waiting: boolean; warned: boolean };

/** What transient state is tagged with: the account and the account lifetime it was made in. */
function lifetimeKey(accountKey: string, epoch: number) {
  return `${accountKey}|${epoch}`;
}

/**
 * Places › Archived on iPhone (location v3 PR 15b, PRD D19 A10): the archived list, its reads and
 * Restore, for the account the page shows. Every piece of state carries the account it belongs to,
 * so another account never sees a name, a busy pill, a problem line or an announcement from before
 * (Codex r1 on #508). Lasting state is kept per account: the archived list (the server's word) and
 * the restores still to be monitored, which survive another account's restores and come back with
 * the account (Codex r9 on #508). Transient state (the busy pill, the problem line, the gate) also
 * carries the account lifetime that made it, and shows or holds only in that lifetime. Restore is one request at a time through a synchronous gate that only the
 * request holding it releases. Every accepted restore is tracked until monitoring has been refreshed
 * from a list that has the place, for its account (`unmonitoredRestoredIn` / `settleMonitoredRestored`),
 * whichever read brings it, and the page retries while any is unresolved (`restoreMonitoringUnresolved`);
 * one whose own refresh did not land also waits under Saved places (`pendingRestored`), so the place
 * is never in neither list and is never left unmonitored. A restore is announced as done only once it
 * is monitored; until then it is announced with the warning that holds, and its recovery is
 * announced when it lands (Codex r1–r4 on #508).
 */
export function useArchivedPlaces({
  onSignedOut,
  refreshAfterRestore,
  shownAccountKey
}: {
  onSignedOut: () => void;
  /**
   * The page's refresh after an accepted restore. It calls `settle` once, before any side effect of
   * its own: in the same render that applies the refreshed list ("applied"), or when another change
   * made it stale or it failed. `settle` returns false when the restore no longer belongs to the
   * account shown, and the page then applies and says nothing (Codex r2 on #508).
   */
  refreshAfterRestore: (place: ArchivedPlace, settle: (outcome: RestoreRefreshOutcome) => boolean) => Promise<void>;
  shownAccountKey: string | null;
}) {
  const [archived, setArchived] = useState<{ accountKey: string; places: MobileArchivedPlace[] } | null>(null);
  // Transient: tagged with `lifetimeKey` (the account and the lifetime it was made in).
  const [restoring, setRestoring] = useState<{ token: number; owner: string; id: string } | null>(null);
  const [problem, setProblem] = useState<{ owner: string; message: string } | null>(null);
  // Restores still to be monitored, per account until each settles (Codex r9 on #508).
  const [pending, setPendingState] = useState<Readonly<Record<string, UnmonitoredRestore[]>>>({});
  const pendingRef = useRef(pending);
  // Restores settled because a later list no longer had the place (archived or deleted elsewhere
  // since), by account: they are never announced or shown as restored (owner follow-up on #508).
  const goneRef = useRef(new Set<string>());
  // Only the newest archived read applies, and none that was out while a restore or an archive landed.
  const reads = useRef(createArchivedReadGate()).current;
  // Counts archived lists applied from a read: one applied after a restore was accepted is the
  // server's word since, which an overtaken restore never edits (Codex r7 on #508).
  const archivedReadsApplied = useRef(0);
  const gate = useRef(createPlaceRestoreGate()).current;
  const mounted = useRef(true);
  const shownAccountRef = useRef(shownAccountKey);
  shownAccountRef.current = shownAccountKey;
  const onSignedOutRef = useRef(onSignedOut);
  onSignedOutRef.current = onSignedOut;
  const refreshRef = useRef(refreshAfterRestore);
  refreshRef.current = refreshAfterRestore;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** The restores of `accountKey` still to be monitored. */
  const pendingFor = useCallback((accountKey: string) => pendingRef.current[accountKey] ?? [], []);
  /** Replaces `accountKey`'s unmonitored restores, leaving every other account's as they are. */
  const setPendingFor = useCallback((accountKey: string, places: UnmonitoredRestore[]) => {
    const next = { ...pendingRef.current };
    if (places.length > 0) next[accountKey] = places;
    else delete next[accountKey];
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  const load = useCallback(async () => {
    const read = reads.begin();
    const epoch = currentMobileAccountEpoch();
    const owner = await readActiveMobileAccount();
    if (!owner) return;
    try {
      const places = await fetchArchivedPlaces();
      if (!mounted.current || !reads.current(read)) return;
      const now = await readActiveMobileAccount();
      if (!now || mobileAccountKey(now) !== mobileAccountKey(owner) || currentMobileAccountEpoch() !== epoch || !reads.current(read)) return;
      archivedReadsApplied.current += 1;
      setArchived({ accountKey: mobileAccountKey(owner), places });
    } catch {
      // Signed out or offline: the page read says so; this section never breaks the page.
    }
  }, [reads]);

  /** An archive, a restore or Replace landed: a read already out is dropped (call `load` after). */
  const changed = useCallback(() => reads.changed(), [reads]);

  /** Restored places of `accountKey` that `places` has and whose monitoring is still unrefreshed. */
  const unmonitoredRestoredIn = useCallback((accountKey: string, places: readonly { id: string }[]) => {
    const listed = new Set(places.map((place) => place.id));
    return pendingFor(accountKey).filter((place) => listed.has(place.id)).map((place) => place.id);
  }, [pendingFor]);

  /**
   * Monitoring was refreshed for `accountKey` from a list that has `ids`: they are settled. Returns
   * the names of those announced with a warning, whose recovery the page announces (and whose
   * warning line it clears).
   */
  const settleMonitoredRestored = useCallback((accountKey: string, ids: readonly string[]) => {
    const current = pendingFor(accountKey);
    if (current.length === 0 || ids.length === 0) return [];
    const settled = new Set(ids);
    const warned = current.filter((place) => settled.has(place.id) && place.warned).map((place) => place.name);
    setPendingFor(accountKey, current.filter((place) => !settled.has(place.id)));
    return warned;
  }, [pendingFor, setPendingFor]);

  /**
   * A list for `accountKey` that started after its restores were accepted (the page only applies
   * those) lacks some of them: the server no longer has them as active places (archived or deleted
   * elsewhere since), so there is nothing to monitor. They settle silently; returns their ids so
   * the page clears a warning line for them. Never announced as restored.
   */
  const settleGone = useCallback((accountKey: string, isGone: (id: string) => boolean) => {
    const current = pendingFor(accountKey);
    const gone = current.filter((place) => isGone(place.id)).map((place) => place.id);
    if (gone.length === 0) return [];
    for (const id of gone) goneRef.current.add(`${accountKey}|${id}`);
    setPendingFor(accountKey, current.filter((place) => !isGone(place.id)));
    return gone;
  }, [pendingFor, setPendingFor]);

  const settleRestoresAbsentFrom = useCallback((accountKey: string, places: readonly { id: string }[]) => {
    const listed = new Set(places.map((place) => place.id));
    return settleGone(accountKey, (id) => !listed.has(id));
  }, [settleGone]);

  /**
   * Restored places of `accountKey` that were archived or deleted again on this iPhone since (Codex
   * r6 on #508): settled silently as gone, like a list that lacks them; returns their ids.
   */
  const settleRestoresRemoved = useCallback((accountKey: string, ids: readonly string[]) => {
    const removed = new Set(ids);
    return settleGone(accountKey, (id) => removed.has(id));
  }, [settleGone]);

  /** Whether the restore of `id` settled because the place is gone again (for the account shown). */
  const restoreGone = useCallback((id: string) => goneRef.current.has(`${shownAccountRef.current}|${id}`), []);

  /** The restore of `id` was announced with a warning: its recovery will be announced too. */
  const markWarned = useCallback((accountKey: string, id: string) => {
    const current = pendingFor(accountKey);
    if (!current.some((place) => place.id === id)) return;
    setPendingFor(accountKey, current.map((place) => (place.id === id ? { ...place, warned: true } : place)));
  }, [pendingFor, setPendingFor]);

  /** Whether the restore of `id` is still unmonitored for the account shown. */
  const restoreUnresolved = useCallback((id: string) => {
    const accountKey = shownAccountRef.current;
    return Boolean(accountKey && pendingFor(accountKey).some((place) => place.id === id));
  }, [pendingFor]);

  const restore = useCallback(async (place: ArchivedPlace) => {
    const accountKey = shownAccountRef.current;
    if (!accountKey) return;
    // The account lifetime this restore belongs to: a sign-out, or a switch away and back, ends it.
    const epoch = currentMobileAccountEpoch();
    const owner = lifetimeKey(accountKey, epoch);
    // One at a time per account lifetime: a request still out from an earlier one never holds it.
    const token = gate.take(owner);
    if (token === null) return;
    const clearBusy = () => setRestoring((current) => (current?.token === token ? null : current));
    setRestoring({ token, owner, id: place.id });
    setProblem((current) => (current?.owner === owner ? null : current));
    try {
      const active = await readActiveMobileAccount();
      // Started for the account the page shows, and still in that account's lifetime; otherwise its
      // answer changes nothing on screen and says nothing to VoiceOver.
      const stillOurs = async () => {
        if (!mounted.current || !active || mobileAccountKey(active) !== accountKey) return false;
        const now = await readActiveMobileAccount();
        return Boolean(now && mounted.current && mobileAccountKey(now) === accountKey && currentMobileAccountEpoch() === epoch);
      };
      if (!active || mobileAccountKey(active) !== accountKey) {
        clearBusy();
        return;
      }
      try {
        await setPlaceArchived(place.id, false);
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          clearBusy();
          if (mounted.current) onSignedOutRef.current();
          return;
        }
        const ours = await stillOurs();
        clearBusy();
        if (!ours) return;
        // The row stays where it was, with the reason under the group (no system alert: UIA-005).
        const message = friendlyMobileErrorMessage(error, `Couldn't restore ${place.name}. Try again.`);
        setProblem({ owner, message });
        AccessibilityInfo.announceForAccessibility(message);
        return;
      }
      if (!(await stillOurs())) {
        clearBusy();
        return;
      }
      // Accepted: a read that started before this answer is dropped. The row leaves Archived in the
      // same render as the refreshed list brings the place back under Saved places; when that list
      // doesn't come, the place waits under Saved places as restored until a later read lands.
      reads.changed();
      const archivedAtAccept = archivedReadsApplied.current;
      // Tracked from now until a list with the place has refreshed monitoring, whichever read brings it.
      goneRef.current.delete(`${accountKey}|${place.id}`);
      setPendingFor(accountKey, [
        ...pendingFor(accountKey).filter((item) => item.id !== place.id),
        { id: place.id, name: place.name, waiting: false, warned: false }
      ]);
      const settledWith: { outcome: RestoreRefreshOutcome | null } = { outcome: null };
      await refreshRef.current(place, (settled) => {
        // Checked synchronously before anything changes: the same account lifetime, still shown.
        if (!mounted.current || currentMobileAccountEpoch() !== epoch || shownAccountRef.current !== accountKey) {
          clearBusy();
          return false;
        }
        settledWith.outcome = settled;
        // The row leaves Archived only from the list read before the restore: one read since (the
        // place archived again, here or elsewhere) is kept as it is (Codex r7 on #508).
        if (archivedReadsApplied.current === archivedAtAccept) {
          setArchived((current) => current && current.accountKey === accountKey
            ? { ...current, places: current.places.filter((item) => item.id !== place.id) }
            : current);
        }
        clearBusy();
        // Not applied: unless another read has already monitored it, it now waits (and is retried).
        const current = pendingFor(accountKey);
        if (settled !== "applied" && current.some((item) => item.id === place.id)) {
          setPendingFor(accountKey, current.map((item) => (item.id === place.id ? { ...item, waiting: true } : item)));
        }
        return true;
      });
      clearBusy();
      // Never settled: the session ended during the refresh (the page is leaving for sign-in), or
      // the restore no longer belongs to the account shown.
      if (settledWith.outcome === null || !(await stillOurs())) return;
      // Done only once monitored (the page awaits monitoring from an applied list before this). Until
      // then, the warning that holds, and its recovery is announced when it lands (Codex r4 on #508).
      if (restoreGone(place.id)) {
        // Gone again before its monitoring finished: nothing was restored for good, so nothing is said.
      } else if (restoreUnresolved(place.id)) {
        markWarned(accountKey, place.id);
        AccessibilityInfo.announceForAccessibility(settledWith.outcome === "failed"
          ? restoredNotRefreshedMessage(place.name)
          : restoredNotMonitoredMessage(place.name));
      } else {
        AccessibilityInfo.announceForAccessibility(`${place.name} restored.`);
      }
      void load();
    } finally {
      gate.release(token);
    }
  }, [gate, load, markWarned, pendingFor, reads, restoreGone, restoreUnresolved, setPendingFor]);

  // Lasting state shows for the account shown; transient state only in the lifetime that made it.
  const shownLifetime = shownAccountKey ? lifetimeKey(shownAccountKey, currentMobileAccountEpoch()) : null;
  const current = <T extends { owner: string }>(value: T | null) => (value && value.owner === shownLifetime ? value : null);
  const shownPending = shownAccountKey ? pending[shownAccountKey] ?? [] : [];
  return {
    places: archived && archived.accountKey === shownAccountKey ? archived.places : [],
    restoringId: current(restoring)?.id ?? null,
    problem: current(problem)?.message ?? null,
    /** Restored places whose own refresh didn't apply and that aren't monitored yet (shown as waiting). */
    pendingRestored: shownPending.filter((place) => place.waiting).map(({ id, name }) => ({ id, name })),
    /** True while any restore is unmonitored, whatever the rows show: the page keeps retrying. */
    restoreMonitoringUnresolved: shownPending.length > 0,
    load,
    changed,
    restore,
    restoreGone,
    restoreUnresolved,
    settleMonitoredRestored,
    settleRestoresAbsentFrom,
    settleRestoresRemoved,
    unmonitoredRestoredIn
  };
}
