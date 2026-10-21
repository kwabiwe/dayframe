import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { createArchivedReadGate } from "./activitiesPage";
import { AuthRequiredError, fetchArchivedPlaces, setPlaceArchived, type MobileArchivedPlace } from "./api";
import { friendlyMobileErrorMessage } from "./friendlyError";
import { currentMobileAccountEpoch, mobileAccountKey, readActiveMobileAccount } from "./mobileAccount";
import { createPlaceRestoreGate, restoredNotRefreshedMessage, type RestoreRefreshOutcome } from "./placesPage";

type ArchivedPlace = { id: string; name: string };
/**
 * A restored place whose monitoring hasn't been refreshed from a list that has it (Codex r3 on
 * #508). `waiting`: its own refresh didn't apply, so it shows under Saved places (when the list
 * shown lacks it) and the page retries until monitoring is refreshed.
 */
type UnmonitoredRestore = ArchivedPlace & { waiting: boolean };

/**
 * Places › Archived on iPhone (location v3 PR 15b, PRD D19 A10): the archived list, its reads and
 * Restore, for the account the page shows. Every piece of state carries the account it belongs to,
 * so another account never sees a name, a busy pill, a problem line or an announcement from before
 * (Codex r1 on #508). Restore is one request at a time through a synchronous gate that only the
 * request holding it releases. Every accepted restore is tracked until monitoring has been refreshed
 * from a list that has the place, for its account (`unmonitoredRestoredIn` / `settleMonitoredRestored`),
 * whichever read brings it; one whose own refresh did not land also waits under Saved places
 * (`pendingRestored`) and keeps the page retrying (`restoreMonitoringWaiting`), so the place is never
 * in neither list and is never left unmonitored (Codex r1–r3 on #508).
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
  const [restoring, setRestoring] = useState<{ token: number; accountKey: string; id: string } | null>(null);
  const [problem, setProblem] = useState<{ accountKey: string; message: string } | null>(null);
  const [pending, setPendingState] = useState<{ accountKey: string; places: UnmonitoredRestore[] } | null>(null);
  const pendingRef = useRef(pending);
  // Only the newest archived read applies, and none that was out while a restore or an archive landed.
  const reads = useRef(createArchivedReadGate()).current;
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

  const setPending = useCallback((next: { accountKey: string; places: UnmonitoredRestore[] } | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  const load = useCallback(async () => {
    const read = reads.begin();
    const owner = await readActiveMobileAccount();
    if (!owner) return;
    try {
      const places = await fetchArchivedPlaces();
      if (!mounted.current || !reads.current(read)) return;
      const now = await readActiveMobileAccount();
      if (!now || mobileAccountKey(now) !== mobileAccountKey(owner) || !reads.current(read)) return;
      setArchived({ accountKey: mobileAccountKey(owner), places });
    } catch {
      // Signed out or offline: the page read says so; this section never breaks the page.
    }
  }, [reads]);

  /** An archive, a restore or Replace landed: a read already out is dropped (call `load` after). */
  const changed = useCallback(() => reads.changed(), [reads]);

  /** Restored places of `accountKey` that `places` has and whose monitoring is still unrefreshed. */
  const unmonitoredRestoredIn = useCallback((accountKey: string, places: readonly { id: string }[]) => {
    const current = pendingRef.current;
    if (!current || current.accountKey !== accountKey) return [];
    const listed = new Set(places.map((place) => place.id));
    return current.places.filter((place) => listed.has(place.id)).map((place) => place.id);
  }, []);

  /**
   * Monitoring was refreshed for `accountKey` from a list that has `ids`: they are settled. Returns
   * true when one of them was waiting (its "couldn't refresh" warning no longer holds).
   */
  const settleMonitoredRestored = useCallback((accountKey: string, ids: readonly string[]) => {
    const current = pendingRef.current;
    if (!current || current.accountKey !== accountKey || ids.length === 0) return false;
    const settled = new Set(ids);
    const wasWaiting = current.places.some((place) => settled.has(place.id) && place.waiting);
    const left = current.places.filter((place) => !settled.has(place.id));
    setPending(left.length > 0 ? { accountKey, places: left } : null);
    return wasWaiting;
  }, [setPending]);

  /** Whether the restore of `id` is still unmonitored for the account shown. */
  const restoreUnresolved = useCallback((id: string) => {
    const current = pendingRef.current;
    return Boolean(current && current.accountKey === shownAccountRef.current && current.places.some((place) => place.id === id));
  }, []);

  const restore = useCallback(async (place: ArchivedPlace) => {
    const accountKey = shownAccountRef.current;
    if (!accountKey) return;
    const token = gate.take(accountKey);
    if (token === null) return;
    const clearBusy = () => setRestoring((current) => (current?.token === token ? null : current));
    setRestoring({ token, accountKey, id: place.id });
    setProblem((current) => (current?.accountKey === accountKey ? null : current));
    // The account lifetime this restore belongs to: a sign-out, or a switch away and back, ends it.
    const epoch = currentMobileAccountEpoch();
    try {
      const owner = await readActiveMobileAccount();
      // Started for the account the page shows, and still in that account's lifetime; otherwise its
      // answer changes nothing on screen and says nothing to VoiceOver.
      const stillOurs = async () => {
        if (!mounted.current || !owner || mobileAccountKey(owner) !== accountKey) return false;
        const now = await readActiveMobileAccount();
        return Boolean(now && mounted.current && mobileAccountKey(now) === accountKey && currentMobileAccountEpoch() === epoch);
      };
      if (!owner || mobileAccountKey(owner) !== accountKey) {
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
        setProblem({ accountKey, message });
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
      // Tracked from now until a list with the place has refreshed monitoring, whichever read brings it.
      const tracked = pendingRef.current?.accountKey === accountKey ? pendingRef.current.places : [];
      setPending({ accountKey, places: [...tracked.filter((item) => item.id !== place.id), { id: place.id, name: place.name, waiting: false }] });
      const settledWith: { outcome: RestoreRefreshOutcome | null } = { outcome: null };
      await refreshRef.current(place, (settled) => {
        // Checked synchronously before anything changes: the same account lifetime, still shown.
        if (!mounted.current || currentMobileAccountEpoch() !== epoch || shownAccountRef.current !== accountKey) {
          clearBusy();
          return false;
        }
        settledWith.outcome = settled;
        setArchived((current) => current && current.accountKey === accountKey
          ? { ...current, places: current.places.filter((item) => item.id !== place.id) }
          : current);
        clearBusy();
        // Not applied: unless another read has already monitored it, it now waits (and is retried).
        const current = pendingRef.current;
        if (settled !== "applied" && current?.accountKey === accountKey && current.places.some((item) => item.id === place.id)) {
          setPending({ accountKey, places: current.places.map((item) => (item.id === place.id ? { ...item, waiting: true } : item)) });
        }
        return true;
      });
      clearBusy();
      // Never settled: the session ended during the refresh (the page is leaving for sign-in), or
      // the restore no longer belongs to the account shown.
      if (settledWith.outcome === null || !(await stillOurs())) return;
      // The warning only while it still holds (another read may have brought the place back meanwhile).
      AccessibilityInfo.announceForAccessibility(settledWith.outcome === "failed" && restoreUnresolved(place.id)
        ? restoredNotRefreshedMessage(place.name)
        : `${place.name} restored.`);
      void load();
    } finally {
      gate.release(token);
    }
  }, [gate, load, reads, restoreUnresolved, setPending]);

  const shown = <T extends { accountKey: string }>(value: T | null) => (value && value.accountKey === shownAccountKey ? value : null);
  const shownPending = shown(pending)?.places ?? [];
  return {
    places: shown(archived)?.places ?? [],
    restoringId: shown(restoring)?.id ?? null,
    problem: shown(problem)?.message ?? null,
    /** Restored places whose own refresh didn't apply and that aren't monitored yet (shown as waiting). */
    pendingRestored: shownPending.filter((place) => place.waiting).map(({ id, name }) => ({ id, name })),
    /** True while such a place exists: the page keeps retrying until monitoring is refreshed. */
    restoreMonitoringWaiting: shownPending.some((place) => place.waiting),
    load,
    changed,
    restore,
    restoreUnresolved,
    settleMonitoredRestored,
    unmonitoredRestoredIn
  };
}
