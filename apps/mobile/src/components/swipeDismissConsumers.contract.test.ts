import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sheetSource = read("./SwipeDismissSheet.tsx");
const editSource = read("./ActiveTimerEditSheet.tsx");
const placesSource = read("../../app/places.tsx");
const settingsSource = read("../../app/settings.tsx");
const consumerSources = [editSource, placesSource, settingsSource];

describe("shared swipe-dismiss ownership integration", () => {
  it("uses no native slide animation around a shared custom transition", () => {
    for (const source of consumerSources) {
      expect(source).not.toMatch(/animationType=.*slide/);
      expect(source).toContain('animationType="none"');
    }
  });

  it("keeps the backdrop inside the shared transition owner", () => {
    expect(sheetSource).toContain("backdropProgressForTranslation");
    expect(sheetSource).toContain("onPress={disabled ? undefined : requestDismiss}");
    expect(sheetSource).toContain("disabled={disabled}");
    for (const source of consumerSources) {
      expect(source).toContain("backdropStyle={styles.sheetBackdrop}");
    }
  });

  it("routes Done and successful destructive actions through coordinated exit", () => {
    expect(editSource).toContain("if (accepted && ok) requestCoordinatedDismiss()");
    expect(editSource).toContain("sheetRef.current?.dismiss()");
    expect(editSource).toContain("onCancel(dismissedPresentationId)");
    expect(editSource).toContain("onRequestClose={handleUserRequestClose}");
    const userCloseSource = editSource.slice(
      editSource.indexOf("function handleUserRequestClose()"),
      editSource.indexOf("async function saveChanges()")
    );
    expect(userCloseSource).toContain("if (datePickerOpen)");
    expect(userCloseSource).toContain('type: "date_picker_closed"');
    expect(userCloseSource).toContain("if (busy) return;");
  });

  it("does not reset drag translation before the dismissal callback", () => {
    expect(sheetSource).not.toContain("translationY.value = 0;\n      runOnJS(finishDismiss)");
    expect(sheetSource).not.toContain("dragY.setValue(0)");
  });

  it("uses the shared presence value for the sheet and backdrop Reduce Motion fade", () => {
    expect(sheetSource).toContain("opacity: presence.value,");
    expect(sheetSource).toContain("opacity: presence.value *");
  });

  it("separates keyboard lift from the Reanimated swipe transform", () => {
    expect(sheetSource).toContain("<ReactNativeAnimated.View");
    expect(sheetSource).toContain("<Reanimated.View");
    expect(editSource).toContain("onGestureStart={freezeKeyboardMotion}");
    expect(editSource).toContain("onGestureSettled={releaseKeyboardMotion}");
  });

  it("scopes presentation and exit callbacks to the active generation", () => {
    expect(sheetSource).toContain("createSwipeSheetPresentationCoordinator()");
    expect(sheetSource).toContain("presentationAnimationSequenceRef.current");
    expect(sheetSource).toContain('completion !== "accepted"');
    expect(sheetSource).toContain("presentedId !== activePresentationIdRef.current");
    expect(sheetSource).toContain("committedPresentationId !== activePresentationIdRef.current");
    expect(sheetSource).toContain("onStaleCallbackRef.current?.");
    expect(editSource).toContain("presentationId={presentation.id}");
  });

  it("finishes interrupted entrances at rest and vetoes conflicting dismissal ownership", () => {
    expect(sheetSource.match(/notifyGestureSettledAtRest/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sheetSource).toContain("cancelAnimation(translationY);");
    expect(sheetSource).toContain("cancelAnimation(presence);");
    expect(sheetSource).toContain("approveDismissStart(committedPresentationId)");
    expect(sheetSource).toContain("dismissRequestInFlightRef.current");
    expect(sheetSource).toContain('presentationAction === "unchanged"');
    expect(editSource).toContain("if (mutationGateRef.current !== null) return false;");
  });

  it("cannot deliver a queued rest settlement after dismissal takes ownership", () => {
    const settlementSource = sheetSource.slice(
      sheetSource.indexOf("const notifyGestureSettledAtRest"),
      sheetSource.indexOf("const finishDismiss")
    );
    expect(settlementSource).toContain("canSettleSwipeGesture({");
    expect(settlementSource).toContain("coordinatorRef.current.canSettle()");
    expect(settlementSource).toContain("presentationCoordinatorRef.current.canSettle(");
    expect(settlementSource).toContain("dismissRequestInFlightRef.current");
    expect(settlementSource).toContain("committedPresentationIdRef.current");
    expect(settlementSource.indexOf("canSettleSwipeGesture({")).toBeLessThan(
      settlementSource.indexOf("notifyGestureSettled(gesturePresentationId)")
    );
    expect(settlementSource.indexOf("canSettleSwipeGesture({")).toBeLessThan(
      settlementSource.indexOf("translationY.value = 0")
    );
  });

  it("uses gesture travel for dismissal while preserving the interrupted visual origin", () => {
    expect(sheetSource).toContain(
      "translationY.value = Math.max(0, gestureOriginY.value + event.translationY)"
    );
    expect(sheetSource).toContain("translationY: event.translationY,");
    expect(sheetSource).not.toContain("translationY: translationY.value,");
  });

  it("keeps form interaction and deferred focus behind presentation ownership", () => {
    expect(editSource).toContain("const presentationInteractionReady = Boolean(");
    expect(editSource).toContain(
      'pointerEvents={presentationInteractionReady ? "auto" : "none"}'
    );
    expect(editSource).toContain("cancelPendingTagFocus();");
    expect(editSource).toContain("classifyTimeEntrySheetDeferredFocus({");
  });
});
