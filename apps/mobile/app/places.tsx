import { formatDuration } from "@dayframe/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_BLOCKS,
  placeDisplayName,
  placeRoleLabel,
  placeRoleSlots,
  type PlaceRole
} from "@dayframe/shared";
import { BlocksNavHeader, usePreviousScreenLabel } from "@/components/BlocksNavHeader";
import { BlocksConfirmHost, useBlocksConfirm, type BlocksConfirmController } from "@/components/blocks/BlocksConfirmSheet";
import { BlocksEmptyState } from "@/components/blocks/BlocksEmptyState";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { ArchivedPlacesGroup } from "@/components/places/ArchivedPlacesGroup";
import { ReflowBlockGroup } from "@/components/places/ReflowBlockGroup";
import { PlaceRoleSheet, type PlaceRoleSaveRequest, type PlaceRoleSheetMode } from "@/components/places/PlaceRoleSheet";
import { StoppedTripsGroup } from "@/components/places/StoppedTripsGroup";
import { SettingsBlockGroup, SettingsBlockRow, SettingsPillButton } from "@/components/settings/SettingsBlocks";
import {
  applyPlaceRoleLocally,
  learnedPlaceSubtitle,
  pendingRestoredRows,
  placeRowSubtitle,
  placesPageState,
  createMonitorQueue,
  createPageReadGate,
  restoredMonitoredMessage,
  restoredNotMonitoredMessage,
  restoredNotRefreshedMessage,
  subscribeDeletedPlaces,
  takeDeletedPlaces,
  type PageReadTicket,
  type RestoreRefreshOutcome
} from "@/lib/placesPage";
import { useArchivedPlaces } from "@/lib/useArchivedPlaces";
import { currentMobileAccountEpoch, mobileAccountKey, mobileAccountOwnersEqual, readActiveMobileAccount } from "@/lib/mobileAccount";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import {
  SwipeDismissSheet,
  type SwipeDismissSheetHandle
} from "@/components/SwipeDismissSheet";
import {
  AuthRequiredError,
  fetchBootstrap,
  forgetLearnedPlace,
  ignoreLearnedPlace,
  setPlaceRole,
  type MobileBootstrap,
  type MobileLearnedPlace,
  type MobilePlace
} from "@/lib/api";
import { friendlyMobileErrorMessage, mobileFailureKind } from "@/lib/friendlyError";
import { refreshGeofencesForPlaces } from "@/lib/geofence";
import { backfillLearnedPlaceLocations } from "@/lib/locationGeocoding";
import { applyAfterSuccessfulMutation } from "@/lib/localMutation";
import { withRole } from "@/lib/places";
import {
  copyLearnedPlaceDetail,
  learnedPlaceDetailValues
} from "@/lib/learnedPlaces";
import { pressable, useMobileTheme, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";
import { formatLocaleDate } from "../src/lib/localeDateFormat";

type Category = MobileBootstrap["categories"][number];

/** A restore accepted while Places couldn't refresh is retried after this long, doubling each time… */
const RESTORE_REFRESH_RETRY_MS = 5_000;
/** …up to this long between tries, until a list with the place has refreshed monitoring. */
const RESTORE_REFRESH_RETRY_MAX_MS = 60_000;

/** What monitoring is refreshed from: a list the page showed, and the account lifetime it was asked in. */
type MonitorInput = { list: MobileBootstrap; epoch: number };

/** The account a page list belongs to. */
function listAccountKey(list: Pick<MobileBootstrap, "user" | "workspace">) {
  return mobileAccountKey({ userId: list.user.id, workspaceId: list.workspace.id });
}

export default function PlacesScreen() {
  const backLabel = usePreviousScreenLabel() ?? "Settings";
  const reduceMotion = useReduceMotionPreference();
  const { styles, theme } = useMobileTheme();
  // Ignore/Forget are asked from the learned-place sheet, which presents this controller's sheet
  // over its own modal (UIA-005).
  const confirmSheet = useBlocksConfirm();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [refreshing, setRefreshing] = useState(false);
  const refreshPull = useRef(0);
  // Ignore/Forget in flight, with the lifetime and request that set them (Codex r11 on #508).
  type LearnedBusy = { id: string; owner: string; request: number };
  const [ignoringLearned, setIgnoringLearned] = useState<LearnedBusy | null>(null);
  const [forgettingLearned, setForgettingLearned] = useState<LearnedBusy | null>(null);
  const learnedRequests = useRef(0);
  // The learned place whose sheet is open, with the account lifetime it was opened in (Codex r9 on #508).
  const [selectedLearned, setSelectedLearned] = useState<{ place: MobileLearnedPlace; owner: string } | null>(null);
  // The status line, with the account lifetime and account it was written for: shown only while
  // both still hold, so another account (or a later lifetime) never sees it (Codex r8 on #508).
  const [status, setStatus] = useState<{ text: string; owner: string } | null>(null);
  const statusOwner = useCallback(() => {
    const shown = dataRef.current;
    return `${currentMobileAccountEpoch()}|${shown ? listAccountKey(shown) : ""}`;
  }, []);
  /** Sets the status line for the lifetime and account shown now (an updater sees only a current line). */
  const setStatusMessage = useCallback((next: string | null | ((current: string | null) => string | null)) => {
    const owner = statusOwner();
    setStatus((current) => {
      const text = typeof next === "function" ? next(current?.owner === owner ? current.text : null) : next;
      return text === null ? null : { text, owner };
    });
  }, [statusOwner]);
  const statusMessage = status && status.owner === statusOwner() ? status.text : null;
  const selectedLearnedRef = useRef(selectedLearned);
  selectedLearnedRef.current = selectedLearned;
  const selectedLearnedPlace = selectedLearned && selectedLearned.owner === statusOwner() ? selectedLearned.place : null;
  const ignoringLearnedId = ignoringLearned?.owner === statusOwner() ? ignoringLearned.id : null;
  const forgettingLearnedId = forgettingLearned?.owner === statusOwner() ? forgettingLearned.id : null;
  const setSelectedLearnedPlace = (place: MobileLearnedPlace | null) => {
    const next = place ? { place, owner: statusOwner() } : null;
    selectedLearnedRef.current = next;
    setSelectedLearned(next);
  };
  // The newest page read failed before any list was shown (staging feedback B2): an in-page state
  // with Try again instead of a system alert, and never "Nothing saved yet" for a list not read.
  const [loadFailure, setLoadFailure] = useState<{ offline: boolean } | null>(null);
  // The status line a failed pull-to-refresh showed, cleared by the next read that lands.
  const refreshFailureMessage = useRef<string | null>(null);
  // The "restored, but Places couldn't refresh" line, cleared when its waiting place settles.
  const restoreWarning = useRef<{ placeId: string; message: string; owner: string } | null>(null);
  // Home and Work (Blocks 7a): which slot's sheet is open, and whether it sets or clears.
  // Bound to the account lifetime that opened it, with its draft (Codex r10 on #508): another
  // account, or a later lifetime, never sees it, and opening it again starts a fresh draft.
  const [roleSheetState, setRoleSheetState] = useState<{ role: PlaceRole; mode: PlaceRoleSheetMode; owner: string } | null>(null);
  const roleSheet = roleSheetState && roleSheetState.owner === statusOwner() ? roleSheetState : null;
  // One Home/Work change at a time in an account lifetime (a second sheet can't open mid-save); a
  // save still out from an earlier lifetime never holds a later one (Codex r10 on #508).
  const roleSaving = useRef<string | null>(null);
  // The one gate every list read goes through (Codex r5/r6 on #508): a read's list applies, settles
  // restores and refreshes monitoring only if no change was accepted and no newer list was applied
  // since it started, in the same account lifetime. Every accepted change calls `pageReads.changed()`.
  const pageReads = useRef(createPageReadGate()).current;
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const shownAccountKey = data ? mobileAccountKey({ userId: data.user.id, workspaceId: data.workspace.id }) : null;
  // Places › Archived (location v3 PR 15b, PRD D19 A10): read with the page, for the account that
  // read it, and shown only when there are some. A failed read leaves it as it was (or hidden).
  const archive = useArchivedPlaces({
    onSignedOut: () => router.replace("/"),
    refreshAfterRestore: (place, settle) => {
      // Accepted: every page read already out started before the place came back, so none may
      // apply (and settle it without the place) once this restore is waiting (Codex r2 on #508).
      pageReads.changed();
      return refreshAfterPlaceChange({
        prefix: `${place.name} restored.`,
        // The warning only while it still holds: a read may have brought the place back meanwhile;
        // and "restored" only once its visits are noticed again (Codex r4 on #508).
        // Nothing at all (null) when it is gone again: archived or deleted elsewhere since.
        failureMessage: () => (archive.restoreGone(place.id) ? null
          : archive.restoreUnresolved(place.id) ? restoredNotRefreshedMessage(place.name) : `${place.name} restored.`),
        successMessage: () => (archive.restoreGone(place.id) ? null
          : archive.restoreUnresolved(place.id) ? restoredNotMonitoredMessage(place.name) : `${place.name} restored.`),
        restoredPlaceId: place.id,
        onSettled: settle
      });
    },
    shownAccountKey
  });
  const {
    changed: archivedChanged,
    load: loadArchived,
    settleMonitoredRestored,
    settleRestoresAbsentFrom,
    settleRestoresRemoved,
    unmonitoredRestoredIn
  } = archive;

  /** The warning line for these restores no longer holds: it clears (only if it still shows). */
  const clearRestoreWarning = useCallback((ids: readonly string[]) => {
    const warning = restoreWarning.current;
    if (!warning) return;
    // A warning from another lifetime or account is never shown again: it is simply forgotten.
    if (warning.owner !== statusOwner()) {
      restoreWarning.current = null;
      return;
    }
    if (!ids.includes(warning.placeId)) return;
    restoreWarning.current = null;
    setStatusMessage((current) => (current === warning.message ? null : current));
  }, [setStatusMessage, statusOwner]);

  /**
   * An applied list (so one that started after every restore it could settle was accepted: older
   * reads are dropped by the read gate) that lacks a restored place: the place isn't active on the
   * server any more, so its restore settles silently, with its waiting row, warning and retries.
   */
  const settleGoneRestores = useCallback((list: MobileBootstrap) => {
    clearRestoreWarning(settleRestoresAbsentFrom(listAccountKey(list), list.places));
  }, [clearRestoreWarning, settleRestoresAbsentFrom]);

  /** The account lifetime a read starts in; its list applies only in the same one. */
  const accountLifetime = useCallback(() => String(currentMobileAccountEpoch()), []);

  /**
   * A check for the account lifetime a change started in (Codex r3 on #508): true while the page is
   * open, the account epoch is unchanged and the list shown is still that account's. Synchronous:
   * every status, VoiceOver, navigation, callback or state write after an await asks it immediately
   * before, in the same step, never across another await (Codex r11 on #508).
   */
  const lifetimeCheck = useCallback(() => {
    const epoch = currentMobileAccountEpoch();
    const shown = dataRef.current;
    const key = shown ? listAccountKey(shown) : null;
    return () => {
      const now = dataRef.current;
      return mounted.current && currentMobileAccountEpoch() === epoch && (now ? listAccountKey(now) : null) === key;
    };
  }, []);

  /** Monitoring from `input` still belongs here: the page is open, in its lifetime, showing its account. */
  const monitorInputCurrent = useCallback(({ list, epoch }: MonitorInput) => {
    const shown = dataRef.current;
    return mounted.current && currentMobileAccountEpoch() === epoch && Boolean(shown) && listAccountKey(shown!) === listAccountKey(list);
  }, []);

  /**
   * The one place a restore's monitoring settles, decided from what the page shows now (Codex r7 on
   * #508): after any successful refresh from `list` that still belongs here, restored places it had
   * that the list shown now also has (and were not yet monitored) settle. A failure leaves them
   * unresolved, so the retry goes on. One announced with a warning has its warning line cleared and
   * its recovery announced.
   */
  const monitorFinished = useRef<(input: MonitorInput, refreshed: boolean) => void>(() => undefined);
  monitorFinished.current = (input, refreshed) => {
    if (!refreshed || !monitorInputCurrent(input)) return;
    const key = listAccountKey(input.list);
    const shownIds = new Set(dataRef.current!.places.map((place) => place.id));
    const restored = unmonitoredRestoredIn(key, input.list.places).filter((id) => shownIds.has(id));
    if (restored.length === 0) return;
    const recovered = settleMonitoredRestored(key, restored);
    clearRestoreWarning(restored);
    for (const name of recovered) AccessibilityInfo.announceForAccessibility(restoredMonitoredMessage(name));
  };
  // One geofence refresh at a time, latest wins (Codex r6 on #508); nothing queued starts outside its
  // account lifetime or after the page closes (Codex r7 on #508).
  const monitor = useRef(createMonitorQueue<MonitorInput>({
    refresh: ({ list }) => refreshGeofencesForPlaces(list.places, { userId: list.user.id, workspaceId: list.workspace.id }),
    runnable: (input) => monitorInputCurrent(input),
    finished: (input, refreshed) => monitorFinished.current(input, refreshed)
  })).current;
  // Closing the page drops whatever monitoring still waits.
  useEffect(() => () => monitor.clear(), [monitor]);
  /** Monitoring refreshed from `list` (latest wins); resolves once it ran, or was overtaken or dropped. */
  const monitorList = useCallback((list: MobileBootstrap) =>
    monitor.request({ list, epoch: currentMobileAccountEpoch() }), [monitor]);

  // `refresh` is the person's own pull-to-refresh; every other read (opening, focus, Try again)
  // fails quietly over the list already shown.
  const load = useCallback(async (options?: { refresh?: boolean }) => {
    // The spinner belongs to the newest pull-to-refresh: an older one ending never stops it.
    const pull = options?.refresh ? ++refreshPull.current : null;
    if (pull !== null) setRefreshing(true);
    // Archived reads alongside, on its own: its failure never touches the page.
    void loadArchived();
    const ticket = pageReads.begin(accountLifetime());
    try {
      const bootstrap = await fetchBootstrap();
      // A delete or archive accepted while this read was out dropped it (Codex r6 on #508): any list
      // that applies started after every accepted change, so it never has a place removed since.
      if (!mounted.current || pageReads.judge(ticket, accountLifetime()) !== "apply") return;
      pageReads.applied(ticket);
      dataRef.current = bootstrap;
      setData(bootstrap);
      setLoadFailure(null);
      // A restored place this list brings back is monitored from it, whichever read lands first
      // (its own refresh may still be out, or have failed); its warning clears once that is done.
      // Once this page has monitored any list, every list it shows is monitored (Codex r6 on #508).
      settleGoneRestores(bootstrap);
      if (monitor.engaged() || unmonitoredRestoredIn(listAccountKey(bootstrap), bootstrap.places).length > 0) {
        void monitorList(bootstrap);
      }
      const failedRefresh = refreshFailureMessage.current;
      refreshFailureMessage.current = null;
      if (failedRefresh) setStatusMessage((current) => (current === failedRefresh ? null : current));
      void backfillLearnedPlaceLocations(bootstrap.learnedPlaces ?? []).then((resolved) => {
        // Only onto this list while it is what the page shows.
        if (resolved.length === 0 || !mounted.current || ticket.lifetime !== accountLifetime() || !pageReads.isCurrent(ticket)) return;
        setData((current) => current ? mergeLearnedPlaceResolutions(current, resolved) : current);
      });
    } catch (error) {
      // Only in the lifetime it started in (sign-in, or the newest read's failure).
      if (!mounted.current || ticket.lifetime !== accountLifetime()) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (!pageReads.isNewest(ticket)) return;
      if (!dataRef.current) {
        setLoadFailure({ offline: mobileFailureKind(error) === "offline" });
      } else if (options?.refresh) {
        // The list already shown stays; only an asked-for refresh says why it didn't update.
        const message = friendlyMobileErrorMessage(error, "Couldn't refresh your places. Try again.");
        refreshFailureMessage.current = message;
        setStatusMessage(message);
      }
    } finally {
      if (pull !== null && pull === refreshPull.current) setRefreshing(false);
    }
  }, [accountLifetime, loadArchived, monitor, monitorList, pageReads, setStatusMessage, settleGoneRestores, unmonitoredRestoredIn]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * A place the editor archived or deleted leaves the list at once, even if a refresh then fails: on
   * focus, and when it finishes after the person already came back to this page. Accepted on the
   * server before now, so every read already out is dropped (Codex r6 on #508): the next list to
   * apply comes from after it. True when nothing was shown yet, so a read must start again.
   */
  const applyDeletedPlaces = useCallback(async () => {
    const epoch = currentMobileAccountEpoch();
    const owner = await readActiveMobileAccount();
    // Read for the lifetime it started in: another one takes its deletes at its own focus.
    if (!mounted.current || !owner || currentMobileAccountEpoch() !== epoch) return false;
    const sameAccount = (list: MobileBootstrap) =>
      mobileAccountOwnersEqual(owner, { userId: list.user.id, workspaceId: list.workspace.id });
    const current = dataRef.current;
    // Another account's list is shown: its deletes wait for that account's page.
    if (current && !sameAccount(current)) return false;
    const key = mobileAccountKey(owner);
    const deleted = takeDeletedPlaces(key);
    if (deleted.length === 0) return false;
    pageReads.changed();
    // A restore of one of them still waiting to be monitored is over: the place is gone again.
    clearRestoreWarning(settleRestoresRemoved(key, deleted));
    // An archived place shows under Archived from a read after it landed.
    archivedChanged();
    void loadArchived();
    if (!current) return true;
    const next = deleted.reduce((list, id) => reconcileBootstrapPlaces(list, { removePlaceId: id }), current);
    dataRef.current = next;
    setData((shown) => shown && sameAccount(shown)
      ? deleted.reduce((list, id) => reconcileBootstrapPlaces(list, { removePlaceId: id }), shown)
      : shown);
    // Monitoring follows the list shown, once this page has monitored any.
    if (monitor.engaged()) void monitorList(next);
    return false;
  }, [archivedChanged, clearRestoreWarning, loadArchived, monitor, monitorList, pageReads, settleRestoresRemoved]);

  useEffect(() => subscribeDeletedPlaces(() => {
    void applyDeletedPlaces().then((needsRead) => {
      if (needsRead) void load();
    });
  }), [applyDeletedPlaces, load]);

  useFocusEffect(
    useCallback(() => {
      void applyDeletedPlaces().finally(() => {
        void load();
      });
    }, [applyDeletedPlaces, load])
  );

  function beginAddPlace() {
    setStatusMessage(null);
    router.push({ pathname: "/place-editor", params: { mode: "create" } } as never);
  }

  function beginSaveLearnedPlace(learnedPlace: MobileLearnedPlace) {
    setSelectedLearnedPlace(null);
    router.push({
      pathname: "/place-editor",
      params: { mode: "learned", learnedPlaceId: learnedPlace.id }
    } as never);
  }

  function beginEditPlace(place: MobilePlace) {
    setStatusMessage(null);
    router.push({ pathname: "/place-editor", params: { mode: "edit", placeId: place.id } } as never);
  }

  function confirmIgnoreLearnedCandidate(
    learnedPlace: MobileLearnedPlace,
    onSuccess?: () => void
  ) {
    confirmSheet.confirm({
      eyebrow: "Place suggestion",
      title: "Ignore learned place?",
      message: "Ignore hides this learned location from save suggestions. It will not create or confirm any blocks.",
      confirmLabel: "Ignore",
      tone: "neutral",
      onConfirm: () => {
        void changeLearnedPlace("ignore", learnedPlace, onSuccess);
      }
    });
  }

  function confirmForgetLearnedCandidate(
    learnedPlace: MobileLearnedPlace,
    onSuccess?: () => void
  ) {
    confirmSheet.confirm({
      eyebrow: "Place suggestion",
      title: "Forget learned place?",
      message: "Forget deletes this learned candidate. Dayframe may learn it again later if future visits provide enough evidence.",
      confirmLabel: "Forget",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void changeLearnedPlace("forget", learnedPlace, onSuccess);
      }
    });
  }

  /**
   * Ignore or Forget a learned place (Codex r10/r11 on #508). Its busy flag carries the lifetime and
   * request that set it; after every await, `still()` is asked synchronously right before each write,
   * and the sheet closes (`onSuccess`) only while it is still this lifetime's sheet for this place.
   */
  async function changeLearnedPlace(kind: "ignore" | "forget", learnedPlace: MobileLearnedPlace, onSuccess?: () => void) {
    const still = lifetimeCheck();
    const owner = statusOwner();
    const request = ++learnedRequests.current;
    const setBusy = kind === "ignore" ? setIgnoringLearned : setForgettingLearned;
    setBusy({ id: learnedPlace.id, owner, request });
    try {
      await applyAfterSuccessfulMutation<unknown>(
        () => (kind === "ignore" ? ignoreLearnedPlace(learnedPlace.id) : forgetLearnedPlace(learnedPlace.id)),
        () => {
          if (still()) removeLocalLearnedPlace(learnedPlace.id);
        }
      );
      if (!still()) return;
      await refreshAfterPlaceChange({
        prefix: kind === "ignore" ? "Learned place ignored." : "Learned place forgotten.",
        removeLearnedPlaceId: learnedPlace.id,
        still
      });
      const sheet = selectedLearnedRef.current;
      if (still() && sheet?.owner === owner && sheet.place.id === learnedPlace.id) onSuccess?.();
    } catch (error) {
      if (!still()) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Places", friendlyMobileErrorMessage(
        error,
        kind === "ignore" ? "Couldn't ignore this suggestion. Try again." : "Couldn't forget this suggestion. Try again."
      ));
    } finally {
      setBusy((current) => (current?.request === request ? null : current));
    }
  }

  function removeLocalLearnedPlace(id: string) {
    pageReads.changed();
    setData((current) => current ? reconcileBootstrapPlaces(current, { removeLearnedPlaceId: id }) : current);
  }

  async function refreshAfterPlaceChange(options: {
    prefix: string;
    upsertPlace?: MobilePlace;
    removePlaceId?: string;
    removeLearnedPlaceId?: string;
    /** Places as this page now shows them, for monitoring when the fresh read fails. */
    fallbackPlaces?: MobilePlace[];
    /** The status line when the refresh fails (instead of the generic "Pull to refresh" one); null says nothing. */
    failureMessage?: () => string | null;
    /** The status line once the list and its monitoring are done (instead of `prefix`); null says nothing. */
    successMessage?: () => string | null;
    /** The restored place a warning line from this refresh is about (it clears when that settles). */
    restoredPlaceId?: string;
    /** The account lifetime of the change this follows (else the one shown when it starts). */
    still?: () => boolean;
    /**
     * Told how the refresh ended, before anything else happens: in the same render that applies its
     * list ("applied"), or when a newer change overtook it ("stale") or it failed. A restored row
     * leaves Archived with it. False means the change no longer belongs to the account shown (a
     * sign-out, a switch, or away and back): then nothing is applied or said (Codex r2 on #508).
     */
    onSettled?: (outcome: RestoreRefreshOutcome) => boolean;
  }) {
    /**
     * The status line, written only while no read started after this one (Codex r6/r7 on #508): a
     * newer read's line (its failure) is never replaced. A restore's warning line (anything but the
     * plain prefix) is remembered with its place.
     */
    const say = (message: string) => {
      if (!pageReads.isNewest(ticket)) return;
      if (message !== options.prefix && options.restoredPlaceId) {
        restoreWarning.current = { placeId: options.restoredPlaceId, message, owner: statusOwner() };
      }
      setStatusMessage(message);
    };
    // Every write below an await first checks the change still belongs to the account lifetime it
    // started in; a change from an ended lifetime refreshes nothing.
    const still = options.still ?? lifetimeCheck();
    if (!still()) return;
    // Starts after the change it follows, so it is newer than every read already out.
    const ticket = pageReads.begin(accountLifetime());
    try {
      const bootstrap = await fetchBootstrap();
      // Another account (or lifetime) is shown now, or this list is another account's: that page's.
      if (!still() || listAccountKey(bootstrap) !== listAccountKey(dataRef.current ?? bootstrap)) return;
      const verdict = pageReads.judge(ticket, accountLifetime());
      if (verdict === "foreign") return;
      if (verdict === "stale") {
        if (options.onSettled && !options.onSettled("stale")) return;
        // A newer change or read brings the list; until a restore is monitored it says so.
        const staleMessage = options.successMessage?.();
        if (staleMessage !== null) say(staleMessage ?? options.prefix);
        return;
      }
      const reconciled = reconcileBootstrapPlaces(bootstrap, options);
      if (options.onSettled && !options.onSettled("applied")) return;
      pageReads.applied(ticket);
      dataRef.current = reconciled;
      setData(reconciled);
      // A restored place this list lacks is gone again; monitoring from it settles any it has.
      settleGoneRestores(reconciled);
      await monitorList(reconciled);
      if (!still()) return;
      const bootstrapHasPlace =
        !options.upsertPlace || bootstrap.places.some((place) => place.id === options.upsertPlace?.id);
      const successMessage = options.successMessage?.();
      if (successMessage === null) return;
      // A restore whose monitoring failed says so, and the line clears once a retry monitors it.
      say(successMessage ?? (bootstrapHasPlace ? options.prefix : `${options.prefix} It may take a moment to show everywhere.`));
    } catch (error) {
      if (!still()) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      // A read started since brings the list instead: a restore counts as overtaken, and only the
      // newest read's failure is shown or announced (Codex r6 on #508).
      if (options.onSettled && !options.onSettled(pageReads.isNewest(ticket) ? "failed" : "stale")) return;
      const current = dataRef.current;
      // Only while nothing else changed since: a later delete or change already set monitoring.
      if (options.fallbackPlaces && current && !pageReads.superseded(ticket)) {
        await monitorList({ ...current, places: options.fallbackPlaces });
        if (!still()) return;
      }
      const failureMessage = options.failureMessage?.();
      // A restore's warning is remembered, so it clears once the restored place is monitored.
      if (failureMessage !== null) say(failureMessage ?? `${options.prefix} Pull to refresh if it doesn't show on another device.`);
    }
  }

  const places = data?.places ?? [];
  const learnedPlaces = (data?.learnedPlaces ?? []).filter(
    (learnedPlace) => learnedPlace.classification === "place_candidate"
  );
  const categories = data?.categories ?? [];
  const rolePlaces = places.map(withRole);
  const slots = placeRoleSlots(rolePlaces);
  const editingSlot = roleSheet ? slots.find((slot) => slot.role === roleSheet.role) ?? null : null;

  const pageState = placesPageState(Boolean(data), Boolean(loadFailure));

  function openRole(role: PlaceRole, mode: PlaceRoleSheetMode) {
    // Only from a list that was read: an unknown list never sends Set straight to adding a place.
    if (roleSaving.current === statusOwner() || !dataRef.current) return;
    setStatusMessage(null);
    // Nothing saved to choose from yet: go straight to adding the place into the slot.
    if (mode === "choose" && places.length === 0) {
      beginAddRolePlace(role);
      return;
    }
    setRoleSheetState({ role, mode, owner: statusOwner() });
  }

  function beginAddRolePlace(role: PlaceRole) {
    router.push({ pathname: "/place-editor", params: { mode: "create", role } } as never);
  }

  async function saveRole(request: PlaceRoleSaveRequest) {
    const lifetime = statusOwner();
    if (roleSaving.current === lifetime) return "Another change is still saving. Try again in a moment.";
    roleSaving.current = lifetime;
    // The account lifetime this change belongs to (Codex r10 on #508): its answer is applied,
    // monitored and said only while that lifetime and its account are still shown.
    const still = lifetimeCheck();
    try {
      const owner = await readActiveMobileAccount();
      let previousArchived = false;
      try {
        previousArchived = (await setPlaceRole(request)).previousArchived === true;
      } catch (error) {
        if (!still()) return null;
        if (error instanceof AuthRequiredError) {
          router.replace("/");
          return null;
        }
        return friendlyMobileErrorMessage(error, "Couldn't update this place. Try again.");
      }
      // Accepted: shown at once (only for the account lifetime that asked, while Places is open),
      // and any read that started before this answer is dropped.
      if (!still() || !mobileAccountOwnersEqual(owner, await readActiveMobileAccount()) || !still()) return null;
      pageReads.changed();
      const shown = dataRef.current;
      // "Replace the old place": the server archived the old holder, so it leaves Saved places too.
      const nextPlaces = shown ? applyPlaceRoleLocally(shown.places, { ...request, archivePrevious: previousArchived }) : undefined;
      if (shown && nextPlaces) {
        const next = { ...shown, places: nextPlaces };
        dataRef.current = next;
        setData(next);
      }
      if (previousArchived) archivedChanged();
      const label = placeRoleLabel(request.role);
      const prefix = !request.placeId
        ? `${label} cleared.`
        : previousArchived ? `${label} updated. The old ${label.toLowerCase()} is archived.` : `${label} updated.`;
      await refreshAfterPlaceChange({ prefix, fallbackPlaces: nextPlaces, still });
      if (previousArchived && still()) void loadArchived();
      return null;
    } finally {
      if (roleSaving.current === lifetime) roleSaving.current = null;
    }
  }

  // A restore accepted while Places couldn't refresh waits under Saved places (when the list shown
  // lacks it). While any restore is unmonitored, whatever the rows show and whether its list or
  // its monitoring failed (Codex r4 on #508), the page retries (5 s, doubling, at most a minute apart; focus
  // and pull-to-refresh also count) until a list with the place has refreshed monitoring (Codex r3).
  const pendingRestored = pendingRestoredRows(archive.pendingRestored, places);
  const hasPendingRestored = pendingRestored.length > 0;
  const restoreMonitoringUnresolved = archive.restoreMonitoringUnresolved;
  const [restoreRetries, setRestoreRetries] = useState(0);
  useEffect(() => {
    if (!restoreMonitoringUnresolved) {
      setRestoreRetries(0);
      return;
    }
    const delay = Math.min(RESTORE_REFRESH_RETRY_MS * 2 ** restoreRetries, RESTORE_REFRESH_RETRY_MAX_MS);
    const retry = setTimeout(() => {
      void load().finally(() => {
        if (mounted.current) setRestoreRetries((count) => count + 1);
      });
    }, delay);
    return () => clearTimeout(retry);
  }, [load, restoreMonitoringUnresolved, restoreRetries]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <BlocksNavHeader backLabel={backLabel} onBack={() => router.back()} title="Saved places" />
      <ScrollView
        style={styles.settingsScrollView}
        contentContainerStyle={styles.settingsScrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ refresh: true })}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.settingsBlocksStack}>
          <Pressable
            accessibilityRole="button"
            onPress={beginAddPlace}
            style={({ pressed }) => [styles.settingsNewActivity, pressed ? styles.buttonPressed : null]}
            testID="places-add"
          >
            <DayframeIcon color={theme.onAccent} glyph={DAYFRAME_APP_ICONS.add} size={18} />
            <Text {...mobileTextProps("control")} style={styles.settingsNewActivityText}>Add place</Text>
          </Pressable>
          {statusMessage ? (
            <Reanimated.View
              key={statusMessage}
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
            >
              <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={styles.placesStatus}>{statusMessage}</Text>
            </Reanimated.View>
          ) : null}

          {pageState === "pending" ? (
            // Before the first read settles: a quiet line in the groups' place (no spinner, and
            // never "Not set" or "Nothing saved yet" for places not yet known).
            <Text
              {...mobileTextProps("body")}
              accessibilityLiveRegion="polite"
              style={[styles.placesStatus, styles.placesPending]}
              testID="places-pending"
            >
              Loading your places…
            </Text>
          ) : pageState === "failed" && loadFailure ? (
            <BlocksEmptyState
              actionAccessibilityLabel="Try loading your places again"
              actionLabel="Try again"
              actionTestID="places-unavailable-retry"
              glyph={loadFailure.offline ? DAYFRAME_APP_ICONS.syncOffline : DAYFRAME_APP_ICONS.places}
              message={
                loadFailure.offline
                  ? "Connect to the internet to see your saved places."
                  : "Dayframe couldn't load your places. Try again in a moment."
              }
              onAction={() => void load()}
              testID="places-unavailable"
              theme={theme}
              title={loadFailure.offline ? "You're offline" : "Places didn't load"}
            />
          ) : (
          <>
          {/* Every group reflows with the shared layout owner, so rows fading in or out (Saved places,
              Archived, Suggested places) never make a boundary or a footnote below them jump. */}
          <ReflowBlockGroup foot="Trips are named after these." reduceMotion={reduceMotion} theme={theme} title="Home and Work">
            {slots.map((slot, index) => (
              <View key={slot.role} style={[styles.placesRow, index > 0 ? styles.settingsActivityRowDivider : null]} testID={`places-role-${slot.role}`}>
                <View style={styles.placesRowMain}>
                  <View style={styles.placesBlock}>
                    <DayframeIcon color={theme.textPrimary} glyph={slot.role === "home" ? DAYFRAME_APP_ICONS.placeHome : DAYFRAME_APP_ICONS.placeWork} size={18} />
                  </View>
                  <View style={styles.settingsActivityText}>
                    <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={styles.settingsActivityName}>{slot.label}</Text>
                    <Text {...mobileTextProps("metadata")} numberOfLines={2} style={styles.settingsActivityMeta}>
                      {slot.place ? slot.secondary ?? `${slot.place.radiusMeters} m radius` : "Not set"}
                    </Text>
                  </View>
                </View>
                <View style={styles.placesRowActions}>
                  {slot.place ? (
                    <>
                      <SettingsPillButton accessibilityLabel={`Change ${slot.label}`} label="Change" onPress={() => openRole(slot.role, "choose")} theme={theme} />
                      <SettingsPillButton accessibilityLabel={`Clear ${slot.label}`} label="Clear" onPress={() => openRole(slot.role, "clear")} theme={theme} />
                    </>
                  ) : (
                    <SettingsPillButton accessibilityLabel={`Set ${slot.label}`} label="Set" onPress={() => openRole(slot.role, "choose")} theme={theme} />
                  )}
                </View>
              </View>
            ))}
          </ReflowBlockGroup>

          <ReflowBlockGroup
            foot={places.length === 0 && !hasPendingRestored ? "No places yet. Add one by searching for an address or using where you are." : "Tap a place to change, archive or delete it."}
            reduceMotion={reduceMotion}
            theme={theme}
            title="Saved places"
          >
            {places.length === 0 && !hasPendingRestored ? (
              <View style={styles.placesEmpty}>
                <Text {...mobileTextProps("metadata")} style={styles.settingsActivityMeta}>Nothing saved yet</Text>
              </View>
            ) : null}
            {places.map((place, index) => {
              const rolePlace = withRole(place);
              const name = placeDisplayName(rolePlace);
              const subtitle = placeRowSubtitle(rolePlace, categories);
              return (
                <Reanimated.View
                  key={place.id}
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                  <Pressable
                    accessibilityHint="Edits this place"
                    accessibilityLabel={`${name}, ${subtitle.replace(/\n/g, ", ")}`}
                    accessibilityRole="button"
                    onPress={() => beginEditPlace(place)}
                    style={({ pressed }) => [
                      styles.placesRow,
                      index > 0 ? styles.settingsActivityRowDivider : null,
                      pressed ? styles.placesRowPressed : null
                    ]}
                    testID={`places-row-${place.id}`}
                  >
                    <View style={styles.placesRowMain}>
                      <View style={styles.placesBlock}>
                        <DayframeIcon
                          color={theme.textPrimary}
                          glyph={rolePlace.role === "home" ? DAYFRAME_APP_ICONS.placeHome : rolePlace.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places}
                          size={18}
                        />
                      </View>
                      <View style={styles.settingsActivityText}>
                        <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={styles.settingsActivityName}>{name}</Text>
                        <Text {...mobileTextProps("metadata")} numberOfLines={3} style={styles.settingsActivityMeta}>{subtitle}</Text>
                      </View>
                    </View>
                    <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.next} size={18} />
                  </Pressable>
                </Reanimated.View>
              );
            })}
            {/* Restored, but no refreshed list has brought it back yet (Codex r1 on #508): it waits
                here, never in neither list, until a read lands and monitoring resumes. */}
            {pendingRestored.map((row, index) => (
              <Reanimated.View
                key={`restored-${row.id}`}
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
              >
                <View
                  accessible
                  accessibilityLabel={row.accessibilityLabel}
                  style={[styles.placesRow, places.length + index > 0 ? styles.settingsActivityRowDivider : null]}
                  testID={`places-restored-${row.id}`}
                >
                  <View style={styles.placesRowMain}>
                    <View style={[styles.placesBlock, styles.placesBlockSuggested]}>
                      <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.places} size={18} />
                    </View>
                    <View style={styles.settingsActivityText}>
                      <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={styles.settingsActivityName}>{row.name}</Text>
                      <Text {...mobileTextProps("metadata")} style={styles.settingsActivityMeta}>{row.subtitle}</Text>
                    </View>
                  </View>
                </View>
              </Reanimated.View>
            ))}
          </ReflowBlockGroup>

          <ArchivedPlacesGroup
            onRestore={(place) => void archive.restore(place)}
            places={archive.places}
            problem={archive.problem}
            reduceMotion={reduceMotion}
            restoringId={archive.restoringId}
            styles={styles}
            theme={theme}
          />

          {learnedPlaces.length > 0 ? (
            <Reanimated.View
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
            >
              <ReflowBlockGroup
                foot="Dayframe suggests a place after repeat visits on different days. Nothing is saved until you choose Save."
                reduceMotion={reduceMotion}
                theme={theme}
                title="Suggested places"
              >
                {learnedPlaces.map((learnedPlace, index) => (
                  <Reanimated.View
                    key={learnedPlace.id}
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                  >
                    <View style={[styles.placesRow, index > 0 ? styles.settingsActivityRowDivider : null]}>
                      <Pressable
                        accessibilityHint="Shows details, Ignore and Forget"
                        accessibilityLabel={`Suggested place ${learnedPlace.name}, ${learnedPlaceSubtitle(learnedPlace)}`}
                        accessibilityRole="button"
                        onPress={() => setSelectedLearnedPlace(learnedPlace)}
                        style={({ pressed }) => [styles.placesRowMain, pressed ? styles.placesRowPressed : null]}
                        testID={`places-learned-${learnedPlace.id}`}
                      >
                        <View style={[styles.placesBlock, styles.placesBlockSuggested]}>
                          <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.places} size={18} />
                        </View>
                        <View style={styles.settingsActivityText}>
                          <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={styles.settingsActivityName}>{learnedPlace.name}</Text>
                          <Text {...mobileTextProps("metadata")} numberOfLines={2} style={styles.settingsActivityMeta}>{learnedPlaceSubtitle(learnedPlace)}</Text>
                        </View>
                      </Pressable>
                      <View style={styles.placesRowActions}>
                        <SettingsPillButton
                          accessibilityLabel={`Save ${learnedPlace.name} as a place`}
                          disabled={ignoringLearnedId === learnedPlace.id || forgettingLearnedId === learnedPlace.id}
                          label="Save"
                          onPress={() => beginSaveLearnedPlace(learnedPlace)}
                          theme={theme}
                        />
                      </View>
                    </View>
                  </Reanimated.View>
                ))}
              </ReflowBlockGroup>
            </Reanimated.View>
          ) : null}
          <StoppedTripsGroup reduceMotion={reduceMotion} styles={styles} theme={theme} />
          </>
          )}
        </View>
      </ScrollView>
      <LearnedPlaceDetailSheet
        categories={categories}
        confirmSheet={confirmSheet}
        forgetting={Boolean(selectedLearnedPlace && forgettingLearnedId === selectedLearnedPlace.id)}
        ignoring={Boolean(selectedLearnedPlace && ignoringLearnedId === selectedLearnedPlace.id)}
        learnedPlace={selectedLearnedPlace}
        onClose={() => setSelectedLearnedPlace(null)}
        onEdit={(learnedPlace) => beginSaveLearnedPlace(learnedPlace)}
        onForget={(learnedPlace, onSuccess) => confirmForgetLearnedCandidate(learnedPlace, onSuccess)}
        onIgnore={(learnedPlace, onSuccess) => confirmIgnoreLearnedCandidate(learnedPlace, onSuccess)}
        onSave={(learnedPlace) => beginSaveLearnedPlace(learnedPlace)}
        styles={styles}
        theme={theme}
      />
      {roleSheet && editingSlot ? (
        <PlaceRoleSheet
          key={`${roleSheet.role}-${roleSheet.mode}-${roleSheet.owner}`}
          mode={roleSheet.mode}
          onAddNew={beginAddRolePlace}
          onClose={() => setRoleSheetState(null)}
          onSave={saveRole}
          places={rolePlaces}
          reduceMotion={reduceMotion}
          slot={editingSlot}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </SafeAreaView>
  );
}

