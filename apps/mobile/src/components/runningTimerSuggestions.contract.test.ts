/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const editSheetSource = source("./ActiveTimerEditSheet.tsx");
const overlaySource = source("./HistoricalSuggestionsOverlay.tsx");
const swipeSource = source("./SwipeDismissSheet.tsx");
const themeSource = source("../lib/mobileTheme.ts");
const dashboardSource = source("./DayframeDashboard.tsx");
const reviewSource = source("../../app/review.tsx");
const qaSource = source("../../app/sheet-qa.tsx");
const qaHarnessSource = source("../../ios/DayframeSheetQATests/SheetQAHarness.swift");

describe("time-entry sheet historical Suggestions contract", () => {
  it("floats a bounded, internally scrolling overlay after the stable form", () => {
    const overlayIndex = editSheetSource.indexOf("<HistoricalSuggestionsOverlay\n");
    const formCloseIndex = editSheetSource.lastIndexOf("</ScrollView>", overlayIndex);
    const pinnedRunningHeroIndex = editSheetSource.indexOf("{isRunningMode ? timeEntryHero : null}");
    const formIndex = editSheetSource.indexOf("testID=\"time-entry-sheet-form\"");

    expect(overlayIndex).toBeGreaterThan(-1);
    expect(formCloseIndex).toBeGreaterThan(-1);
    expect(formCloseIndex).toBeLessThan(overlayIndex);
    expect(pinnedRunningHeroIndex).toBeGreaterThan(-1);
    expect(pinnedRunningHeroIndex).toBeLessThan(formIndex);
    expect(themeSource).toMatch(/historicalSuggestionsOverlay:\s*\{[\s\S]*?position: "absolute"/);
    expect(themeSource).toMatch(/historicalSuggestionsOverlay:\s*\{[\s\S]*?backgroundColor: "transparent"/);
    expect(themeSource).toMatch(/historicalSuggestionsSurface:\s*\{[\s\S]*?backgroundColor: theme\.surfaceRaised[\s\S]*?borderWidth: 1[\s\S]*?borderColor: theme\.borderStrong[\s\S]*?borderRadius: 14[\s\S]*?overflow: "hidden"/);
    expect(themeSource).toMatch(/historicalSuggestionsHeader:\s*\{[\s\S]*?backgroundColor: theme\.surfaceMuted/);
    expect(themeSource).toMatch(/historicalSuggestionsList:\s*\{[\s\S]*?backgroundColor: "transparent"[\s\S]*?flexShrink: 1[\s\S]*?minHeight: 0/);
    expect(themeSource).not.toContain("historicalSuggestionsBackground");
    expect(themeSource).toMatch(/activeEditBodyKeyboard:\s*\{[\s\S]*?flex: 1[\s\S]*?minHeight: 0/);
    expect(themeSource).toMatch(/activeEditPinnedHeroRow:\s*\{[\s\S]*?flexShrink: 0/);
    expect(overlaySource).toContain("<ScrollView");
    expect(overlaySource).toContain("resolveHistoricalSuggestionsOverlayHeight");
    expect(overlaySource).toContain("resolveHistoricalSuggestionsOverlayMotionAction({");
    expect(overlaySource).toContain('motionAction === "hold_visible_update"');
    expect(overlaySource).toContain("opacity: paintableContent ? progress : 0");
    expect(overlaySource).toContain("const retainedRenderedHeight");
    expect(overlaySource).toContain("recordHistoricalSuggestionsOverlayContinuity(");
    expect(overlaySource).toContain("if (!geometry || geometry.maxHeight <= 0) return null;");
    expect(overlaySource).not.toContain("if (!mounted || !geometry");
    expect(overlaySource).toContain("pointerEvents={containerVisible ? \"auto\" : \"none\"}");
    expect(overlaySource).toContain("onRenderStateChangeRef.current({");
    expect(overlaySource).toContain("historical-suggestions-content-${contentKey}");
    expect(overlaySource).toContain("showsVerticalScrollIndicator");
    expect(overlaySource).toContain("useNativeDriver: true");
    expect(overlaySource).not.toContain("OVERLAY_HEADER_HEIGHT");
    expect(editSheetSource).not.toMatch(/Animated\.timing\([^)]*height/);
    expect(editSheetSource).toContain("resolveTimeEntrySheetLocalGeometry");
    expect(editSheetSource).toContain("contentOffset: contentScrollOffsetRef.current");
    expect(editSheetSource).toContain('testID="time-entry-sheet-form"');
    expect(editSheetSource).not.toContain("scrollEnabled={false}");
    expect(editSheetSource).toContain("localGeometry.overlayBottomBoundary - keyboardInsetRef.current");
    expect(editSheetSource).toContain("topBoundary: localGeometry.overlayTopBoundary");
    expect(editSheetSource).not.toContain("measureInWindow");
  });

  it("keeps keyboard frames flowing into the fixed-sheet handoff", () => {
    const freezeSource = editSheetSource.slice(
      editSheetSource.indexOf("function freezeKeyboardMotion"),
      editSheetSource.indexOf("function releaseKeyboardMotion")
    );
    expect(freezeSource).toContain("keyboardMotionFrozen.current = false");
    expect(freezeSource).toContain("dismissTransientEditingSurfaces()");
    expect(freezeSource).not.toContain("animatedSheetHeight.stopAnimation()");
    const releaseSource = editSheetSource.slice(
      editSheetSource.indexOf("function releaseKeyboardMotion"),
      editSheetSource.indexOf("function commitSheetDismissal")
    );
    expect(releaseSource).toContain("keyboardMotionFrozen.current = false");
    expect(releaseSource).not.toContain("applyKeyboardUpdateRef.current(");
  });

  it("removes only post-Description siblings from native traversal while Suggestions obscure them", () => {
    expect(editSheetSource).toMatch(
      /historicalSuggestionsObscureFormAccessibility\(\s*sheetState,\s*Boolean\(overlayGeometry && overlayGeometry\.maxHeight > 0\)/
    );
    expect(editSheetSource).toContain(
      "accessibilityElementsHidden={suggestionsObscureFormAccessibility}"
    );
    expect(editSheetSource).toContain(
      'suggestionsObscureFormAccessibility ? "no-hide-descendants" : "auto"'
    );
    expect(editSheetSource).toContain('testID="time-entry-sheet-obscured-form-content"');
    expect(editSheetSource).toContain('testID="time-entry-description-obscured-footer"');
    expect(editSheetSource).toContain('"time-entry-category-clear"');
    expect(editSheetSource).toContain(
      "obscuredFormAccessibilityHidden: suggestionsObscureFormAccessibility"
    );
    expect(editSheetSource.indexOf('testID="time-entry-description"')).toBeLessThan(
      editSheetSource.indexOf("accessibilityElementsHidden={suggestionsObscureFormAccessibility}")
    );
    expect(editSheetSource.indexOf('testID="time-entry-sheet-stop"')).toBeLessThan(
      editSheetSource.indexOf('testID="time-entry-sheet-form"')
    );
    const overlayIndex = editSheetSource.indexOf(
      "<HistoricalSuggestionsOverlay",
      editSheetSource.indexOf('testID="time-entry-sheet-form"')
    );
    expect(editSheetSource.indexOf('testID="time-entry-sheet-form"')).toBeLessThan(overlayIndex);
  });

  it("derives Suggestions from raw history at the sheet boundary", () => {
    expect(editSheetSource).toContain("buildHistoricalEntrySuggestions(normalizedHistoricalEntries");
    expect(editSheetSource).toContain("tagNames: candidate.tagNames ?? candidate.tags?.map");
    expect(editSheetSource).toContain("currentEntryId: entry?.id ?? null");
    expect(editSheetSource).toContain("query: description");
    expect(editSheetSource).toContain("queryActive: value.trim().length > 0");
    expect(editSheetSource).toContain("const HISTORICAL_SUGGESTION_LIMIT = 12");
    expect(editSheetSource).toContain("historicalSuggestionResultSignature");
    expect(editSheetSource).not.toContain("[historicalSuggestions.length");
    expect(editSheetSource).toContain("historicalSuggestionPatch(suggestion)");
    expect(editSheetSource).toContain("commitDescriptionEditorState(\n      patch.description");
    expect(editSheetSource).toContain("setSelectedCategoryId(patch.categoryId)");
    expect(editSheetSource).toContain("setSelectedTagNames(patch.tagNames)");
    expect(editSheetSource).toContain(
      "AccessibilityInfo.announceForAccessibility(\n        historicalSuggestionAppliedAnnouncement(suggestion)"
    );
    expect(editSheetSource).toContain("if (accepted && ok)");
    expect(editSheetSource).toContain("HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT");
  });

  it("uses explicit monotonic presentation identity and real TextInput focus", () => {
    expect(editSheetSource).toContain("presentation: TimeEntrySheetPresentation");
    expect(editSheetSource).toContain("pendingDescriptionFocusPresentationId(sheetState)");
    expect(editSheetSource).toContain("descriptionInputRef.current?.blur()");
    expect(editSheetSource).toContain('type: "focus_ownership_reset"');
    expect(editSheetSource).not.toContain("focusResetFrameRef");
    expect(editSheetSource).toContain("descriptionInputRef.current?.focus()");
    expect(editSheetSource).toContain("currentSheetState.descriptionFocused\n      ? activeSessionToken");
    expect(editSheetSource).toContain("? activeSessionToken\n      : beginNativeKeyboardSession()");
    expect(editSheetSource).toContain("armKeyboardConfirmationWatchdog(sessionToken)");
    expect(editSheetSource).toContain("const metrics = Keyboard.metrics()");
    expect(editSheetSource).toContain("synchronizeVisibleKeyboardMetrics(sessionToken)");
    expect(editSheetSource).toContain('Keyboard.addListener("keyboardDidShow", updateKeyboardInset)');
    expect(editSheetSource).toContain('Keyboard.addListener("keyboardDidHide", handleKeyboardHidden)');
    expect(editSheetSource).toContain("onPresented?.(presentedPresentationId)");
    expect(editSheetSource).toContain("onCancel(dismissedPresentationId)");
    expect(swipeSource).toContain("createSwipeSheetPresentationCoordinator()");
    expect(swipeSource).toContain("presentationAnimationSequenceRef.current");
    expect(swipeSource).toContain("onPresented?: (presentationId: number) => void");
    expect(dashboardSource).toContain('presentActiveEditor("blank_timer_started", true)');
    expect(dashboardSource).toContain('presentActiveEditor("existing_active_timer")');
    expect(reviewSource).toContain('reason: "review_edit"');
    expect(editSheetSource).not.toContain("focusDescriptionOnShow");
  });

  it("resolves Reduce Motion before mounting the first sheet generation", () => {
    expect(editSheetSource).toContain("reduceMotion: boolean;");
    expect(editSheetSource).not.toContain("useReduceMotionPreference");
    for (const callerSource of [dashboardSource, reviewSource, qaSource]) {
      expect(callerSource).toContain("useResolvedReduceMotionPreference");
      expect(callerSource).toContain("reduceMotionPreferenceResolved");
      expect(callerSource).toContain("reduceMotion={reduceMotion}");
    }
    expect(dashboardSource).toContain(
      "manualEntryPresentation && reduceMotionPreferenceResolved ? <ActiveTimerEditSheet"
    );
    expect(dashboardSource).toContain(
      "activeEditPresentation && reduceMotionPreferenceResolved ? <ActiveTimerEditSheet"
    );
    expect(dashboardSource).toContain(
      "calendarEditPresentation && reduceMotionPreferenceResolved ? <ActiveTimerEditSheet"
    );
    expect(reviewSource).toContain(
      "editPresentation && reduceMotionPreferenceResolved ? ("
    );
    expect(qaSource).toContain(
      "reduceMotionPreferenceResolved ? <ActiveTimerEditSheet"
    );
  });

  it("coordinates direct mutations, protected user dismissal, and generation-safe exit", () => {
    const removedPromptName = ["Delete", "Entry", "Confirmation"].join("");
    expect(editSheetSource).not.toContain(removedPromptName);
    expect(editSheetSource).toContain("const token = beginMutation(\"deleting\")");
    expect(editSheetSource).toContain("resolveMutation(() => onDelete(entry.id))");
    expect(editSheetSource).toContain(
      "if (accepted && ok) requestCoordinatedDismiss({ bypassDiscardConfirmation: true })"
    );
    expect(editSheetSource).toContain("onRequestClose={handleUserRequestClose}");
    expect(editSheetSource).toContain("dismissRequestId?: number | null");
    expect(editSheetSource).toContain("pendingTimeEntrySheetDismissRequestId({");
    expect(editSheetSource).toContain(
      "handledDismissRequestIdRef.current = pendingCallerDismissRequestId"
    );
    expect(swipeSource).toContain("disabled={disabled}");
    expect(swipeSource).toContain("onPress={disabled ? undefined : requestBackdropDismiss}");
    expect(editSheetSource).toContain("presentationRef.current.id !== focusPresentationId");
    expect(editSheetSource).toContain("animationPresentationId !== presentationRef.current.id");
  });

  it("keeps a production-component QA route with raw queryable fixtures and state telemetry", () => {
    expect(qaSource).toContain("<ActiveTimerEditSheet");
    expect(qaSource).toContain('description: index === 0 ? "Bauhaus research"');
    expect(qaSource).toContain("historicalEntries={historicalEntries}");
    expect(qaSource).toContain("nextPresentationIdRef.current += 1");
    expect(qaSource).toContain("createDeletionCoordinator<");
    expect(qaSource).toContain("filterPendingDeletedTimeEntries(");
    expect(qaSource).toContain('testID="deletion-undo-toast"');
    expect(qaSource).toContain('testID="deletion-undo-action"');
    expect(qaSource).toContain("testID={`sheet-qa-${key}`}");
    expect(qaSource).toContain('["second-delete", "Delete a second entry", prepareSecondDeletion]');
    expect(qaSource).toContain("secondDeletionCount");
    expect(qaSource).toContain('testID="sheet-qa-harness-state"');
    expect(editSheetSource).toContain('testID="sheet-qa-state"');
    expect(editSheetSource).toContain("staleCallbackCount");
    expect(editSheetSource).not.toContain("setStaleCallbackCount(0)");
    expect(editSheetSource).toContain("duplicateMutationCount: mutationTelemetry.duplicateMutationCount");
    expect(editSheetSource).toContain("mutationStartedCount: mutationTelemetry.mutationStartedCount");
    expect(editSheetSource).toContain("mutationRejectedCount: mutationTelemetry.mutationRejectedCount");
    expect(editSheetSource).toContain("mutationFinishedCount: mutationTelemetry.mutationFinishedCount");
    expect(qaHarnessSource).not.toContain('"duplicateMutationCount": 0');
    expect(qaHarnessSource).toContain('"mutationAttemptCount"');
    expect(qaHarnessSource).toContain('payload["counters"] = counters');
    expect(editSheetSource).toContain('geometryCoordinateSpace: "sheet_local"');
    expect(editSheetSource).toContain("sheetRect: telemetrySheetRect");
    expect(editSheetSource).toContain("timeEntrySheetVisualReadiness");
    expect(editSheetSource).toContain("overlayContentKeyMatches: overlayMeasuredForCurrentContent");
    expect(editSheetSource).toContain("overlayContentMeasured:");
    expect(editSheetSource).toContain("overlayContainerVisible:");
    expect(editSheetSource).toContain("overlayRenderedHeight:");
    expect(editSheetSource).toContain("suggestionsAreVisiblyRenderable,");
    expect(editSheetSource).toContain("overlayUpdateVisibilityDropCount,");
    expect(editSheetSource).not.toContain("setOverlayUpdateVisibilityDropCount(0)");
  });
});
