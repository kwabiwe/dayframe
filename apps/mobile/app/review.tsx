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
import { paletteColorFor, readableLocationNameFromParts } from "@dayframe/shared";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { DayframeBrand } from "@/components/brand";
import { MobileBackButton } from "@/components/MobileBackButton";
import {
  OverflowMenu,
  type OverflowMenuAction
} from "@/components/OverflowMenu";
import {
  AuthRequiredError,
  confirmReviewItem,
  dismissReviewItem,
  fetchBootstrap,
  resolveLocationReviewItem,
  saveEditedReviewItem,
  updateTimeEntry,
  type HealthReviewReprocessResult,
  type MobileBootstrap,
  type MobileReviewItem,
  type MobileTimeEntry,
  type TimeEntryUpdatePatch
} from "@/lib/api";
import { DAYFRAME_API_BASE } from "@/lib/config";
import { reprocessExistingHealthReviewItems } from "@/lib/health";
import { applyOptimisticMutation } from "@/lib/localMutation";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  scheduleLayoutTransition,
  useReduceMotionPreference
} from "@/lib/motion";
import {
  REVIEW_COPY,
  CLOSED_REVIEW_MENU_STATE,
  buildReviewItemDraftEntry,
  canRunReviewMenuAction,
  hasSuggestedTimeWindow,
  hasV2LocationEvidence,
  hideTombstonedReviewItems,
  isOneOffLocationReviewItem,
  isOpenReviewItem,
  isReviewNeededEntry,
  isLocationReviewItem,
  removeReviewItemOptimistically,
  reduceReviewMenuState,
  restoreReviewItemOptimistically,
  reviewConfirmLabel,
  reviewItemCategoryLabel,
  reviewItemDurationSeconds,
  type OptimisticReviewRemoval,
  type ReviewMenuEvent
} from "@/lib/review";

type ReviewEditTarget =
  | {
    kind: "reviewItem";
    item: MobileReviewItem;
    entry: MobileTimeEntry;
    handoverToken: number;
  }
  | { kind: "entry"; entry: MobileTimeEntry };

type ReviewTombstone = {
  status: "pending" | "succeeded";
  version: number;
};

type ReviewLoadOptions = {
  forceReprocess?: boolean;
  preserveMenu?: boolean;
  queueIfBusy?: boolean;
  refresh?: boolean;
  silent?: boolean;
  skipReprocess?: boolean;
};

type ReviewReprocessDiagnostics = {
  apiBaseUrl: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: "idle" | "running" | "success" | "partial" | "failed" | "timed_out";
  result: HealthReviewReprocessResult | null;
  error: string | null;
};

const HEALTH_REPROCESS_TIMEOUT_MS = 45_000;