function LearnedPlaceDetailSheet({
  categories,
  confirmSheet,
  forgetting,
  ignoring,
  learnedPlace,
  onClose,
  onEdit,
  onForget,
  onIgnore,
  onSave,
  styles,
  theme
}: {
  categories: Category[];
  confirmSheet: BlocksConfirmController;
  forgetting: boolean;
  ignoring: boolean;
  learnedPlace: MobileLearnedPlace | null;
  onClose: () => void;
  onEdit: (learnedPlace: MobileLearnedPlace) => void;
  onForget: (learnedPlace: MobileLearnedPlace, onSuccess: () => void) => void;
  onIgnore: (learnedPlace: MobileLearnedPlace, onSuccess: () => void) => void;
  onSave: (learnedPlace: MobileLearnedPlace) => void;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const reduceMotion = useReduceMotionPreference();
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const dismissalActionRef = useRef<() => void>(onClose);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyToastToken = useRef(0);

  useEffect(() => {
    dismissalActionRef.current = onClose;
    copyToastToken.current += 1;
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    copyToastTimer.current = null;
    setCopyToast(null);
    return () => {
      if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
      copyToastTimer.current = null;
    };
  }, [learnedPlace?.id]);

  if (!learnedPlace) return null;

  const details = learnedPlaceDetailValues(learnedPlace);
  const associatedCategory = learnedPlaceCategoryLabel(learnedPlace, categories);
  const disabled = ignoring || forgetting;
  function dismissWith(action: () => void = onClose) {
    dismissalActionRef.current = action;
    sheetRef.current?.dismiss();
  }
  function finishDismissal() {
    const action = dismissalActionRef.current;
    dismissalActionRef.current = onClose;
    action();
  }
  async function copyDetail(label: string, value: string | null) {
    const copied = await copyLearnedPlaceDetail(value, Clipboard.setStringAsync);
    if (!copied) return;
    const token = ++copyToastToken.current;
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    setCopyToast(`${label} copied`);
    copyToastTimer.current = setTimeout(() => {
      if (copyToastToken.current !== token) return;
      setCopyToast(null);
      copyToastTimer.current = null;
    }, 2_000);
  }

  return (
    <Modal animationType="none" onRequestClose={() => dismissWith()} transparent visible>
      <View style={styles.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel="Place suggestion"
          backdropAccessibilityLabel="Close learned place details"
          backdropStyle={styles.sheetBackdrop}
          disabled={disabled}
          handleStyle={styles.sheetHandle}
          onDismiss={finishDismissal}
          reduceMotion={reduceMotion}
          style={styles.activeEditSheet}
          visible
        >
          {/* Blocks head (UIA-031): the eyebrow over the place's name, and a circular close. */}
          <View style={learnedSheetStyles.head}>
            <View style={learnedSheetStyles.headTitle}>
              <Text {...mobileTextProps("counter")} style={[learnedSheetStyles.eyebrow, { color: theme.textMuted }]}>PLACE SUGGESTION</Text>
              <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" numberOfLines={2} style={[learnedSheetStyles.title, { color: theme.textPrimary }]}>
                {details.name}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close place suggestion"
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => dismissWith()}
              style={({ pressed }) => [learnedSheetStyles.close, { backgroundColor: theme.surfaceMuted }, pressed ? styles.buttonPressed : null]}
            >
              <DayframeIcon color={theme.textPrimary} glyph="x" size={18} />
            </Pressable>
          </View>

          <ScrollView style={styles.activeEditScroller} contentContainerStyle={[styles.activeEditContent, learnedSheetStyles.body]}>
            <Text {...mobileTextProps("body")} style={{ color: theme.textSecondary }}>
              You keep coming back here, so it may be worth saving. Nothing changes until you save it.
            </Text>

            <SettingsBlockGroup theme={theme} title="Where">
              <SettingsBlockRow
                control={details.address ? (
                  <SettingsPillButton accessibilityLabel="Copy address" label="Copy" onPress={() => void copyDetail("Address", details.address)} theme={theme} />
                ) : undefined}
                divider={false}
                subtitle={details.address ?? "Not found yet"}
                theme={theme}
                title="Address"
              />
              <SettingsBlockRow
                control={details.coordinates ? (
                  <SettingsPillButton accessibilityLabel="Copy coordinates" label="Copy" onPress={() => void copyDetail("Coordinates", details.coordinates)} theme={theme} />
                ) : undefined}
                subtitle={details.coordinates ?? "Not available"}
                theme={theme}
                title="Coordinates"
              />
              <SettingsBlockRow subtitle={`${learnedPlace.radiusMeters} m around the centre`} theme={theme} title="Size" />
            </SettingsBlockGroup>

            <SettingsBlockGroup theme={theme} title="Your visits">
              <SettingsBlockRow
                divider={false}
                subtitle={`${learnedPlace.visitCount} ${learnedPlace.visitCount === 1 ? "visit" : "visits"} on ${learnedPlace.distinctDayCount} ${learnedPlace.distinctDayCount === 1 ? "day" : "days"}`}
                theme={theme}
                title="Visits seen"
              />
              <SettingsBlockRow
                subtitle={`${formatDwell(learnedPlace.totalDwellSeconds)} in all · longest ${formatDwell(learnedPlace.longestDwellSeconds)}`}
                theme={theme}
                title="Time spent here"
              />
              <SettingsBlockRow subtitle={formatShortDateTime(learnedPlace.lastSeenAt)} theme={theme} title="Last seen" />
              <SettingsBlockRow subtitle={associatedCategory} theme={theme} title="Activity" />
            </SettingsBlockGroup>

            <View style={learnedSheetStyles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => dismissWith(() => onSave(learnedPlace))}
                style={({ pressed }) => [learnedSheetStyles.pill, { backgroundColor: theme.accent, opacity: disabled ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
              >
                <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.onAccent }]}>Save place</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => dismissWith(() => onEdit(learnedPlace))}
                style={({ pressed }) => [learnedSheetStyles.pill, { backgroundColor: theme.surfaceMuted, opacity: disabled ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
              >
                <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.textPrimary }]}>Edit before saving</Text>
              </Pressable>
              <View style={learnedSheetStyles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: ignoring, disabled }}
                  disabled={disabled}
                  onPress={() => onIgnore(learnedPlace, () => dismissWith())}
                  style={({ pressed }) => [learnedSheetStyles.pill, learnedSheetStyles.half, { backgroundColor: theme.surfaceMuted, opacity: disabled && !ignoring ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
                >
                  <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.textPrimary }]}>{ignoring ? "Ignoring…" : "Ignore"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: forgetting, disabled }}
                  disabled={disabled}
                  onPress={() => onForget(learnedPlace, () => dismissWith())}
                  style={({ pressed }) => [learnedSheetStyles.pill, learnedSheetStyles.half, { backgroundColor: theme.surfaceMuted, opacity: disabled && !forgetting ? 0.45 : 1 }, pressed ? styles.buttonPressed : null]}
                >
                  <Text {...mobileTextProps("control")} style={[learnedSheetStyles.pillText, { color: theme.dangerText }]}>{forgetting ? "Forgetting…" : "Forget"}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
          {copyToast ? (
            <Reanimated.View
              key={copyToast}
              accessibilityLiveRegion="polite"
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              style={styles.copyToastOverlay}
            >
              <View style={styles.copyToast}>
                <Text style={styles.copyToastText}>{copyToast}</Text>
              </View>
            </Reanimated.View>
          ) : null}
        </SwipeDismissSheet>
      </View>
      {/* Ignore / Forget confirmations, presented over this sheet's modal. */}
      <BlocksConfirmHost controller={confirmSheet} reduceMotion={reduceMotion} styles={styles} theme={theme} />
    </Modal>
  );
}

