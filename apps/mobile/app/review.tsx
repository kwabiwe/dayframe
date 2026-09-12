import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  paletteColorFor,
  readableLocationNameFromParts,
  type LegacyReviewEntryPresentation,
  type ReviewMutation
} from "@dayframe/shared";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { MobileBackButton } from "@/components/MobileBackButton";
import {
  OverflowMenu,
  type OverflowMenuAction
} from "@/components/OverflowMenu";
import {
  AuthRequiredError,
  createTag,
  fetchBootstrap,
  updateTimeEntry,
  type MobileBootstrap,
  type MobileReviewItem,
  type MobileTimeEntry,
  type TimeEntryUpdatePatch
} from "@/lib/api";
import { reprocessExistingHealthReviewItems } from "@/lib/health";
import { createLocationReviewEvidencePrefetcher } from "@/lib/locationReviewEvidenceCache";
import { prepareReviewOverlapCounts, reviewPeerEntries } from "@/lib/reviewPresentation";
import { useConnectivity } from "@/lib/connectivity";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";
import { mergePersistedMobileTag } from "@/lib/mobileTags";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  scheduleLayoutTransition,
  useResolvedReduceMotionPreference
} from "@/lib/motion";
import {
  REVIEW_COPY,
  CLOSED_REVIEW_MENU_STATE,
  buildReviewItemDraftEntry,
  canRunReviewMenuAction,
  hasSuggestedTimeWindow,
  hasV2LocationEvidence,
  isCurrentReviewEditPresentation,
  isOneOffLocationReviewItem,
  isOpenReviewItem,
  isReviewNeededEntry,
  locationReviewReasonCopy,
  isLocationReviewItem,
  reduceReviewMenuState,
  reviewConfidencePresentation,
  reviewConfirmLabel,
  reviewItemCategoryLabel,
  reviewItemDurationSeconds,
  type ReviewMenuEvent
} from "@/lib/review";
import { mobileTextProps } from "@/lib/mobileTypography";
import { recordMobileLayout, recordMobileTextLayout } from "@/components/accessibility/diagnostics";
import type { MobileAccessibilityDiagnostic } from "@/components/accessibility/diagnostics";
import {
  cacheReviewPresentation,
  createReviewClientMutationId,
  enqueueReviewMutation,
  getReviewItemSyncStates,
  getReviewSyncDiagnostics,
  loadCachedReviewBootstrap,
  projectReviewBootstrap,
  projectReviewBootstrapFromStore,
  subscribeReviewSync,
  synchroniseReviewMutations,
  type ReviewItemSyncState,
  type ReviewSyncDiagnostics
} from "@/lib/reviewSyncStore";
import { DAYFRAME_BACKEND_ID } from "@/lib/backendIdentity";
import {
  fetchReviewPresentationPage,
  fetchReviewPresentationSnapshot,
  ReviewPresentationSnapshotChangedError
} from "@/lib/reviewPresentationClient";
import {
  mergeReviewBacklogPage,
  projectReviewBacklogPage,
  type ReviewBacklogState
} from "@/lib/reviewBacklog";
import {
  legacyReviewPresentationToMobileEntry,
  parseReviewFocusRequest
} from "@/lib/reviewFocus";
import {
  reviewSyncStatusCopy
} from "@/lib/reviewSyncPresentation";
import type { TimeEntrySheetPresentation } from "@/lib/timeEntrySheetPresentation";

type ReviewEditTarget =
  | {
    kind: "reviewItem";
    item: MobileReviewItem;
    entry: MobileTimeEntry;
    handoverToken: number;
  }
  | { kind: "entry"; entry: MobileTimeEntry };

type ReviewLoadOptions = {
  forceReprocess?: boolean;
  preserveMenu?: boolean;
  queueIfBusy?: boolean;
  refresh?: boolean;
  silent?: boolean;
  skipReprocess?: boolean;
};

type ReviewBacklogRead = {
  controller: AbortController;
  generation: number;
};

type ReviewBacklogLoadOptions = {
  cursor?: string;
  reset: boolean;
  replace?: boolean;
  restartAttempt?: number;
};

const HEALTH_REPROCESS_TIMEOUT_MS = 45_000;

