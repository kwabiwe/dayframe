import { Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, PixelRatio, Pressable, ScrollView, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import type { MobileBootstrap, MobileTimeEntry } from "@/lib/api";
import {
  createDeletionCoordinator,
  type PendingDeletion
} from "@/lib/historyDeletion";
import { useMobileTheme } from "@/lib/mobileTheme";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useResolvedReduceMotionPreference
} from "@/lib/motion";
import {
  filterPendingDeletedTimeEntries,
  mobileTimeEntryById,
  optimisticPatchTimeEntry,
  optimisticStartTimer,
  optimisticStopActiveTimer,
  replaceOptimisticTimeEntryId,
  restoreEntriesWithPersistedIds
} from "@/lib/timerPresentation";
import type {
  TimeEntrySheetOpenReason,
  TimeEntrySheetPresentation
} from "@/lib/timeEntrySheetPresentation";

type FixtureMode = "running" | "entry" | "add";
type FixtureKey = "blank" | "existing" | "existing-blank" | "completed" | "add" | "review";
type MutationFailureMode = "save" | "stop" | "suggestion" | null;

const startedAt = "2026-08-07T17:00:00.000Z";
const stoppedAt = "2026-08-07T18:15:00.000Z";

const categories = [
  { id: "cat-focus", name: "Focus", color: "coral", isPinned: true },
  { id: "cat-admin", name: "Admin", color: "teal", isPinned: true },
  { id: "cat-home", name: "Home", color: "lavender", isPinned: false }
];

const tags = [
  { id: "tag-a24", name: "A24", normalizedName: "a24", usageCount: 8 },
  { id: "tag-launch", name: "Launch", normalizedName: "launch", usageCount: 4 }
];

const historyFixtures: MobileTimeEntry[] = Array.from({ length: 12 }, (_, index) => {
  const historyStoppedAt = new Date(Date.parse(stoppedAt) - (index + 1) * 86_400_000);
  const historyStartedAt = new Date(historyStoppedAt.getTime() - (index + 1) * 1_800_000);
  const tagNames = index % 3 === 0 ? ["A24", "Launch"] : [];
  return {
    ...fixtureEntry("completed"),
    id: `history-${index + 1}`,
    categoryId: index % 2 === 0 ? "cat-focus" : "cat-admin",
    categoryName: index % 2 === 0 ? "Focus" : "Admin",
    categoryColor: index % 2 === 0 ? "coral" : "teal",
    description: index === 0 ? "Bauhaus research" : `Historical task ${index + 1}`,
    durationSeconds: Math.floor((historyStoppedAt.getTime() - historyStartedAt.getTime()) / 1_000),
    startedAt: historyStartedAt.toISOString(),
    stoppedAt: historyStoppedAt.toISOString(),
    tagNames,
    tags: tagNames.map((name) => tags.find((tag) => tag.name === name) ?? {
      id: `fixture-${name}`,
      name,
      normalizedName: name.toLowerCase()
    })
  };
});

export default function SheetQaRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <SheetQaHarness />;
}