function reconcileBootstrapPlaces(
  data: MobileBootstrap,
  options: { upsertPlace?: MobilePlace; removePlaceId?: string; removeLearnedPlaceId?: string }
): MobileBootstrap {
  const withoutChangedPlace = data.places.filter((place) => {
    if (options.removePlaceId && place.id === options.removePlaceId) return false;
    if (options.upsertPlace && place.id === options.upsertPlace.id) return false;
    return true;
  });
  const places = options.upsertPlace
    ? sortPlaces([options.upsertPlace, ...withoutChangedPlace])
    : sortPlaces(withoutChangedPlace);
  const learnedPlaces = options.removeLearnedPlaceId
    ? (data.learnedPlaces ?? []).filter((learnedPlace) => learnedPlace.id !== options.removeLearnedPlaceId)
    : data.learnedPlaces;
  return { ...data, places, learnedPlaces };
}

function mergeLearnedPlaceResolutions(
  data: MobileBootstrap,
  resolved: Array<Pick<
    MobileLearnedPlace,
    "id" | "name" | "address" | "poiName" | "formattedAddress" | "geocodedAt"
  >>
): MobileBootstrap {
  const byId = new Map(resolved.map((learnedPlace) => [learnedPlace.id, learnedPlace]));
  return {
    ...data,
    learnedPlaces: (data.learnedPlaces ?? []).map((learnedPlace) => {
      const resolution = byId.get(learnedPlace.id);
      return resolution ? { ...learnedPlace, ...resolution } : learnedPlace;
    })
  };
}