export default function ReviewScreen() {
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const reduceMotion = useReduceMotionPreference();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editTarget, setEditTarget] = useState<ReviewEditTarget | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [showReviewInfo, setShowReviewInfo] = useState(false);
  const [reviewMenuState, setReviewMenuState] = useState(CLOSED_REVIEW_MENU_STATE);
  const [reprocessDiagnostics, setReprocessDiagnostics] = useState<ReviewReprocessDiagnostics>({
    apiBaseUrl: DAYFRAME_API_BASE,
    startedAt: null,
    finishedAt: null,
    status: "idle",
    result: null,
    error: null
  });
  const dataRef = useRef<MobileBootstrap | null>(null);
  const editTargetRef = useRef<ReviewEditTarget | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const screenFocusedRef = useRef(false);
  const refreshInFlight = useRef(false);
  const bootstrapRefreshQueued = useRef(false);
  const forcedReprocessComplete = useRef(false);
  const reviewMenuStateRef = useRef(CLOSED_REVIEW_MENU_STATE);
  const reviewMenuActionSequence = useRef(0);
  const reviewMutationSequence = useRef(0);
  const reviewMutations = useRef(new Map<string, number>());
  const reviewTombstones = useRef(new Map<string, ReviewTombstone>());
  const loadRef = useRef<(options?: ReviewLoadOptions) => Promise<void>>(
    async () => undefined
  );
  const now = Date.now();

  const applyReviewMenuEvent = useCallback((event: ReviewMenuEvent) => {
    const nextState = reduceReviewMenuState(reviewMenuStateRef.current, event);
    reviewMenuStateRef.current = nextState;
    setReviewMenuState(nextState);
  }, []);

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
      commitEditTarget(null);
    }
  }, [applyReviewMenuEvent, commitEditTarget]);

  const commitBootstrap = useCallback((bootstrap: MobileBootstrap) => {
    const serverOpenItemIds = new Set(
      bootstrap.reviewItems.filter(isOpenReviewItem).map((item) => item.id)
    );
    for (const [itemId, tombstone] of reviewTombstones.current) {
      if (tombstone.status === "succeeded" && !serverOpenItemIds.has(itemId)) {
        reviewTombstones.current.delete(itemId);
      }
    }
    commitData(
      hideTombstonedReviewItems(bootstrap, reviewTombstones.current.keys())
    );
  }, [commitData]);

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
    }
  }, [applyReviewMenuEvent, commitEditTarget]);

  const load = useCallback(async (options?: ReviewLoadOptions) => {
    if (refreshInFlight.current) {
      if (options?.queueIfBusy) bootstrapRefreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;
    if (!options?.preserveMenu) applyReviewMenuEvent({ type: "close" });
    if (options?.refresh) setRefreshing(true);
    try {
      commitBootstrap(await fetchBootstrap());
      if (options?.skipReprocess) return;
      const forceReprocess = options?.forceReprocess ?? !forcedReprocessComplete.current;
      if (forceReprocess) forcedReprocessComplete.current = true;
      const startedAt = new Date().toISOString();
      setReprocessDiagnostics((current) => ({
        ...current,
        startedAt,
        finishedAt: null,
        status: "running",
        error: null
      }));
      const reprocess = await withTimeout(
        reprocessExistingHealthReviewItems(undefined, { force: forceReprocess }),
        HEALTH_REPROCESS_TIMEOUT_MS
      );
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
        commitBootstrap(await fetchBootstrap());
      }
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "Health reprocess timed out.";
      setReprocessDiagnostics((current) => ({
        ...current,
        finishedAt: new Date().toISOString(),
        status: timedOut ? "timed_out" : "failed",
        error: error instanceof Error ? error.message : "Unable to reprocess Health review items."
      }));
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (!options?.silent && !timedOut) {
        Alert.alert("Review", error instanceof Error ? error.message : "Unable to load review items.");
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
  }, [applyReviewMenuEvent, commitBootstrap]);
  loadRef.current = load;

  useEffect(() => {
    void load({ forceReprocess: true });
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true;
      applyReviewMenuEvent({ type: "close" });
      void reloadThemePreference();
      void load({ silent: true, skipReprocess: true });
      return () => {
        screenFocusedRef.current = false;
        cancelPendingReviewHandover();
      };
    }, [
      applyReviewMenuEvent,
      cancelPendingReviewHandover,
      load,
      reloadThemePreference
    ])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState !== "active") {
        cancelPendingReviewHandover();
        return;
      }
      if (screenFocusedRef.current) {
        void load({
          preserveMenu: true,
          queueIfBusy: true,
          silent: true,
          skipReprocess: true
        });
      }
    });
    return () => subscription.remove();
  }, [cancelPendingReviewHandover, load]);

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

  useEffect(() => {
    if (reprocessRunning) cancelPendingReviewHandover();
  }, [cancelPendingReviewHandover, reprocessRunning]);

  function confirmItem(item: MobileReviewItem) {
    applyReviewMenuEvent({ type: "close" });
    resolveItem(item, async () => {
      if (hasV2LocationEvidence(item)) await resolveLocationReviewItem(item.id, { action: "confirm" });
      else await confirmReviewItem(item.id);
    }, "Suggestion confirmed.");
  }

  function dismissItem(item: MobileReviewItem) {
    resolveItem(item, async () => {
      if (hasV2LocationEvidence(item)) {
        await resolveLocationReviewItem(item.id, { action: "ignore_once_location" });
      } else await dismissReviewItem(item.id);
    }, "Suggestion dismissed.");
  }

  function toggleReviewMenu(item: MobileReviewItem) {
    applyReviewMenuEvent({
      type: "toggle",
      itemId: item.id,
      disabled: reprocessRunning || reviewMutations.current.has(item.id)
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
    action: () => Promise<void>,
    successAnnouncement: string
  ) {
    if (reviewMutations.current.has(item.id)) return;
    const currentData = dataRef.current;
    if (!currentData) return;
    const optimistic = removeReviewItemOptimistically(currentData, item.id);
    if (!optimistic) return;

    reviewMutationSequence.current += 1;
    const version = reviewMutationSequence.current;
    reviewMutations.current.set(item.id, version);
    reviewTombstones.current.set(item.id, { status: "pending", version });

    void applyOptimisticMutation<OptimisticReviewRemoval, void>(
      () => {
        commitData(optimistic.data);
        AccessibilityInfo.announceForAccessibility(successAnnouncement);
        return optimistic.removal;
      },
      action,
      (removal) => {
        if (reviewMutations.current.get(item.id) !== version) return;
        const tombstone = reviewTombstones.current.get(item.id);
        if (!tombstone || tombstone.version !== version) return;
        reviewMutations.current.delete(item.id);
        reviewTombstones.current.delete(item.id);
        const latestData = dataRef.current;
        if (latestData) {
          commitData(restoreReviewItemOptimistically(latestData, removal));
        }
        AccessibilityInfo.announceForAccessibility(
          "Suggestion restored because the action failed."
        );
      }
    ).then(() => {
      if (reviewMutations.current.get(item.id) !== version) return;
      const tombstone = reviewTombstones.current.get(item.id);
      if (!tombstone || tombstone.version !== version) return;
      reviewMutations.current.delete(item.id);
      reviewTombstones.current.set(item.id, {
        status: "succeeded",
        version
      });
      void load({
        preserveMenu: true,
        queueIfBusy: true,
        silent: true,
        skipReprocess: true
      });
    }).catch((error) => {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert(
        "Review",
        error instanceof Error ? error.message : "Unable to update this suggestion."
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
    return true;
  }

  function finishEditHandover() {
    const currentEditTarget = editTargetRef.current;
    if (currentEditTarget?.kind !== "reviewItem") return;
    applyReviewMenuEvent({
      type: "finish_action",
      itemId: currentEditTarget.item.id,
      token: currentEditTarget.handoverToken
    });
  }

  function cancelEdit() {
    const currentEditTarget = editTargetRef.current;
    if (currentEditTarget?.kind === "reviewItem") {
      applyReviewMenuEvent({
        type: "finish_action",
        itemId: currentEditTarget.item.id,
        token: currentEditTarget.handoverToken
      });
    }
    commitEditTarget(null);
  }

  function beginReviewNeededEntryEdit(entry: MobileTimeEntry) {
    commitEditTarget({ kind: "entry", entry });
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
        await saveEditedReviewItem(editTarget.item.id, {
          categoryId: patch.categoryId,
          description: patch.description,
          startedAt: patch.startedAt,
          stoppedAt: patch.stoppedAt
        }, { atomicLocation: hasV2LocationEvidence(editTarget.item) });
      } else {
        await updateTimeEntry(entryId, patch);
      }
      await load({ silent: true, skipReprocess: true });
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <MobileBackButton accessibilityLabel="Back" onPress={() => router.back()} />
          <DayframeBrand
            layout="compact"
            size="sm"
            tone={theme.mode === "dark" ? "light" : "dark"}
          />
        </View>
      </View>
      <ScrollView
        style={styles.settingsScrollView}
        contentContainerStyle={styles.settingsScrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ forceReprocess: true, refresh: true })}
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
                <ReviewDiagnosticsPanel diagnostics={reprocessDiagnostics} styles={styles} />
              </Reanimated.View>
            ) : null}
          </View>

          <View style={styles.lifecyclePanel}>
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
                      disabled={reprocessRunning}
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
          reprocessRunning ||
          reviewMenuState.pendingAction != null
        }
        onClose={() => applyReviewMenuEvent({ type: "close" })}
        onClosed={handleOverflowClosed}
        onSelect={selectOverflowAction}
        instanceId={overflowItemId}
        title={overflowTarget ? reviewItemTitle(overflowTarget) : "review suggestion"}
        visible={reviewMenuState.openItemId != null}
      />

      <ActiveTimerEditSheet
        categories={data?.categories ?? []}
        elapsedSeconds={editingEntry ? entryDurationSeconds(editingEntry, now) : 0}
        entry={editingEntry}
        focusDescriptionOnShow={editTarget?.kind === "reviewItem"}
        lastStoppedAt={null}
        mode="entry"
        onCancel={cancelEdit}
        onPresented={finishEditHandover}
        onSave={saveEdit}
        saving={editSaving}
        stopping={false}
        styles={styles}
        theme={theme}
        visible={Boolean(editingEntry)}
      />
    </SafeAreaView>
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
  const controlsDisabled = disabled;
  const contextLines = reviewItemContextLines(item, categoryName);

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewCardHeader}>
        <View style={styles.reviewTitleStack}>
          <Text style={styles.reviewTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.reviewMetaLine}>{formatReviewItemMeta(item, durationSeconds)}</Text>
          <Text style={styles.reviewMetaLine}>{formatReviewItemSource(item)}</Text>
        </View>
        <View style={styles.reviewBadge}>
          <Text style={styles.reviewBadgeText}>{REVIEW_COPY.needsReview}</Text>
        </View>
      </View>

      <View style={styles.calendarBlockTitleRow}>
        <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
        <Text style={styles.reviewMetaLine} numberOfLines={1}>
          {categoryName}
          {item.placeName ? ` · ${item.placeName}` : ""}
        </Text>
      </View>
      {item.notes && !hasV2LocationEvidence(item) ? (
        <Text style={styles.reviewMetaLine}>{item.notes}</Text>
      ) : null}
      {contextLines.map((line) => (
        <Text key={line} style={styles.reviewMetaLine}>{line}</Text>
      ))}

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

