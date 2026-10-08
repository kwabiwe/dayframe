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
import Svg, { Path } from "react-native-svg";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  onBlockTextColor,
  paletteColorFor,
  readableLocationNameFromParts,
  travelModeLabel,
  type LegacyReviewEntryPresentation,
  type ReviewMutation
} from "@dayframe/shared";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import {
  ReviewDeckActions,
  ReviewDeckFinished,
  ReviewDeckStack,
  type ReviewDeckCardModel
} from "@/components/review/ReviewDeck";
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
import { useResolvedReduceMotionPreference } from "@/lib/motion";
import {
  formatReviewDeckDuration,
  formatReviewDeckWhen,
  orderReviewDeck,
  reviewDeckPicture,
  reviewDeckPosition,
  reviewDeckSource
} from "@/lib/reviewDeck";
import {
  REVIEW_COPY,
  isTimeAwayReviewItem,
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
  reviewItemCategoryLabel,
  reviewItemDurationSeconds,
  type ReviewMenuEvent
} from "@/lib/review";
import { mobileTextProps } from "@/lib/mobileTypography";
import {
  cacheReviewPresentation,
  recordReviewPresentationRead,
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
  ReviewPresentationSnapshotChangedError,
  ReviewPresentationValidationError
} from "@/lib/reviewPresentationClient";
import { isMobileTransportFailure } from "@/lib/mobile-network";
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
  // This visit's decisions: the "N of M" position and the "All framed" summary.
  const [deckVisit, setDeckVisit] = useState<{ decided: number; logged: { color: string; seconds: number }[] }>({
    decided: 0,
    logged: []
  });
  // Legacy needs-review entries have no skip mutation; Skip moves them behind the rest for this visit.
  const [deferredDeckKeys, setDeferredDeckKeys] = useState<readonly string[]>([]);
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
  const reviewBacklogRef = useRef<ReviewBacklogState | null>(null);
  const reviewBacklogRead = useRef<ReviewBacklogRead | null>(null);
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
    let readPhase: "server" | "cache" = "server";

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
        recordReviewPresentationRead(owner, "backlog", "snapshot_changed");
        restart = (options.restartAttempt ?? 0) < 1;
        if (!restart) {
          setReviewAvailabilityMessage(
            "Review changed while more items were loading. Pull to refresh the list."
          );
        }
      } else {
        readPhase = "cache";
        const wrote = await cacheReviewPresentation({ owner, response });
        if (!wrote) recordReviewPresentationRead(owner, "backlog", "cache");
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
        commitData(nextBootstrap);
        commitReviewBacklog(nextBacklog);
        startEvidencePrefetch(nextBootstrap);
        setReviewAvailabilityMessage(null);
        recordReviewPresentationRead(owner, "backlog", "success");
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== screenOwnerGeneration.current) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      recordReviewPresentationRead(owner, "backlog",
        error instanceof ReviewPresentationSnapshotChangedError ? "snapshot_changed"
          : error instanceof ReviewPresentationValidationError ? "validation"
            : readPhase === "cache" ? "cache"
              : isMobileTransportFailure(error) ? "offline" : "server");
      if (error instanceof ReviewPresentationSnapshotChangedError) {
        restart = (options.restartAttempt ?? 0) < 1;
        if (!restart) {
          setReviewAvailabilityMessage(
            "Review changed while more items were loading. Pull to refresh the list."
          );
        }
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

  type DeckSource =
    | { key: string; kind: "review"; item: MobileReviewItem }
    | { key: string; kind: "legacy_entry"; entry: MobileTimeEntry };
  const deckSources = useMemo(() => {
    const sources: DeckSource[] = [
      ...openReviewItems.map((item) => ({ key: reviewFocusKey("review", item.id), kind: "review" as const, item })),
      ...displayedReviewNeededEntries.map((entry) => ({
        key: reviewFocusKey("legacy_entry", entry.id),
        kind: "legacy_entry" as const,
        entry
      }))
    ];
    const deferred = new Set(deferredDeckKeys);
    const ordered = [
      ...sources.filter((source) => !deferred.has(source.key)),
      ...deferredDeckKeys.flatMap((key) => sources.filter((source) => source.key === key))
    ];
    return orderReviewDeck(ordered, highlightedFocusKey);
  }, [deferredDeckKeys, displayedReviewNeededEntries, highlightedFocusKey, openReviewItems]);
  const deckCards = useMemo(
    () => deckSources.slice(0, 3).map((source): ReviewDeckCardModel => (
      source.kind === "review"
        ? reviewDeckCardForItem(source.key, source.item, {
            menuOpen: reviewMenuState.openItemId === source.item.id,
            mode: theme.mode,
            neutral: theme.textSecondary,
            now,
            overlapCount: overlapCounts.get(source.item.id) ?? 0,
            syncState: reviewItemSyncStates.get(source.item.id) ?? null
          })
        : reviewDeckCardForEntry(source.key, source.entry, { mode: theme.mode, neutral: theme.textSecondary, now })
    )),
    [deckSources, now, overlapCounts, reviewItemSyncStates, reviewMenuState.openItemId, theme.mode, theme.textSecondary]
  );
  const topDeckSource = deckSources[0] ?? null;
  const deckPosition = reviewDeckPosition({
    decided: deckVisit.decided,
    remaining: reviewCountIsExact ? Math.max(totalNeedsReview, deckSources.length) : deckSources.length,
    exact: reviewCountIsExact
  });
  const deckFinished = deckSources.length === 0 && (showEmptyReviewState || (deckVisit.decided > 0 && !reviewBacklog?.nextCursor));

  function recordDeckDecision(logged: { color: string; seconds: number } | null) {
    setDeckVisit((current) => ({
      decided: current.decided + 1,
      logged: logged ? [...current.logged, logged] : current.logged
    }));
  }

  function deckLoggedBlock(item: MobileReviewItem) {
    const name = reviewItemCategoryName(item);
    return {
      color: reviewItemCategoryColor(item, name, theme.textSecondary, theme.mode),
      seconds: reviewItemDurationSeconds(item, Date.now())
    };
  }

  const loadMoreReviewBacklog = useCallback(() => {
    const cursor = reviewBacklogRef.current?.nextCursor;
    if (!cursor) return;
    void loadReviewBacklogPage({ cursor, reset: false });
  }, [loadReviewBacklogPage]);

  // The next backlog page is read while cards remain on the stack, once per cursor; a failed read
  // is not retried automatically (the empty deck offers "Load more Review items" instead).
  const autoLoadedCursor = useRef<string | null>(null);
  const deckNextCursor = deckSources.length < 3 ? reviewBacklog?.nextCursor ?? null : null;
  useEffect(() => {
    if (!deckNextCursor || reviewBacklogLoading || autoLoadedCursor.current === deckNextCursor) return;
    autoLoadedCursor.current = deckNextCursor;
    loadMoreReviewBacklog();
  }, [deckNextCursor, loadMoreReviewBacklog, reviewBacklogLoading]);

  // The exact item a Today ribbon tap asked for leads the deck (orderReviewDeck).
  const beginExactFocus = useCallback((key: string) => {
    if (focusConsumedKey.current === key) return;
    focusConsumedKey.current = key;
    setHighlightedFocusKey(key);
    AccessibilityInfo.announceForAccessibility("Opened the exact Review item.");
  }, []);

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
      "Logged. Saved on this iPhone. Waiting to sync.",
      () => recordDeckDecision(deckLoggedBlock(item))
    );
  }

  function dismissItem(item: MobileReviewItem) {
    resolveItem(
      item,
      hasV2LocationEvidence(item)
        ? { action: "ignore_once_location" }
        : { action: "ignore_once" },
      "Skipped. Saved on this iPhone. Waiting to sync.",
      () => recordDeckDecision(null)
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
    successAnnouncement: string,
    onCommitted?: () => void
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
        onCommitted?.();
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

  function beginDeckEdit(item: MobileReviewItem) {
    if (reviewMutations.current.has(item.id) || reviewItemSyncStates.has(item.id)) return;
    applyReviewMenuEvent({ type: "close" });
    reviewMenuActionSequence.current += 1;
    beginReviewItemEdit(item, reviewMenuActionSequence.current);
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
        recordDeckDecision({
          color: reviewItemCategoryColor(
            editTarget.item,
            reviewItemCategoryName(editTarget.item),
            theme.textSecondary,
            theme.mode
          ),
          seconds: Math.max(0, (Date.parse(patch.stoppedAt) - Date.parse(patch.startedAt)) / 1000)
        });
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
      <View style={styles.reviewDeckNav}>
        <Pressable
          accessibilityLabel="Back to Today"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={pressable(styles.reviewDeckBack, styles.buttonPressed)}
          testID="review-deck-back"
        >
          <Svg accessibilityElementsHidden height={22} viewBox="0 0 24 24" width={22}>
            <Path d="M15 5 8 12l7 7" fill="none" stroke={theme.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
          </Svg>
          <Text {...mobileTextProps("control")} style={[styles.reviewDeckBackText, { color: theme.accentText }]}>Today</Text>
        </Pressable>
        <Text {...mobileTextProps("control")} accessibilityRole="header" style={styles.reviewDeckNavTitle}>Review</Text>
        <Text
          {...mobileTextProps("numeric")}
          accessibilityLabel={deckPosition?.accessibilityLabel ?? reviewCountCopy}
          style={styles.reviewDeckNavCount}
          testID="review-deck-count"
        >
          {deckFinished ? "" : deckPosition?.text ?? ""}
        </Text>
      </View>
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.reviewDeckContent}
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
        style={styles.settingsScrollView}
      >
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

        {deckFinished ? (
          <ReviewDeckFinished
            blocks={deckVisit.logged.map((block) => block.color)}
            copy={deckFinishedCopy(deckVisit.logged)}
            onBack={() => router.back()}
            theme={theme}
          />
        ) : topDeckSource ? (
          <>
            <ReviewDeckStack
              cards={deckCards}
              onEdit={(key) => {
                const source = deckSources.find((candidate) => candidate.key === key);
                if (!source) return;
                if (source.kind === "legacy_entry") beginReviewNeededEntryEdit(source.entry);
                else beginDeckEdit(source.item);
              }}
              onMore={(key) => {
                const source = deckSources.find((candidate) => candidate.key === key);
                if (source?.kind === "review") toggleReviewMenu(source.item);
              }}
              reduceMotion={reduceMotion}
              theme={theme}
            />
            <ReviewDeckActions
              disabled={deckCards[0]?.controlsDisabled ?? true}
              logLabel={topDeckSource.kind === "legacy_entry" ? "Edit to log" : "Log it"}
              onEdit={() => {
                if (topDeckSource.kind === "legacy_entry") {
                  beginReviewNeededEntryEdit(topDeckSource.entry);
                } else if (hasV2LocationEvidence(topDeckSource.item)) {
                  // D7: Edit before logging opens the Location evidence editor.
                  applyReviewMenuEvent({ type: "close" });
                  router.push({ pathname: "/review/[id]", params: { id: topDeckSource.item.id } } as never);
                } else {
                  beginDeckEdit(topDeckSource.item);
                }
              }}
              onLog={() => {
                if (topDeckSource.kind === "legacy_entry") beginReviewNeededEntryEdit(topDeckSource.entry);
                else confirmItem(topDeckSource.item);
              }}
              onSkip={() => {
                if (topDeckSource.kind === "legacy_entry") {
                  const key = topDeckSource.key;
                  setDeferredDeckKeys((current) => [...current.filter((candidate) => candidate !== key), key]);
                  if (highlightedFocusKey === key) setHighlightedFocusKey(null);
                } else {
                  dismissItem(topDeckSource.item);
                }
              }}
              skipLabel={topDeckSource.kind === "legacy_entry" ? "Skip for now" : "Skip"}
              theme={theme}
            />
          </>
        ) : (
          <View style={styles.reviewDeckWaiting}>
            <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={styles.muted}>
              {reviewBacklogLoading || !reviewCountIsExact ? "Looking for moments to review…" : REVIEW_COPY.emptyState}
            </Text>
            {reviewBacklog?.nextCursor && !reviewBacklogLoading ? (
              <Pressable
                accessibilityLabel={`Load more Review items. ${backlogProgressCopy ?? ""}`.trim()}
                accessibilityRole="button"
                onPress={loadMoreReviewBacklog}
                style={pressable(styles.secondaryButton, styles.buttonPressed)}
              >
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Load more Review items</Text>
              </Pressable>
            ) : null}
          </View>
        )}
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

function deckFinishedCopy(logged: readonly { seconds: number }[]) {
  if (!logged.length) return "Nothing to review right now.";
  const seconds = logged.reduce((total, block) => total + block.seconds, 0);
  const moments = `${logged.length} ${logged.length === 1 ? "moment" : "moments"} logged`;
  return seconds >= 60 ? `${moments}, ${formatReviewDeckDuration(seconds)} added to your days.` : `${moments}.`;
}

export function reviewDeckCardForItem(
  key: string,
  item: MobileReviewItem,
  context: {
    menuOpen: boolean;
    mode: ReturnType<typeof useMobileTheme>["theme"]["mode"];
    neutral: string;
    now: number;
    overlapCount: number;
    syncState: ReviewItemSyncState | null;
  }
): ReviewDeckCardModel {
  const activityName = reviewItemCategoryName(item);
  const color = reviewItemCategoryColor(item, activityName, context.neutral, context.mode);
  const kind = {
    eventSource: item.eventSource,
    eventType: item.eventType,
    isLocation: isLocationReviewItem(item),
    isTimeAway: isTimeAwayReviewItem(item)
  };
  const confidence = reviewConfidencePresentation(item.confidence);
  const locationReason = locationReviewReasonCopy(item, context.overlapCount);
  const overlap = context.overlapCount && !locationReason
    ? `Overlaps ${context.overlapCount} other ${context.overlapCount === 1 ? "entry" : "entries"} · You can still confirm.`
    : null;
  const syncCopy = reviewItemSyncStatusCopy(context.syncState);
  const title = reviewItemTitle(item);
  const travelMode = item.eventType === "commute_detected" ? travelModeLabel(item.rawPayload?.travelMode) : null;
  return {
    key,
    picture: reviewDeckPicture(kind),
    color,
    onColor: onBlockTextColor(item.categoryColor ?? item.suggestedCategoryId ?? color, context.mode, activityName),
    source: reviewDeckSource(kind),
    confidence: { score: confidence.score, label: confidence.label },
    title,
    when: [
      formatReviewDeckWhen(item.suggestedStartedAt, item.suggestedStoppedAt, reviewItemDurationSeconds(item, context.now), context.now),
      travelMode
    ].filter(Boolean).join(" · ") || null,
    logAsName: item.title?.trim() || title,
    activityName,
    reason: [locationReason ?? reviewItemSummary(item), overlap].filter(Boolean).join(" ") || null,
    syncBadge: syncCopy?.badge ?? null,
    syncDetail: syncCopy?.detail ?? null,
    controlsDisabled: context.syncState != null,
    moreLabel: `More actions for ${title}`,
    menuOpen: context.menuOpen
  };
}

function reviewDeckCardForEntry(
  key: string,
  entry: MobileTimeEntry,
  context: { mode: ReturnType<typeof useMobileTheme>["theme"]["mode"]; neutral: string; now: number }
): ReviewDeckCardModel {
  const health = isHealthSource(entry.source);
  const activityName = entry.categoryName ?? (health ? "Health" : "No activity");
  // No activity stays neutral rather than taking a hashed palette colour.
  const neutral = !entry.categoryId && !entry.categoryName && !health;
  const colorKey = entry.categoryColor ?? (health ? "moss" : entry.categoryId);
  const kind = {
    eventSource: entry.source,
    eventType: null,
    isLocation: Boolean(entry.placeName) || entry.source?.startsWith("location") === true,
    isTimeAway: false
  };
  return {
    key,
    picture: reviewDeckPicture(kind),
    color: neutral ? context.neutral : paletteColorFor(colorKey, activityName, context.mode),
    onColor: neutral ? onBlockTextColor("slate", context.mode) : onBlockTextColor(colorKey, context.mode, activityName),
    source: reviewDeckSource(kind),
    confidence: null,
    title: displayEntryTitle(entry),
    when: formatReviewDeckWhen(entry.startedAt, entry.stoppedAt, entryDurationSeconds(entry, context.now), context.now),
    logAsName: displayEntryTitle(entry),
    activityName,
    reason: "Already on your timeline. Edit it to confirm the details.",
    syncBadge: null,
    syncDetail: null,
    controlsDisabled: false,
    moreLabel: null,
    menuOpen: false
  };
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
  if (isTimeAwayReviewItem(item)) return item.title || "Time away";
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

function reviewItemSummary(item: MobileReviewItem) {
  if (isTimeAwayReviewItem(item)) {
    return typeof item.rawPayload?.stopCount === "number" && item.rawPayload.stopCount > 0
      ? "You were away from this place, with an unnamed stop nearby."
      : "You were away from this place.";
  }
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
    (item.eventType === "commute_detected" && !isTimeAwayReviewItem(item))
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

function displayEntryTitle(entry: MobileTimeEntry) {
  return entry.description?.trim() || entry.categoryName || REVIEW_COPY.suggestedActivity;
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

