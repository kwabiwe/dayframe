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
import Reanimated, { LayoutAnimationConfig } from "react-native-reanimated";
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
  ReviewDeckOlderDivider,
  ReviewDeckSegmentControl,
  ReviewDeckSegmentFramed
} from "@/components/review/ReviewDeckSegments";
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
  reviewBulkSkipOwnerMatches,
  reviewBulkSkipToast,
  runReviewBulkSkip,
  type ReviewBulkSkipScope
} from "@/lib/reviewBulkSkip";
import { ActivityPickerSheet } from "@/components/ActivityPickerSheet";
import { recentActivityIds } from "@/lib/activityChoice";
import { activeLogAsCategoryId, reviewDeckDecisionName, reviewLogAsEdit, reviewLogAsEditorName } from "@/lib/reviewLogAs";
import { friendlyMobileErrorMessage } from "@/lib/friendlyError";
import { playHaptic } from "@/lib/haptics";
import { useClockFormat } from "@/lib/clockFormat";
import {
  OverflowMenu,
  type OverflowMenuAction
} from "@/components/OverflowMenu";
import {
  AuthRequiredError,
  blockWordingForServerMessage,
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
  reviewDeckDayWord,
  reviewDeckPicture,
  reviewDeckPosition,
  reviewDeckSource
} from "@/lib/reviewDeck";
import { beginReviewDeckVisit, takeReviewDeckEvidenceDecisions } from "@/lib/reviewDeckDecisions";
import {
  legacyEntryMoment,
  orderReviewDeckChronology,
  orderReviewItemsByStart,
  otherReviewDeckSegment,
  parseReviewDeckSegmentParam,
  reviewDeckMomentStartMs,
  reviewDeckOlderThanWeek,
  reviewDeckSegmentAccessibilityLabel,
  reviewDeckSegmentCounts,
  reviewDeckSegmentFor,
  reviewDeckSegmentFramedCopy,
  reviewDeckSegmentView,
  reviewDeckToday,
  reviewItemMoment,
  switchReviewDeckSegment,
  type ReviewDeckMoment,
  type ReviewDeckSegment
} from "@/lib/reviewDeckSegments";
import { createReviewKnownItems, reviewDataOwnerKey } from "@/lib/reviewKnownItems";
import { liveReviewItems, projectReviewScreenData } from "@/lib/reviewScreenProjection";
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
import { BlocksNavHeader, usePreviousScreenLabel } from "@/components/BlocksNavHeader";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { SettingsStatusDot } from "@/components/settings/SettingsBlocks";
import { DAYFRAME_APP_ICONS, formatClockTime, outingKeyOf, reviewCardCount, type ClockFormat } from "@dayframe/shared";
import {
  heldOutingStillSame, outingFocusSegment, outingTravelSeconds, reviewDeckOutingLine, reviewDeckOutings
} from "@/lib/reviewDeckOutings";
import { reviewAnswerMutation } from "@/lib/reviewAnswer";
import { BlocksConfirmHost, useBlocksConfirm } from "@/components/blocks/BlocksConfirmSheet";
import { BlocksToast, useBlocksNotice } from "@/components/blocks/BlocksToast";
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
  loadedReviewBacklogCards,
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
import { formatLocaleDate } from "../src/lib/localeDateFormat";

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
    /** The Today nudge opens the segment that has moments (`today` or `earlier`). */
    segment?: string | string[];
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
  // UIA-005/003: the bulk-skip confirmation is a Blocks confirm sheet; "Nothing to skip" is a notice
  // in the deck toast's place (a held decision's Undo toast always wins that place).
  const confirmSheet = useBlocksConfirm();
  const deckNotice = useBlocksNotice();
  const shownDeckToastKeysRef = useRef(new Set<string>());
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
  // Owner decision 14 Oct 2026 (option C): the deck shows one segment, Today or Earlier. A focused
  // card (Today ribbon, Calendar) selects its own segment; otherwise the route's `segment`, else Today.
  const [deckSegment, setDeckSegment] = useState<ReviewDeckSegment>(
    () => parseReviewDeckSegmentParam(routeParams.segment) ?? "today"
  );
  const deckSegmentRef = useRef(deckSegment);
  deckSegmentRef.current = deckSegment;
  // Whether the latest segment change was the user's switch (the thumb slides) or a placement
  // (a focused card, the route), which places the thumb at once.
  const [deckSegmentSwitched, setDeckSegmentSwitched] = useState(false);
  // Bumped by a segment switch: VoiceOver focus moves once to the new top card's title (or the
  // "Today is framed" heading); a token is spent once it has moved focus.
  const [segmentFocusToken, setSegmentFocusToken] = useState(0);
  const spentSegmentFocusToken = useRef(0);
  // The segment each card was last shown in, so this visit's decisions count toward their own
  // segment's "N of M" after the card has left the deck.
  const knownDeckSegments = useRef(new Map<string, ReviewDeckSegment>());
  // Legacy needs-review entries have no skip mutation; Skip moves them behind the rest for this visit.
  const [deferredDeckKeys, setDeferredDeckKeys] = useState<readonly string[]>([]);
  // A deferred card was thrown off screen; it comes back as a fresh card at the back of the deck.
  const deferGenerations = useRef(new Map<string, number>());
  // Blocks parity step 5b: a thrown card is held for Undo before its decision is saved.
  const [heldDeckDecision, setHeldDeckDecision] = useState<ReviewDeckHeld | null>(null);
  // A toast key goes into this set once it has been on screen (after commit), so the same toast
  // handed to another slot when the deck changes branch starts settled instead of rising again.
  const activeDeckToastKey = heldDeckDecision ? String(heldDeckDecision.token) : deckNotice.notice ? `notice-${deckNotice.notice.token}` : null;
  useEffect(() => {
    // Only the toast on screen now can be handed to another slot; older keys are dropped.
    shownDeckToastKeysRef.current = new Set(activeDeckToastKey ? [activeDeckToastKey] : []);
  }, [activeDeckToastKey]);
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
  // Open items the deck has shown (Undo, a failed save, a Location evidence decision), each read
  // back only for the account it was shown for (reviewKnownItems.ts).
  const knownDeckItems = useRef(createReviewKnownItems<MobileReviewItem>()).current;
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
  // The latest bootstrap's open items, shown in place of their cached copies while unchanged.
  const liveReviewItemsRef = useRef<ReadonlyMap<string, MobileReviewItem>>(new Map());
  // One projection re-read at a time; a burst of store changes runs it once more at most.
  const projectionReadRef = useRef({ running: false, again: false });
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
  // Where an exact focus on a Review card was placed: a Move's focus follows its outing's card when the
  // grouping arrives later (Codex r2 on #473).
  const exactFocusPlacement = useRef<{ itemId: string; segment: ReviewDeckSegment } | null>(null);
  const focusLookupKey = useRef<string | null>(null);
  const loadRef = useRef<(options?: ReviewLoadOptions) => Promise<void>>(
    async () => undefined
  );
  const evidencePrefetcher = useRef(
    createLocationReviewEvidencePrefetcher()
  ).current;
  const now = Date.now();
  const clockFormat = useClockFormat();
  const navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>();
  // Review opens from Today and from Calendar; the back button names the screen it returns to.
  const backLabel = usePreviousScreenLabel() ?? "Today";
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
      // Cards the deck remembers (for Undo or a failed save) belong to the previous account.
      knownDeckItems.clear();
      liveReviewItemsRef.current = new Map();
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
    const next = current
      ? projectReviewScreenData({ base: current, projection: cached.bootstrap, live: liveReviewItemsRef.current, current })
      : cached.bootstrap;
    if (next !== current) commitData(next);
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
            "Review changed while more moments were loading. Pull to refresh."
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
        const nextBootstrap = projectReviewScreenData({
          base: current, projection: cached.bootstrap, live: liveReviewItemsRef.current, current
        });
        if (nextBootstrap !== current) commitData(nextBootstrap);
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
            "Review changed while more moments were loading. Pull to refresh."
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
      // The bootstrap's Review list is capped and carries no local decisions: the screen shows the
      // store's projection of it (written by fetchBootstrap), never the raw list, so a reload can
      // not briefly drop or re-add cards.
      const live = liveReviewItems(bootstrap);
      const projection = await loadCachedReviewBootstrap().catch(() => null);
      if (
        generation !== screenOwnerGeneration.current ||
        !screenFocusedRef.current
      ) {
        return;
      }
      commitBootstrap(projection
        ? projectReviewScreenData({ base: bootstrap, projection: projection.bootstrap, live, current: dataRef.current })
        : bootstrap);
      // After the commit, which forgets a previous account's live items.
      liveReviewItemsRef.current = live;
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
              ? projectReviewScreenData({ base: current, projection: cached.bootstrap, live: liveReviewItemsRef.current, current })
              : cached.bootstrap;
          commitBootstrap(nextBootstrap);
          startEvidencePrefetch(nextBootstrap);
        } else if (dataRef.current) {
          startEvidencePrefetch(dataRef.current);
        }
        setReviewAvailabilityMessage(
          connectivityRef.current.isOffline
            ? cached?.cachedAt
              ? `Showing Review data saved ${formatCachedAt(cached.cachedAt, clockFormat)}`
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
      const read = projectionReadRef.current;
      if (read.running) {
        read.again = true;
        return;
      }
      read.running = true;
      void (async () => {
        try {
          do {
            read.again = false;
            await reconcileLocalReviewProjection().catch(() => false);
            await refreshReviewSyncDiagnostics().catch(() => undefined);
          } while (read.again && screenFocusedRef.current);
        } finally {
          read.running = false;
          read.again = false;
        }
      })();
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
    // Before any backlog read (offline), the cached deck takes the backlog's own order: newest
    // suggested start first, not the bootstrap's newest-created first.
    if (!reviewBacklog) return orderReviewItemsByStart(cachedOpenReviewItems);
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
  // One card per outing (PRD D19): the Move cards of an unknown Stay's outing fold into its card.
  // A card with its own waiting or rejected change, or without a complete window, stays its own.
  const deckOutings = useMemo(() => reviewDeckOutings(openReviewItems, (item) => (
    isLocationReviewItem(item) && hasSuggestedTimeWindow(item) && !reviewItemSyncStates.has(item.id)
  )), [openReviewItems, reviewItemSyncStates]);
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
  // Counted in cards, an outing once (PRD D19, PR 12c), as the server's counts are.
  const visibleReviewItemCount = reviewCardCount(openReviewItems) + displayedReviewNeededEntries.length;
  const hasUnmaterialisedReviewEffects = Boolean(reviewSyncDiagnostics && (
    reviewSyncDiagnostics.pendingCount +
    reviewSyncDiagnostics.retryWaitCount +
    reviewSyncDiagnostics.authenticationRequiredCount +
    reviewSyncDiagnostics.needsAttentionCount +
    (reviewSyncDiagnostics.checkingCount ?? 0) +
    reviewSyncDiagnostics.acknowledgedCount > 0
  ));
  const reviewCountIsExact = reviewBacklog !== null && !hasUnmaterialisedReviewEffects;
  const totalNeedsReview = reviewCountIsExact
    ? reviewBacklog.globalCount
    : visibleReviewItemCount;
  const reviewCountCopy = reviewCountIsExact
    ? `${reviewBacklog.globalCount} ${reviewBacklog.globalCount === 1 ? "moment" : "moments"} to review`
    : reviewBacklog
      ? "Review available · count updating"
      : `At least ${visibleReviewItemCount} ${visibleReviewItemCount === 1 ? "moment" : "moments"} to review`;
  const backlogProgressCopy = reviewBacklog?.nextCursor
    ? `Loaded ${loadedReviewBacklogCards(reviewBacklog)} of ${reviewBacklog.globalCount} moments.`
    : reviewBacklog && !reviewBacklog.recordsComplete
      ? `Loaded ${loadedReviewBacklogCards(reviewBacklog)} of ${reviewBacklog.globalCount} moments.`
      : null;
  const showEmptyReviewState = reviewCountIsExact && totalNeedsReview === 0 && visibleReviewItemCount === 0;
  const editingEntry = editTarget?.entry ?? null;
  const overflowItemId =
    reviewMenuState.openItemId ?? reviewMenuState.closingItemId;
  const overflowTarget = (data?.reviewItems ?? []).find(
    (item) => item.id === overflowItemId
  ) ?? null;

  type DeckSource =
    | { key: string; kind: "review"; item: MobileReviewItem; moment: ReviewDeckMoment; segment: ReviewDeckSegment }
    | { key: string; kind: "legacy_entry"; entry: MobileTimeEntry; moment: ReviewDeckMoment; segment: ReviewDeckSegment };
  // Today is "overlaps today" (the server's todayCount and the ribbon); the day rolls at local midnight.
  const deckTodayKey = new Date(now).toDateString();
  const deckToday = useMemo(() => reviewDeckToday(Date.now()), [deckTodayKey]);
  // Every open card in date order, split by segment (hidden and deferred cards handled as before).
  const deckSegmentSources = useMemo(() => {
    // Item 5: one date order for every card, newest first, before deferrals and the sticky top.
    let sources: DeckSource[] = orderReviewDeckChronology(openReviewItems, displayedReviewNeededEntries, {
      review: (item) => reviewDeckMomentStartMs(reviewItemMoment(item)),
      legacy: (entry) => reviewDeckMomentStartMs(legacyEntryMoment(entry))
    }).map((source): DeckSource => {
      if (source.kind === "review") {
        const moment = reviewItemMoment(source.value);
        return {
          key: reviewFocusKey("review", source.value.id),
          kind: "review",
          item: source.value,
          moment,
          segment: reviewDeckSegmentFor(moment, deckToday)
        };
      }
      const moment = legacyEntryMoment(source.value);
      return {
        key: reviewFocusKey("legacy_entry", source.value.id),
        kind: "legacy_entry",
        entry: source.value,
        moment,
        segment: reviewDeckSegmentFor(moment, deckToday)
      };
    });
    const deferred = new Set(deferredDeckKeys);
    // A held card stays while it flies out; a held bulk skip hides every card it covers.
    const heldKeys = new Set(reviewDeckHeldKeys(heldDeckDecision).filter((key) => (
      heldDeckDecision?.kind === "batch" || key !== flyingDeckKey
    )));
    // A Move folded into its Stay's card is not a card of its own (also while the Stay is decided).
    const folded = (source: DeckSource) => source.kind === "review" && deckOutings.anchorByMember.has(source.item.id);
    const hidden = (key: string) => heldKeys.has(key) || committingDeckKeys.has(key);
    sources = sources.filter((source) => !folded(source));
    const ordered = [
      ...sources.filter((source) => !deferred.has(source.key) && !hidden(source.key)),
      ...deferredDeckKeys.flatMap((key) => sources.filter((source) => source.key === key && !hidden(key)))
    ];
    return {
      all: ordered,
      today: ordered.filter((source) => source.segment === "today"),
      earlier: ordered.filter((source) => source.segment === "earlier")
    };
  }, [committingDeckKeys, deckOutings, deckToday, deferredDeckKeys, displayedReviewNeededEntries, flyingDeckKey, heldDeckDecision, openReviewItems]);
  // The selected segment's cards: the deck itself.
  const deckSources = useMemo(() => {
    const ordered = deckSegmentSources[deckSegment];
    const deferred = new Set(deferredDeckKeys);
    // The card on top stays on top while it is open: a backlog page or refresh arriving with a
    // different order never swaps the card being read. A ribbon focus or a deferral still wins.
    const stickyKey = deferred.has(deckTopKeyRef.current ?? "") ? null : deckTopKeyRef.current;
    // The ribbon's focus leads only while that card is still open; afterwards the sticky top holds.
    // A Move folded into its outing leads with the outing's card.
    const focusedAnchor = highlightedFocusKey?.startsWith("review:")
      ? deckOutings.anchorByMember.get(highlightedFocusKey.slice("review:".length))
      : undefined;
    const focusTarget = focusedAnchor ? reviewFocusKey("review", focusedAnchor) : highlightedFocusKey;
    const focusKey = focusTarget && ordered.some((source) => source.key === focusTarget)
      ? focusTarget
      : null;
    // A card brought back by Undo returns to the top.
    const returnKey = deckReturn && ordered.some((source) => source.key === deckReturn.key) ? deckReturn.key : null;
    // Undo wins over a ribbon focus: the card the user brought back is the one they want.
    return orderReviewDeck(ordered, returnKey ?? focusKey ?? stickyKey);
  }, [deckOutings, deckReturn, deckSegment, deckSegmentSources, deferredDeckKeys, highlightedFocusKey]);
  for (const source of deckSegmentSources.all) knownDeckSegments.current.set(source.key, source.segment);
  // The other segment's top card is measured invisibly, so a switch lands it at its final size.
  const standbyDeckSource = deckSegmentSources[otherReviewDeckSegment(deckSegment)][0] ?? null;
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
  function deckCardForSource(source: DeckSource): ReviewDeckCardModel {
    const card = source.kind === "review"
      ? reviewDeckCardForItem(source.key, source.item, {
          categories: data?.categories,
          clockFormat,
          draft: {
            categoryId: logAsDrafts.get(source.item.id)?.categoryId,
            description: logAsNames.current.get(source.item.id)
          },
          menuOpen: reviewMenuState.openItemId === source.item.id,
          mode: theme.mode,
          neutral: theme.textSecondary,
          now,
          outing: deckOutings.outings.get(source.item.id) ? reviewDeckOutingLine(deckOutings.outings.get(source.item.id)!, now) : null,
          overlapCount: overlapCounts.get(source.item.id) ?? 0,
          syncState: reviewItemSyncStates.get(source.item.id) ?? null
        })
      : reviewDeckCardForEntry(source.key, source.entry, { clockFormat, mode: theme.mode, neutral: theme.textSecondary, now });
    const start = reviewDeckMomentStartMs(source.moment);
    return {
      ...card,
      // An Earlier card names its day on the picture ("Yesterday", "Mon 12 Oct").
      dayPill: source.segment === "earlier" && Number.isFinite(start) ? reviewDeckDayWord(new Date(start), now) : null
    };
  }
  const deckCards = useMemo(
    // One more than the visible stack: while the top card flies out, the card behind moves in.
    () => deckSources.slice(0, 4).map(deckCardForSource).map((card) => ({
      ...card,
      // Deferring the only card would change nothing.
      canSkip: card.canSkip && !(card.skipDefers && deckSources.length <= 1),
      // The card flying out cannot be edited or opened.
      controlsDisabled: card.controlsDisabled || card.key === flyingDeckKey,
      renderKey: `${card.key}#${deferGenerations.current.get(card.key) ?? 0}`
    })),
    // deferredDeckKeys changes whenever a defer generation does; deckCardForSource reads the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clockFormat, data?.categories, deckOutings, deckSources, deferredDeckKeys, flyingDeckKey, logAsDrafts, now, overlapCounts, reviewItemSyncStates, reviewMenuState.openItemId, theme.mode, theme.textSecondary]
  );
  const standbyDeckCard = useMemo(
    () => standbyDeckSource ? deckCardForSource(standbyDeckSource) : null,
    // deckCardForSource reads the same inputs as deckCards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clockFormat, data?.categories, deckOutings, logAsDrafts, now, overlapCounts, reviewItemSyncStates, standbyDeckSource, theme.mode, theme.textSecondary]
  );
  const topDeckSource = deckSources[0] ?? null;
  // The top card is the held card still flying out: the round actions wait for the next card.
  const deckFlying = flyingDeckKey !== null && topDeckSource?.key === flyingDeckKey;
  // The flying held card is already decided, so "N of M" does not count it (a deferred card
  // flying to the back still does).
  const heldInFlight = deckFlying && heldDeckCard?.key === flyingDeckKey;
  const deckRemaining = heldInFlight ? deckSources.length - 1 : deckSources.length;
  // Each segment's cards still to decide (the held card flying out of the selected one is decided).
  const segmentRemaining: Record<ReviewDeckSegment, number> = {
    today: deckSegment === "today" ? deckRemaining : deckSegmentSources.today.length,
    earlier: deckSegment === "earlier" ? deckRemaining : deckSegmentSources.earlier.length
  };
  // Every open item is loaded: the deck itself is the count, so a decision still syncing never
  // turns "2 of 5" into "2 of 5+". The server's total has no Today/Earlier split, so until then
  // each segment's count is what is loaded, marked "at least".
  const deckBacklogComplete = reviewBacklog !== null && !reviewBacklog.nextCursor && reviewBacklog.recordsComplete;
  // Exact only once the whole backlog is loaded (reviewDeckSegmentCounts); "9+" until then.
  const segmentCounts = reviewDeckSegmentCounts({
    today: segmentRemaining.today,
    earlier: segmentRemaining.earlier,
    backlogComplete: deckBacklogComplete
  });
  // "N of M" follows the selected segment: this visit's decisions in it, plus its count.
  let decidedInSegment = 0;
  for (const key of ownDeckDecisionKeys.current) {
    if ((knownDeckSegments.current.get(key) ?? deckSegment) === deckSegment) decidedInSegment += 1;
  }
  const deckPosition = reviewDeckPosition({
    decided: decidedInSegment,
    remaining: Math.max(segmentCounts[deckSegment].value, deckRemaining),
    exact: segmentCounts[deckSegment].exact
  });
  // "All framed" only when both segments are empty and a verified read says nothing else is open;
  // a cached-only deck (offline, no backlog read yet) never claims completeness.
  // A reload after the last decision keeps the previous complete read until it is replaced, so
  // "All framed" does not blink back to the waiting copy.
  const deckFinished = deckSegmentSources.all.length === 0 && deckBacklogComplete;
  const deckView = reviewDeckSegmentView({
    selected: deckSegment,
    selectedCards: deckSources.length,
    otherCards: deckSegmentSources[otherReviewDeckSegment(deckSegment)].length,
    selectedCount: segmentCounts[deckSegment],
    allFinished: deckFinished
  });
  const segmentFramedCopy = reviewDeckSegmentFramedCopy(deckSegment, segmentCounts[otherReviewDeckSegment(deckSegment)]);
  // The slim "Older than 7 days" divider: an Earlier top card that began more than a week ago.
  const showOlderDivider = deckView === "cards" && deckSegment === "earlier" && topDeckSourceIsOlder();
  function topDeckSourceIsOlder() {
    const top = deckSources[0];
    return Boolean(top && reviewDeckOlderThanWeek(top.moment, now));
  }
  // Decided while rendering so the finished screen mounts knowing whether to celebrate: only when
  // the cards last on screen were all this visit's own decisions (a refresh emptying it is quiet).
  if (deckFinished && !deckWasFinished.current) {
    celebrateDeckFinish.current = lastDeckKeys.current.length > 0 &&
      lastDeckKeys.current.every((key) => ownDeckDecisionKeys.current.has(key));
  }
  deckWasFinished.current = deckFinished;
  if (deckSegmentSources.all.length) lastDeckKeys.current = deckSegmentSources.all.map((source) => source.key);
  const deckWaitingCopy = reviewBacklogLoading || refreshing || data === null
    ? "Looking for moments to review…"
    : reviewBacklog === null
      ? "Nothing else is saved on this iPhone. Pull to refresh when you're online."
      : "More moments may be waiting. Pull to refresh.";
  const topDeckControlsDisabled = deckFlying ? false : (deckCards[0]?.controlsDisabled ?? true);
  // A legacy entry has no skip mutation, and a card with a waiting or rejected change cannot be
  // decided here: Skip moves either behind the rest for this visit, so it never blocks the deck.
  const topDeckSkipDefers = topDeckSource?.kind === "legacy_entry" || topDeckControlsDisabled || (deckCards[0]?.skipDefers ?? false);

  // The account this render's open items belong to.
  const deckOwnerKey = data ? reviewDataOwnerKey(data) : null;
  // Decisions made in Location evidence (Edit before logging, D7) count toward this visit.
  useEffect(() => {
    if (!deckOwnerKey) return;
    for (const item of openReviewItems) knownDeckItems.remember(item, deckOwnerKey);
  }, [deckOwnerKey, openReviewItems]);

  /** A remembered open item, only when it was shown for the account loaded now. */
  function knownDeckItem(itemId: string) {
    return knownDeckItems.get(itemId, dataRef.current);
  }
  useEffect(() => beginReviewDeckVisit(), []);
  useFocusEffect(
    useCallback(() => {
      for (const decision of takeReviewDeckEvidenceDecisions()) {
        const item = knownDeckItem(decision.itemId);
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
    // One card per outing (PRD D19): its Moves are decided with it and logged with its time. The
    // outing is one decision of this visit ("N of M" counts cards; Codex r1 on #473).
    const outing = deckOutings.outings.get(item.id);
    const outingKey = outing ? outingKeyOf(item) : null;
    const outingMembers = outing && outingKey ? outing.members.map((member) => ({
      key: reviewFocusKey("review", member.id),
      itemId: member.id,
      proposal: reviewDeckProposalSignature(member)
    })) : [];
    const stayBlock = deckLoggedBlock(item);
    const block = outing && outingKey ? { ...stayBlock, seconds: stayBlock.seconds + outingTravelSeconds(outing, Date.now()) } : stayBlock;
    // C2: a logged card's toast names the block as it will be listed, from what this decision
    // sends (the same edit the hold saves), not the detector title.
    const decisionName = reviewDeckDecisionName({
      logged,
      cardTitle: card?.title ?? reviewItemTitle(item),
      edit: logged ? deckLogAsEdit(item) : null,
      isLocationV2Commute: isLocationV2Commute(item),
      suggestionTitle: item.title,
      activityName: card?.activityName ?? reviewItemCategoryName(item)
    });
    deckTokenSequence.current += 1;
    recordDeckDecision(logged ? { ...block, color: card?.color ?? block.color } : null);
    deckHold.hold({
      kind: "single",
      token: deckTokenSequence.current,
      key,
      itemId: item.id,
      logged,
      direction,
      title: decisionName,
      // The colour the card showed (a live "Log as" activity included).
      color: card?.color ?? block.color,
      seconds: block.seconds,
      proposal: reviewDeckProposalSignature(item),
      ...(outingKey && outingMembers.length ? { outing: { key: outingKey, members: outingMembers } } : {})
    });
    // A throw reported after Review lost focus or the app went to the background is saved at
    // once: the lifecycle flush has already run.
    if (!deckScreenActive.current) deckHold.flush();
    playHaptic(logged ? "reviewLog" : "reviewSkip");
    AccessibilityInfo.announceForAccessibility(
      `${logged ? "Logged" : "Skipped"} ${decisionName}. Undo is available for a few seconds.`
    );
  }

  // What logging this card sends: an edit only when its "Log as" name or activity really changed
  // (reviewLogAs.ts). The toast's name (at the throw) and the saved edit (when the hold ends) both
  // read it, so they agree.
  function deckLogAsEdit(item: MobileReviewItem) {
    return reviewLogAsEdit({
      draftName: logAsNames.current.get(item.id),
      draftCategoryId: activeLogAsCategoryId(logAsDraftsRef.current.get(item.id)?.categoryId, dataRef.current?.categories),
      defaultName: item.title?.trim() || reviewItemTitle(item),
      suggestedCategoryId: item.suggestedCategoryId,
      isLocationV2: hasV2LocationEvidence(item),
      startedAt: hasSuggestedTimeWindow(item) ? item.suggestedStartedAt : null,
      stoppedAt: hasSuggestedTimeWindow(item) ? item.suggestedStoppedAt : null
    });
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
    // An outing comes back whole, even when a refresh paged some of it out.
    for (const member of held.outing?.members ?? []) restorePagedOutDeckItem(member.itemId);
    setDeckReturn({ key: held.key, direction: held.direction, token: held.token });
    playHaptic("undoRestore");
    AccessibilityInfo.announceForAccessibility(`${held.title} is back.`);
  }

  // A card brought back (Undo, a failed save) after a capped refresh paged its item out returns to
  // the loaded data from the copy the deck showed, so the deck, More, Edit and saving all see it
  // again. The next read replaces it like any other loaded item.
  function restorePagedOutDeckItem(itemId: string) {
    const loaded = dataRef.current;
    const known = knownDeckItem(itemId);
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
    // A bulk skip covers only the segment it was started in (Earlier, or Today).
    const segment = deckSegmentRef.current;
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
    const candidates = bulkSkipCandidates(scope, segment);
    const confirmation = reviewBulkSkipConfirmation(candidates.length, scope, complete, segment);
    if (!confirmation.confirmLabel) {
      bulkSkipInFlight.current = false;
      deckNotice.show(`${confirmation.title}. ${confirmation.message}`);
      return;
    }
    const chosen = new Set(candidates.map((item) => item.id));
    const shown = confirmSheet.confirm({
      eyebrow: "Review all",
      title: confirmation.title,
      message: confirmation.message,
      confirmLabel: confirmation.confirmLabel,
      // Cancel, a swipe down, a backdrop tap or VoiceOver escape.
      onCancel: () => { bulkSkipInFlight.current = false; },
      onConfirm: () => {
        bulkSkipInFlight.current = false;
        if (!stillHere()) return;
        // Only what the user confirmed, and only what can still be skipped now.
        holdBulkSkip(bulkSkipCandidates(scope, segment).filter((item) => chosen.has(item.id)));
      }
    });
    if (!shown) bulkSkipInFlight.current = false;
  }

  function bulkSkipCandidates(scope: ReviewBulkSkipScope, segment: ReviewDeckSegment) {
    const held = new Set(reviewDeckHeldKeys(deckHold.current()));
    const today = reviewDeckToday(Date.now());
    return reviewBulkSkipCandidates((dataRef.current?.reviewItems ?? []).filter(isOpenReviewItem), {
      // Only the selected segment's moments, by the deck's own Today predicate.
      inSegment: (item) => reviewDeckSegmentFor(reviewItemMoment(item), today) === segment,
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
    // Another decision may have been held while the confirmation was up: it is saved first, and
    // anything that save claimed is no longer part of this batch.
    deckHold.flush();
    items = items.filter((item) => !reviewMutations.current.has(item.id));
    const loaded = dataRef.current;
    if (!items.length || !loaded) return;
    applyReviewMenuEvent({ type: "close" });
    setDeckThrowRequest(null);
    setDeckReturn(null);
    setHighlightedFocusKey(null);
    for (const item of items) {
      knownDeckItems.remember(item, reviewDataOwnerKey(loaded));
      ownDeckDecisionKeys.current.add(reviewFocusKey("review", item.id));
    }
    setDeckVisit((current) => ({ ...current, decided: current.decided + items.length }));
    deckTokenSequence.current += 1;
    deckHold.hold({
      kind: "batch",
      token: deckTokenSequence.current,
      owner: { workspaceId: loaded.workspace.id, userId: loaded.user.id },
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
    // Another account signed in while it was held: nothing of the old account comes back.
    if (!reviewBulkSkipOwnerMatches(held.owner, dataRef.current)) return;
    for (const item of held.items) restorePagedOutDeckItem(item.itemId);
    playHaptic("undoRestore");
    AccessibilityInfo.announceForAccessibility(
      `${held.items.length} ${held.items.length === 1 ? "moment is" : "moments are"} back.`
    );
  }

  // The batch ends its hold: each item still open and unchanged is skipped once, one after the
  // other through the durable outbox (runReviewBulkSkip re-checks each right before it is written
  // and stops if the account changes), then the deck is projected and synced once.
  function commitHeldBulkSkip(held: ReviewDeckHeldBatch) {
    // Fenced to the account that held it (not whichever is loaded when the hold ends).
    const ownerMatches = () => reviewBulkSkipOwnerMatches(held.owner, dataRef.current);
    if (!ownerMatches()) {
      forgetBulkDecisions(held.items.map((entry) => entry.key));
      return;
    }
    // The batch claims its items, so no single decision can start for them while it saves.
    const claim = -held.token;
    const claimed = held.items.filter((entry) => !reviewMutations.current.has(entry.itemId));
    const busy = held.items.filter((entry) => reviewMutations.current.has(entry.itemId));
    for (const entry of claimed) reviewMutations.current.set(entry.itemId, claim);
    setDeckKeysCommitting(claimed.map((entry) => entry.key), true);
    // An item a capped refresh paged out is still open: it is saved from the copy the deck showed.
    const openItem = (itemId: string) => {
      const listed = dataRef.current?.reviewItems.find((candidate) => candidate.id === itemId);
      if (listed) return isOpenReviewItem(listed) ? listed : undefined;
      const known = knownDeckItem(itemId);
      return known && isOpenReviewItem(known) ? known : undefined;
    };
    void (async () => {
      const outcome = await runReviewBulkSkip<MobileReviewItem>(claimed, {
        enqueue: async (item) => {
          const current = dataRef.current;
          if (!current) throw new Error("Review data is not loaded.");
          const bootstrap = current.reviewItems.some((candidate) => candidate.id === item.id)
            ? current
            : { ...current, reviewItems: [...current.reviewItems, item] };
          await enqueueReviewMutation({
            bootstrap,
            item,
            mutation: hasV2LocationEvidence(item) ? { action: "ignore_once_location" } : { action: "ignore_once" },
            clientMutationId: createReviewClientMutationId()
          });
        },
        isSaving: (itemId) => {
          const current = reviewMutations.current.get(itemId);
          return current !== undefined && current !== claim;
        },
        openItem,
        ownerMatches,
        signature: reviewDeckProposalSignature
      });
      const sameOwner = ownerMatches();
      if (outcome.saved.length && sameOwner) {
        // Projected onto the newest data: a refresh that landed while saving is kept.
        const savedIds = new Set(outcome.saved.map((entry) => entry.itemId));
        const base = dataRef.current!;
        const projected = await projectReviewBootstrapFromStore(base).catch(() => null);
        if (ownerMatches()) {
          const latest = dataRef.current!;
          commitData(projected && latest === base ? projected : projectReviewBootstrap(latest, savedIds));
        }
      }
      for (const entry of claimed) {
        if (reviewMutations.current.get(entry.itemId) === claim) reviewMutations.current.delete(entry.itemId);
      }
      setDeckKeysCommitting(claimed.map((entry) => entry.key), false);
      const notSaved = [...busy, ...outcome.changed, ...outcome.failed];
      forgetBulkDecisions([...notSaved, ...outcome.resolved, ...outcome.abandoned].map((entry) => entry.key));
      // Nothing is put back once the account has changed.
      if (!ownerMatches()) return;
      for (const entry of [...outcome.changed, ...outcome.failed]) {
        deferGenerations.current.set(entry.key, (deferGenerations.current.get(entry.key) ?? 0) + 1);
        restorePagedOutDeckItem(entry.itemId);
      }
      // (A moment already saving another change is decided by that change; nothing to say.)
      if (outcome.changed.length) {
        const count = outcome.changed.length;
        AccessibilityInfo.announceForAccessibility(
          `${count} ${count === 1 ? "moment" : "moments"} changed, so ${count === 1 ? "it was" : "they were"} not skipped.`
        );
      }
      if (outcome.failed.length) {
        const count = outcome.failed.length;
        AccessibilityInfo.announceForAccessibility("Some moments were not skipped. They are still in Review.");
        Alert.alert(
          "Review",
          `${count} ${count === 1 ? "moment wasn’t" : "moments weren’t"} skipped on this iPhone. ${count === 1 ? "It is" : "They are"} still in Review.`
        );
      }
      if (outcome.saved.length) {
        AccessibilityInfo.announceForAccessibility(`${reviewBulkSkipToast(outcome.saved.length)}. Saved on this iPhone. Waiting to sync.`);
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
    const knownItem = knownDeckItem(held.itemId);
    const item = listedItem
      ? (isOpenReviewItem(listedItem) ? listedItem : undefined)
      : knownItem && isOpenReviewItem(knownItem) ? knownItem : undefined;
    const memberKeys = held.outing?.members.map((member) => member.key) ?? [];
    const undoCount = () => {
      unrecordDeckDecision(held.logged ? { color: held.color, seconds: held.seconds } : null);
      ownDeckDecisionKeys.current.delete(held.key);
    };
    // The outing's Moves come back with it whenever the Stay's card does.
    const restoreMembers = () => {
      for (const member of held.outing?.members ?? []) {
        deferGenerations.current.set(member.key, (deferGenerations.current.get(member.key) ?? 0) + 1);
        restorePagedOutDeckItem(member.itemId);
      }
    };
    // An item a capped refresh paged out is still open: it is saved from the copy the deck showed.
    const openItem = (itemId: string) => {
      const listed = dataRef.current?.reviewItems.find((candidate) => candidate.id === itemId);
      if (listed) return isOpenReviewItem(listed) ? listed : undefined;
      const known = knownDeckItem(itemId);
      return known && isOpenReviewItem(known) ? known : undefined;
    };
    if (!item) {
      setFlyingDeckKey((current) => (current === held.key ? null : current));
      // Resolved elsewhere while held: this visit did not decide it (its Moves show on their own).
      restoreMembers();
      undoCount();
      return;
    }
    // One card per outing (PRD D19): every Move must still be open, unchanged and in this outing.
    const members = held.outing
      ? heldOutingStillSame(held.outing.members, outingKeyOf(item) === held.outing.key ? held.outing.key : null, openItem, reviewDeckProposalSignature)
      : [];
    if (reviewDeckProposalSignature(item) !== held.proposal || members === null) {
      // A refresh changed the suggestion while the decision was held: the user decided about
      // something else, so nothing is saved and the card comes back as it is now.
      deferGenerations.current.set(held.key, (deferGenerations.current.get(held.key) ?? 0) + 1);
      setFlyingDeckKey((current) => (current === held.key ? null : current));
      restorePagedOutDeckItem(held.itemId);
      restoreMembers();
      undoCount();
      AccessibilityInfo.announceForAccessibility(`${held.title} changed, so it was not saved. Review it again.`);
      return;
    }
    const committingKeys = [held.key, ...memberKeys];
    setDeckKeysCommitting(committingKeys, true);
    // A flight cut short (Review left or the app backgrounded mid-throw) never reports its end, so
    // the outcome retires it; otherwise a card restored by a failed save would stay locked.
    const settled = () => {
      setDeckKeysCommitting(committingKeys, false);
      setFlyingDeckKey((current) => (current === held.key ? null : current));
    };
    const failed = () => {
      // The restored card is a fresh card: the thrown one's animation state is spent.
      deferGenerations.current.set(held.key, (deferGenerations.current.get(held.key) ?? 0) + 1);
      setDeckKeysCommitting(committingKeys, false);
      setFlyingDeckKey((current) => (current === held.key ? null : current));
      // "The suggestion is still available": a paged-out card comes back to retry.
      restorePagedOutDeckItem(held.itemId);
      restoreMembers();
      undoCount();
    };
    const edit = held.logged ? deckLogAsEdit(item) : null;
    // One outbox row for the whole outing, sent on the Stay's card; its Moves are hidden with it. The
    // mutation is the one rule Calendar › List answers with too (reviewAnswer.ts, step 14 part 3b).
    const outing = Boolean(held.outing && members.length);
    const started = resolveItem(
      item,
      reviewAnswerMutation(item, held.logged, { edit, outingMemberIds: outing ? members.map((member) => member.id) : undefined }),
      `${held.logged ? "Logged" : "Skipped"}. Saved on this iPhone. Waiting to sync.`,
      settled,
      failed,
      outing ? { unlisted, affectedItems: [item, ...members] } : { unlisted }
    );
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

  // A tap on the Today · Earlier control (or the "Today is framed" pill). Tapping the selected
  // segment does nothing; otherwise a held decision is saved first, as leaving the screen saves it,
  // then the stacks cross-fade (each card's own presence fade) and VoiceOver hears the new segment
  // and lands on its top card's title.
  function selectDeckSegment(next: ReviewDeckSegment) {
    switchReviewDeckSegment(deckSegmentRef.current, next, {
      flushHeld: () => deckHold.flush(),
      select: (segment) => {
        deckSegmentRef.current = segment;
        applyReviewMenuEvent({ type: "close" });
        setDeckThrowRequest(null);
        setDeckReturn(null);
        setDeckSegmentSwitched(true);
        setDeckSegment(segment);
        setSegmentFocusToken((token) => token + 1);
        AccessibilityInfo.announceForAccessibility(reviewDeckSegmentAccessibilityLabel(segment, segmentCounts[segment]));
      }
    });
  }

  function spendSegmentFocusToken(token: number) {
    spentSegmentFocusToken.current = Math.max(spentSegmentFocusToken.current, token);
  }
  const unspentSegmentFocusToken = segmentFocusToken > spentSegmentFocusToken.current ? segmentFocusToken : 0;

  const loadMoreReviewBacklog = useCallback(() => {
    const cursor = reviewBacklogRef.current?.nextCursor;
    if (!cursor) return;
    void loadReviewBacklogPage({ cursor, reset: false });
  }, [loadReviewBacklogPage]);

  // The next backlog page is read while fewer than three cards remain in the selected segment, once
  // per cursor; a failed read is not retried automatically (the empty deck offers "Show more"
  // instead).
  const autoLoadedCursor = useRef<string | null>(null);
  const segmentWantsPage = deckSources.length < 3;
  const deckNextCursor = segmentWantsPage ? reviewBacklog?.nextCursor ?? null : null;
  useEffect(() => {
    if (!deckNextCursor || reviewBacklogLoading || autoLoadedCursor.current === deckNextCursor) return;
    autoLoadedCursor.current = deckNextCursor;
    loadMoreReviewBacklog();
  }, [deckNextCursor, loadMoreReviewBacklog, reviewBacklogLoading]);

  // The exact item a Today ribbon or Calendar tap asked for leads the deck (orderReviewDeck), in
  // its own segment: a ribbon moment overlaps today, so it opens Today; an earlier day's opens Earlier.
  const beginExactFocus = useCallback((key: string, segment: ReviewDeckSegment) => {
    if (focusConsumedKey.current === key) return;
    focusConsumedKey.current = key;
    exactFocusPlacement.current = key.startsWith("review:") ? { itemId: key.slice("review:".length), segment } : null;
    if (segment !== deckSegmentRef.current) {
      // Placed at once (no thumb slide, no announcement beyond the one below); a held decision is
      // saved first, as any segment change saves it.
      deckHold.flush();
      deckSegmentRef.current = segment;
      setDeckSegmentSwitched(false);
      setDeckSegment(segment);
    }
    setHighlightedFocusKey(key);
    AccessibilityInfo.announceForAccessibility("Opened that moment.");
  }, [deckHold]);

  // A focused Move whose outing arrives after the focus was placed moves with it to its outing's card,
  // in the Stay's segment (a trip home after midnight belongs to the evening's card; Codex r2 on #473).
  useEffect(() => {
    const segment = outingFocusSegment({
      placed: exactFocusPlacement.current,
      currentSegment: deckSegmentRef.current,
      anchorByMember: deckOutings.anchorByMember,
      openItems: openReviewItems,
      segmentFor: (item) => reviewDeckSegmentFor(reviewItemMoment(item), reviewDeckToday(Date.now()))
    });
    if (!segment || !exactFocusPlacement.current) return;
    exactFocusPlacement.current = { ...exactFocusPlacement.current, segment };
    deckHold.flush();
    deckSegmentRef.current = segment;
    setDeckSegmentSwitched(false);
    setDeckSegment(segment);
  }, [deckHold, deckOutings, openReviewItems]);

  useEffect(() => {
    const request = focusRequest;
    if (!request) {
      exactFocusPlacement.current = null;
      setFocusedLegacyEntry(null);
      setHighlightedFocusKey(null);
      return;
    }
    const focusKey = reviewFocusKey(request.kind, request.id);
    if (focusConsumedKey.current === focusKey) return;
    if (!data) return;

    if (request.kind === "review") {
      const item = openReviewItems.find((candidate) => candidate.id === request.id);
      if (item) {
        // A Move folded into its outing opens the outing's card, in the Stay's segment (a trip home
        // after midnight belongs to the evening's card; Codex r1 on #473).
        const anchorId = deckOutings.anchorByMember.get(item.id);
        const shown = (anchorId ? openReviewItems.find((candidate) => candidate.id === anchorId) : undefined) ?? item;
        beginExactFocus(focusKey, reviewDeckSegmentFor(reviewItemMoment(shown), reviewDeckToday(Date.now())));
        return;
      }
    } else {
      const entry = displayedReviewNeededEntries.find((candidate) => candidate.id === request.id);
      if (entry) {
        beginExactFocus(focusKey, reviewDeckSegmentFor(legacyEntryMoment(entry), reviewDeckToday(Date.now())));
        return;
      }
    }

    if (focusLookupKey.current === focusKey) return;
    if (!DAYFRAME_BACKEND_ID) {
      focusConsumedKey.current = focusKey;
      setReviewAvailabilityMessage("This moment can’t be opened in this version of Dayframe. Refresh Review.");
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
      setReviewAvailabilityMessage("This moment was already reviewed or is no longer there. Refreshing Review.");
      void loadRef.current({ preserveMenu: true, queueIfBusy: true, silent: true, skipReprocess: true });
    }).catch((error) => {
      if (focusConsumedKey.current === focusKey) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      focusConsumedKey.current = focusKey;
      setReviewAvailabilityMessage("Couldn’t find that moment. It may have changed; refresh Review.");
    });
  }, [
    beginExactFocus,
    data,
    deckOutings,
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
      // UIA-024: More › Skip is the deck's Skip: the top card is thrown (haptic, held with Undo).
      // More only opens on the top card; if it is no longer on top (or a card is flying), the
      // stale choice is dropped rather than skipping a card without Undo.
      const top = deckSources[0];
      if (!deckFlying && top && top.kind !== "legacy_entry" && top.item.id === item.id) requestDeckThrow(-1);
      return;
    }

    if (pendingAction.action === "skip_older" || pendingAction.action === "skip_all") {
      finishAction();
      void startBulkSkip(pendingAction.action === "skip_older" ? "older" : "all");
      return;
    }

    // Edit before logging opens the same editor as the card's pencil (Location evidence for a
    // location moment).
    if (hasV2LocationEvidence(item)) {
      finishAction();
      router.push({ pathname: "/review/[id]", params: { id: item.id } } as never);
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
    /** `affectedItems`: every card the change decides (an outing's Stay and Moves), the item first. */
    options: { unlisted?: boolean; affectedItems?: MobileReviewItem[] } = {}
  ) {
    const affected = options.affectedItems ?? [item];
    const claimed = () => affected.some((candidate) => reviewMutations.current.has(candidate.id));
    if (claimed()) return false;
    // Any other decision (More › Dismiss, an edit) saves a held card first, as a throw does.
    deckHold.flush();
    // That flush may have saved this very item (a held bulk skip covering it): decided once.
    if (claimed()) return false;
    const loadedData = dataRef.current;
    if (!loadedData) return false;
    const listed = loadedData.reviewItems.some((candidate) => candidate.id === item.id);
    if (!listed && !options.unlisted) return false;
    // A held card whose item a capped refresh paged out (still open, just not in the first page)
    // is saved from the copy the deck showed.
    const unlistedItems = affected.filter((candidate) => !loadedData.reviewItems.some((loaded) => loaded.id === candidate.id));
    const currentData = unlistedItems.length ? { ...loadedData, reviewItems: [...loadedData.reviewItems, ...unlistedItems] } : loadedData;

    for (const candidate of affected) reviewMutations.current.set(candidate.id, 1);
    const release = () => {
      for (const candidate of affected) reviewMutations.current.delete(candidate.id);
    };
    const clientMutationId = createReviewClientMutationId();
    void enqueueReviewMutation({
      bootstrap: currentData,
      item,
      mutation,
      clientMutationId,
      ...(options.affectedItems ? { affectedItems: options.affectedItems } : {})
    }).then(async () => {
        if (!reviewMutations.current.has(item.id)) return;
        const currentProjection = dataRef.current;
        if (currentProjection) {
          const projected = await projectReviewBootstrapFromStore(currentProjection)
            .catch(() => projectReviewBootstrap(currentProjection, new Set(affected.map((candidate) => candidate.id))));
          commitData(projected);
        } else {
          await reconcileLocalReviewProjection();
        }
        onCommitted?.();
        AccessibilityInfo.announceForAccessibility(successAnnouncement);
        release();
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
        release();
        onFailed?.();
        AccessibilityInfo.announceForAccessibility(
          "The Review choice wasn’t saved. The moment is still here."
        );
        Alert.alert(
          "Review",
          friendlyMobileErrorMessage(error, "Couldn’t save this Review choice on this iPhone.")
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
      deckNotice.show("This suggestion has no start and end time yet.");
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
      Alert.alert("Edit", friendlyMobileErrorMessage(error, "Couldn't save this block. Try again."));
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

  // The Undo toast hangs 12 points below the round actions, in space reserved under them (staging
  // feedback C1: it used to sit above them, over the bottom of the card), or under Back to Today
  // once all is framed / under the waiting copy, always out of flow, so it never covers the card or
  // the controls whatever the phone height or text size, and its exit moves nothing.
  // Each place the toast can hang (under the round actions, under Back to Today, under the waiting
  // copy) is a slot that is always mounted with its branch. When the deck changes branch while a
  // toast is up (the last card thrown, "All framed" appearing) the slot that went away takes its
  // copy with it instead of leaving a fading ghost (skipExiting), and the same toast continues in
  // the new slot at rest (BlocksToast appearSettled, for a key already shown). A toast first raised
  // in the same commit as a branch change (Skip all) still rises in; one that times out inside a
  // mounted slot still leaves with its own exit.
  function deckToastSlot(placement: "actions" | "under") {
    return (
      <LayoutAnimationConfig skipExiting>
        {renderDeckToast(placement)}
      </LayoutAnimationConfig>
    );
  }

  function renderDeckToast(placement: "actions" | "under") {
    const held = heldDeckDecision;
    const placementStyle = placement === "under" ? styles.reviewDeckToastUnderButton : styles.reviewDeckToast;
    if (!held) {
      const notice = deckNotice.notice;
      return notice ? (
        <BlocksToast
          appearSettled={shownDeckToastKeysRef.current.has(`notice-${notice.token}`)}
          key={`notice-${notice.token}`}
          message={notice.message}
          reduceMotion={reduceMotion}
          style={placementStyle}
          swatchColor={notice.swatchColor}
          testID="review-deck-notice"
          theme={theme}
        />
      ) : null;
    }
    // A bulk skip (step 5f) has one neutral swatch and names the count.
    const label = held.kind === "batch"
      ? reviewBulkSkipToast(held.items.length)
      : `${held.logged ? "Logged" : "Skipped"} ${held.title}`;
    const undoLabel = held.kind === "batch"
      ? `Undo skipping ${held.items.length} ${held.items.length === 1 ? "moment" : "moments"}`
      : `Undo ${held.logged ? "logging" : "skipping"} ${held.title}`;
    // The shared Blocks toast (UIA-003): swatch, sentence and a neutral 44-point Undo pill. The
    // hold (reviewDeckHold.ts, 4.8 s) still owns its lifetime; the token re-mounts a newer toast.
    return (
      <BlocksToast
        appearSettled={shownDeckToastKeysRef.current.has(String(held.token))}
        key={held.token}
        actionAccessibilityLabel={undoLabel}
        actionLabel="Undo"
        actionTestID="review-deck-undo"
        message={label}
        onAction={undoHeldDeckDecision}
        reduceMotion={reduceMotion}
        style={placementStyle}
        swatchColor={held.kind === "batch" ? theme.textSecondary : held.color}
        testID="review-deck-toast"
        theme={theme}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <BlocksNavHeader
        backLabel={backLabel}
        backTestID="review-deck-back"
        onBack={() => router.back()}
        title="Review"
        trailing={
          <Text
            {...mobileTextProps("numeric")}
            accessibilityLabel={deckPosition?.accessibilityLabel ?? reviewCountCopy}
            style={styles.reviewDeckNavCount}
            testID="review-deck-count"
          >
            {/* While a bulk skip counts older pages, the count slot says so (nothing else moves). */}
            {bulkSkipCounting ? "Counting…" : deckFinished ? "" : deckPosition?.text ?? ""}
          </Text>
        }
      />
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
        {/* Today · Earlier (owner decision 14 Oct 2026, option C): neutral, no coral; it owns its thumb. */}
        <ReviewDeckSegmentControl
          animateChange={deckSegmentSwitched}
          counts={segmentCounts}
          onSelect={selectDeckSegment}
          reduceMotion={reduceMotion}
          selected={deckSegment}
          theme={theme}
        />
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
            router.push({ pathname: "/settings", params: { from: "review", section: "sync" } })
          }
          styles={styles}
          theme={theme}
        />

        {/* Always reserved in both segments, so the divider appearing never moves the deck. */}
        <ReviewDeckOlderDivider reduceMotion={reduceMotion} theme={theme} visible={showOlderDivider} />

        {deckView === "finished" ? (
          <ReviewDeckFinished
            backLabel={backLabel}
            blocks={deckVisit.logged.map((block) => block.color)}
            copy={deckFinishedCopy(deckVisit.logged, deckVisit.decided)}
            celebrate={celebrateDeckFinish.current}
            footer={deckToastSlot("under")}
            onBack={() => router.back()}
            reduceMotion={reduceMotion}
            theme={theme}
          />
        ) : deckView === "segment_framed" ? (
          <ReviewDeckSegmentFramed
            action={segmentFramedCopy.action}
            actionAccessibilityLabel={segmentFramedCopy.actionAccessibilityLabel}
            detail={segmentFramedCopy.detail}
            focusToken={unspentSegmentFocusToken}
            footer={deckToastSlot("under")}
            key={deckSegment}
            onAction={() => selectDeckSegment(otherReviewDeckSegment(deckSegment))}
            onFocused={spendSegmentFocusToken}
            reduceMotion={reduceMotion}
            theme={theme}
            title={segmentFramedCopy.title}
          />
        ) : topDeckSource ? (
          <>
            <ReviewDeckStack
              cards={deckCards}
              focusTitleToken={unspentSegmentFocusToken}
              onTitleFocused={spendSegmentFocusToken}
              standby={standbyDeckCard}
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
              {/* After the actions: below them on screen and after them for VoiceOver. */}
              {deckToastSlot("actions")}
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
                accessibilityLabel={`Show more moments. ${backlogProgressCopy ?? ""}`.trim()}
                accessibilityRole="button"
                onPress={loadMoreReviewBacklog}
                style={pressable(styles.secondaryButton, styles.buttonPressed)}
              >
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Show more</Text>
              </Pressable>
            ) : null}
            {deckToastSlot("under")}
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
        bulkSkip={deckSegment}
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
      <BlocksConfirmHost controller={confirmSheet} reduceMotion={reduceMotion} styles={styles} theme={theme} />
    </SafeAreaView>
  );
}

/**
 * Review's sync line as the Settings status row (UIA-023): a status dot, one short sentence and,
 * when something needs checking, "Fix" with a chevron to Sync help.
 */
function ReviewSyncStatus({
  diagnostics,
  onReviewIssue,
  styles,
  theme
}: {
  diagnostics: ReviewSyncDiagnostics | null;
  onReviewIssue: () => void;
  styles: ReturnType<typeof useMobileTheme>["styles"];
  theme: ReturnType<typeof useMobileTheme>["theme"];
}) {
  if (!diagnostics) return null;
  const copy = reviewSyncStatusCopy(diagnostics);
  if (!copy) return null;
  const attention = diagnostics.needsAttentionCount > 0;
  const content = (
    <>
      <SettingsStatusDot attention theme={theme} />
      <Text {...mobileTextProps("body")} style={[styles.reviewMetaLine, { flex: 1, minWidth: 0 }]}>{copy}</Text>
      {attention ? (
        <View style={{ alignItems: "center", flexDirection: "row", gap: 2 }}>
          <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontWeight: "700" }}>Fix</Text>
          <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.next} size={18} />
        </View>
      ) : null}
    </>
  );
  return (
    <Reanimated.View accessibilityLiveRegion={attention ? "assertive" : "polite"}>
      {attention ? (
        <Pressable
          accessibilityHint="Opens Sync help"
          accessibilityLabel={`${copy}. Fix`}
          accessibilityRole="button"
          onPress={onReviewIssue}
          style={({ pressed }) => [styles.queueDiagnosticCard, reviewStatusRowStyle, pressed ? { opacity: 0.72 } : null]}
          testID="review-sync-status"
        >
          {content}
        </Pressable>
      ) : (
        <View style={[styles.queueDiagnosticCard, reviewStatusRowStyle]} testID="review-sync-status">{content}</View>
      )}
    </Reanimated.View>
  );
}

const reviewStatusRowStyle = { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 44 } as const;

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
    clockFormat: ClockFormat;
    draft?: ReviewLogAsDraft;
    menuOpen: boolean;
    mode: ReturnType<typeof useMobileTheme>["theme"]["mode"];
    neutral: string;
    now: number;
    /** One card per outing (PRD D19): the folded Moves' travel line. */
    outing?: string | null;
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
    isTimeAway: isTimeAwayReviewItem(item),
    workoutType: item.rawPayload?.workoutType
  };
  const confidence = reviewConfidencePresentation(item.confidence);
  const locationReason = locationReviewReasonCopy(item, context.overlapCount);
  const overlap = context.overlapCount && !locationReason
    ? `Overlaps ${context.overlapCount} other ${context.overlapCount === 1 ? "block" : "blocks"} · You can still confirm.`
    : null;
  const syncCopy = reviewItemSyncStatusCopy(context.syncState);
  const title = reviewItemTitle(item);
  // A Move's second line from the server ("Home → Gym"; PRD D19); an older server's card shows the mode.
  const routeLabel = item.eventType === "commute_detected" && typeof item.rawPayload?.routeLabel === "string"
    ? item.rawPayload.routeLabel.trim() || null : null;
  const travelMode = routeLabel ?? (item.eventType === "commute_detected" ? travelModeLabel(item.rawPayload?.travelMode) : null);
  return {
    key,
    picture: reviewDeckPicture(kind),
    color,
    onColor: onColorFor(color),
    source: reviewDeckSource(kind),
    confidence: { score: confidence.score, label: confidence.label },
    title,
    when: [
      formatReviewDeckWhen(item.suggestedStartedAt, item.suggestedStoppedAt, reviewItemDurationSeconds(item, context.now), context.now, context.clockFormat),
      travelMode
    ].filter(Boolean).join(" · ") || null,
    outing: context.outing ?? null,
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
  context: { clockFormat: ClockFormat; mode: ReturnType<typeof useMobileTheme>["theme"]["mode"]; neutral: string; now: number }
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
    when: formatReviewDeckWhen(entry.startedAt, entry.stoppedAt, entryDurationSeconds(entry, context.now), context.now, context.clockFormat),
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
  // Moves carry the server's title ("Drive", "Commute", "Trip"; PRD D19).
  if (item.eventType === "commute_detected") return item.title?.trim() || "Trip";
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
      ? "A round trip from this place, with an unnamed stop."
      : "A round trip from this place.";
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

  // Server notes (bootstrap or cached) can still say "entry" or "timer" (UIA-100).
  const notes = item.notes?.trim();
  if (notes) return blockWordingForServerMessage(notes);
  if (isHealthReviewItem(item)) return "Review this Health activity before it is added.";
  return "Review this suggested time before it is added.";
}

/** A Location V2 Move: the server stores it with only a typed name (a legacy time-away card kept its title). */
function isLocationV2Commute(item: MobileReviewItem) {
  return hasV2LocationEvidence(item) && item.eventType === "commute_detected" &&
    (!isTimeAwayReviewItem(item) || Boolean(item.rawPayload?.routeLabel));
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

function formatCachedAt(value: string, clockFormat: ClockFormat) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "earlier";
  return `${formatLocaleDate(date, { month: "short", day: "numeric" })}, ${formatClockTime(date, clockFormat)}`;
}

function reviewItemSyncStatusCopy(syncState: ReviewItemSyncState | null) {
  if (!syncState) return null;
  if (syncState.state === "needs_attention") {
    return {
      badge: "Sync issue",
      detail: "Dayframe couldn't save this change. Tap Fix above to choose what to do in Sync help."
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