function ReviewDiagnosticsPanel({
  diagnostics,
  styles
}: {
  diagnostics: ReviewReprocessDiagnostics;
  styles: ReturnType<typeof useMobileTheme>["styles"];
}) {
  const result = diagnostics.result;
  const reasonPreview = result?.reasons?.slice(0, 3).map((reason) => reason.message) ?? [];

  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Health reprocess</Text>
      <Text style={styles.muted}>API: {diagnostics.apiBaseUrl}</Text>
      <Text style={styles.reviewMetaLine}>
        Status: {diagnostics.status}
        {diagnostics.startedAt ? ` · started ${formatDiagnosticsTime(diagnostics.startedAt)}` : ""}
        {diagnostics.finishedAt ? ` · finished ${formatDiagnosticsTime(diagnostics.finishedAt)}` : ""}
      </Text>
      {result ? (
        <Text style={styles.reviewMetaLine}>
          Confirmed {result.confirmedCount} · ignored {result.ignoredCount} · remaining {result.remainingReviewCount} · skipped {result.skippedCount} · failed {result.failedCount} · categories {result.updatedCategoryCount} · sleep fixes {result.repairedSleepEntryCount}
          {result.partial ? ` · batch ${result.batchSize ?? "partial"}` : ""}
        </Text>
      ) : null}
      {diagnostics.error ? (
        <Text style={styles.reviewMetaLine}>Last error: {diagnostics.error}</Text>
      ) : null}
      {reasonPreview.map((reason) => (
        <Text key={reason} style={styles.reviewMetaLine}>{reason}</Text>
      ))}
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
  const parts: string[] = [reviewItemKindLabel(item)];
  const timeWindow = formatReviewItemTimeWindow(item);
  if (timeWindow) parts.push(timeWindow);
  if (durationSeconds > 0) parts.push(formatDuration(durationSeconds));
  return parts.join(" · ");
}

