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
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  analyzeTimeIntervals,
  paletteColorFor,
  readableLocationNameFromParts,
  type ReviewMutation
} from "@dayframe/shared";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { ConnectivityStatusStrip } from "@/components/ConnectivityStatusStrip";
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
  type HealthReviewReprocessResult,
  type MobileBootstrap,
  type MobileReviewItem,
  type MobileTimeEntry,
  type TimeEntryUpdatePatch
} from "@/lib/api";
import { reprocessExistingHealthReviewItems } from "@/lib/health";
import { createLocationReviewEvidencePrefetcher } from "@/lib/locationReviewEvidenceCache";
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
import {
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
import {
  reviewSyncStatusCopy,
  shouldOfferReviewSyncRetry
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

type ReviewReprocessDiagnostics = {
  startedAt: string | null;
  finishedAt: string | null;
  status: "idle" | "running" | "success" | "partial" | "failed" | "timed_out";
  result: HealthReviewReprocessResult | null;
  error: string | null;
};

const HEALTH_REPROCESS_TIMEOUT_MS = 45_000;

export default function ReviewScreen() {
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const { isOffline, isOnline, reconnectEpoch } = useConnectivity();
  const {
    reduceMotion,
    resolved: reduceMotionPreferenceResolved
  } = useResolvedReduceMotionPreference();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editTarget, setEditTarget] = useState<ReviewEditTarget | null>(null);
  const [editPresentation, setEditPresentation] = useState<TimeEntrySheetPresentation | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [showReviewInfo, setShowReviewInfo] = useState(false);
  const [reviewMenuState, setReviewMenuState] = useState(CLOSED_REVIEW_MENU_STATE);
  const [reviewAvailabilityMessage, setReviewAvailabilityMessage] = useState<string | null>(null);
  const [reviewSyncDiagnostics, setReviewSyncDiagnostics] = useState<ReviewSyncDiagnostics | null>(
    null
  );
  const [reviewItemSyncStates, setReviewItemSyncStates] = useState<
    Map<string, ReviewItemSyncState>
  >(new Map());
  const [reprocessDiagnostics, setReprocessDiagnostics] = useState<ReviewReprocessDiagnostics>({
    startedAt: null,
    finishedAt: null,
    status: "idle",
    result: null,
    error: null
  });
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
  const loadRef = useRef<(options?: ReviewLoadOptions) => Promise<void>>(
    async () => undefined
  );
  const evidencePrefetcher = useRef(
    createLocationReviewEvidencePrefetcher()
  ).current;
  const now = Date.now();
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
    const [diagnostics, itemStates] = await Promise.all([
      getReviewSyncDiagnostics(),
      getReviewItemSyncStates()
    ]);
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
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
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
    const generation = screenOwnerGeneration.current;
    const forceReprocess = force || !forcedReprocessComplete.current;
    if (forceReprocess) forcedReprocessComplete.current = true;
    const startedAt = new Date().toISOString();
    setReprocessDiagnostics((current) => ({
      ...current,
      startedAt,
      finishedAt: null,
      status: "running",
      error: null
    }));
    try {
      const reprocess = await withTimeout(
        reprocessExistingHealthReviewItems(undefined, { force: forceReprocess }),
        HEALTH_REPROCESS_TIMEOUT_MS
      );
      if (generation !== screenOwnerGeneration.current) return;
      setReprocessDiagnostics((current) => ({
        ...current,
        finishedAt: new Date().toISOString(),
        status: reprocess.failedCount > 0 || reprocess.partial ? "partial" : "success",
        result: reprocess,
        error: reprocess.errorSummary[0] ?? null
      }));
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
      if (generation !== screenOwnerGeneration.current) return;
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      const timedOut = error instanceof Error && error.message === "Health reprocess timed out.";
      setReprocessDiagnostics((current) => ({
        ...current,
        finishedAt: new Date().toISOString(),
        status: timedOut ? "timed_out" : "failed",
        error: error instanceof Error ? error.message : "Unable to reprocess Health review items."
      }));
    } finally {
      healthReprocessInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshReviewSyncDiagnostics();
    return subscribeReviewSync(() => {
      void reconcileLocalReviewProjection();
      void refreshReviewSyncDiagnostics();
    });
  }, [reconcileLocalReviewProjection, refreshReviewSyncDiagnostics]);

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
        cancelPendingReviewHandover();
      };
    }, [
      applyReviewMenuEvent,
      cancelPendingReviewHandover,
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
  }, [cancelPendingReviewHandover, evidencePrefetcher, load, recoverReviewAfterReconnect]);

  const openReviewItems = useMemo(
    () => (data?.reviewItems ?? []).filter(isOpenReviewItem),
    [data?.reviewItems]
  );
  const reviewNeededEntries = useMemo(
    () => collectReviewNeededEntries(data),
    [data]
  );
  const totalNeedsReview = openReviewItems.length + reviewNeededEntries.length;
  const editingEntry = editTarget?.entry ?? null;
  const reprocessRunning = reprocessDiagnostics.status === "running";
  const overflowItemId =
    reviewMenuState.openItemId ?? reviewMenuState.closingItemId;
  const overflowTarget = (data?.reviewItems ?? []).find(
    (item) => item.id === overflowItemId
  ) ?? null;

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
        (reprocessRunning && isHealthReviewItem(item)) ||
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
          <Text style={styles.settingsTitle} numberOfLines={1}>Review</Text>
        </View>
      </View>
      <ConnectivityStatusStrip style={styles.connectivityStatusStripScreen} />
      <ScrollView
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
                <Text style={styles.label}>{REVIEW_COPY.needsReview}</Text>
                <Text style={styles.sectionTitle}>Review</Text>
              </View>
              <Text style={styles.summaryTotal}>{totalNeedsReview}</Text>
            </View>
            <Text style={styles.muted}>Detected visits and suggested time entries stay here until you confirm, edit or ignore them.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showReviewInfo }}
              style={pressable(styles.detailsToggle, styles.buttonPressed)}
              onPress={() => {
                scheduleLayoutTransition(reduceMotion);
                setShowReviewInfo((current) => !current);
              }}
            >
              <Text style={styles.detailsToggleText}>About Review</Text>
              <ReviewChevronGlyph color={theme.textSecondary} expanded={showReviewInfo} />
            </Pressable>
            {showReviewInfo ? (
              <Reanimated.View
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
              >
                <Text style={styles.muted}>Dayframe keeps uncertain Health and location activity here so you can confirm the time, edit its details, or dismiss it without silently changing your timeline.</Text>
              </Reanimated.View>
            ) : null}
          </View>

          {reviewAvailabilityMessage ? (
            <View style={styles.queueDiagnosticCard}>
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                {reviewAvailabilityMessage}
              </Text>
            </View>
          ) : null}

          <ReviewSyncStatus
            diagnostics={reviewSyncDiagnostics}
            onReviewIssue={() =>
              router.push({ pathname: "/settings", params: { section: "sync" } })
            }
            onRetry={() => {
              void synchroniseReviewMutations({ force: true })
                .then(() =>
                  load({
                    preserveMenu: true,
                    queueIfBusy: true,
                    silent: true,
                    skipReprocess: true
                  })
                )
                .catch(() => refreshReviewSyncDiagnostics());
            }}
            styles={styles}
          />

          <View style={styles.reviewItemsSection}>
            <Text style={styles.sectionTitle}>Review items</Text>
            {totalNeedsReview === 0 ? (
              <Text style={styles.muted}>{REVIEW_COPY.emptyState}</Text>
            ) : null}
            <View style={styles.reviewList}>
              {openReviewItems.map((item) => (
                  <Reanimated.View
                    key={item.id}
                    entering={localPresenceEntering(reduceMotion)}
                    exiting={localPresenceExiting(reduceMotion)}
                    layout={localLayoutTransition(reduceMotion)}
                  >
                    <ReviewItemCard
                      item={item}
                      peerEntries={reviewPeerEntries(data)}
                      disabled={reprocessRunning && isHealthReviewItem(item)}
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
            {reviewNeededEntries.length > 0 ? (
              <View style={styles.reviewList}>
                {reviewNeededEntries.map((entry) => (
                  <ReviewNeededEntryCard
                    key={entry.id}
                    entry={entry}
                    now={now}
                    onEdit={() => beginReviewNeededEntryEdit(entry)}
                    styles={styles}
                    theme={theme}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <OverflowMenu
        disabled={
          !overflowItemId ||
          (reprocessRunning && Boolean(overflowTarget && isHealthReviewItem(overflowTarget))) ||
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
          historicalEntries={reviewPeerEntries(data)}
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
  onRetry,
  onReviewIssue,
  styles
}: {
  diagnostics: ReviewSyncDiagnostics | null;
  onRetry: () => void;
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
      <Text style={styles.reviewMetaLine}>{copy}</Text>
      <View style={styles.buttonRow}>
        {shouldOfferReviewSyncRetry(diagnostics) ? (
          <Pressable
            accessibilityRole="button"
            style={pressable(styles.secondaryButton, styles.buttonPressed)}
            onPress={onRetry}
          >
            <Text style={styles.secondaryButtonText}>Retry now</Text>
          </Pressable>
        ) : null}
        {diagnostics.needsAttentionCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={pressable(styles.secondaryButton, styles.buttonPressed)}
            onPress={onReviewIssue}
          >
            <Text style={styles.secondaryButtonText}>Review issue</Text>
          </Pressable>
        ) : null}
      </View>
    </Reanimated.View>
  );
}

function ReviewItemCard({
  disabled,
  item,
  menuOpen,
  now,
  onConfirm,
  onToggleMenu,
  onViewEvidence,
  peerEntries,
  syncState,
  styles,
  theme
}: {
  disabled: boolean;
  item: MobileReviewItem;
  menuOpen: boolean;
  now: number;
  onConfirm: () => void;
  onToggleMenu: () => void;
  onViewEvidence: () => void;
  peerEntries: MobileTimeEntry[];
  syncState: ReviewItemSyncState | null;
  styles: ReturnType<typeof useMobileTheme>["styles"];
  theme: ReturnType<typeof useMobileTheme>["theme"];
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
  const controlsDisabled = disabled || syncState != null;
  const confidence = reviewConfidencePresentation(item.confidence);
  const overlapWarning = reviewItemOverlapWarning(item, peerEntries, now);
  const locationReason = locationReviewReasonCopy(item, overlapWarning?.overlapCount ?? 0);
  const summary = locationReason ?? reviewItemSummary(item);
  const syncCopy = reviewItemSyncStatusCopy(syncState);

  return (
    <View style={styles.reviewCard}>
      <View
        pointerEvents="none"
        style={[styles.reviewCardAccentRail, { backgroundColor: categoryColor }]}
      />
      <View style={styles.reviewCardHeader}>
        <View style={styles.reviewTitleStack}>
          <Text style={styles.reviewTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.reviewMetaLine}>{formatReviewItemMeta(item, durationSeconds)}</Text>
        </View>
        <View style={styles.reviewBadge}>
          <Text style={styles.reviewBadgeText}>
            {syncCopy?.badge ?? REVIEW_COPY.needsReview}
          </Text>
        </View>
      </View>

      {syncCopy ? (
        <Text accessibilityLiveRegion="polite" style={styles.reviewMetaLine}>
          {syncCopy.detail}
        </Text>
      ) : null}

      <View style={styles.calendarBlockTitleRow}>
        <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
        <Text style={styles.reviewMetaLine} numberOfLines={1}>
          {categoryName}
          {item.placeName ? ` · ${item.placeName}` : ""}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={`Confidence: ${confidence.label}, ${confidence.score} of 5`}
        style={styles.reviewConfidenceRow}
      >
        <Text style={styles.reviewConfidenceLabel}>Confidence</Text>
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
        <Text style={styles.reviewConfidenceValue}>{confidence.label}</Text>
      </View>
      {summary ? (
        <Text numberOfLines={3} style={styles.reviewSummary}>{summary}</Text>
      ) : null}
      {overlapWarning?.overlapCount && !locationReason ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Overlaps ${overlapWarning.overlapCount} other ${overlapWarning.overlapCount === 1 ? "entry" : "entries"}. You can still confirm.`}
          style={styles.reviewOverlapRow}
        >
          <WarningGlyph color={theme.warningText} />
          <Text style={styles.reviewOverlapText}>
            Overlaps {overlapWarning.overlapCount} other {overlapWarning.overlapCount === 1 ? "entry" : "entries"} · You can still confirm
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
            <Text style={styles.reviewSecondaryButtonText}>View evidence</Text>
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
          <Text style={styles.primaryButtonText}>{reviewConfirmLabel(item)}</Text>
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
          <Text style={styles.reviewTitle} numberOfLines={2}>{displayEntryTitle(entry)}</Text>
          <Text style={styles.reviewMetaLine}>
            {formatEntryTimeRange(entry, now)} · {formatDuration(entryDurationSeconds(entry, now))}
          </Text>
        </View>
        <View style={styles.reviewBadge}>
          <Text style={styles.reviewBadgeText}>{REVIEW_COPY.needsReview}</Text>
        </View>
      </View>
      <View style={styles.calendarBlockTitleRow}>
        <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
        <Text style={styles.reviewMetaLine} numberOfLines={1}>
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
          <Text style={styles.reviewSecondaryButtonText}>{REVIEW_COPY.editDetails}</Text>
        </Pressable>
      </View>
      <Text style={styles.reviewMetaLine}>Confirm and ignore are available for suggested time entries.</Text>
    </View>
  );
}

function collectReviewNeededEntries(data: MobileBootstrap | null) {
  const byId = new Map<string, MobileTimeEntry>();
  for (const entry of [
    ...(data?.dayEntries ?? []),
    ...(data?.weekEntries ?? []),
    ...(data?.entries ?? [])
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

function reviewPeerEntries(data: MobileBootstrap | null) {
  if (!data) return [];
  return Array.from(
    new Map(
      [
        ...(data.historyEntries ?? []),
        ...(data.weekEntries ?? []),
        ...(data.dayEntries ?? []),
        ...(data.entries ?? [])
      ].map((entry) => [entry.id, entry])
    ).values()
  );
}

function reviewItemOverlapWarning(
  item: MobileReviewItem,
  peerEntries: MobileTimeEntry[],
  now: number
) {
  if (!item.suggestedStartedAt || !item.suggestedStoppedAt) return null;
  const candidateId = "__review_overlap_candidate__";
  return analyzeTimeIntervals(
    [
      ...peerEntries.map((entry) => ({
        id: entry.id,
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt
      })),
      {
        id: candidateId,
        startedAt: item.suggestedStartedAt,
        stoppedAt: item.suggestedStoppedAt
      }
    ],
    { now }
  ).entries.find((entry) => entry.id === candidateId) ?? null;
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