function sortPlaces(places: MobilePlace[]) {
  return [...places].sort((left, right) => {
    const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return left.name.localeCompare(right.name);
  });
}

function formatDwell(seconds: number) {
  return formatDuration(Number(seconds));
}

function learnedPlaceCategoryLabel(learnedPlace: MobileLearnedPlace, categories: Category[]) {
  const raw = learnedPlace.rawPayload ?? {};
  const categoryName = typeof raw.categoryName === "string" && raw.categoryName.trim()
    ? raw.categoryName.trim()
    : null;
  if (categoryName) return categoryName;
  const categoryId = typeof raw.categoryId === "string" ? raw.categoryId : null;
  const category = categoryId ? categories.find((candidate) => candidate.id === categoryId) : null;
  const description = typeof raw.activityDescription === "string" && raw.activityDescription.trim()
    ? raw.activityDescription.trim()
    : null;
  if (category && description) return `${category.name} · ${description}`;
  if (category) return category.name;
  if (description) return description;
  return "Not set until saved";
}

function formatShortDateTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "recently";
  return formatLocaleDate(timestamp, {
    month: "short",
    day: "numeric"
  });
}

const learnedSheetStyles = StyleSheet.create({
  head: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 8, paddingHorizontal: 4, paddingTop: 6 },
  headTitle: { flex: 1, gap: 2, minWidth: 0 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 22 },
  close: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, height: 44, justifyContent: "center", width: 44 },
  body: { gap: 16 },
  actions: { gap: 10 },
  actionRow: { flexDirection: "row", gap: 10 },
  pill: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 48, paddingHorizontal: 18 },
  half: { flex: 1 },
  pillText: { fontSize: 16, fontWeight: "700" }
});