export default function ReviewScreen() {
  const routeParams = useLocalSearchParams<{
    focusReviewId?: string | string[];
    focusEntryId?: string | string[];
  }>();
  const focusRequest = useMemo(
    () => parseReviewFocusRequest(routeParams),
    [routeParams.focusEntryId, routeParams.focusReviewId]
  );
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const { isOffline, isOnline, reconnectEpoch } = useConnectivity();
  const {
    reduceMotion,
    resolved: reduceMotionPreferenceResolved
  } = useResolvedReduceMotionPreference();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [reviewBacklog, setReviewBacklog] = useState<ReviewBacklogState | null>(null);
  const [reviewBacklogLoading, setReviewBacklogLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editTarget, setEditTarget] = useState<ReviewEditTarget | null>(null);
  const [editPresentation, setEditPresentation] = useState<TimeEntrySheetPresentation | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [showReviewInfo, setShowReviewInfo] = useState(false);
  const [reviewMenuState, setReviewMenuState] = useState(CLOSED_REVIEW_MENU_STATE);
  const [reviewAvailabilityMessage, setReviewAvailabilityMessage] = useState<string | null>(null);
  const [focusedLegacyEntry, setFocusedLegacyEntry] = useState<MobileTimeEntry | null>(null);
  const [highlightedFocusKey, setHighlightedFocusKey] = useState<string | null>(null);
  const [reviewSyncDiagnostics, setReviewSyncDiagnostics] = useState<ReviewSyncDiagnostics | null>(
    null
  );
  const [reviewItemSyncStates, setReviewItemSyncStates] = useState<
    Map<string, ReviewItemSyncState>
  >(new Map());
  const dataRef = useRef<MobileBootstrap | null>(null);
  const editTargetRef = useRef<ReviewEditTarget | null>(null);
  const editPresentationRef = useRef<TimeEntrySheetPresentation | null>(null);
  const editPresentationSequence = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const screenFocusedRef = useRef(false);
  const screenOwnerGeneration = useRef(0);
  const refreshInFlight = useRef(false);
  const bootstrapRefreshQueued = useRef(false);
  const initialFocusHandled = useRef(false);
  const healthReprocessInFlight = useRef(false);
  const forcedReprocessComplete = useRef(false);
  const lastHandledReconnectEpoch = useRef(0);
  const connectivityRef = useRef({ isOffline, isOnline, reconnectEpoch });
  const reviewMenuStateRef = useRef(CLOSED_REVIEW_MENU_STATE);
  const reviewMenuActionSequence = useRef(0);
  const reviewMutations = useRef(new Map<string, number>());
  const reviewScrollRef = useRef<ScrollView>(null);
  const reviewBacklogRef = useRef<ReviewBacklogState | null>(null);
  const reviewBacklogRead = useRef<ReviewBacklogRead | null>(null);
  const focusRowOffsets = useRef(new Map<string, number>());
  const focusPendingKey = useRef<string | null>(null);
  const focusConsumedKey = useRef<string | null>(null);
  const focusLookupKey = useRef<string | null>(null);
  const loadRef = useRef<(options?: ReviewLoadOptions) => Promise<void>>(
    async () => undefined
  );
  const evidencePrefetcher = useRef(
    createLocationReviewEvidencePrefetcher()
  ).current;
  const now = Date.now();
  const navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>();
  const peerEntries = useMemo(() => reviewPeerEntries(data), [data]);
  const overlapCounts = useMemo(() => prepareReviewOverlapCounts(data?.reviewItems ?? [], peerEntries, Date.now()), [data, peerEntries]);
  connectivityRef.current = { isOffline, isOnline, reconnectEpoch };

  const applyReviewMenuEvent = useCallback((event: ReviewMenuEvent) => {
    const nextState = reduceReviewMenuState(reviewMenuStateRef.current, event);
    reviewMenuStateRef.current = nextState;
    setReviewMenuState(nextState);
  }, []);

  const commitEditPresentation = useCallback(
    (nextPresentation: TimeEntrySheetPresentation | null) => {
      editPresentationRef.current = nextPresentation;
      setEditPresentation(nextPresentation);
    },
    []
  );

  const beginEditPresentation = useCallback((requestDescriptionFocus: boolean) => {
    editPresentationSequence.current += 1;
    const nextPresentation: TimeEntrySheetPresentation = {
      id: editPresentationSequence.current,
      reason: "review_edit",
      requestDescriptionFocus,
      allowSuggestionsOnFocus: true
    };
    commitEditPresentation(nextPresentation);
    return nextPresentation;
  }, [commitEditPresentation]);

  const commitEditTarget = useCallback((nextTarget: ReviewEditTarget | null) => {
    editTargetRef.current = nextTarget;
    setEditTarget(nextTarget);
  }, []);

  const commitData = useCallback((nextData: MobileBootstrap | null) => {
    const previousData = dataRef.current;
    if (
      previousData &&
      nextData &&
      (previousData.workspace.id !== nextData.workspace.id || previousData.user.id !== nextData.user.id)
    ) {
      // Backlog pages include legacy editor fields, so they must never bridge
      // an account replacement even for the one render before the next page
      // starts. The active Review cache remains separately owner-bound.
      reviewBacklogRead.current?.controller.abort();
      reviewBacklogRead.current = null;
      reviewBacklogRef.current = null;
      setReviewBacklog(null);
      setReviewBacklogLoading(false);
    }
    const openItemIds = (nextData?.reviewItems ?? [])
      .filter(isOpenReviewItem)
      .map((item) => item.id);
    dataRef.current = nextData;
    setData(nextData);
    applyReviewMenuEvent({
      type: "reconcile",
      openItemIds
    });
    const currentEditTarget = editTargetRef.current;
    if (
      currentEditTarget?.kind === "reviewItem" &&
      !openItemIds.includes(currentEditTarget.item.id)
    ) {
      if (!editPresentationRef.current) commitEditTarget(null);
    }
  }, [applyReviewMenuEvent, commitEditTarget]);

  const commitBootstrap = useCallback((bootstrap: MobileBootstrap) => {
    commitData(bootstrap);
  }, [commitData]);

  const refreshReviewSyncDiagnostics = useCallback(async () => {
    const generation = screenOwnerGeneration.current;
    const [diagnostics, itemStates] = await Promise.all([
      getReviewSyncDiagnostics(),
      getReviewItemSyncStates()
    ]);
    if (generation !== screenOwnerGeneration.current || !screenFocusedRef.current) return;
    setReviewSyncDiagnostics(diagnostics);
    setReviewItemSyncStates(itemStates);
  }, []);

  const reconcileLocalReviewProjection = useCallback(async (
    generation = screenOwnerGeneration.current
  ) => {
    const cached = await loadCachedReviewBootstrap().catch(() => null);
    if (
      generation !== screenOwnerGeneration.current ||
      !screenFocusedRef.current ||
      !cached
    ) {
      return false;
    }
    const current = dataRef.current;
    commitData(current ? mergeReviewBootstrapProjection(current, cached.bootstrap) : cached.bootstrap);
    return true;
  }, [commitData]);

  const hydrateReviewFromCache = useCallback(async (
    generation = screenOwnerGeneration.current
  ) => {
    const committed = await reconcileLocalReviewProjection(generation);
    await refreshReviewSyncDiagnostics();
    return committed;
  }, [reconcileLocalReviewProjection, refreshReviewSyncDiagnostics]);

  const startEvidencePrefetch = useCallback((bootstrap: MobileBootstrap) => {
    evidencePrefetcher.start({
      reviewItemIds: bootstrap.reviewItems
        .filter((item) => item.status === "open" && hasV2LocationEvidence(item))
        .map((item) => item.id),
      workspaceId: bootstrap.workspace.id,
      userId: bootstrap.user.id
    });
  }, [evidencePrefetcher]);

  const cancelPendingReviewHandover = useCallback(() => {
    const pendingAction = reviewMenuStateRef.current.pendingAction;
    applyReviewMenuEvent({ type: "reset" });
    if (!pendingAction) return;
    const currentEditTarget = editTargetRef.current;
    if (
      currentEditTarget?.kind === "reviewItem" &&
      currentEditTarget.handoverToken === pendingAction.token
    ) {
      commitEditTarget(null);
      commitEditPresentation(null);
    }
  }, [applyReviewMenuEvent, commitEditPresentation, commitEditTarget]);

  const commitReviewBacklog = useCallback((next: ReviewBacklogState | null) => {
    reviewBacklogRef.current = next;
    setReviewBacklog(next);
  }, []);

  const cancelReviewBacklogRead = useCallback(() => {
    reviewBacklogRead.current?.controller.abort();
    reviewBacklogRead.current = null;
    setReviewBacklogLoading(false);
  }, []);

  const loadReviewBacklogPage = useCallback(async function loadReviewBacklogPage(
    options: ReviewBacklogLoadOptions
  ): Promise<void> {
    const bootstrap = dataRef.current;
    if (!bootstrap || !DAYFRAME_BACKEND_ID || !screenFocusedRef.current) return;
    const existing = reviewBacklogRead.current;
    if (existing) {
      if (!options.replace) return;
      existing.controller.abort();
    }
    if (options.reset) commitReviewBacklog(null);

    const owner = {
      backendId: DAYFRAME_BACKEND_ID,
      workspaceId: bootstrap.workspace.id,
      userId: bootstrap.user.id
    };
    const origin = { workspaceId: bootstrap.workspace.id, userId: bootstrap.user.id };
    const generation = screenOwnerGeneration.current;
    const controller = new AbortController();
    reviewBacklogRead.current = { controller, generation };
    setReviewBacklogLoading(true);
    let restart = false;

    try {
      const response = await fetchReviewPresentationPage({
        owner,
        request: {
          version: 1,
          mode: "backlog",
          timeZone: currentPresentationTimeZone(),
          ...(options.cursor ? { cursor: options.cursor } : {}),
          limit: 100
        },
        signal: controller.signal
      });
      if (
        controller.signal.aborted ||
        generation !== screenOwnerGeneration.current ||
        !screenFocusedRef.current
      ) {
        return;
      }
      const page = projectReviewBacklogPage(response);
      const nextBacklog = mergeReviewBacklogPage(
        reviewBacklogRef.current,
        page,
        options.reset
      );
      if (!nextBacklog) {
        restart = (options.restartAttempt ?? 0) < 1;
        if (!restart) {
          setReviewAvailabilityMessage(
            "Review changed while more items were loading. Pull to refresh the list."
          );
        }
      } else {
        const wrote = await cacheReviewPresentation({ owner, response });
        if (
          !wrote ||
          controller.signal.aborted ||
          generation !== screenOwnerGeneration.current ||
          !screenFocusedRef.current
        ) {
          return;
        }
        const cached = await loadCachedReviewBootstrap();
        const current = dataRef.current;
        if (
          !cached ||
          !current ||
          current.workspace.id !== origin.workspaceId ||
          current.user.id !== origin.userId ||
          controller.signal.aborted ||
          generation !== screenOwnerGeneration.current ||
          !screenFocusedRef.current
        ) {
          return;
        }
        const nextBootstrap = mergeReviewBootstrapProjection(current, cached.bootstrap);
        scheduleLayoutTransition(reduceMotion);
        commitData(nextBootstrap);
        commitReviewBacklog(nextBacklog);
        startEvidencePrefetch(nextBootstrap);
        setReviewAvailabilityMessage(null);
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== screenOwnerGeneration.current) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (error instanceof ReviewPresentationSnapshotChangedError) {
        restart = (options.restartAttempt ?? 0) < 1;
        if (!restart) {
          setReviewAvailabilityMessage(
            "Review changed while more items were loading. Pull to refresh the list."
          );
        }
      } else {
        setReviewAvailabilityMessage(
          connectivityRef.current.isOffline
            ? "Connect to load more Review items."
            : "Couldn’t load more Review items. Try again."
        );
      }
    } finally {
      if (reviewBacklogRead.current?.controller === controller) {
        reviewBacklogRead.current = null;
        setReviewBacklogLoading(false);
      }
    }

    if (
      restart &&
      generation === screenOwnerGeneration.current &&
      screenFocusedRef.current
    ) {
      await loadReviewBacklogPage({
        reset: true,
        replace: true,
        restartAttempt: (options.restartAttempt ?? 0) + 1
      });
    }
  }, [
    commitData,
    commitReviewBacklog,
    reduceMotion,
    startEvidencePrefetch
  ]);

  const load = useCallback(async (options?: ReviewLoadOptions) => {
    if (refreshInFlight.current) {
      if (options?.queueIfBusy) bootstrapRefreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;
    const generation = screenOwnerGeneration.current;
    if (!options?.preserveMenu) applyReviewMenuEvent({ type: "close" });
    if (options?.refresh) setRefreshing(true);
    try {
      if (options?.refresh) {
        await synchroniseReviewMutations({ force: true });
      }
      const bootstrap = await fetchBootstrap();
      if (
        generation !== screenOwnerGeneration.current ||
        !screenFocusedRef.current
      ) {
        return;
      }
      commitBootstrap(bootstrap);
      setReviewAvailabilityMessage(null);
      await refreshReviewSyncDiagnostics();
      startEvidencePrefetch(bootstrap);
      // Bootstrap intentionally remains capped. The existing Review screen
      // stays responsive while this separate bounded display page makes an
      // older 101st source reachable.
      void loadReviewBacklogPage({ reset: true, replace: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      console.warn("Health Review reprocess did not complete", {
        name: error instanceof Error ? error.name : "UnknownError",
        timedOut: error instanceof Error && error.message === "Health reprocess timed out."
      });
      if (
        generation !== screenOwnerGeneration.current ||
        !screenFocusedRef.current
      ) {
        return;
      }
      const cached = await loadCachedReviewBootstrap().catch(() => null);
      if (cached || dataRef.current) {
        if (cached) {
          const current = dataRef.current;
          const nextBootstrap =
            current
              ? mergeReviewBootstrapProjection(current, cached.bootstrap)
              : cached.bootstrap;
          commitBootstrap(nextBootstrap);
          startEvidencePrefetch(nextBootstrap);
        } else if (dataRef.current) {
          startEvidencePrefetch(dataRef.current);
        }
        setReviewAvailabilityMessage(
          connectivityRef.current.isOffline
            ? cached?.cachedAt
              ? `Showing Review data saved ${formatCachedAt(cached.cachedAt)}`
              : "Showing Review data saved on this iPhone"
            : "Couldn’t refresh Review · showing saved data"
        );
        await refreshReviewSyncDiagnostics();
      } else {
        setReviewAvailabilityMessage(
          connectivityRef.current.isOffline
            ? "No Review data is saved on this iPhone yet."
            : "Review couldn’t load and no saved copy is available."
        );
      }
    } finally {
      refreshInFlight.current = false;
      if (options?.refresh) setRefreshing(false);
      if (bootstrapRefreshQueued.current) {
        bootstrapRefreshQueued.current = false;
        void loadRef.current({
          preserveMenu: true,
          queueIfBusy: true,
          silent: true,
          skipReprocess: true
        });
      }
    }
  }, [
    applyReviewMenuEvent,
    commitBootstrap,
    evidencePrefetcher,
    loadReviewBacklogPage,
    refreshReviewSyncDiagnostics,
    startEvidencePrefetch
  ]);
  loadRef.current = load;

  const recoverReviewAfterReconnect = useCallback(() => {
    const currentConnectivity = connectivityRef.current;
    if (
      currentConnectivity.reconnectEpoch <= lastHandledReconnectEpoch.current ||
      !currentConnectivity.isOnline ||
      appStateRef.current !== "active" ||
      !screenFocusedRef.current
    ) {
      return;
    }
    lastHandledReconnectEpoch.current = currentConnectivity.reconnectEpoch;
    const generation = screenOwnerGeneration.current;
    void synchroniseReviewMutations({ force: true })
      .catch(() => undefined)
      .then(() => {
        if (
          generation !== screenOwnerGeneration.current ||
          !screenFocusedRef.current ||
          appStateRef.current !== "active"
        ) {
          return;
        }
        return load({
          preserveMenu: true,
          queueIfBusy: true,
          silent: true,
          skipReprocess: true
        });
      });
  }, [load]);

  const startHealthReviewReprocess = useCallback(async (force = false) => {
    if (healthReprocessInFlight.current) return;
    healthReprocessInFlight.current = true;
    const forceReprocess = force || !forcedReprocessComplete.current;
    if (forceReprocess) forcedReprocessComplete.current = true;
    try {
      const reprocess = await withTimeout(
        reprocessExistingHealthReviewItems(undefined, { force: forceReprocess }),
        HEALTH_REPROCESS_TIMEOUT_MS
      );
      if (
        reprocess.confirmedCount > 0 ||
        reprocess.ignoredCount > 0 ||
        reprocess.updatedCategoryCount > 0 ||
        reprocess.repairedSleepEntryCount > 0
      ) {
        void loadRef.current({
          preserveMenu: true,
          queueIfBusy: true,
          silent: true,
          skipReprocess: true
        });
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
    } finally {
      healthReprocessInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshReviewSyncDiagnostics();
    return subscribeReviewSync(() => {
      if (!screenFocusedRef.current) return;
      void reconcileLocalReviewProjection();
      void refreshReviewSyncDiagnostics();
    });
  }, [reconcileLocalReviewProjection, refreshReviewSyncDiagnostics]);

  const stopReviewPresentationWork = useCallback(() => {
    screenFocusedRef.current = false;
    screenOwnerGeneration.current += 1;
    evidencePrefetcher.stop();
    cancelReviewBacklogRead();
    cancelPendingReviewHandover();
  }, [cancelPendingReviewHandover, cancelReviewBacklogRead, evidencePrefetcher]);

  useEffect(() => navigation.addListener("beforeRemove", stopReviewPresentationWork), [navigation, stopReviewPresentationWork]);
  useEffect(() => navigation.addListener("transitionStart", (event) => {
    if (event.data.closing) stopReviewPresentationWork();
  }), [navigation, stopReviewPresentationWork]);
  useEffect(() => navigation.addListener("gestureCancel", () => {
    screenFocusedRef.current = true;
    const generation = ++screenOwnerGeneration.current;
    void hydrateReviewFromCache(generation);
    void loadRef.current({ silent: true, skipReprocess: true, queueIfBusy: true });
  }), [hydrateReviewFromCache, navigation]);

  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true;
      screenOwnerGeneration.current += 1;
      lastHandledReconnectEpoch.current = Math.max(
        lastHandledReconnectEpoch.current,
        connectivityRef.current.reconnectEpoch
      );
      const generation = screenOwnerGeneration.current;
      applyReviewMenuEvent({ type: "close" });
      void reloadThemePreference();
      if (!initialFocusHandled.current) {
        initialFocusHandled.current = true;
        void hydrateReviewFromCache(generation).finally(() => {
          if (generation !== screenOwnerGeneration.current) return;
          void load({ silent: true, skipReprocess: true, queueIfBusy: true });
          void startHealthReviewReprocess(true);
        });
      } else {
        void hydrateReviewFromCache(generation);
        void load({ silent: true, skipReprocess: true, queueIfBusy: true });
      }
      return () => {
        screenFocusedRef.current = false;
        screenOwnerGeneration.current += 1;
        evidencePrefetcher.stop();
        cancelReviewBacklogRead();
        cancelPendingReviewHandover();
      };
    }, [
      applyReviewMenuEvent,
      cancelPendingReviewHandover,
      cancelReviewBacklogRead,
      evidencePrefetcher,
      hydrateReviewFromCache,
      load,
      reloadThemePreference,
      startHealthReviewReprocess
    ])
  );

  useEffect(() => recoverReviewAfterReconnect(), [
    isOnline,
    reconnectEpoch,
    recoverReviewAfterReconnect
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState !== "active") {
        evidencePrefetcher.stop();
        cancelReviewBacklogRead();
        cancelPendingReviewHandover();
        return;
      }
      if (screenFocusedRef.current) {
        const reconnectPending =
          connectivityRef.current.isOnline &&
          connectivityRef.current.reconnectEpoch > lastHandledReconnectEpoch.current;
        if (reconnectPending) {
          recoverReviewAfterReconnect();
        } else {
          void synchroniseReviewMutations().catch(() => undefined);
          void load({
            preserveMenu: true,
            queueIfBusy: true,
            silent: true,
            skipReprocess: true
          });
        }
      }
    });
    return () => subscription.remove();
  }, [
    cancelPendingReviewHandover,
    cancelReviewBacklogRead,
    evidencePrefetcher,
    load,
    recoverReviewAfterReconnect
  ]);

  const cachedOpenReviewItems = useMemo(
    () => (data?.reviewItems ?? []).filter(isOpenReviewItem),
    [data?.reviewItems]
  );
  const openReviewItems = useMemo(() => {
    if (!reviewBacklog) return cachedOpenReviewItems;
    const byId = new Map(cachedOpenReviewItems.map((item) => [item.id, item]));
    const ordered = reviewBacklog.reviewItemIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    const loadedIds = new Set(ordered.map((item) => item.id));
    // Partial cache safety retains sources from a previous verified scope.
    // Put them after the immutable current page rather than letting equal
    // SQLite positions interleave an older page with this one.
    return [
      ...ordered,
      ...cachedOpenReviewItems.filter((item) => !loadedIds.has(item.id))
    ];
  }, [cachedOpenReviewItems, reviewBacklog]);
  const reviewNeededEntries = useMemo(
    () => collectReviewNeededEntries(data, reviewBacklog?.legacyEntries ?? []),
    [data, reviewBacklog]
  );
  const displayedReviewNeededEntries = useMemo(() => {
    const byId = new Map(reviewNeededEntries.map((entry) => [entry.id, entry]));
    if (focusedLegacyEntry) byId.set(focusedLegacyEntry.id, focusedLegacyEntry);
    return [...byId.values()].sort(
      (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
    );
  }, [focusedLegacyEntry, reviewNeededEntries]);
  const visibleReviewItemCount = openReviewItems.length + displayedReviewNeededEntries.length;
  const hasUnmaterialisedReviewEffects = Boolean(reviewSyncDiagnostics && (
    reviewSyncDiagnostics.pendingCount +
    reviewSyncDiagnostics.retryWaitCount +
    reviewSyncDiagnostics.authenticationRequiredCount +
    reviewSyncDiagnostics.needsAttentionCount +
    reviewSyncDiagnostics.acknowledgedCount > 0
  ));
  const reviewCountIsExact = reviewBacklog !== null && !hasUnmaterialisedReviewEffects;
  const totalNeedsReview = reviewCountIsExact
    ? reviewBacklog.globalCount
    : visibleReviewItemCount;
  const reviewCountCopy = reviewCountIsExact
    ? `${reviewBacklog.globalCount} ${reviewBacklog.globalCount === 1 ? "item" : "items"} need review`
    : reviewBacklog
      ? "Review available · count updating"
      : `At least ${visibleReviewItemCount} ${visibleReviewItemCount === 1 ? "item" : "items"} need review`;
  const backlogProgressCopy = reviewBacklog?.nextCursor
    ? `Loaded ${reviewBacklog.recordKeys.length} of ${reviewBacklog.globalCount} Review items.`
    : reviewBacklog && !reviewBacklog.recordsComplete
      ? `Loaded ${reviewBacklog.recordKeys.length} of ${reviewBacklog.globalCount} Review items. More Review items may be available after this bounded collection.`
      : null;
  const showEmptyReviewState = reviewCountIsExact && totalNeedsReview === 0 && visibleReviewItemCount === 0;
  const editingEntry = editTarget?.entry ?? null;
  const overflowItemId =
    reviewMenuState.openItemId ?? reviewMenuState.closingItemId;
  const overflowTarget = (data?.reviewItems ?? []).find(
    (item) => item.id === overflowItemId
  ) ?? null;

  const loadMoreReviewBacklog = useCallback(() => {
    const cursor = reviewBacklogRef.current?.nextCursor;
    if (!cursor) return;
    void loadReviewBacklogPage({ cursor, reset: false });
  }, [loadReviewBacklogPage]);

  const scrollExactFocusIntoView = useCallback((key: string) => {
    if (focusPendingKey.current !== key || focusConsumedKey.current === key) return;
    const offset = focusRowOffsets.current.get(key);
    if (offset === undefined) return;
    focusPendingKey.current = null;
    focusConsumedKey.current = key;
    reviewScrollRef.current?.scrollTo({
      y: Math.max(0, offset - 16),
      animated: !reduceMotion
    });
    AccessibilityInfo.announceForAccessibility("Opened the exact Review item.");
  }, [reduceMotion]);

  const beginExactFocus = useCallback((key: string) => {
    if (focusConsumedKey.current === key) return;
    focusPendingKey.current = key;
    setHighlightedFocusKey(key);
    scrollExactFocusIntoView(key);
  }, [scrollExactFocusIntoView]);

  const recordFocusRowLayout = useCallback((key: string, y: number) => {
    if (!Number.isFinite(y)) return;
    focusRowOffsets.current.set(key, y);
    scrollExactFocusIntoView(key);
  }, [scrollExactFocusIntoView]);

  useEffect(() => {
    const request = focusRequest;
    if (!request) {
      setFocusedLegacyEntry(null);
      setHighlightedFocusKey(null);
      return;
    }
    const focusKey = reviewFocusKey(request.kind, request.id);
    if (focusConsumedKey.current === focusKey) return;
    if (!data) return;

    if (request.kind === "review") {
      if (openReviewItems.some((item) => item.id === request.id)) {
        beginExactFocus(focusKey);
        return;
      }
    } else if (displayedReviewNeededEntries.some((entry) => entry.id === request.id)) {
      beginExactFocus(focusKey);
      return;
    }

    if (focusLookupKey.current === focusKey) return;
    if (!DAYFRAME_BACKEND_ID) {
      focusConsumedKey.current = focusKey;
      setReviewAvailabilityMessage("This exact Review item cannot be resolved in this app build. Refresh Review.");
      return;
    }
    focusLookupKey.current = focusKey;
    const owner = {
      backendId: DAYFRAME_BACKEND_ID,
      workspaceId: data.workspace.id,
      userId: data.user.id
    };
    const origin = { workspaceId: data.workspace.id, userId: data.user.id };
    void fetchReviewPresentationSnapshot({
      owner,
      request: {
        version: 1,
        mode: "lookup",
        timeZone: currentPresentationTimeZone(),
        ...(request.kind === "review"
          ? { reviewItemIds: [request.id] }
          : { entryIds: [request.id] }),
        limit: 100
      }
    }).then(async (response) => {
      const current = dataRef.current;
      if (
        !current ||
        current.workspace.id !== origin.workspaceId ||
        current.user.id !== origin.userId ||
        focusLookupKey.current !== focusKey ||
        focusConsumedKey.current === focusKey
      ) return;
      const wrote = await cacheReviewPresentation({ owner, response });
      if (!wrote) return;
      if (request.kind === "review") {
        const cached = await loadCachedReviewBootstrap();
        const target = cached?.bootstrap.reviewItems.find((item) => item.id === request.id) ?? null;
        if (target) {
          const latest = dataRef.current;
          if (latest && latest.workspace.id === origin.workspaceId && latest.user.id === origin.userId) {
            commitData(mergeFocusedReviewItem(latest, target));
          }
          return;
        }
      } else {
        const target = response.lookup.entries.find((entry): entry is LegacyReviewEntryPresentation => (
          entry.kind === "legacy_review_entry" && entry.entryId === request.id
        ));
        const entry = target ? legacyReviewPresentationToMobileEntry(target) : null;
        if (entry) {
          setFocusedLegacyEntry(entry);
          return;
        }
      }
      focusConsumedKey.current = focusKey;
      setReviewAvailabilityMessage("This Review item is already resolved or no longer available. Refreshing Review.");
      void loadRef.current({ preserveMenu: true, queueIfBusy: true, silent: true, skipReprocess: true });
    }).catch((error) => {
      if (focusConsumedKey.current === focusKey) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      focusConsumedKey.current = focusKey;
      setReviewAvailabilityMessage("Couldn’t find that exact Review item. It may have changed; refresh Review.");
    });
  }, [
    beginExactFocus,
    data,
    displayedReviewNeededEntries,
    focusRequest,
    openReviewItems
  ]);

  useEffect(() => {
    applyReviewMenuEvent({
      type: "reconcile",
      openItemIds: openReviewItems.map((item) => item.id)
    });
  }, [applyReviewMenuEvent, openReviewItems]);

  function confirmItem(item: MobileReviewItem) {
    applyReviewMenuEvent({ type: "close" });
    resolveItem(
      item,
      hasV2LocationEvidence(item)
        ? { action: "confirm" }
        : { action: "accept" },
      "Saved on this iPhone. Waiting to sync."
    );
  }

  function dismissItem(item: MobileReviewItem) {
    resolveItem(
      item,
      hasV2LocationEvidence(item)
        ? { action: "ignore_once_location" }
        : { action: "ignore_once" },
      "Saved on this iPhone. Waiting to sync."
    );
  }

  function toggleReviewMenu(item: MobileReviewItem) {
    applyReviewMenuEvent({
      type: "toggle",
      itemId: item.id,
      disabled:
        reviewMutations.current.has(item.id) ||
        reviewItemSyncStates.has(item.id)
    });
  }

  function selectOverflowAction(action: OverflowMenuAction, itemId: string) {
    const currentState = reviewMenuStateRef.current;
    const item = dataRef.current?.reviewItems.find(
      (candidate) => candidate.id === itemId && isOpenReviewItem(candidate)
    );
    if (!item || !canRunReviewMenuAction(currentState, itemId)) return;
    reviewMenuActionSequence.current += 1;
    applyReviewMenuEvent({
      type: "begin_action",
      action,
      itemId,
      token: reviewMenuActionSequence.current
    });
  }

  function handleOverflowClosed(itemId: string) {
    const pendingAction = reviewMenuStateRef.current.pendingAction;
    applyReviewMenuEvent({ type: "menu_closed", itemId });
    if (!pendingAction || pendingAction.itemId !== itemId) return;

    const finishAction = () => applyReviewMenuEvent({
      type: "finish_action",
      itemId,
      token: pendingAction.token
    });
    if (!screenFocusedRef.current || appStateRef.current !== "active") {
      finishAction();
      return;
    }

    const item = dataRef.current?.reviewItems.find(
      (candidate) => candidate.id === itemId && isOpenReviewItem(candidate)
    );
    if (!item) {
      finishAction();
      return;
    }

    if (pendingAction.action === "dismiss") {
      finishAction();
      dismissItem(item);
      return;
    }

    if (!beginReviewItemEdit(item, pendingAction.token)) finishAction();
  }

  function resolveItem(
    item: MobileReviewItem,
    mutation: ReviewMutation,
    successAnnouncement: string
  ) {
    if (reviewMutations.current.has(item.id)) return;
    const currentData = dataRef.current;
    if (!currentData) return;
    if (!currentData.reviewItems.some((candidate) => candidate.id === item.id)) return;

    reviewMutations.current.set(item.id, 1);
    const clientMutationId = createReviewClientMutationId();
    void enqueueReviewMutation({
      bootstrap: currentData,
      item,
      mutation,
      clientMutationId
    }).then(async () => {
        if (!reviewMutations.current.has(item.id)) return;
        const currentProjection = dataRef.current;
        if (currentProjection) {
          const projected = await projectReviewBootstrapFromStore(currentProjection)
            .catch(() => projectReviewBootstrap(currentProjection, new Set([item.id])));
          commitData(projected);
        } else {
          await reconcileLocalReviewProjection();
        }
        AccessibilityInfo.announceForAccessibility(successAnnouncement);
        reviewMutations.current.delete(item.id);
        void refreshReviewSyncDiagnostics();
        void synchroniseReviewMutations()
          .then(() => {
            void load({
              preserveMenu: true,
              queueIfBusy: true,
              silent: true,
              skipReprocess: true
            });
          })
          .catch(() => {
            void refreshReviewSyncDiagnostics();
          });
      }).catch((error) => {
        reviewMutations.current.delete(item.id);
        AccessibilityInfo.announceForAccessibility(
          "The Review change was not saved. The suggestion is still available."
        );
        Alert.alert(
          "Review",
          error instanceof Error
            ? error.message
            : "Unable to save this Review change on this iPhone."
        );
      });
  }

  function beginReviewItemEdit(item: MobileReviewItem, handoverToken: number) {
    const draftEntry = buildReviewItemDraftEntry(
      item,
      dataRef.current?.categories ?? [],
      Date.now()
    );
    if (!draftEntry || !hasSuggestedTimeWindow(item)) {
      Alert.alert("Edit", "This suggested time entry does not include a start and end time yet.");
      return false;
    }
    commitEditTarget({
      kind: "reviewItem",
      item,
      entry: draftEntry,
      handoverToken
    });
    beginEditPresentation(true);
    return true;
  }

  function finishEditHandover(presentationId: number) {
    if (!isCurrentReviewEditPresentation(editPresentationRef.current?.id ?? null, presentationId)) {
      return;
    }
    const currentEditTarget = editTargetRef.current;
    if (currentEditTarget?.kind !== "reviewItem") return;
    applyReviewMenuEvent({
      type: "finish_action",
      itemId: currentEditTarget.item.id,
      token: currentEditTarget.handoverToken
    });
  }

  function cancelEdit(presentationId: number) {
    if (!isCurrentReviewEditPresentation(editPresentationRef.current?.id ?? null, presentationId)) {
      return;
    }
    const currentEditTarget = editTargetRef.current;
    if (currentEditTarget?.kind === "reviewItem") {
      applyReviewMenuEvent({
        type: "finish_action",
        itemId: currentEditTarget.item.id,
        token: currentEditTarget.handoverToken
      });
    }
    commitEditTarget(null);
    commitEditPresentation(null);
  }

  function beginReviewNeededEntryEdit(entry: MobileTimeEntry) {
    commitEditTarget({ kind: "entry", entry });
    beginEditPresentation(false);
  }

  async function saveEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    if (!editTarget) return false;
    setEditSaving(true);
    try {
      if (editTarget.kind === "reviewItem") {
        if (!patch.startedAt || !patch.stoppedAt) {
          Alert.alert("Edit", "Choose a start and end time before saving this suggestion.");
          return false;
        }
        const currentData = dataRef.current;
        if (!currentData) return false;
        if (!currentData.reviewItems.some(
          (candidate) => candidate.id === editTarget.item.id
        )) return false;
        await enqueueReviewMutation({
          bootstrap: currentData,
          item: editTarget.item,
          clientMutationId: createReviewClientMutationId(),
          mutation: {
            action: "edit_and_confirm",
            edit: {
              categoryId: patch.categoryId ?? null,
              description: patch.description?.trim() || undefined,
              startedAt: patch.startedAt,
              stoppedAt: patch.stoppedAt,
              tags: patch.tagNames
            }
          }
        });
        const currentProjection = dataRef.current;
        if (currentProjection) {
          const projected = await projectReviewBootstrapFromStore(currentProjection)
            .catch(() => projectReviewBootstrap(
              currentProjection,
              new Set([editTarget.item.id])
            ));
          commitData(projected);
        } else {
          await reconcileLocalReviewProjection();
        }
        void refreshReviewSyncDiagnostics();
        AccessibilityInfo.announceForAccessibility(
          "Changes saved on this iPhone. Waiting to sync."
        );
        void synchroniseReviewMutations()
          .then(() => {
            void load({
              preserveMenu: true,
              queueIfBusy: true,
              silent: true,
              skipReprocess: true
            });
          })
          .catch(() => {
            void refreshReviewSyncDiagnostics();
          });
      } else {
        await updateTimeEntry(entryId, patch);
        await load({ silent: true, skipReprocess: true });
      }
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return false;
      }
      Alert.alert("Edit", error instanceof Error ? error.message : "Unable to save this activity.");
      return false;
    } finally {
      setEditSaving(false);
    }
  }

  async function createTimerSheetTag(name: string) {
    try {
      const response = await createTag(name);
      commitData(mergePersistedMobileTag(dataRef.current, response.tag));
      return response.tag;
    } catch (error) {
      if (error instanceof AuthRequiredError) router.replace("/");
      return null;
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <MobileBackButton accessibilityLabel="Back" onPress={() => router.back()} />
          <Text {...mobileTextProps("screenHeading")} style={styles.settingsTitle}>Review</Text>
        </View>
      </View>
      <ScrollView
        ref={reviewScrollRef}
        style={styles.settingsScrollView}
        contentContainerStyle={styles.settingsScrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void load({ refresh: true });
              void startHealthReviewReprocess(true);
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.contentStack}>
          <View style={styles.panel}>
            <View style={styles.summaryHeader}>
              <View>
                <Text {...mobileTextProps("counter")} style={styles.label}>{REVIEW_COPY.needsReview}</Text>
                <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Review</Text>
              </View>
              <Text
                {...mobileTextProps("numeric")}
                accessibilityLabel={reviewCountCopy}
                style={styles.summaryTotal}
              >
                {totalNeedsReview}
              </Text>
            </View>
            <Text {...mobileTextProps("body")} style={styles.muted}>Detected visits and suggested time entries stay here until you confirm, edit or ignore them.</Text>
            {!reviewCountIsExact ? (
              <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={styles.reviewMetaLine}>
                {reviewCountCopy}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showReviewInfo }}
              style={pressable(styles.detailsToggle, styles.buttonPressed)}
              onPress={() => {
                scheduleLayoutTransition(reduceMotion);
                setShowReviewInfo((current) => !current);
              }}
            >
              <Text {...mobileTextProps("control")} style={styles.detailsToggleText}>About Review</Text>
              <ReviewChevronGlyph color={theme.textSecondary} expanded={showReviewInfo} />
            </Pressable>
            {showReviewInfo ? (
              <Reanimated.View
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
              >
                <Text {...mobileTextProps("body")} style={styles.muted}>Dayframe keeps uncertain Health and location activity here so you can confirm the time, edit its details, or dismiss it without silently changing your timeline.</Text>
              </Reanimated.View>
            ) : null}
          </View>

          {reviewAvailabilityMessage ? (
            <View style={styles.queueDiagnosticCard}>
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={styles.muted}>
                {reviewAvailabilityMessage}
              </Text>
            </View>
          ) : null}

          <ReviewSyncStatus
            diagnostics={reviewSyncDiagnostics}
            onReviewIssue={() =>
              router.push({ pathname: "/settings", params: { section: "sync" } })
            }
            styles={styles}
          />

          <View style={styles.reviewItemsSection}>
            <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Review items</Text>
            {showEmptyReviewState ? (
              <Text {...mobileTextProps("body")} style={styles.muted}>{REVIEW_COPY.emptyState}</Text>
            ) : null}
            <View style={styles.reviewList}>
              {openReviewItems.map((item) => (
                  <Reanimated.View
                    key={item.id}
                    onLayout={(event) => recordFocusRowLayout(
                      reviewFocusKey("review", item.id),
                      event.nativeEvent.layout.y
                    )}
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                    style={highlightedFocusKey === reviewFocusKey("review", item.id)
                      ? styles.reviewFocusHighlight
                      : undefined}
                  >
                    <ReviewItemCard
                      item={item}
                      overlapCount={overlapCounts.get(item.id) ?? 0}
                      syncState={reviewItemSyncStates.get(item.id) ?? null}
                      menuOpen={reviewMenuState.openItemId === item.id}
                      now={now}
                      onConfirm={() => confirmItem(item)}
                      onToggleMenu={() => toggleReviewMenu(item)}
                      onViewEvidence={() => {
                        applyReviewMenuEvent({ type: "close" });
                        router.push({ pathname: "/review/[id]", params: { id: item.id } } as never);
                      }}
                      styles={styles}
                      theme={theme}
                    />
                  </Reanimated.View>
              ))}
            </View>
            {displayedReviewNeededEntries.length > 0 ? (
              <View style={styles.reviewList}>
                {displayedReviewNeededEntries.map((entry) => (
                  <Reanimated.View
                    key={entry.id}
                    onLayout={(event) => recordFocusRowLayout(
                      reviewFocusKey("legacy_entry", entry.id),
                      event.nativeEvent.layout.y
                    )}
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                    style={highlightedFocusKey === reviewFocusKey("legacy_entry", entry.id)
                      ? styles.reviewFocusHighlight
                      : undefined}
                  >
                    <ReviewNeededEntryCard
                      entry={entry}
                      now={now}
                      onEdit={() => beginReviewNeededEntryEdit(entry)}
                      styles={styles}
                      theme={theme}
                    />
                  </Reanimated.View>
                ))}
              </View>
            ) : null}
            {backlogProgressCopy ? (
              <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={styles.reviewMetaLine}>
                {backlogProgressCopy}
              </Text>
            ) : null}
            {reviewBacklog?.nextCursor ? (
              <Pressable
                accessibilityLabel={`Load more Review items. ${backlogProgressCopy ?? ""}`.trim()}
                accessibilityRole="button"
                accessibilityState={{ busy: reviewBacklogLoading, disabled: reviewBacklogLoading }}
                disabled={reviewBacklogLoading}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && !reviewBacklogLoading ? styles.buttonPressed : null,
                  reviewBacklogLoading ? styles.buttonDisabled : null
                ]}
                onPress={loadMoreReviewBacklog}
              >
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>
                  {reviewBacklogLoading ? "Loading more Review items…" : "Load more Review items"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <OverflowMenu
        disabled={
          !overflowItemId ||
          reviewMenuState.pendingAction != null
        }
        onClose={() => applyReviewMenuEvent({ type: "close" })}
        onClosed={handleOverflowClosed}
        onSelect={selectOverflowAction}
        instanceId={overflowItemId}
        title={overflowTarget ? reviewItemTitle(overflowTarget) : "review suggestion"}
        visible={reviewMenuState.openItemId != null}
      />

      {editPresentation && reduceMotionPreferenceResolved ? (
        <ActiveTimerEditSheet
          categories={data?.categories ?? []}
          elapsedSeconds={editingEntry ? entryDurationSeconds(editingEntry, now) : 0}
          entry={editingEntry}
          historicalEntries={peerEntries}
          lastStoppedAt={null}
          mode="entry"
          onCancel={cancelEdit}
          onCreateTag={createTimerSheetTag}
          onPresented={finishEditHandover}
          onSave={saveEdit}
          presentation={editPresentation}
          reduceMotion={reduceMotion}
          saving={editSaving}
          stopping={false}
          styles={styles}
          tags={data?.tags ?? []}
          theme={theme}
          visible={Boolean(editingEntry)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ReviewSyncStatus({
  diagnostics,
  onReviewIssue,
  styles
}: {
  diagnostics: ReviewSyncDiagnostics | null;
  onReviewIssue: () => void;
  styles: ReturnType<typeof useMobileTheme>["styles"];
}) {
  if (!diagnostics) return null;
  const copy = reviewSyncStatusCopy(diagnostics);
  if (!copy) return null;
  return (
    <Reanimated.View
      accessibilityLiveRegion={diagnostics.needsAttentionCount > 0 ? "assertive" : "polite"}
      style={styles.queueDiagnosticCard}
    >
      <Text {...mobileTextProps("body")} style={styles.reviewMetaLine}>{copy}</Text>
      <View style={styles.buttonRow}>
        {diagnostics.needsAttentionCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={pressable(styles.secondaryButton, styles.buttonPressed)}
            onPress={onReviewIssue}
          >
            <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Review issue</Text>
          </Pressable>
        ) : null}
      </View>
    </Reanimated.View>
  );
}

export function ReviewItemCard({
  item,
  menuOpen,
  now,
  onConfirm,
  onToggleMenu,
  onViewEvidence,
  overlapCount,
  syncState,
  styles,
  theme,
  diagnostic
}: {
  item: MobileReviewItem;
  menuOpen: boolean;
  now: number;
  onConfirm: () => void;
  onToggleMenu: () => void;
  onViewEvidence: () => void;
  overlapCount: number;
  syncState: ReviewItemSyncState | null;
  styles: ReturnType<typeof useMobileTheme>["styles"];
  theme: ReturnType<typeof useMobileTheme>["theme"];
  diagnostic?: MobileAccessibilityDiagnostic;
}) {
  const durationSeconds = reviewItemDurationSeconds(item, now);
  const title = reviewItemTitle(item);
  const categoryName = reviewItemCategoryName(item);
  const categoryColor = reviewItemCategoryColor(
    item,
    categoryName,
    theme.textSecondary,
    theme.mode
  );
  const controlsDisabled = syncState != null;
  const confidence = reviewConfidencePresentation(item.confidence);
  const locationReason = locationReviewReasonCopy(item, overlapCount);
  const summary = locationReason ?? reviewItemSummary(item);
  const syncCopy = reviewItemSyncStatusCopy(syncState);

  return (
    <View style={styles.reviewCard} onLayout={(event) => recordMobileLayout(diagnostic, "review.card", event)}>
      <View
        pointerEvents="none"
        style={[styles.reviewCardAccentRail, { backgroundColor: categoryColor }]}
      />
      <View style={styles.reviewCardHeader} onLayout={(event) => recordMobileLayout(diagnostic, "review.header", event)}>
        <View style={styles.reviewTitleStack}>
          <Text {...mobileTextProps("itemTitle")} style={styles.reviewTitle} numberOfLines={2} onLayout={(event) => diagnostic?.onLayout?.("review.title.frame", event.nativeEvent.layout)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, "review.title", event, "itemTitle", styles.reviewTitle)}>{title}</Text>
          <Text {...mobileTextProps("metadata")} style={styles.reviewMetaLine}>{formatReviewItemMeta(item, durationSeconds)}</Text>
        </View>
        <View style={styles.reviewBadge} onLayout={(event) => recordMobileLayout(diagnostic, "review.badge", event)}>
          <Text {...mobileTextProps("counter")} style={styles.reviewBadgeText}>
            {syncCopy?.badge ?? REVIEW_COPY.needsReview}
          </Text>
        </View>
      </View>

      {syncCopy ? (
        <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={styles.reviewMetaLine}>
          {syncCopy.detail}
        </Text>
      ) : null}

      <View style={styles.calendarBlockTitleRow}>
        <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
        <Text {...mobileTextProps("metadata")} style={[styles.reviewMetaLine, { flex: 1, minWidth: 0 }]}>
          {categoryName}
          {item.placeName ? ` · ${item.placeName}` : ""}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={`Confidence: ${confidence.label}, ${confidence.score} of 5`}
        style={styles.reviewConfidenceRow}
      >
        <Text {...mobileTextProps("metadata")} style={styles.reviewConfidenceLabel}>Confidence</Text>
        <View accessibilityElementsHidden style={styles.reviewConfidenceDots}>
          {[1, 2, 3, 4, 5].map((score) => (
            <View
              key={score}
              style={[
                styles.reviewConfidenceDot,
                {
                  backgroundColor: score <= confidence.score
                    ? theme.accent
                    : theme.borderStrong
                }
              ]}
            />
          ))}
        </View>
        <Text {...mobileTextProps("metadata")} style={styles.reviewConfidenceValue}>{confidence.label}</Text>
      </View>
      {summary ? (
        <Text {...mobileTextProps("body")} style={styles.reviewSummary} onLayout={(event) => recordMobileLayout(diagnostic, "review.reason.frame", event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, "review.reason", event, "body", styles.reviewSummary)}>{summary}</Text>
      ) : null}
      {overlapCount && !locationReason ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Overlaps ${overlapCount} other ${overlapCount === 1 ? "entry" : "entries"}. You can still confirm.`}
          style={styles.reviewOverlapRow}
        >
          <WarningGlyph color={theme.warningText} />
          <Text {...mobileTextProps("body")} style={styles.reviewOverlapText}>
            Overlaps {overlapCount} other {overlapCount === 1 ? "entry" : "entries"} · You can still confirm
          </Text>
        </View>
      ) : null}

      <View style={styles.reviewActionStack}>
        {hasV2LocationEvidence(item) ? (
          <Pressable
            accessibilityRole="button"
            disabled={controlsDisabled}
            style={({ pressed }) => [
              styles.reviewSecondaryButton,
              pressed && !controlsDisabled ? styles.buttonPressed : null,
              controlsDisabled ? styles.buttonDisabled : null
            ]}
            onPress={onViewEvidence}
          >
            <Text {...mobileTextProps("control")} style={styles.reviewSecondaryButtonText}>View evidence</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={controlsDisabled}
          style={({ pressed }) => [
            styles.reviewPrimaryButton,
            pressed && !controlsDisabled ? styles.buttonPressed : null,
            controlsDisabled ? styles.buttonDisabled : null
          ]}
          onPress={onConfirm}
        >
          <Text {...mobileTextProps("control")} style={styles.primaryButtonText}>{reviewConfirmLabel(item)}</Text>
        </Pressable>
        <View style={styles.reviewOverflowRow}>
          <Pressable
            accessibilityLabel={`More actions for ${title}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: menuOpen, disabled: controlsDisabled }}
            disabled={controlsDisabled}
            style={({ pressed }) => [
              styles.reviewOverflowButton,
              pressed && !controlsDisabled ? styles.buttonPressed : null,
              controlsDisabled ? styles.buttonDisabled : null
            ]}
            onPress={onToggleMenu}
          >
            <MoreActionsGlyph color={theme.accent} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ReviewNeededEntryCard({
  entry,
  now,
  onEdit,
  styles,
  theme
}: {
  entry: MobileTimeEntry;
  now: number;
  onEdit: () => void;
  styles: ReturnType<typeof useMobileTheme>["styles"];
  theme: ReturnType<typeof useMobileTheme>["theme"];
}) {
  const categoryName = entry.categoryName ?? (isHealthSource(entry.source) ? "Health" : "No category");
  const categoryColor = paletteColorFor(
    entry.categoryColor ?? (isHealthSource(entry.source) ? "moss" : entry.categoryId),
    categoryName,
    theme.mode
  );

  return (
    <View style={styles.reviewCard}>
      <View
        pointerEvents="none"
        style={[styles.reviewCardAccentRail, { backgroundColor: categoryColor }]}
      />
      <View style={styles.reviewCardHeader}>
        <View style={styles.reviewTitleStack}>
          <Text {...mobileTextProps("itemTitle")} style={styles.reviewTitle} numberOfLines={2}>{displayEntryTitle(entry)}</Text>
          <Text {...mobileTextProps("metadata")} style={styles.reviewMetaLine}>
            {formatEntryTimeRange(entry, now)} · {formatDuration(entryDurationSeconds(entry, now))}
          </Text>
        </View>
        <View style={styles.reviewBadge}>
          <Text {...mobileTextProps("counter")} style={styles.reviewBadgeText}>{REVIEW_COPY.needsReview}</Text>
        </View>
      </View>
      <View style={styles.calendarBlockTitleRow}>
        <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
        <Text {...mobileTextProps("metadata")} style={[styles.reviewMetaLine, { flex: 1, minWidth: 0 }]}>
          {categoryName}
          {entry.placeName ? ` · ${entry.placeName}` : ""}
        </Text>
      </View>
      <View style={styles.reviewActions}>
        <Pressable
          accessibilityRole="button"
          style={pressable(styles.reviewSecondaryButton, styles.buttonPressed)}
          onPress={onEdit}
        >
          <Text {...mobileTextProps("control")} style={styles.reviewSecondaryButtonText}>{REVIEW_COPY.editDetails}</Text>
        </Pressable>
      </View>
      <Text {...mobileTextProps("body")} style={styles.reviewMetaLine}>Confirm and ignore are available for suggested time entries.</Text>
    </View>
  );
}

function collectReviewNeededEntries(
  data: MobileBootstrap | null,
  backlogEntries: readonly MobileTimeEntry[] = []
) {
  const byId = new Map<string, MobileTimeEntry>();
  for (const entry of [
    ...(data?.dayEntries ?? []),
    ...(data?.weekEntries ?? []),
    ...(data?.entries ?? []),
    ...backlogEntries
  ]) {
    if (isReviewNeededEntry(entry)) byId.set(entry.id, entry);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function mergeReviewBootstrapProjection(
  current: MobileBootstrap,
  projection: MobileBootstrap
) {
  if (
    current.workspace.id !== projection.workspace.id ||
    current.user.id !== projection.user.id
  ) {
    return projection;
  }
  return {
    ...current,
    workspace: projection.workspace,
    categories: projection.categories,
    reviewItems: projection.reviewItems,
    stats: current.stats
      ? {
          ...current.stats,
          reviewCount: projection.stats?.reviewCount ?? projection.reviewItems.length
        }
      : projection.stats
  };
}

function mergeFocusedReviewItem(current: MobileBootstrap, target: MobileReviewItem): MobileBootstrap {
  const existing = current.reviewItems.find((item) => item.id === target.id);
  if (existing) {
    return {
      ...current,
      reviewItems: current.reviewItems.map((item) => item.id === target.id ? target : item)
    };
  }
  return {
    ...current,
    // A targeted source belongs at the visible top of Review. It is not a
    // replacement for bootstrap's capped collection or a claim about global
    // order; its exact identity is what matters for the focused route.
    reviewItems: [target, ...current.reviewItems]
  };
}

function reviewFocusKey(kind: "review" | "legacy_entry", id: string) {
  return `${kind}:${id}`;
}

function currentPresentationTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone || "Etc/UTC";
}

function reviewItemTitle(item: MobileReviewItem) {
  if (item.eventType === "commute_detected") return "Commute detected";
  if (isLocationReviewItem(item)) {
    return readableLocationNameFromParts({
      address: item.rawPayload?.address,
      latitude: item.rawPayload?.latitude,
      longitude: item.rawPayload?.longitude,
      fallbackName: item.title || item.placeName
    });
  }
  return item.title || REVIEW_COPY.suggestedActivity;
}

function formatReviewItemMeta(item: MobileReviewItem, durationSeconds: number) {
  const parts: string[] = [];
  const timeWindow = formatReviewItemTimeWindow(item);
  if (timeWindow) parts.push(timeWindow);
  if (durationSeconds > 0) parts.push(formatDuration(durationSeconds));
  if (!parts.length) parts.push(reviewItemKindLabel(item));
  return parts.join(" · ");
}

function reviewItemKindLabel(item: MobileReviewItem) {
  if (item.eventType === "commute_detected") return "Commute";
  if (isOneOffLocationReviewItem(item)) return "One-off activity";
  if (isLocationReviewItem(item)) return REVIEW_COPY.detectedVisit;
  if (isHealthReviewItem(item)) return "Health import";
  return REVIEW_COPY.suggestedActivity;
}

function reviewItemSummary(item: MobileReviewItem) {
  if (item.eventType === "commute_detected") {
    return item.rawPayload?.continuityStatus === "uncertain_gap"
      ? "Travel was detected, but part of the time range is uncertain."
      : "Travel was detected between places.";
  }

  if (isOneOffLocationReviewItem(item)) {
    return "A significant stay was detected at this location.";
  }

  if (isLocationReviewItem(item)) {
    return item.placeName
      ? `A stay was detected at ${item.placeName}.`
      : "A stay was detected at this location.";
  }

  const notes = item.notes?.trim();
  if (notes) return notes;
  if (isHealthReviewItem(item)) return "Review this Health activity before it is added.";
  return "Review this suggested time before it is added.";
}

function reviewItemCategoryName(item: MobileReviewItem) {
  return reviewItemCategoryLabel(item);
}

function reviewItemCategoryColor(
  item: MobileReviewItem,
  categoryName: string,
  fallbackColor: string,
  mode: ReturnType<typeof useMobileTheme>["theme"]["mode"]
) {
  if (
    item.categoryColor ||
    item.suggestedCategoryId ||
    isHealthReviewItem(item) ||
    item.eventType === "commute_detected"
  ) {
    return paletteColorFor(
      item.categoryColor ??
        (
          item.eventType === "commute_detected"
            ? "sky"
            : isHealthReviewItem(item)
              ? "moss"
              : item.suggestedCategoryId
        ),
      categoryName,
      mode
    );
  }
  return fallbackColor;
}

function isHealthReviewItem(item: Pick<MobileReviewItem, "eventSource" | "eventType">) {
  return item.eventSource?.startsWith("health_") || item.eventType?.startsWith("health_") || false;
}

function isHealthSource(source: string | null | undefined) {
  return source?.startsWith("health_") ?? false;
}

function formatReviewItemTimeWindow(item: MobileReviewItem) {
  if (!item.suggestedStartedAt) return null;
  const startedAt = new Date(item.suggestedStartedAt);
  const stoppedAt = item.suggestedStoppedAt ? new Date(item.suggestedStoppedAt) : null;
  if (Number.isNaN(startedAt.getTime())) return null;
  if (!stoppedAt || Number.isNaN(stoppedAt.getTime())) return formatDateTime(startedAt);
  if (startedAt.toDateString() === stoppedAt.toDateString()) {
    return `${formatDateTime(startedAt)}–${formatTimeOfDay(stoppedAt)}`;
  }
  return `${formatDateTime(startedAt)}–${formatDateTime(stoppedAt)}`;
}

function displayEntryTitle(entry: MobileTimeEntry) {
  return entry.description?.trim() || entry.categoryName || REVIEW_COPY.suggestedActivity;
}

function formatEntryTimeRange(entry: MobileTimeEntry, now: number) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  return `${formatTimeOfDay(startedAt)}-${entry.stoppedAt ? formatTimeOfDay(stoppedAt) : "now"}`;
}

function formatDateTime(date: Date) {
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${formatTimeOfDay(date)}`;
}

function formatCachedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "earlier";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function reviewItemSyncStatusCopy(syncState: ReviewItemSyncState | null) {
  if (!syncState) return null;
  if (syncState.state === "needs_attention") {
    return {
      badge: "Sync issue",
      detail: "This saved change needs attention in Settings before it can reach Dayframe."
    };
  }
  if (syncState.state === "auth_required") {
    return {
      badge: "Waiting to sync",
      detail: "Saved on this iPhone. Sign in to send this change to Dayframe."
    };
  }
  if (syncState.state === "retry_wait") {
    return {
      badge: "Waiting to sync",
      detail: "Saved on this iPhone. It will stay here until Dayframe confirms the change."
    };
  }
  return {
    badge: "Waiting to sync",
    detail: "Saving to Dayframe…"
  };
}

function formatTimeOfDay(date: Date) {
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function entryDurationSeconds(entry: MobileTimeEntry, now: number) {
  const startedAt = new Date(entry.startedAt).getTime();
  if (entry.stoppedAt) return Math.max(0, entry.durationSeconds);
  if (Number.isNaN(startedAt)) return Math.max(0, entry.durationSeconds);
  return Math.max(entry.durationSeconds, Math.floor((now - startedAt) / 1000));
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Health reprocess timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function ReviewChevronGlyph({ color, expanded }: { color: string; expanded: boolean }) {
  return (
    <Svg accessibilityElementsHidden width={18} height={18} viewBox="0 0 24 24">
      <Path
        d={expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

function MoreActionsGlyph({ color }: { color: string }) {
  return (
    <Svg accessibilityElementsHidden width={22} height={22} viewBox="0 0 24 24">
      <Circle cx={5} cy={12} r={1.7} fill={color} />
      <Circle cx={12} cy={12} r={1.7} fill={color} />
      <Circle cx={19} cy={12} r={1.7} fill={color} />
    </Svg>
  );
}

function WarningGlyph({ color }: { color: string }) {
  return (
    <Svg accessibilityElementsHidden width={16} height={16} viewBox="0 0 24 24">
      <Path
        d="M12 3 2.8 20h18.4L12 3Z"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
      <Path
        d="M12 9v4.5M12 17.25h.01"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
      />
    </Svg>
  );
}