function reviewItemKindLabel(item: MobileReviewItem) {
  if (item.eventType === "commute_detected") return "Commute";
  if (isOneOffLocationReviewItem(item)) return "One-off activity";
  if (isLocationReviewItem(item)) return REVIEW_COPY.detectedVisit;
  if (isHealthReviewItem(item)) return "Health import";
  return REVIEW_COPY.suggestedActivity;
}

function reviewItemContextLines(item: MobileReviewItem, categoryName: string) {
  if (hasV2LocationEvidence(item)) {
    return item.rawPayload?.continuityStatus === "uncertain_gap"
      ? ["Uncertain boundary · inspect evidence before confirming."]
      : [];
  }
  if (item.eventType === "commute_detected") {
    return [
      "Dayframe detected travel between places.",
      "Confirming creates a Commute time entry with no description."
    ];
  }

  if (!isLocationReviewItem(item)) return [];

  if (isOneOffLocationReviewItem(item)) {
    const confirmTarget = categoryName === "No category"
      ? "Confirming creates an uncategorized time entry. Edit first to choose a category or description."
      : `Confirming creates a ${categoryName} time entry. Edit first to change the category or add a description.`;
    return [
      "Dayframe detected one significant stay at this location.",
      "It is reviewable as time spent here, but it is not a suggestion to save this place.",
      confirmTarget
    ];
  }

  const match = item.suggestedPlaceId || item.placeName
    ? "Matched saved place"
    : item.eventType === "learned_place_visit"
      ? "Matched learned place"
      : "Unknown location";
  const confirmTarget = categoryName === "No category"
    ? "Confirming creates an uncategorized time entry. Edit first to choose a category or description."
    : `Confirming creates a ${categoryName} time entry. Edit first to change the category or add a description.`;
  return [
    "Dayframe detected a stay at this location.",
    `${match}. Needs review before time is logged.`,
    confirmTarget
  ];
}

function formatReviewItemSource(item: MobileReviewItem) {
  return `${formatSourceLabel(item.eventSource)} · ${formatConfidence(item.confidence)}`;
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
  return `${formatDateTime(startedAt)}-${formatTimeOfDay(stoppedAt)}`;
}

function formatSourceLabel(source: string | null) {
  switch (source) {
    case "health_sleep":
      return "Apple Health sleep";
    case "health_workout":
      return "Apple Health workout";
    case "geofence_specific":
    case "geofence_broad":
      return "Saved place visit";
    case "ha_geofence":
      return "Home Assistant place visit";
    case "location_learning":
      return "Location learning";
    case "calendar":
      return "Calendar hint";
    case "mobile_app":
      return "Mobile";
    default:
      return "Activity evidence";
  }
}

function formatConfidence(confidence: string) {
  return `${confidence.replace(/_/g, " ")} confidence`;
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

function formatDiagnosticsTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return formatTimeOfDay(date);
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
