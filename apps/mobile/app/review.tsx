import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { paletteColorFor } from "@dayframe/shared";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import {
  AuthRequiredError,
  confirmReviewItem,
  dismissReviewItem,
  fetchBootstrap,
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
import { pressable, useMobileTheme } from "@/lib/mobileTheme";
import {
  REVIEW_COPY,
  buildReviewItemDraftEntry,
  hasSuggestedTimeWindow,
  isOpenReviewItem,
  isReviewNeededEntry,
  reviewItemDurationSeconds
} from "@/lib/review";

type ReviewEditTarget =
  | { kind: "reviewItem"; item: MobileReviewItem; entry: MobileTimeEntry }
  | { kind: "entry"; entry: MobileTimeEntry };

type ReviewReprocessDiagnostics = {
  apiBaseUrl: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: "idle" | "running" | "success" | "partial" | "failed" | "timed_out";
  result: HealthReviewReprocessResult | null;
  error: string | null;
};

const HEALTH_REPROCESS_TIMEOUT_MS = 15_000;

export default function ReviewScreen() {
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<ReviewEditTarget | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [reprocessDiagnostics, setReprocessDiagnostics] = useState<ReviewReprocessDiagnostics>({
    apiBaseUrl: DAYFRAME_API_BASE,
    startedAt: null,
    finishedAt: null,
    status: "idle",
    result: null,
    error: null
  });
  const refreshInFlight = useRef(false);
  const forcedReprocessComplete = useRef(false);
  const now = Date.now();

  const load = useCallback(async (options?: { forceReprocess?: boolean; refresh?: boolean; silent?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (options?.refresh) setRefreshing(true);
    try {
      setData(await fetchBootstrap());
      const forceReprocess = options?.forceReprocess ?? !forcedReprocessComplete.current;
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
      forcedReprocessComplete.current = true;
      setReprocessDiagnostics((current) => ({
        ...current,
        finishedAt: new Date().toISOString(),
        status: reprocess.failedCount > 0 || reprocess.partial ? "partial" : "success",
        result: reprocess,
        error: reprocess.errorSummary[0] ?? null
      }));
      if (reprocess.confirmedCount > 0 || reprocess.ignoredCount > 0 || reprocess.updatedCategoryCount > 0) {
        setData(await fetchBootstrap());
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
    }
  }, []);

  useEffect(() => {
    void load({ forceReprocess: true });
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void reloadThemePreference();
      void load({ silent: true });
    }, [load, reloadThemePreference])
  );

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

  async function confirmItem(item: MobileReviewItem) {
    await resolveItem(item, async () => {
      await confirmReviewItem(item.id);
    });
  }

  async function dismissItem(item: MobileReviewItem) {
    await resolveItem(item, async () => {
      await dismissReviewItem(item.id);
    });
  }

  async function resolveItem(item: MobileReviewItem, action: () => Promise<void>) {
    setResolvingId(item.id);
    try {
      await action();
      await load({ silent: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Review", error instanceof Error ? error.message : "Unable to update this suggestion.");
    } finally {
      setResolvingId(null);
    }
  }

  function beginReviewItemEdit(item: MobileReviewItem) {
    const draftEntry = buildReviewItemDraftEntry(item, data?.categories ?? [], now);
    if (!draftEntry || !hasSuggestedTimeWindow(item)) {
      Alert.alert("Edit", "This suggested activity does not include a start and end time yet.");
      return;
    }
    setEditTarget({ kind: "reviewItem", item, entry: draftEntry });
  }

  function beginReviewNeededEntryEdit(entry: MobileTimeEntry) {
    setEditTarget({ kind: "entry", entry });
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
        });
      } else {
        await updateTimeEntry(entryId, patch);
      }
      await load({ silent: true });
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
      <ScrollView
        contentContainerStyle={styles.container}
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
          <View style={styles.settingsHeader}>
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              style={pressable(styles.iconButton, styles.buttonPressed)}
              onPress={() => router.back()}
            >
              <BackGlyph color={theme.accent} />
            </Pressable>
            <Image
              source={require("../assets/dayframe_logo_banner.png")}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>

          <View style={styles.panel}>
            <View style={styles.summaryHeader}>
              <View>
                <Text style={styles.label}>{REVIEW_COPY.needsReview}</Text>
                <Text style={styles.sectionTitle}>Review</Text>
              </View>
              <Text style={styles.summaryTotal}>{totalNeedsReview}</Text>
            </View>
            <Text style={styles.muted}>Suggested activity from Health and places stays here until it is confirmed.</Text>
          </View>

          <ReviewDiagnosticsPanel
            diagnostics={reprocessDiagnostics}
            styles={styles}
          />

          <View style={styles.lifecyclePanel}>
            <Text style={styles.sectionTitle}>{REVIEW_COPY.suggestedActivity}</Text>
            {totalNeedsReview === 0 ? (
              <Text style={styles.muted}>{REVIEW_COPY.emptyState}</Text>
            ) : null}
            {openReviewItems.length > 0 ? (
              <View style={styles.reviewList}>
                {openReviewItems.map((item) => (
                  <ReviewItemCard
                    key={item.id}
                    item={item}
                    loading={resolvingId === item.id}
                    now={now}
                    onConfirm={() => confirmItem(item)}
                    onDismiss={() => dismissItem(item)}
                    onEdit={() => beginReviewItemEdit(item)}
                    styles={styles}
                    theme={theme}
                  />
                ))}
              </View>
            ) : null}
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

      <ActiveTimerEditSheet
        categories={data?.categories ?? []}
        elapsedSeconds={editingEntry ? entryDurationSeconds(editingEntry, now) : 0}
        entry={editingEntry}
        lastStoppedAt={null}
        mode="entry"
        onCancel={() => setEditTarget(null)}
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
  item,
  loading,
  now,
  onConfirm,
  onDismiss,
  onEdit,
  styles,
  theme
}: {
  item: MobileReviewItem;
  loading: boolean;
  now: number;
  onConfirm: () => void;
  onDismiss: () => void;
  onEdit: () => void;
  styles: ReturnType<typeof useMobileTheme>["styles"];
  theme: ReturnType<typeof useMobileTheme>["theme"];
}) {
  const durationSeconds = reviewItemDurationSeconds(item, now);
  const categoryName = reviewItemCategoryName(item);
  const categoryColor = reviewItemCategoryColor(item, categoryName, theme.textSecondary);

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewCardHeader}>
        <View style={styles.reviewTitleStack}>
          <Text style={styles.reviewTitle} numberOfLines={2}>{item.title || REVIEW_COPY.suggestedActivity}</Text>
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
      {item.notes ? (
        <Text style={styles.reviewMetaLine}>{item.notes}</Text>
      ) : null}

      <View style={styles.reviewActions}>
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          style={({ pressed }) => [
            styles.reviewPrimaryButton,
            pressed && !loading ? styles.buttonPressed : null,
            loading ? styles.buttonDisabled : null
          ]}
          onPress={onConfirm}
        >
          <Text style={styles.primaryButtonText}>{REVIEW_COPY.confirm}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          style={({ pressed }) => [
            styles.reviewSecondaryButton,
            pressed && !loading ? styles.buttonPressed : null,
            loading ? styles.buttonDisabled : null
          ]}
          onPress={onEdit}
        >
          <Text style={styles.reviewSecondaryButtonText}>{REVIEW_COPY.edit}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          style={({ pressed }) => [
            styles.reviewSecondaryButton,
            pressed && !loading ? styles.buttonPressed : null,
            loading ? styles.buttonDisabled : null
          ]}
          onPress={onDismiss}
        >
          <Text style={styles.reviewSecondaryButtonText}>{REVIEW_COPY.dismiss}</Text>
        </Pressable>
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
          Confirmed {result.confirmedCount} · ignored {result.ignoredCount} · remaining {result.remainingReviewCount} · skipped {result.skippedCount} · failed {result.failedCount} · categories {result.updatedCategoryCount}
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
    categoryName
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
          <Text style={styles.reviewSecondaryButtonText}>{REVIEW_COPY.edit}</Text>
        </Pressable>
      </View>
      <Text style={styles.reviewMetaLine}>Confirm and dismiss are available for suggested activity.</Text>
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

function formatReviewItemMeta(item: MobileReviewItem, durationSeconds: number) {
  const parts: string[] = [REVIEW_COPY.suggestedActivity];
  const timeWindow = formatReviewItemTimeWindow(item);
  if (timeWindow) parts.push(timeWindow);
  if (durationSeconds > 0) parts.push(formatDuration(durationSeconds));
  return parts.join(" · ");
}

function formatReviewItemSource(item: MobileReviewItem) {
  return `${formatSourceLabel(item.eventSource)} · ${formatConfidence(item.confidence)}`;
}

function reviewItemCategoryName(item: MobileReviewItem) {
  return item.categoryName ?? (isHealthReviewItem(item) ? "Health" : "No category");
}

function reviewItemCategoryColor(item: MobileReviewItem, categoryName: string, fallbackColor: string) {
  if (item.categoryColor || item.suggestedCategoryId || isHealthReviewItem(item)) {
    return paletteColorFor(
      item.categoryColor ?? (isHealthReviewItem(item) ? "moss" : item.suggestedCategoryId),
      categoryName
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
      return "Place visit";
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

function BackGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M15 5 8 12l7 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
    </Svg>
  );
}
