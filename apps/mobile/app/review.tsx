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
  DAYFRAME_BLOCKS,
  contrastRatio,
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
  type ReviewDeckCardModel,
  type ReviewDeckDirection,
  type ReviewDeckReturn,
  type ReviewDeckThrowRequest
} from "@/components/review/ReviewDeck";
import {
  createReviewDeckHold,
  reviewDeckHeldKeys,
  reviewDeckProposalSignature,
  type ReviewDeckHeld,
  type ReviewDeckHeldBatch,
  type ReviewDeckHeldDecision
} from "@/lib/reviewDeckHold";
import {
  reviewBulkSkipCandidates,
  reviewBulkSkipConfirmation,
  reviewBulkSkipToast,
  type ReviewBulkSkipScope
} from "@/lib/reviewBulkSkip";
import { ActivityPickerSheet } from "@/components/ActivityPickerSheet";
import { recentActivityIds } from "@/lib/activityChoice";
import { activeLogAsCategoryId, reviewLogAsEdit, reviewLogAsEditorName } from "@/lib/reviewLogAs";
import { playHaptic } from "@/lib/haptics";
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
import { localPresenceEntering, localPresenceExiting, useResolvedReduceMotionPreference } from "@/lib/motion";
import {
  formatReviewDeckDuration,
  formatReviewDeckWhen,
  orderReviewDeck,
  reviewDeckPicture,
  reviewDeckPosition,
  reviewDeckSource
} from "@/lib/reviewDeck";
import { beginReviewDeckVisit, takeReviewDeckEvidenceDecisions } from "@/lib/reviewDeckDecisions";
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
  /** Settles when this read ends, whatever its outcome (a bulk skip waits for it). */
  done: Promise<void>;
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
  // A deferred card was thrown off screen; it comes back as a fresh card at the back of the deck.
  const deferGenerations = useRef(new Map<string, number>());
  // Blocks parity step 5b: a thrown card is held for Undo before its decision is saved.
  const [heldDeckDecision, setHeldDeckDecision] = useState<ReviewDeckHeld | null>(null);
  // A single thrown card (most of the deck's flight and Undo logic is about this one).
  const heldDeckCard = heldDeckDecision?.kind === "single" ? heldDeckDecision : null;
  // Step 5f: a bulk skip is being counted (older backlog pages load before the confirmation).
  const [bulkSkipCounting, setBulkSkipCounting] = useState(false);
  const bulkSkipInFlight = useRef(false);
  // A bulk skip reads these after awaiting older pages and the confirmation, so never stale.
  const bulkSkipStateRef = useRef<{ committing: ReadonlySet<string>; syncStates: ReadonlyMap<string, unknown> }>({
    committing: new Set(),
    syncStates: new Map()
  });
  const [deckThrowRequest, setDeckThrowRequest] = useState<ReviewDeckThrowRequest | null>(null);
  const [deckReturn, setDeckReturn] = useState<ReviewDeckReturn | null>(null);
  // The held card stays on screen while it flies out; the cards beneath land when it has gone.
  const [flyingDeckKey, setFlyingDeckKey] = useState<string | null>(null);
  // Whether that flight only moves the card behind the rest (no decision is held for it).
  const flyingDeckDefers = useRef(false);
  // A saved decision stays out of the deck until its SQLite projection drops the card.
  const [committingDeckKeys, setCommittingDeckKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Cards this visit decided itself: "All framed" celebrates only when they emptied the deck.
  const ownDeckDecisionKeys = useRef(new Set<string>());
  const lastDeckKeys = useRef<readonly string[]>([]);
  const deckWasFinished = useRef(false);
  const celebrateDeckFinish = useRef(false);
  const deckTokenSequence = useRef(0);
  // Live "Log as" (step 5c-1): names typed on a card live in a ref (the field is uncontrolled);
  // activities picked on the chip are state so the card recolours. Both are read when a held
  // decision is saved, so a change made during the flight still counts.
  const [logAsDrafts, setLogAsDrafts] = useState<ReadonlyMap<string, ReviewLogAsDraft>>(new Map());
  const logAsDraftsRef = useRef(logAsDrafts);
  logAsDraftsRef.current = logAsDrafts;
  const logAsNames = useRef(new Map<string, string>());
  const [logAsPickerItemId, setLogAsPickerItemId] = useState<string | null>(null);
  const commitHeldDeckDecisionRef = useRef<(held: ReviewDeckHeld) => void>(() => undefined);
  const deckHold = useRef(createReviewDeckHold({
    onChange: setHeldDeckDecision,
    onCommit: (held) => commitHeldDeckDecisionRef.current(held)
  })).current;
  const deckTopKeyRef = useRef<string | null>(null);
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
  const recentLogAsActivityIds = useMemo(() => recentActivityIds(peerEntries), [peerEntries]);
  connectivityRef.current = { isOffline, isOnline, reconnectEpoch };
  bulkSkipStateRef.current = { committing: committingDeckKeys, syncStates: reviewItemSyncStates };

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
    let settleRead: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      settleRead = resolve;
    });
    reviewBacklogRead.current = { controller, generation, done };
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
      settleRead();
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
  useEffect(() => {
    // The picked-for moment left (decided elsewhere, refreshed away): close its picker.
    if (logAsPickerItemId && !openReviewItems.some((item) => item.id === logAsPickerItemId)) setLogAsPickerItemId(null);
  }, [logAsPickerItemId, openReviewItems]);
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
    // A held card stays while it flies out; a held bulk skip hides every card it covers.
    const heldKeys = new Set(reviewDeckHeldKeys(heldDeckDecision).filter((key) => (
      heldDeckDecision?.kind === "batch" || key !== flyingDeckKey
    )));
    const hidden = (key: string) => heldKeys.has(key) || committingDeckKeys.has(key);
    const ordered = [
      ...sources.filter((source) => !deferred.has(source.key) && !hidden(source.key)),
      ...deferredDeckKeys.flatMap((key) => sources.filter((source) => source.key === key && !hidden(key)))
    ];
    // The card on top stays on top while it is open: a backlog page or refresh arriving with a
    // different order never swaps the card being read. A ribbon focus or a deferral still wins.
    const stickyKey = deferred.has(deckTopKeyRef.current ?? "") ? null : deckTopKeyRef.current;
    // The ribbon's focus leads only while that card is still open; afterwards the sticky top holds.
    const focusKey = highlightedFocusKey && ordered.some((source) => source.key === highlightedFocusKey)
      ? highlightedFocusKey
      : null;
    // A card brought back by Undo returns to the top.
    const returnKey = deckReturn && ordered.some((source) => source.key === deckReturn.key) ? deckReturn.key : null;
    // Undo wins over a ribbon focus: the card the user brought back is the one they want.
    return orderReviewDeck(ordered, returnKey ?? focusKey ?? stickyKey);
  }, [committingDeckKeys, deckReturn, deferredDeckKeys, displayedReviewNeededEntries, flyingDeckKey, heldDeckDecision, highlightedFocusKey, openReviewItems]);
  useEffect(() => {
    deckTopKeyRef.current = deckSources[0]?.key ?? null;
  }, [deckSources]);
  // An Undo return is spent once its card leaves the deck, so a card a refresh briefly drops and
  // brings back never replays the flight in.
  useEffect(() => {
    if (deckReturn && !deckSources.some((source) => source.key === deckReturn.key)) setDeckReturn(null);
    // A deferral flight whose card a refresh dropped mid-flight never reports its end: retire it
    // here and still move the card behind the rest, so it never comes back locked. (A held flight
    // is retired by its save outcome instead.)
    // Any flight whose card left the deck mid-flight is retired (it will never report its end): a
    // deferral still moves the card behind the rest; a held card stays hidden behind its toast.
    if (flyingDeckKey && !deckSources.some((source) => source.key === flyingDeckKey)) {
      if (flyingDeckDefers.current && heldDeckCard?.key !== flyingDeckKey) deferDeckCard(flyingDeckKey);
      setFlyingDeckKey(null);
    }
    // deferDeckCard only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckReturn, deckSources, flyingDeckKey, heldDeckCard]);
  const deckCards = useMemo(
    // One more than the visible stack: while the top card flies out, the card behind moves in.
    () => deckSources.slice(0, 4).map((source): ReviewDeckCardModel => (
      source.kind === "review"
        ? reviewDeckCardForItem(source.key, source.item, {
            categories: data?.categories,
            draft: {
              categoryId: logAsDrafts.get(source.item.id)?.categoryId,
              description: logAsNames.current.get(source.item.id)
            },
            menuOpen: reviewMenuState.openItemId === source.item.id,
            mode: theme.mode,
            neutral: theme.textSecondary,
            now,
            overlapCount: overlapCounts.get(source.item.id) ?? 0,
            syncState: reviewItemSyncStates.get(source.item.id) ?? null
          })
        : reviewDeckCardForEntry(source.key, source.entry, { mode: theme.mode, neutral: theme.textSecondary, now })
    )).map((card) => ({
      ...card,
      // Deferring the only card would change nothing.
      canSkip: card.canSkip && !(card.skipDefers && deckSources.length <= 1),
      // The card flying out cannot be edited or opened.
      controlsDisabled: card.controlsDisabled || card.key === flyingDeckKey,
      renderKey: `${card.key}#${deferGenerations.current.get(card.key) ?? 0}`
    })),
    // deferredDeckKeys changes whenever a defer generation does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.categories, deckSources, deferredDeckKeys, flyingDeckKey, logAsDrafts, now, overlapCounts, reviewItemSyncStates, reviewMenuState.openItemId, theme.mode, theme.textSecondary]
  );
  const topDeckSource = deckSources[0] ?? null;
  // The top card is the held card still flying out: the round actions wait for the next card.
  const deckFlying = flyingDeckKey !== null && topDeckSource?.key === flyingDeckKey;
  // The flying held card is already decided, so "N of M" does not count it (a deferred card
  // flying to the back still does).
  const heldInFlight = deckFlying && heldDeckCard?.key === flyingDeckKey;
  const deckRemaining = heldInFlight ? deckSources.length - 1 : deckSources.length;
  // The server count still includes decisions held for Undo or saving on this iPhone.
  // Every open item is loaded: the deck itself is the count, so a decision still syncing never
  // turns "2 of 5" into "2 of 5+". Otherwise the server count is used when it is exact.
  const deckBacklogComplete = reviewBacklog !== null && !reviewBacklog.nextCursor && reviewBacklog.recordsComplete;
  const locallyDecidedCount = reviewDeckHeldKeys(heldDeckDecision).length + committingDeckKeys.size;
  const deckPosition = reviewDeckPosition({
    decided: deckVisit.decided,
    remaining: deckBacklogComplete
      ? deckRemaining
      : reviewCountIsExact ? Math.max(totalNeedsReview - locallyDecidedCount, deckRemaining) : deckRemaining,
    exact: deckBacklogComplete || reviewCountIsExact
  });
  // "All framed" only once a verified read says nothing else is open; a cached-only deck (offline,
  // no backlog read yet) never claims completeness.
  // A reload after the last decision keeps the previous complete read until it is replaced, so
  // "All framed" does not blink back to the waiting copy.
  const deckFinished = deckSources.length === 0 && deckBacklogComplete;
  // Decided while rendering so the finished screen mounts knowing whether to celebrate: only when
  // the cards last on screen were all this visit's own decisions (a refresh emptying it is quiet).
  if (deckFinished && !deckWasFinished.current) {
    celebrateDeckFinish.current = lastDeckKeys.current.length > 0 &&
      lastDeckKeys.current.every((key) => ownDeckDecisionKeys.current.has(key));
  }
  deckWasFinished.current = deckFinished;
  if (deckSources.length) lastDeckKeys.current = deckSources.map((source) => source.key);
  const deckWaitingCopy = reviewBacklogLoading || refreshing || data === null
    ? "Looking for moments to review…"
    : reviewBacklog === null
      ? "Nothing else is saved on this iPhone. Pull to refresh when you're online."
      : "More moments may be waiting. Pull to refresh.";
  const topDeckControlsDisabled = deckFlying ? false : (deckCards[0]?.controlsDisabled ?? true);
  // A legacy entry has no skip mutation, and a card with a waiting or rejected change cannot be
  // decided here: Skip moves either behind the rest for this visit, so it never blocks the deck.
  const topDeckSkipDefers = topDeckSource?.kind === "legacy_entry" || topDeckControlsDisabled || (deckCards[0]?.skipDefers ?? false);

  // Decisions made in Location evidence (Edit before logging, D7) count toward this visit.
  const knownDeckItems = useRef(new Map<string, MobileReviewItem>());
  useEffect(() => {
    for (const item of openReviewItems) knownDeckItems.current.set(item.id, item);
  }, [openReviewItems]);
  useEffect(() => beginReviewDeckVisit(), []);
  useFocusEffect(
    useCallback(() => {
      for (const decision of takeReviewDeckEvidenceDecisions()) {
        const item = knownDeckItems.current.get(decision.itemId);
        ownDeckDecisionKeys.current.add(reviewFocusKey("review", decision.itemId));
        recordDeckDecision(decision.logged ? (item ? deckLoggedBlock(item) : { color: theme.textSecondary, seconds: 0 }) : null);
      }
      // recordDeckDecision and deckLoggedBlock only read theme values and state setters.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme.mode, theme.textSecondary])
  );

  function unrecordDeckDecision(logged: { color: string; seconds: number } | null) {
    setDeckVisit((current) => {
      let index = -1;
      if (logged) {
        for (let candidate = current.logged.length - 1; candidate >= 0; candidate -= 1) {
          const block = current.logged[candidate];
          if (block.color === logged.color && block.seconds === logged.seconds) {
            index = candidate;
            break;
          }
        }
      }
      return {
        decided: Math.max(0, current.decided - 1),
        logged: index >= 0 ? [...current.logged.slice(0, index), ...current.logged.slice(index + 1)] : current.logged
      };
    });
  }

  function deferDeckCard(key: string) {
    deferGenerations.current.set(key, (deferGenerations.current.get(key) ?? 0) + 1);
    setDeferredDeckKeys((current) => [...current.filter((candidate) => candidate !== key), key]);
    if (highlightedFocusKey === key) setHighlightedFocusKey(null);
  }

  // A card left the deck by a swipe or a Log it / Skip press (after its fling).
  // The card has left the screen: the next card may land; a deferral moves the card to the back.
  function handleDeckThrowEnd(key: string, direction: ReviewDeckDirection) {
    setFlyingDeckKey((current) => (current === key ? null : current));
    const source = deckSources.find((candidate) => candidate.key === key);
    const card = deckCards.find((candidate) => candidate.key === key);
    if (source && (source.kind === "legacy_entry" || card?.skipDefers) && direction === -1) deferDeckCard(key);
  }

  // A card was thrown (swipe or Log it / Skip): its decision is taken now, before the flight ends,
  // so leaving Review mid-flight still saves it.
  function handleDeckThrow(key: string, direction: ReviewDeckDirection) {
    setDeckThrowRequest(null);
    setDeckReturn(null);
    const source = deckSources.find((candidate) => candidate.key === key);
    if (!source) return;
    const card = deckCards.find((candidate) => candidate.key === key);
    // The outgoing card's controls stay locked for the whole flight, deferral or decision.
    setFlyingDeckKey(key);
    flyingDeckDefers.current = source.kind === "legacy_entry" || Boolean(card?.skipDefers);
    if (source.kind === "legacy_entry" || card?.skipDefers) {
      // Moving a card behind the rest is another card decided: a held one is saved now.
      deckHold.flush();
      if (card?.title) AccessibilityInfo.announceForAccessibility(`${card.title} moved behind the rest.`);
      return;
    }
    ownDeckDecisionKeys.current.add(key);
    const item = source.item;
    const logged = direction === 1;
    const block = deckLoggedBlock(item);
    deckTokenSequence.current += 1;
    recordDeckDecision(logged ? { ...block, color: card?.color ?? block.color } : null);
    deckHold.hold({
      kind: "single",
      token: deckTokenSequence.current,
      key,
      itemId: item.id,
      logged,
      direction,
      title: card?.title ?? reviewItemTitle(item),
      // The colour the card showed (a live "Log as" activity included).
      color: card?.color ?? block.color,
      seconds: block.seconds,
      proposal: reviewDeckProposalSignature(item)
    });
    // A throw reported after Review lost focus or the app went to the background is saved at
    // once: the lifecycle flush has already run.
    if (!deckScreenActive.current) deckHold.flush();
    playHaptic(logged ? "reviewLog" : "reviewSkip");
    AccessibilityInfo.announceForAccessibility(
      `${logged ? "Logged" : "Skipped"} ${card?.title ?? reviewItemTitle(item)}. Undo is available for a few seconds.`
    );
  }

  function requestDeckThrow(direction: ReviewDeckDirection) {
    const key = deckSources[0]?.key;
    if (!key) return;
    deckTokenSequence.current += 1;
    setDeckThrowRequest({ key, direction, token: deckTokenSequence.current });
  }

  function undoHeldDeckDecision() {
    const current = heldDeckDecision;
    if (!current) return;
    const held = deckHold.undo(current.token);
    if (!held) return;
    if (held.kind === "batch") {
      undoHeldBulkSkip(held);
      return;
    }
    unrecordDeckDecision(held.logged ? { color: held.color, seconds: held.seconds } : null);
    ownDeckDecisionKeys.current.delete(held.key);
    setDeckThrowRequest(null);
    if (flyingDeckKey === held.key) {
      // Undone mid-flight: the card comes back as a fresh card instead of finishing its flight.
      deferGenerations.current.set(held.key, (deferGenerations.current.get(held.key) ?? 0) + 1);
      setFlyingDeckKey(null);
    }
    restorePagedOutDeckItem(held.itemId);
    setDeckReturn({ key: held.key, direction: held.direction, token: held.token });
    playHaptic("undoRestore");
    AccessibilityInfo.announceForAccessibility(`${held.title} is back.`);
  }

  // A card brought back (Undo, a failed save) after a capped refresh paged its item out returns to
  // the loaded data from the copy the deck showed, so the deck, More, Edit and saving all see it
  // again. The next read replaces it like any other loaded item.
  function restorePagedOutDeckItem(itemId: string) {
    const loaded = dataRef.current;
    const known = knownDeckItems.current.get(itemId);
    if (!loaded || !known || !isOpenReviewItem(known)) return;
    if (loaded.reviewItems.some((item) => item.id === itemId)) return;
    commitData({ ...loaded, reviewItems: [...loaded.reviewItems, known] });
  }

  function setDeckKeyCommitting(key: string, committing: boolean) {
    setCommittingDeckKeys((current) => {
      if (current.has(key) === committing) return current;
      const next = new Set(current);
      if (committing) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function setDeckKeysCommitting(keys: readonly string[], committing: boolean) {
    if (!keys.length) return;
    setCommittingDeckKeys((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (committing) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  // Step 5f: "Review all" in the card's More menu. Older backlog pages are read first so the count
  // covers every open moment; then one confirmation, and the batch is held for one Undo.
  async function startBulkSkip(scope: ReviewBulkSkipScope) {
    if (bulkSkipInFlight.current) return;
    bulkSkipInFlight.current = true;
    // Like any other decision, a bulk skip saves a held card first.
    deckHold.flush();
    const generation = screenOwnerGeneration.current;
    const stillHere = () => generation === screenOwnerGeneration.current && screenFocusedRef.current;
    try {
      if (reviewBacklogRef.current?.nextCursor || reviewBacklogRead.current) {
        setBulkSkipCounting(true);
        AccessibilityInfo.announceForAccessibility("Counting moments to skip.");
        // Bounded: at most 50 more pages of 100, and a page that does not advance stops it.
        for (let page = 0; page < 50 && stillHere(); page += 1) {
          const inFlight = reviewBacklogRead.current;
          if (inFlight) {
            await inFlight.done;
            continue;
          }
          const cursor = reviewBacklogRef.current?.nextCursor;
          if (!cursor) break;
          await loadReviewBacklogPage({ cursor, reset: false });
          if (reviewBacklogRef.current?.nextCursor === cursor) break;
        }
      }
    } finally {
      setBulkSkipCounting(false);
    }
    if (!stillHere()) {
      bulkSkipInFlight.current = false;
      return;
    }
    const backlog = reviewBacklogRef.current;
    const complete = Boolean(backlog && !backlog.nextCursor && backlog.recordsComplete);
    const candidates = bulkSkipCandidates(scope);
    const confirmation = reviewBulkSkipConfirmation(candidates.length, scope, complete);
    if (!confirmation.confirmLabel) {
      bulkSkipInFlight.current = false;
      Alert.alert(confirmation.title, confirmation.message);
      return;
    }
    const chosen = new Set(candidates.map((item) => item.id));
    Alert.alert(confirmation.title, confirmation.message, [
      { style: "cancel", text: "Cancel", onPress: () => { bulkSkipInFlight.current = false; } },
      {
        style: "destructive",
        text: confirmation.confirmLabel,
        onPress: () => {
          bulkSkipInFlight.current = false;
          if (!stillHere()) return;
          // Only what the user confirmed, and only what can still be skipped now.
          holdBulkSkip(bulkSkipCandidates(scope).filter((item) => chosen.has(item.id)));
        }
      }
    ], { cancelable: true, onDismiss: () => { bulkSkipInFlight.current = false; } });
  }

  function bulkSkipCandidates(scope: ReviewBulkSkipScope) {
    const held = new Set(reviewDeckHeldKeys(deckHold.current()));
    return reviewBulkSkipCandidates((dataRef.current?.reviewItems ?? []).filter(isOpenReviewItem), {
      now: Date.now(),
      scope,
      // The same rule as a single Skip: a card that would only move behind the rest is left alone.
      skippable: (item) => {
        const key = reviewFocusKey("review", item.id);
        return hasSuggestedTimeWindow(item) &&
          !reviewMutations.current.has(item.id) &&
          !bulkSkipStateRef.current.syncStates.has(item.id) &&
          !bulkSkipStateRef.current.committing.has(key) &&
          !held.has(key);
      }
    });
  }

  function holdBulkSkip(items: MobileReviewItem[]) {
    if (!items.length) return;
    // Another decision may have been held while the confirmation was up: it is saved first.
    deckHold.flush();
    applyReviewMenuEvent({ type: "close" });
    setDeckThrowRequest(null);
    setDeckReturn(null);
    setHighlightedFocusKey(null);
    for (const item of items) {
      knownDeckItems.current.set(item.id, item);
      ownDeckDecisionKeys.current.add(reviewFocusKey("review", item.id));
    }
    setDeckVisit((current) => ({ ...current, decided: current.decided + items.length }));
    deckTokenSequence.current += 1;
    deckHold.hold({
      kind: "batch",
      token: deckTokenSequence.current,
      items: items.map((item) => ({
        key: reviewFocusKey("review", item.id),
        itemId: item.id,
        proposal: reviewDeckProposalSignature(item)
      }))
    });
    if (!deckScreenActive.current) deckHold.flush();
    playHaptic("reviewSkip");
    AccessibilityInfo.announceForAccessibility(`${reviewBulkSkipToast(items.length)}. Undo is available for a few seconds.`);
  }

  function forgetBulkDecisions(keys: readonly string[]) {
    if (!keys.length) return;
    for (const key of keys) ownDeckDecisionKeys.current.delete(key);
    setDeckVisit((current) => ({ ...current, decided: Math.max(0, current.decided - keys.length) }));
  }

  function undoHeldBulkSkip(held: ReviewDeckHeldBatch) {
    forgetBulkDecisions(held.items.map((item) => item.key));
    for (const item of held.items) restorePagedOutDeckItem(item.itemId);
    playHaptic("undoRestore");
    AccessibilityInfo.announceForAccessibility(
      `${held.items.length} ${held.items.length === 1 ? "moment is" : "moments are"} back.`
    );
  }

  // The batch ends its hold: each item still open and unchanged is skipped once, one after the
  // other through the durable outbox, then the deck is projected and synced once.
  function commitHeldBulkSkip(held: ReviewDeckHeldBatch) {
    const toSave: { key: string; item: MobileReviewItem }[] = [];
    const resolvedElsewhere: string[] = [];
    const changed: string[] = [];
    for (const entry of held.items) {
      const listed = dataRef.current?.reviewItems.find((candidate) => candidate.id === entry.itemId);
      const known = knownDeckItems.current.get(entry.itemId);
      const item = listed
        ? (isOpenReviewItem(listed) ? listed : undefined)
        : known && isOpenReviewItem(known) ? known : undefined;
      if (!item) {
        resolvedElsewhere.push(entry.key);
      } else if (reviewDeckProposalSignature(item) !== entry.proposal || reviewMutations.current.has(item.id)) {
        // Changed by a refresh (or already saving): not what the user confirmed, so it stays.
        changed.push(entry.key);
        restorePagedOutDeckItem(item.id);
      } else {
        toSave.push({ key: entry.key, item });
      }
    }
    forgetBulkDecisions([...resolvedElsewhere, ...changed]);
    if (changed.length) {
      AccessibilityInfo.announceForAccessibility(
        `${changed.length} ${changed.length === 1 ? "moment" : "moments"} changed, so ${changed.length === 1 ? "it was" : "they were"} not skipped.`
      );
    }
    if (!toSave.length || !dataRef.current) {
      forgetBulkDecisions(toSave.map((entry) => entry.key));
      return;
    }
    setDeckKeysCommitting(toSave.map((entry) => entry.key), true);
    for (const { item } of toSave) reviewMutations.current.set(item.id, 1);
    void (async () => {
      const failed: { key: string; item: MobileReviewItem }[] = [];
      for (const entry of toSave) {
        const loaded = dataRef.current;
        try {
          if (!loaded) throw new Error("Review data is not loaded.");
          // An item a capped refresh paged out is saved from the copy the deck showed.
          const bootstrap = loaded.reviewItems.some((candidate) => candidate.id === entry.item.id)
            ? loaded
            : { ...loaded, reviewItems: [...loaded.reviewItems, entry.item] };
          await enqueueReviewMutation({
            bootstrap,
            item: entry.item,
            mutation: hasV2LocationEvidence(entry.item) ? { action: "ignore_once_location" } : { action: "ignore_once" },
            clientMutationId: createReviewClientMutationId()
          });
        } catch {
          failed.push(entry);
        }
      }
      const saved = toSave.length - failed.length;
      const projection = dataRef.current;
      if (saved && projection) {
        const ids = new Set(toSave.filter((entry) => !failed.includes(entry)).map((entry) => entry.item.id));
        commitData(await projectReviewBootstrapFromStore(projection).catch(() => projectReviewBootstrap(projection, ids)));
      }
      for (const { item } of toSave) reviewMutations.current.delete(item.id);
      setDeckKeysCommitting(toSave.map((entry) => entry.key), false);
      if (failed.length) {
        for (const entry of failed) {
          deferGenerations.current.set(entry.key, (deferGenerations.current.get(entry.key) ?? 0) + 1);
          restorePagedOutDeckItem(entry.item.id);
        }
        forgetBulkDecisions(failed.map((entry) => entry.key));
        AccessibilityInfo.announceForAccessibility("Some moments were not skipped. They are still in Review.");
        Alert.alert(
          "Review",
          `${failed.length} ${failed.length === 1 ? "moment wasn’t" : "moments weren’t"} skipped on this iPhone. ${failed.length === 1 ? "It is" : "They are"} still in Review.`
        );
      }
      if (saved) {
        AccessibilityInfo.announceForAccessibility(`${reviewBulkSkipToast(saved)}. Saved on this iPhone. Waiting to sync.`);
        void refreshReviewSyncDiagnostics();
        void synchroniseReviewMutations()
          .then(() => {
            void load({ preserveMenu: true, queueIfBusy: true, silent: true, skipReprocess: true });
          })
          .catch(() => {
            void refreshReviewSyncDiagnostics();
          });
      }
    })();
  }

  commitHeldDeckDecisionRef.current = (held) => {
    if (held.kind === "batch") {
      commitHeldBulkSkip(held);
      return;
    }
    const listedItem = dataRef.current?.reviewItems.find((candidate) => candidate.id === held.itemId);
    // Missing from the loaded list is not "resolved": a capped refresh may only have paged it out.
    const unlisted = !listedItem;
    const knownItem = knownDeckItems.current.get(held.itemId);
    const item = listedItem
      ? (isOpenReviewItem(listedItem) ? listedItem : undefined)
      : knownItem && isOpenReviewItem(knownItem) ? knownItem : undefined;
    const undoCount = () => {
      unrecordDeckDecision(held.logged ? { color: held.color, seconds: held.seconds } : null);
      ownDeckDecisionKeys.current.delete(held.key);
    };
    if (!item) {
      setFlyingDeckKey((current) => (current === held.key ? null : current));
      // Resolved elsewhere while held: this visit did not decide it.
      undoCount();
      return;
    }
    if (reviewDeckProposalSignature(item) !== held.proposal) {
      // A refresh changed the suggestion while the decision was held: the user decided about
      // something else, so nothing is saved and the card comes back as it is now.
      deferGenerations.current.set(held.key, (deferGenerations.current.get(held.key) ?? 0) + 1);
      setFlyingDeckKey((current) => (current === held.key ? null : current));
      restorePagedOutDeckItem(held.itemId);
      undoCount();
      AccessibilityInfo.announceForAccessibility(`${held.title} changed, so it was not saved. Review it again.`);
      return;
    }
    setDeckKeyCommitting(held.key, true);
    // A flight cut short (Review left or the app backgrounded mid-throw) never reports its end, so
    // the outcome retires it; otherwise a card restored by a failed save would stay locked.
    const settled = () => {
      setDeckKeyCommitting(held.key, false);
      setFlyingDeckKey((current) => (current === held.key ? null : current));
    };
    const failed = () => {
      // The restored card is a fresh card: the thrown one's animation state is spent.
      deferGenerations.current.set(held.key, (deferGenerations.current.get(held.key) ?? 0) + 1);
      setDeckKeyCommitting(held.key, false);
      setFlyingDeckKey((current) => (current === held.key ? null : current));
      // "The suggestion is still available": a paged-out card comes back to retry.
      restorePagedOutDeckItem(held.itemId);
      undoCount();
    };
    let started: boolean;
    const edit = held.logged
      ? reviewLogAsEdit({
          draftName: logAsNames.current.get(item.id),
          draftCategoryId: activeLogAsCategoryId(logAsDraftsRef.current.get(item.id)?.categoryId, dataRef.current?.categories),
          defaultName: item.title?.trim() || reviewItemTitle(item),
          suggestedCategoryId: item.suggestedCategoryId,
          isLocationV2: hasV2LocationEvidence(item),
          startedAt: hasSuggestedTimeWindow(item) ? item.suggestedStartedAt : null,
          stoppedAt: hasSuggestedTimeWindow(item) ? item.suggestedStoppedAt : null
        })
      : null;
    if (edit) {
      started = resolveItem(item, { action: "edit_and_confirm", edit }, "Logged. Saved on this iPhone. Waiting to sync.", settled, failed, { unlisted });
    } else if (held.logged) {
      started = resolveItem(item, hasV2LocationEvidence(item) ? { action: "confirm" } : { action: "accept" }, "Logged. Saved on this iPhone. Waiting to sync.", settled, failed, { unlisted });
    } else {
      started = resolveItem(item, hasV2LocationEvidence(item) ? { action: "ignore_once_location" } : { action: "ignore_once" }, "Skipped. Saved on this iPhone. Waiting to sync.", settled, failed, { unlisted });
    }
    // Not started (a change for this item is already saving, or the item has gone): the card is
    // not this visit's decision.
    if (!started) failed();
  };

  // A committing card whose item has left the open list and has no save still in flight no longer
  // needs hiding (a capped refresh can omit an item whose save is pending; it stays hidden).
  useEffect(() => {
    if (!committingDeckKeys.size) return;
    const open = new Set(openReviewItems.map((item) => reviewFocusKey("review", item.id)));
    const stale = [...committingDeckKeys].filter((key) => (
      !open.has(key) && !reviewMutations.current.has(key.slice(key.indexOf(":") + 1))
    ));
    if (!stale.length) return;
    setCommittingDeckKeys((current) => {
      const next = new Set(current);
      for (const key of stale) next.delete(key);
      return next;
    });
  }, [committingDeckKeys, openReviewItems]);

  // Leaving Review or backgrounding the app saves a held decision at once.
  // Active means Review is focused and the app is in the foreground; returning to the
  // foreground with another screen open does not reactivate it.
  const deckScreenActive = useRef(true);
  const deckScreenFocused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      deckScreenFocused.current = true;
      deckScreenActive.current = AppState.currentState === "active";
      return () => {
        deckScreenFocused.current = false;
        deckScreenActive.current = false;
        deckHold.flush();
      };
    }, [deckHold])
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      deckScreenActive.current = state === "active" && deckScreenFocused.current;
      if (state !== "active") deckHold.flush();
    });
    return () => {
      subscription.remove();
      deckHold.flush();
    };
  }, [deckHold]);

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

  function dismissItem(item: MobileReviewItem) {
    resolveItem(
      item,
      hasV2LocationEvidence(item)
        ? { action: "ignore_once_location" }
        : { action: "ignore_once" },
      "Skipped. Saved on this iPhone. Waiting to sync.",
      () => {
        ownDeckDecisionKeys.current.add(reviewFocusKey("review", item.id));
        recordDeckDecision(null);
      }
    );
  }

  function toggleReviewMenu(item: MobileReviewItem) {
    applyReviewMenuEvent({
      type: "toggle",
      itemId: item.id,
      disabled:
        reviewMutations.current.has(item.id) ||
        reviewItemSyncStates.has(item.id) ||
        !hasSuggestedTimeWindow(item)
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

    if (pendingAction.action === "skip_older" || pendingAction.action === "skip_all") {
      finishAction();
      void startBulkSkip(pendingAction.action === "skip_older" ? "older" : "all");
      return;
    }

    if (!beginReviewItemEdit(item, pendingAction.token)) finishAction();
  }

  function resolveItem(
    item: MobileReviewItem,
    mutation: ReviewMutation,
    successAnnouncement: string,
    onCommitted?: () => void,
    onFailed?: () => void,
    options: { unlisted?: boolean } = {}
  ) {
    if (reviewMutations.current.has(item.id)) return false;
    // Any other decision (More › Dismiss, an edit) saves a held card first, as a throw does.
    deckHold.flush();
    const loadedData = dataRef.current;
    if (!loadedData) return false;
    const listed = loadedData.reviewItems.some((candidate) => candidate.id === item.id);
    if (!listed && !options.unlisted) return false;
    // A held card whose item a capped refresh paged out (still open, just not in the first page)
    // is saved from the copy the deck showed.
    const currentData = listed ? loadedData : { ...loadedData, reviewItems: [...loadedData.reviewItems, item] };

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
        onFailed?.();
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
    return true;
  }

  function beginReviewItemEdit(item: MobileReviewItem, handoverToken: number) {
    const builtEntry = buildReviewItemDraftEntry(
      item,
      dataRef.current?.categories ?? [],
      Date.now()
    );
    // The details sheet starts from what the card's live "Log as" shows.
    const typedName = logAsNames.current.get(item.id)?.trim();
    const pickedCategoryId = logAsDraftsRef.current.get(item.id)?.categoryId;
    const pickedCategory = pickedCategoryId
      ? dataRef.current?.categories.find((category) => category.id === pickedCategoryId) ?? null
      : null;
    const draftEntry = builtEntry
      ? {
          ...builtEntry,
          description: reviewLogAsEditorName({
            typedName,
            builtDescription: builtEntry.description,
            defaultName: item.title?.trim() || reviewItemTitle(item),
            isLocationV2: hasV2LocationEvidence(item)
          }),
          ...(pickedCategory
            ? { categoryColor: pickedCategory.color, categoryId: pickedCategory.id, categoryName: pickedCategory.name }
            : {})
        }
      : null;
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
    // Saving any edit (a Review item or a legacy entry) saves a held card first.
    deckHold.flush();
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
        ownDeckDecisionKeys.current.add(reviewFocusKey("review", editTarget.item.id));
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

  // The Undo toast sits just above the round actions (or hangs under Back to Today once all is
  // framed, out of flow),
  // so it never covers the controls whatever the phone height or text size.
  function renderDeckToast(placement: "actions" | "under") {
    const held = heldDeckDecision;
    if (!held) return null;
    // A bulk skip (step 5f) has one neutral swatch and names the count.
    const label = held.kind === "batch"
      ? reviewBulkSkipToast(held.items.length)
      : `${held.logged ? "Logged" : "Skipped"} ${held.title}`;
    const undoLabel = held.kind === "batch"
      ? `Undo skipping ${held.items.length} ${held.items.length === 1 ? "moment" : "moments"}`
      : `Undo ${held.logged ? "logging" : "skipping"} ${held.title}`;
    return (
    <Reanimated.View
      key={held.token}
      accessibilityLiveRegion="polite"
      entering={localPresenceEntering(reduceMotion, "rise")}
      exiting={localPresenceExiting(reduceMotion)}
      style={[styles.historyDeleteUndoToast, styles.reviewDeckToast, placement === "under" ? styles.reviewDeckToastUnderButton : null]}
      testID="review-deck-toast"
    >
      <View style={styles.reviewDeckToastLabel}>
        <View style={[styles.reviewDeckToastSwatch, { backgroundColor: held.kind === "batch" ? theme.textSecondary : held.color }]} />
        <Text numberOfLines={1} style={[styles.historyDeleteUndoText, styles.reviewDeckToastText]}>
          {label}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={undoLabel}
        accessibilityRole="button"
        // The shared Undo pill is 40 points tall; the slop makes it a 44-point target.
        hitSlop={{ bottom: 4, left: 4, right: 4, top: 4 }}
        onPress={undoHeldDeckDecision}
        style={({ pressed }) => [styles.historyDeleteUndoButton, pressed ? styles.buttonPressed : null]}
        testID="review-deck-undo"
      >
        <Text style={styles.historyDeleteUndoButtonText}>Undo</Text>
      </Pressable>
    </Reanimated.View>
    );
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
          {/* While a bulk skip counts older pages, the count slot says so (nothing else moves). */}
          {bulkSkipCounting ? "Counting…" : deckFinished ? "" : deckPosition?.text ?? ""}
        </Text>
      </View>
      <ScrollView
        alwaysBounceVertical
        // Typing a "Log as" name keeps the card above the keyboard; a tap elsewhere dismisses it.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.reviewDeckContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
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
            copy={deckFinishedCopy(deckVisit.logged, deckVisit.decided)}
            celebrate={celebrateDeckFinish.current}
            footer={renderDeckToast("under")}
            onBack={() => router.back()}
            reduceMotion={reduceMotion}
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
              onLogAsActivity={(key) => {
                const source = deckSources.find((candidate) => candidate.key === key);
                if (source?.kind === "review") setLogAsPickerItemId(source.item.id);
              }}
              onLogAsName={(key, name) => {
                const source = deckSources.find((candidate) => candidate.key === key);
                // The name field is uncontrolled; typing updates this ref, not React state, so a
                // keystroke never re-renders the screen.
                if (source?.kind === "review") logAsNames.current.set(source.item.id, name);
              }}
              flyingKey={flyingDeckKey}
              onThrow={handleDeckThrowEnd}
              onThrowStart={handleDeckThrow}
              reduceMotion={reduceMotion}
              returnRequest={deckReturn}
              theme={theme}
              throwRequest={deckThrowRequest}
            />
            <View style={styles.reviewDeckActionsAnchor}>
              {renderDeckToast("actions")}
            <ReviewDeckActions
              logDisabled={topDeckControlsDisabled || deckFlying}
              skipDisabled={deckFlying || (topDeckSkipDefers && deckSources.length <= 1)}
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
                else requestDeckThrow(1);
              }}
              onSkip={() => requestDeckThrow(-1)}
              skipLabel={topDeckSkipDefers ? "Skip for now" : "Skip"}
              theme={theme}
            />
            </View>
          </>
        ) : (
          <View style={styles.reviewDeckWaiting}>
            {/* A card thrown last keeps its Undo here too, hanging out of flow below. */}
            <View style={styles.reviewDeckWaitingContent}>
            <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={styles.muted}>
              {deckWaitingCopy}
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
            {renderDeckToast("under")}
            </View>
          </View>
        )}
      </ScrollView>


      {logAsPickerItemId ? (
        <ActivityPickerSheet
          activities={data?.categories ?? []}
          onClose={() => setLogAsPickerItemId(null)}
          onPick={(activityId) => {
            const itemId = logAsPickerItemId;
            setLogAsDrafts((current) => new Map(current).set(itemId, { ...current.get(itemId), categoryId: activityId }));
          }}
          recentIds={recentLogAsActivityIds}
          reduceMotion={reduceMotion}
          selectedId={
            activeLogAsCategoryId(logAsDrafts.get(logAsPickerItemId)?.categoryId, data?.categories) ??
            (data?.reviewItems ?? []).find((item) => item.id === logAsPickerItemId)?.suggestedCategoryId ??
            null
          }
          styles={styles}
          theme={theme}
        />
      ) : null}

      <OverflowMenu
        bulkSkip
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

/** On-chip text measured against the chip's actual fill: white or deep ink, whichever is higher. */
function onColorFor(fill: string) {
  const { ink, white } = DAYFRAME_BLOCKS.onBlock;
  return contrastRatio(fill, white) >= contrastRatio(fill, ink) ? white : ink;
}

/** The card's live "Log as" changes, kept until the moment is decided. */
type ReviewLogAsDraft = { description?: string; categoryId?: string };

function deckFinishedCopy(logged: readonly { seconds: number }[], decided = 0) {
  if (!logged.length) {
    return decided > 0 ? `${decided} ${decided === 1 ? "moment" : "moments"} skipped. Nothing new on your days.` : "Nothing to review right now.";
  }
  const seconds = logged.reduce((total, block) => total + block.seconds, 0);
  const moments = `${logged.length} ${logged.length === 1 ? "moment" : "moments"} logged`;
  return seconds >= 60 ? `${moments}, ${formatReviewDeckDuration(seconds)} added to your days.` : `${moments}.`;
}

export function reviewDeckCardForItem(
  key: string,
  item: MobileReviewItem,
  context: {
    categories?: MobileBootstrap["categories"];
    draft?: ReviewLogAsDraft;
    menuOpen: boolean;
    mode: ReturnType<typeof useMobileTheme>["theme"]["mode"];
    neutral: string;
    now: number;
    overlapCount: number;
    syncState: ReviewItemSyncState | null;
  }
): ReviewDeckCardModel {
  // A live "Log as" choice (step 5c-1) replaces the suggested activity on the card.
  const draftCategory = context.draft?.categoryId
    ? context.categories?.find((category) => category.id === context.draft?.categoryId) ?? null
    : null;
  const activityName = draftCategory?.name ?? reviewItemCategoryName(item);
  const color = draftCategory
    ? paletteColorFor(draftCategory.color, draftCategory.name, context.mode)
    : reviewItemCategoryColor(item, activityName, context.neutral, context.mode);
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
    onColor: onColorFor(color),
    source: reviewDeckSource(kind),
    confidence: { score: confidence.score, label: confidence.label },
    title,
    when: [
      formatReviewDeckWhen(item.suggestedStartedAt, item.suggestedStoppedAt, reviewItemDurationSeconds(item, context.now), context.now),
      travelMode
    ].filter(Boolean).join(" · ") || null,
    // A cleared field logs the default name, so the card says so too.
    logAsName: context.draft?.description?.trim() || item.title?.trim() || title,
    logAsEditable: context.syncState == null && hasSuggestedTimeWindow(item),
    activityName,
    reason: [locationReason ?? reviewItemSummary(item), overlap].filter(Boolean).join(" ") || null,
    syncBadge: syncCopy?.badge ?? null,
    syncDetail: syncCopy?.detail ?? null,
    // A card without a complete window cannot be decided (the outbox refuses it), so it locks like
    // a card with a waiting change: no Log it, Edit, More or Log as; Skip only moves it back.
    controlsDisabled: context.syncState != null || !hasSuggestedTimeWindow(item),
    // Every decision needs a complete suggested window (the outbox refuses one without), so a card
    // without one resists both directions and Skip only moves it behind the rest.
    canLog: context.syncState == null && hasSuggestedTimeWindow(item),
    canSkip: true,
    skipDefers: context.syncState != null || !hasSuggestedTimeWindow(item),
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
  const entryColor = neutral ? context.neutral : paletteColorFor(colorKey, activityName, context.mode);
  const kind = {
    eventSource: entry.source,
    eventType: null,
    isLocation: Boolean(entry.placeName) || entry.source?.startsWith("location") === true,
    isTimeAway: false
  };
  return {
    key,
    picture: reviewDeckPicture(kind),
    color: entryColor,
    onColor: onColorFor(entryColor),
    source: reviewDeckSource(kind),
    confidence: null,
    title: displayEntryTitle(entry),
    when: formatReviewDeckWhen(entry.startedAt, entry.stoppedAt, entryDurationSeconds(entry, context.now), context.now),
    logAsName: displayEntryTitle(entry),
    logAsEditable: false,
    activityName,
    reason: "Already on your timeline. Edit it to confirm the details.",
    syncBadge: null,
    syncDetail: null,
    controlsDisabled: false,
    canLog: false,
    canSkip: true,
    skipDefers: true,
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