function SheetQaHarness() {
  const params = useLocalSearchParams<{
    fixture?: string;
    count?: string;
    failure?: string;
    open?: string;
    run?: string;
  }>();
  const { styles, theme } = useMobileTheme();
  const {
    reduceMotion,
    resolved: reduceMotionPreferenceResolved
  } = useResolvedReduceMotionPreference();
  const requestedFixture = fixtureKeyFromParam(params.fixture);
  const requestedCount = suggestionCountFromParam(params.count);
  const requestedFailure = mutationFailureModeFromParam(params.failure);
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>(requestedFixture);
  // Start closed so a deep-linked fixture never mounts Modal with presentation
  // generation zero. The reset effect publishes a valid monotonic generation
  // and visibility together, keeping Modal.onShow inside that generation.
  const [visible, setVisible] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(requestedCount);
  const [data, setData] = useState<MobileBootstrap>(() => fixtureBootstrap(requestedFixture));
  const dataRef = useRef(data);
  const serverBootstrapRef = useRef(data);
  const [selectedEntryId, setSelectedEntryId] = useState(
    fixtureEntry(requestedFixture).id
  );
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion<
    MobileTimeEntry,
    MobileBootstrap
  > | null>(null);
  const [durableMutationCount, setDurableMutationCount] = useState(0);
  const [restoreCount, setRestoreCount] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [canonicalReplacementCount, setCanonicalReplacementCount] = useState(0);
  const [newTimerCount, setNewTimerCount] = useState(0);
  const [secondDeletionCount, setSecondDeletionCount] = useState(0);
  const [mutationFailureMode, setMutationFailureMode] = useState<MutationFailureMode>(requestedFailure);
  const [mutationFailureCount, setMutationFailureCount] = useState(0);
  const persistedIdsRef = useRef(new Map<string, string>());
  const sheetDeletionRef = useRef<{ presentationId: number; token: number } | null>(null);
  const nextPresentationIdRef = useRef(0);
  const [presentationId, setPresentationId] = useState(0);
  const commitData = useCallback((update: MobileBootstrap | ((current: MobileBootstrap) => MobileBootstrap)) => {
    const next = typeof update === "function" ? update(dataRef.current) : update;
    dataRef.current = next;
    setData(next);
  }, []);
  const deletionCoordinator = useMemo(() => createDeletionCoordinator<
    MobileTimeEntry,
    MobileBootstrap
  >({
    onCommit: (committed) => {
      const committedIds = new Set(committed.entryIds);
      serverBootstrapRef.current = filterPendingDeletedTimeEntries(
        serverBootstrapRef.current,
        committedIds
      ) as MobileBootstrap;
      commitData((current) => filterPendingDeletedTimeEntries(
        current,
        committedIds
      ) as MobileBootstrap);
      setDurableMutationCount((count) => count + 1);
    },
    onPendingChange: setPendingDeletion,
    onRestore: ({ entries, snapshot }) => {
      commitData((current) => restoreEntriesWithPersistedIds(
        current,
        snapshot,
        entries.map((candidate) => candidate.id),
        persistedIdsRef.current
      ) as MobileBootstrap);
      const restoredId = entries[0]
        ? persistedIdsRef.current.get(entries[0].id) ?? entries[0].id
        : null;
      if (restoredId) setSelectedEntryId(restoredId);
      setRestoreCount((count) => count + 1);
    }
  }), [commitData]);
  const mode: FixtureMode = fixtureKey === "add" ? "add" : fixtureKey === "blank" || fixtureKey.startsWith("existing") ? "running" : "entry";
  const elapsedSeconds = mode === "running" ? 4_321 : 4_500;
  const entry = mobileTimeEntryById(data, selectedEntryId);
  const historicalEntries = useMemo(
    () => historyFixtures.slice(0, suggestionCount),
    [suggestionCount]
  );
  const presentation = useMemo<TimeEntrySheetPresentation>(() => ({
    id: presentationId,
    reason: openReasonForFixture(fixtureKey),
    requestDescriptionFocus: fixtureKey === "blank" || fixtureKey === "add" || fixtureKey === "review",
    allowSuggestionsOnFocus: true
  }), [fixtureKey, presentationId]);

  useEffect(() => () => deletionCoordinator.dispose(), [deletionCoordinator]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") deletionCoordinator.reconcileForeground();
    });
    return () => subscription.remove();
  }, [deletionCoordinator]);

  useEffect(() => {
    if (params.open !== "1") return;
    resetHarness(requestedFixture, requestedCount, requestedFailure);
  }, [params.open, params.run, requestedCount, requestedFailure, requestedFixture]);

  function openFixture(next: FixtureKey) {
    deletionCoordinator.invalidate();
    sheetDeletionRef.current = null;
    persistedIdsRef.current.clear();
    const nextData = fixtureBootstrap(next);
    serverBootstrapRef.current = nextData;
    commitData(nextData);
    setFixtureKey(next);
    setMutationFailureMode(null);
    setSelectedEntryId(fixtureEntry(next).id);
    nextPresentationIdRef.current += 1;
    setPresentationId(nextPresentationIdRef.current);
    setVisible(true);
  }

  function resetHarness(next: FixtureKey, count: number, failureMode: MutationFailureMode) {
    deletionCoordinator.invalidate();
    sheetDeletionRef.current = null;
    persistedIdsRef.current.clear();
    const nextData = fixtureBootstrap(next);
    serverBootstrapRef.current = nextData;
    commitData(nextData);
    setFixtureKey(next);
    setSelectedEntryId(fixtureEntry(next).id);
    setSuggestionCount(count);
    setDurableMutationCount(0);
    setRestoreCount(0);
    setRefreshCount(0);
    setCanonicalReplacementCount(0);
    setNewTimerCount(0);
    setSecondDeletionCount(0);
    setMutationFailureMode(failureMode);
    setMutationFailureCount(0);
    nextPresentationIdRef.current += 1;
    setPresentationId(nextPresentationIdRef.current);
    setVisible(true);
  }

  function prepareSheetDeletion(entryId: string) {
    if (sheetDeletionRef.current) return false;
    const snapshot = dataRef.current;
    const candidate = mobileTimeEntryById(snapshot, entryId);
    if (!candidate) return false;
    const prepared = deletionCoordinator.prepare([candidate], snapshot);
    if (!prepared) return false;
    sheetDeletionRef.current = {
      presentationId: presentation.id,
      token: prepared.token
    };
    commitData(filterPendingDeletedTimeEntries(
      snapshot,
      deletionCoordinator.pendingEntryIds()
    ) as MobileBootstrap);
    return true;
  }

  function completeSheetExit(dismissedPresentationId: number) {
    if (dismissedPresentationId !== presentation.id) return;
    const pendingSheetDeletion = sheetDeletionRef.current;
    if (pendingSheetDeletion?.presentationId === dismissedPresentationId) {
      sheetDeletionRef.current = null;
      deletionCoordinator.activate(pendingSheetDeletion.token);
    }
    setVisible(false);
  }

  function undoDeletion() {
    const pending = deletionCoordinator.current();
    if (pending?.phase === "active") deletionCoordinator.undo(pending.token);
  }

  function simulateRefresh() {
    commitData(filterPendingDeletedTimeEntries(
      serverBootstrapRef.current,
      deletionCoordinator.pendingEntryIds()
    ) as MobileBootstrap);
    setRefreshCount((count) => count + 1);
  }

  function replaceWithCanonicalId() {
    const pending = deletionCoordinator.current();
    const originalId = pending?.entries[0]?.id;
    if (!pending || !originalId) return;
    const canonicalId = `${originalId}:canonical`;
    if (!deletionCoordinator.registerPendingId(pending.token, canonicalId)) return;
    persistedIdsRef.current.set(originalId, canonicalId);
    serverBootstrapRef.current = replaceOptimisticTimeEntryId(
      serverBootstrapRef.current,
      originalId,
      canonicalId
    ) as MobileBootstrap;
    commitData((current) => replaceOptimisticTimeEntryId(
      current,
      originalId,
      canonicalId
    ) as MobileBootstrap);
    setCanonicalReplacementCount((count) => count + 1);
  }

  function startNewTimerDuringUndo() {
    const pending = deletionCoordinator.current();
    const deletedActiveId = pending?.snapshot.activeEntry?.id;
    if (pending && deletedActiveId && pending.entryIds.includes(deletedActiveId)) {
      deletionCoordinator.commit(pending.token);
    }
    const nextCount = newTimerCount + 1;
    const nextEntry: MobileTimeEntry = {
      ...fixtureEntry("existing"),
      id: `qa-new-running-${nextCount}`,
      description: `New timer ${nextCount}`
    };
    commitData((current) => optimisticStartTimer(current, nextEntry) as MobileBootstrap);
    setSelectedEntryId(nextEntry.id);
    setFixtureKey("existing");
    setNewTimerCount(nextCount);
    setVisible(false);
  }

  function prepareSecondDeletion() {
    const snapshot = dataRef.current;
    const candidate = (snapshot.historyEntries ?? []).find((entry) => (
      !deletionCoordinator.pendingEntryIds().has(entry.id)
    ));
    if (!candidate) return;
    const prepared = deletionCoordinator.prepare([candidate], snapshot);
    if (!prepared) return;
    commitData(filterPendingDeletedTimeEntries(
      dataRef.current,
      deletionCoordinator.pendingEntryIds()
    ) as MobileBootstrap);
    if (deletionCoordinator.activate(prepared.token)) {
      setSecondDeletionCount((count) => count + 1);
    }
  }

  const harnessStateJson = JSON.stringify({
    ready: true,
    fixture: fixtureKey,
    presentationId: presentation.id,
    presentationReason: presentation.reason,
    visible,
    selectedEntryId,
    visibleEntryId: entry?.id ?? null,
    startedAt: entry?.startedAt ?? null,
    stoppedAt: entry?.stoppedAt ?? null,
    pendingDeletionPhase: pendingDeletion?.phase ?? null,
    pendingDeletionToken: pendingDeletion?.token ?? null,
    pendingEntryIds: [...deletionCoordinator.pendingEntryIds()],
    activatedAt: pendingDeletion?.activatedAt ?? null,
    expiresAt: pendingDeletion?.expiresAt ?? null,
    preparedAt: pendingDeletion?.preparedAt ?? null,
    durableMutationCount,
    restoreCount,
    refreshCount,
    canonicalReplacementCount,
    newTimerCount,
    secondDeletionCount,
    mutationFailureMode,
    mutationFailureCount,
    reduceMotion,
    fontScale: PixelRatio.getFontScale(),
    theme: theme.mode
  });

  return (
    <SafeAreaView style={styles.safeArea} testID="sheet-qa-root">
      <Text
        accessible
        accessibilityLabel={harnessStateJson}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 100,
          height: 1,
          width: 1,
          fontSize: 1,
          lineHeight: 1,
          opacity: 0.01
        }}
        testID="sheet-qa-harness-state"
      >
        {harnessStateJson}
      </Text>
      <ScrollView contentContainerStyle={{ gap: 12, padding: 20 }}>
        <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: "700" }}>
          Time-entry sheet QA
        </Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 18 }}>
          Development-only deterministic fixtures using the production sheet.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {([
            ["blank", "Open blank Play"],
            ["existing", "Open existing timer"],
            ["existing-blank", "Open existing blank timer"],
            ["completed", "Open completed entry"],
            ["add", "Open Add past time"],
            ["review", "Open Review edit"]
          ] as const).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityLabel={label}
              accessibilityRole="button"
              onPress={() => openFixture(key)}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                borderRadius: 999,
                backgroundColor: pressed ? theme.accentSoft : theme.surfaceRaised,
                paddingHorizontal: 14
              })}
              testID={`sheet-qa-open-${key}`}
            >
              <Text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: "600" }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[1, 6, 12].map((count) => (
            <Pressable
              key={count}
              accessibilityLabel={`Use ${count} historical suggestions`}
              accessibilityRole="button"
              onPress={() => setSuggestionCount(count)}
              style={{
                minHeight: 44,
                justifyContent: "center",
                borderRadius: 999,
                backgroundColor: suggestionCount === count ? theme.accent : theme.surfaceRaised,
                paddingHorizontal: 14
              }}
              testID={`sheet-qa-count-${count}`}
            >
              <Text style={{ color: suggestionCount === count ? theme.onAccent : theme.textPrimary, fontSize: 13, fontWeight: "600" }}>
                {count} results
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {([
            ["refresh", "Refresh pending data", simulateRefresh],
            ["canonical", "Replace with canonical ID", replaceWithCanonicalId],
            ["second-delete", "Delete a second entry", prepareSecondDeletion],
            ["new-timer", "Start a new timer", startNewTimerDuringUndo]
          ] as const).map(([key, label, action]) => (
            <Pressable
              key={key}
              accessibilityLabel={label}
              accessibilityRole="button"
              onPress={action}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                borderRadius: 999,
                backgroundColor: pressed ? theme.accentSoft : theme.surfaceRaised,
                paddingHorizontal: 14
              })}
              testID={`sheet-qa-${key}`}
            >
              <Text style={{ color: theme.textPrimary, fontSize: 13, fontWeight: "600" }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {pendingDeletion?.phase === "active" ? (
        <Reanimated.View
          accessibilityLiveRegion="polite"
          entering={localPresenceEntering(reduceMotion, "rise")}
          exiting={localPresenceExiting(reduceMotion)}
          layout={localLayoutTransition(reduceMotion)}
          style={styles.historyDeleteUndoToast}
          testID="deletion-undo-toast"
        >
          <Text style={styles.historyDeleteUndoText}>Time entry deleted</Text>
          <Pressable
            accessibilityLabel="Undo deleting time entries"
            accessibilityRole="button"
            onPress={undoDeletion}
            style={({ pressed }) => [
              styles.historyDeleteUndoButton,
              pressed ? styles.buttonPressed : null
            ]}
            testID="deletion-undo-action"
          >
            <Text style={styles.historyDeleteUndoButtonText}>Undo</Text>
          </Pressable>
        </Reanimated.View>
      ) : null}

      {reduceMotionPreferenceResolved ? <ActiveTimerEditSheet
        categories={categories}
        debugTelemetry
        elapsedSeconds={elapsedSeconds}
        entry={entry}
        historicalEntries={historicalEntries}
        lastStoppedAt="2026-08-07T16:45:00.000Z"
        mode={mode}
        onApplySuggestion={async (_entryId, suggestion) => {
          if (mutationFailureMode === "suggestion") {
            setMutationFailureCount((count) => count + 1);
            return false;
          }
          commitData((current) => optimisticPatchTimeEntry(current, selectedEntryId, {
            categoryId: suggestion.categoryId,
            description: suggestion.description,
            tagNames: suggestion.tagNames
          }) as MobileBootstrap);
          return true;
        }}
        onCancel={completeSheetExit}
        onDelete={async (entryId) => prepareSheetDeletion(entryId)}
        onSave={async (_entryId, patch) => {
          if (mutationFailureMode === "save") {
            setMutationFailureCount((count) => count + 1);
            return false;
          }
          commitData((current) => optimisticPatchTimeEntry(
            current,
            selectedEntryId,
            patch
          ) as MobileBootstrap);
          return true;
        }}
        onStop={mode === "running" ? async () => {
          if (mutationFailureMode === "stop") {
            setMutationFailureCount((count) => count + 1);
            return false;
          }
          commitData((current) => optimisticStopActiveTimer(
            current,
            stoppedAt
          ) as MobileBootstrap);
          return true;
        } : undefined}
        presentation={presentation}
        reduceMotion={reduceMotion}
        saving={false}
        stopping={false}
        styles={styles}
        tags={tags}
        theme={theme}
        visible={visible}
      /> : null}
    </SafeAreaView>
  );
}

function openReasonForFixture(key: FixtureKey): TimeEntrySheetOpenReason {
  if (key === "blank") return "blank_timer_started";
  if (key === "existing" || key === "existing-blank") return "existing_active_timer";
  if (key === "completed") return "completed_entry";
  if (key === "add") return "add_past_time";
  return "review_edit";
}

function fixtureKeyFromParam(value: string | undefined): FixtureKey {
  if (value === "existing" || value === "existing-blank" || value === "completed" || value === "add" || value === "review") {
    return value;
  }
  return "blank";
}

function suggestionCountFromParam(value: string | undefined) {
  const parsed = Number(value);
  return parsed === 1 || parsed === 12 ? parsed : 6;
}

function mutationFailureModeFromParam(value: string | undefined): MutationFailureMode {
  return value === "save" || value === "stop" || value === "suggestion" ? value : null;
}

function fixtureBootstrap(key: FixtureKey): MobileBootstrap {
  const selected = fixtureEntry(key);
  const entries = [selected, ...historyFixtures];
  return {
    user: {
      id: "qa-user",
      email: "qa@example.invalid",
      name: "Sheet QA"
    },
    workspace: { id: "qa-workspace", name: "Sheet QA" },
    activeEntry: selected.stoppedAt ? null : selected,
    projects: [],
    categories,
    tags,
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    places: [],
    reviewItems: []
  };
}

function fixtureEntry(key: FixtureKey): MobileTimeEntry {
  const isRunning = key === "blank" || key === "existing" || key === "existing-blank";
  const description = key === "existing" ? "Existing focused work" : key === "blank" || key === "existing-blank" ? null : key === "add" ? null : key === "review" ? "Review suggested window" : "Completed design work";
  return {
    id: `fixture-${key}`,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: key === "blank" || key === "existing-blank" || key === "add" ? null : "cat-focus",
    categoryName: key === "blank" || key === "existing-blank" || key === "add" ? null : "Focus",
    categoryColor: key === "blank" || key === "existing-blank" || key === "add" ? null : "coral",
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: key === "review" ? "needs_review" : "confirmed",
    description,
    startedAt,
    stoppedAt: isRunning ? null : stoppedAt,
    durationSeconds: isRunning ? 4_321 : 4_500,
    tagNames: [],
    tags: []
  };
}
