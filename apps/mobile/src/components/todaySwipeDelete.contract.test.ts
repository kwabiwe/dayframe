/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DELETION_UNDO_MS } from "../lib/historyDeletion";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);
const rowsSource = readFileSync(
  fileURLToPath(new URL("./today/TodayBlockRows.tsx", import.meta.url)),
  "utf8"
);
const timerSurfaceSource = readFileSync(
  fileURLToPath(new URL("./accessibility/TodayTimerSurface.tsx", import.meta.url)),
  "utf8"
);
const idleCardSource = readFileSync(
  fileURLToPath(new URL("./today/TodayIdleCard.tsx", import.meta.url)),
  "utf8"
);
const mobileThemeSource = readFileSync(
  fileURLToPath(new URL("../lib/mobileTheme.ts", import.meta.url)),
  "utf8"
);

describe("Today rows swipe-to-delete contract", () => {
  it("swipes rows with one UI-thread Pan whose underlay is revealed by the moving row", () => {
    expect(rowsSource).toContain("Gesture.Pan()");
    expect(rowsSource).toContain(".activeOffsetX([-8, 8])");
    expect(rowsSource).toContain(".failOffsetY([-10, 10])");
    expect(rowsSource).toContain("useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }))");
    expect(rowsSource).not.toContain("ReanimatedSwipeable");
    expect(rowsSource).not.toContain("LayoutAnimation");
  });

  it("uses the semantic brand danger colours for the Delete underlay and coral for Start again", () => {
    expect(rowsSource).toContain("backgroundColor: theme.danger");
    expect(rowsSource).toContain("color={theme.onDanger} glyph={DAYFRAME_APP_ICONS.delete}");
    expect(rowsSource).toContain("backgroundColor: theme.accent");
  });

  it("deletes directly from the list without a confirmation step", () => {
    const historyRenderSource = dashboardSource.slice(
      dashboardSource.indexOf("renderItem={({ item }) =>"),
      dashboardSource.indexOf("ItemSeparatorComponent")
    );

    expect(historyRenderSource).toContain("onDeleteEntries={scheduleHistoryDeletion}");
    expect(historyRenderSource).not.toContain("Alert.alert");
    expect(dashboardSource).not.toContain("historyDeleteEntries");
  });

  it("keeps Start again functional as an explicit switch while another timer runs", () => {
    expect(rowsSource).toContain('activeTimerRunning ? `Switch to ${title}` : "Start again"');
    expect(rowsSource).toContain("const replayable = !live && canStartAgain(entry)");
    expect(dashboardSource).toContain("!isActiveEntryPendingDeletion()");
  });

  it("allows immediate grouped deletion with a temporary undo action", () => {
    expect(rowsSource).toContain("onDeleteEntries(group.entries.map(({ entry }) => entry))");
    expect(dashboardSource).toContain("time entries deleted");
    expect(dashboardSource).toContain("undoDeletion");
    expect(DELETION_UNDO_MS).toBe(5_000);
    expect(dashboardSource).toContain("createDeletionCoordinator");
    expect(dashboardSource).toContain("coordinator.prepare(entries, snapshot)");
    expect(dashboardSource).toContain("coordinator.activate(prepared.token)");
  });

  it("exposes VoiceOver Delete through the existing undoable callback for exact completed entries", () => {
    expect(rowsSource).toContain('name: "delete"');
    expect(rowsSource).toContain('event.nativeEvent.actionName === "delete" && deletable');
    expect(rowsSource).toContain("deletable={canDeleteGroup(group)}");
    expect(rowsSource).toContain("deletable={Boolean(entry.stoppedAt)}");
    expect(rowsSource).toContain("onDelete={() => onDeleteEntries([entry])}");
    expect(dashboardSource).toContain("coordinator.prepare(entries, snapshot)");
    expect(rowsSource).not.toContain("Alert.alert");
  });

  it("omits row overlap copy", () => {
    expect(rowsSource).not.toContain("Overlap");
    expect(rowsSource).not.toMatch(/overlaps? (other|with)/i);
  });

  it("uses the shared tombstone filter for refresh and optimistic state", () => {
    expect(dashboardSource).toContain("filterPendingDeletedTimeEntries(");
    expect(dashboardSource).toContain("deletionCoordinator.current?.pendingEntryIds()");
    expect(dashboardSource).toContain("registerPendingId(");
    expect(dashboardSource).toContain("reconcileForeground()");
  });

  it("commits pending active deletion when bootstrap or Shortcut sync reveals another timer", () => {
    const loadSource = dashboardSource.slice(
      dashboardSource.indexOf("const load = useCallback"),
      dashboardSource.indexOf("loadRef.current = load")
    );

    expect(dashboardSource).toContain("function reconcilePendingActiveDeletionWithExternalActiveEntry(");
    expect(dashboardSource).toContain("coordinator.reconcileExternalActiveEntry({");
    expect(dashboardSource).toContain("deferredExternalActiveEntryIds()");
    expect(loadSource).toContain("await syncQueueWithTimerReconciliation()");
    expect(dashboardSource).toContain(
      "async function reconcileDashboardDeletionState(bootstrap: MobileBootstrap)"
    );
    expect(dashboardSource).toContain("bootstrap.activeEntry?.id ?? null");
    expect(loadSource).toContain("reconcile: reconcileDashboardDeletionState");
    expect(loadSource.indexOf("reconcileDashboardRefreshCandidate({")).toBeGreaterThan(
      loadSource.indexOf("await syncQueueWithTimerReconciliation()")
    );
    expect(dashboardSource).toContain("await resolveTimerEntryIdAfterQueueBarrier(localId)");
  });

  it("persists sheet deletion before projection and activates Undo only after visual exit", () => {
    const prepareSource = dashboardSource.slice(
      dashboardSource.indexOf("async function prepareSheetDeletion("),
      dashboardSource.indexOf("function activateSheetDeletion(")
    );
    const activeExitSource = dashboardSource.slice(
      dashboardSource.indexOf("function completeActiveEditorExit("),
      dashboardSource.indexOf("function completeManualEntryExit(")
    );
    const completedExitSource = dashboardSource.slice(
      dashboardSource.indexOf("function completeCalendarEntryExit("),
      dashboardSource.indexOf("function nextTimerMutationVersion(")
    );

    expect(prepareSource).toContain("coordinator.prepare([entry], snapshot)");
    expect(prepareSource).toContain("await persistPreparedDeletion([entry], snapshot, prepared.token)");
    expect(prepareSource.indexOf("await persistPreparedDeletion(")).toBeLessThan(
      prepareSource.indexOf("filterPendingDeletedTimeEntries(")
    );
    expect(prepareSource).toContain("filterPendingDeletedTimeEntries(");
    expect(prepareSource).not.toContain(".activate(");
    expect(activeExitSource).toContain("activateSheetDeletion(activeSheetDeletionToken, presentationId)");
    expect(completedExitSource).toContain("activateSheetDeletion(calendarSheetDeletionToken, presentationId)");
  });

  it("keeps editor snapshots and elapsed presentation alive through coordinated exit", () => {
    expect(dashboardSource).toContain("if (activeEditPresentation) return undefined");
    expect(dashboardSource).toContain("entry={retainedActiveEntryForSheet}");
    expect(dashboardSource).toContain("elapsedSeconds={displayedActiveDurationSeconds}");
    expect(dashboardSource).toContain("dashboardActiveTimerEntry({");
    expect(dashboardSource).toContain("pendingDeletionEntryIds");
    expect(dashboardSource).not.toContain("if (!activeEntryForDisplay && activeEditVisible)");
  });

  it("commits an undoable active deletion before starting or switching timers", () => {
    const startSource = dashboardSource.slice(
      dashboardSource.indexOf("async function startTaskWith("),
      dashboardSource.indexOf("async function saveActiveTimerEdit(")
    );
    expect(startSource).toContain("commitPendingActiveDeletionBeforeTimerStart()");
    expect(dashboardSource).toContain("coordinator.commit(pending.token)");
    expect(dashboardSource).toContain("restoreFailedDeletionSafely(");
  });

  it("synchronously gates same-tick blank Play before creating its canonical optimistic start", () => {
    const startSource = dashboardSource.slice(
      dashboardSource.indexOf("async function startTask("),
      dashboardSource.indexOf("function startBlankTask()")
    );
    const canonicalStartSource = dashboardSource.slice(
      dashboardSource.indexOf("async function startTaskWith("),
      dashboardSource.indexOf("function rejectOptimisticTimerStart(")
    );
    const stateUpdateSource = dashboardSource.slice(
      dashboardSource.indexOf("function updateDashboardData("),
      dashboardSource.indexOf("function createSheetPresentation(")
    );

    expect(startSource).toContain("blankTimerStartGate.current.current()");
    expect(startSource).toContain("const blankStartToken = blankTimerStartGate.current.claim()");
    expect(startSource.indexOf("blankTimerStartGate.current.claim()")).toBeLessThan(
      startSource.indexOf("await startTaskWith(")
    );
    expect(canonicalStartSource).toContain("blankTimerStartGate.current.bindEntry(");
    expect(stateUpdateSource.indexOf("latestData.current = next")).toBeLessThan(
      stateUpdateSource.indexOf("setData(next)")
    );
  });

  it("invalidates deletion and dependent optimistic work when start permanently fails", () => {
    const rejectionSource = dashboardSource.slice(
      dashboardSource.indexOf("function rejectOptimisticTimerStart("),
      dashboardSource.indexOf("async function saveActiveTimerEdit(")
    );
    const saveSource = dashboardSource.slice(
      dashboardSource.indexOf("async function saveTimeEntryOptimistically("),
      dashboardSource.indexOf("async function deleteCalendarEntry(")
    );
    const stopSource = dashboardSource.slice(
      dashboardSource.indexOf("async function stopActiveTimer("),
      dashboardSource.indexOf("async function deleteActiveTimer(")
    );

    expect(rejectionSource).toContain("invalidatePendingEntry(optimisticId)");
    expect(rejectionSource).toContain("nextTimerMutationVersion(optimisticId)");
    expect(rejectionSource).toContain("rollbackRejectedOptimisticTimerStart(");
    expect(rejectionSource).toContain("rejectedOptimisticStartExit.current.schedule(");
    expect(rejectionSource).toContain("setActiveEditDismissRequestId(failedPresentation.id)");
    expect(rejectionSource).not.toContain("setActiveEditPresentation(null)");
    expect(saveSource).toContain("await enqueueTimeEntryUpdate({");
    expect(saveSource.indexOf("await enqueueTimeEntryUpdate({")).toBeLessThan(
      saveSource.indexOf("optimisticPatchTimeEntry(")
    );
    expect(saveSource).toContain("return true");
    expect(stopSource).toContain("await persistPendingTimerStop(");
    expect(stopSource.indexOf("await persistPendingTimerStop(")).toBeLessThan(
      stopSource.indexOf("optimisticStopActiveTimer(")
    );
    expect(stopSource.indexOf('pendingStop.failureKind === "permanent"')).toBeLessThan(
      stopSource.indexOf("optimisticStopActiveTimer(")
    );
    expect(stopSource).toContain("Open Settings > Sync & diagnostics to retry or discard");
    expect(stopSource).toContain("void (async () => {");
    expect(stopSource).toContain("const summary = await deliverOwnedPendingTimerStops(bootstrap");
    expect(stopSource).toContain("summary.permanentRejectedClientEventIds.includes(");
    expect(stopSource).toContain("rollbackOptimisticStopSafely(");
    expect(stopSource).toContain("return true");
    expect(stopSource).not.toContain("queueStopTimer(");
    expect(stopSource).not.toContain("stopTimer(");
    expect(dashboardSource).not.toContain("rollbackOptimisticTimeEntryPatch(");
    expect(dashboardSource).not.toContain("updateDashboardData(() => previousData)");
  });

  it("serializes queue sync with dependent edits while Stop durability stays independent", () => {
    const syncSource = dashboardSource.slice(
      dashboardSource.indexOf("async function syncQueueWithTimerReconciliation()"),
      dashboardSource.indexOf("const syncQueuedEvents = useCallback")
    );
    const mutationQueueSource = dashboardSource.slice(
      dashboardSource.indexOf("function serializeTimerPersistence"),
      dashboardSource.indexOf("const syncQueuedEventsAndReload")
    );

    expect(syncSource).toContain("return serializeTimerPersistence(");
    expect(mutationQueueSource).toContain("timerMutationQueue.current.enqueue(operation)");
    expect(mutationQueueSource).toContain("serializeTimerPersistence(operation)");
    expect(dashboardSource).toContain("resolveTimerEntryIdAfterQueueBarrier(entryId)");
    expect(dashboardSource).toContain("await synchronisePendingTimerStops({ owner, correlations })");
  });

  it("keeps the blank Play generation gated across RAF until the sheet is presented", () => {
    const startSource = dashboardSource.slice(
      dashboardSource.indexOf("async function startTask("),
      dashboardSource.indexOf("function startBlankTask()")
    );
    const presentationSource = dashboardSource.slice(
      dashboardSource.indexOf("function completeActiveEditorPresentation("),
      dashboardSource.indexOf("function completeManualEntryExit(")
    );
    const frameSource = startSource.slice(
      startSource.indexOf("activeEditorOpenFrame.current = requestAnimationFrame"),
      startSource.indexOf("return true;")
    );

    expect(startSource).toContain('presentActiveEditor("blank_timer_started", true)');
    expect(frameSource).not.toContain("blankTimerStartGate.current.release(blankStartToken)");
    expect(presentationSource).toContain('presentation.reason !== "blank_timer_started"');
    expect(presentationSource).toContain("blankTimerStartGate.current.release(blankStart.token)");
    expect(dashboardSource).toContain("onPresented={completeActiveEditorPresentation}");
    expect(idleCardSource).toContain('accessibilityLabel="Start a block"');
    expect(timerSurfaceSource).toContain("onStartBlank={onStartBlank}");
  });

  it("limits conservative disposal to account/provider boundaries", () => {
    const accountBoundarySource = dashboardSource.slice(
      dashboardSource.indexOf("const transitionToSignedOut"),
      dashboardSource.indexOf("useEffect(() => subscribeMobileSignedOut")
    );
    const activeExitSource = dashboardSource.slice(
      dashboardSource.indexOf("function completeActiveEditorExit("),
      dashboardSource.indexOf("function completeManualEntryExit(")
    );

    expect(accountBoundarySource).toContain("deletionCoordinator.current?.dispose()");
    expect(activeExitSource).toContain("activateSheetDeletion(");
    expect(activeExitSource).not.toContain(".dispose()");
  });

  it("uses one local Reanimated owner for presence and surrounding reflow", () => {
    expect(dashboardSource).toContain("itemLayoutAnimation={localLayoutTransition(reduceMotion)}");
    expect(dashboardSource).toContain("exiting={localPresenceExiting(reduceMotion)}");
  });

  it("renders the undo notice as an inverse bean with a branded action", () => {
    const toastStyle = mobileThemeSource.slice(
      mobileThemeSource.indexOf("historyDeleteUndoToast:"),
      mobileThemeSource.indexOf("accountValue:")
    );

    expect(toastStyle).toContain("backgroundColor: theme.textPrimary");
    expect(toastStyle).toContain("borderRadius: 999");
    expect(toastStyle).toContain("color: theme.background");
    expect(toastStyle).toContain("backgroundColor: theme.accent");
    expect(toastStyle).toContain("color: theme.onAccent");
  });
});
