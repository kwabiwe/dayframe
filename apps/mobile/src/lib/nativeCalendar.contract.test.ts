import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardPath = fileURLToPath(new URL("../components/DayframeDashboard.tsx", import.meta.url));
const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const moduleRoot = fileURLToPath(new URL("../../modules/dayframe-calendar/", import.meta.url));

describe("native Calendar production contract", () => {
  it("removes the React pinch, temporary transform, and outer-scroll ownership", () => {
    const source = readFileSync(dashboardPath, "utf8");

    expect(source).toContain("<DayframeCalendarView");
    expect(source).not.toContain("function CalendarTab(");
    expect(source).not.toContain("Gesture.Pinch");
    expect(source).not.toContain("calendarGestureLocked");
    expect(source).not.toContain("calendarScrollRef");
    expect(source).not.toContain("scaleY");
    expect(source).not.toContain("onGestureLockedChange");
    expect(existsSync(`${mobileRoot}src/lib/calendarGestures.ts`)).toBe(false);
    expect(existsSync(`${mobileRoot}src/lib/calendarBlocks.ts`)).toBe(false);
  });

  it("retains one hosting controller and only updates its observable model on props", () => {
    const expoView = readFileSync(`${moduleRoot}ios/DayframeCalendarExpoView.swift`, "utf8");
    const model = readFileSync(`${moduleRoot}ios/DayframeCalendarModel.swift`, "utf8");

    expect(expoView).toContain("private var hostingController: UIHostingController");
    expect(expoView.match(/hostingController = controller/g)).toHaveLength(1);
    expect(expoView).toContain("JSONDecoder().decode(DayframeCalendarPresentationRecord.self");
    expect(expoView).toContain("model.update(record)");
    expect(model).toContain("@Published private(set) var hourHeight");
    expect(model).not.toContain("hourHeight = DayframeCalendarConstants.defaultHourHeight\n  }");
  });

  it("keeps networking, sessions, queue writes, and timer mutations outside Swift", () => {
    const swiftSources = [
      "DayframeCalendarExpoView.swift",
      "DayframeCalendarModel.swift",
      "DayframeCalendarModule.swift",
      "DayframeCalendarRootView.swift",
      "DayframeCalendarScrollCoordinator.swift"
    ].map((file) => readFileSync(`${moduleRoot}ios/${file}`, "utf8")).join("\n");

    for (const forbidden of [
      "URLSession",
      "SecureStore",
      "AsyncStorage",
      "fetchBootstrap",
      "startTimer",
      "stopTimer",
      "deleteTimeEntry",
      "offlineQueue"
    ]) {
      expect(swiftSources).not.toContain(forbidden);
    }
  });

  it("renders serialized tag metadata in Swift without moving data ownership out of React", () => {
    const records = readFileSync(`${moduleRoot}ios/DayframeCalendarRecords.swift`, "utf8");
    const model = readFileSync(`${moduleRoot}ios/DayframeCalendarModel.swift`, "utf8");
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");

    expect(records).toContain("var tagText: String?");
    expect(model).toContain("tagText = record.tagText");
    expect(rootView).toContain("Image(systemName: \"tag.fill\")");
    expect(rootView).toContain("theme.textSecondary");
    expect(rootView).not.toContain("URLSession");
  });

  it("animates only horizontal collision reflow and disables it for Reduce Motion", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");

    expect(rootView).toContain("private struct DayframeCalendarHorizontalGeometry: AnimatableModifier");
    expect(rootView).toContain("var animatableData: AnimatablePair<CGFloat, CGFloat>");
    expect(rootView).toContain("presentation.reduceMotion ? nil : .easeOut(duration: 0.21)");
    expect(rootView).not.toContain("value: presentation.entries");
  });

  it("passes semantic warning colours across the React-to-Swift boundary", () => {
    const records = readFileSync(`${moduleRoot}ios/DayframeCalendarRecords.swift`, "utf8");
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");

    expect(records).toContain("var warning =");
    expect(records).toContain("var warningText =");
    expect(rootView).toContain("theme.warning");
    expect(rootView).not.toContain("#F0AA55");
  });

  it("keeps native block styling visual-only and preserves semantic state treatments", () => {
    const core = readFileSync(`${moduleRoot}ios/DayframeCalendarCore.swift`, "utf8");
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const swiftSources = [core, rootView].join("\n");

    expect(core).toContain("public static let blockCornerRadius = 8.0");
    expect(core).toContain("public static let blockVisualGap = 1.0");
    expect(core).toContain("public enum DayframeCalendarBlockVisualMath");
    expect(core).toContain("public enum DayframeCalendarVerticalMath");
    expect(core).toContain("semanticHeight: Double");
    expect(rootView).toContain(".frame(height: visualHeight)");
    expect(rootView).toContain(".frame(height: semanticHeight, alignment: .top)");
    expect(rootView).toContain(".offset(y: CGFloat(vertical.visualOffsetWithinHitTarget))");
    expect(rootView).toContain(".frame(height: hitHeight, alignment: .top)");
    expect(rootView).toContain("y: CGFloat(vertical.hitCenterY)");
    expect(rootView).toContain("semanticHeight: metrics.height");
    expect(rootView).not.toContain(".frame(width: width, height: hitHeight)");
    expect(rootView).toContain("alpha: 0.42");
    expect(rootView).toContain("entry.isReview || entry.isActive ? [4, 3] : []");
    expect(rootView).toContain("DayframeCalendarHatch");
    expect(swiftSources).not.toContain("min(13");
    expect(swiftSources).not.toContain("rect.height / 2), height: min(13");
    expect(swiftSources).not.toContain("onLongPressGesture");
    expect(swiftSources).not.toContain("contextMenu");
    expect(swiftSources).not.toContain("play.fill");
  });

  it("owns exactly one UIKit long press in the existing scroll coordinator", () => {
    const coordinator = readFileSync(`${moduleRoot}ios/DayframeCalendarScrollCoordinator.swift`, "utf8");
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const dashboard = readFileSync(dashboardPath, "utf8");
    const handler = coordinator.slice(
      coordinator.indexOf("@objc private func handleLongPress"),
      coordinator.indexOf("func gestureRecognizerShouldBegin")
    );
    const began = handler.slice(handler.indexOf("case .began:"), handler.indexOf("case .changed:"));
    const changed = handler.slice(handler.indexOf("case .changed:"), handler.indexOf("case .ended:"));
    const ended = handler.slice(handler.indexOf("case .ended:"), handler.indexOf("case .cancelled"));

    expect(coordinator.match(/private let longPressGesture = UILongPressGestureRecognizer\(\)/g)).toHaveLength(1);
    expect(coordinator).toContain("minimumPressDuration = DayframeCalendarConstants.longPressMinimumDuration");
    expect(coordinator).toContain("allowableMovement = DayframeCalendarConstants.longPressAllowableMovement");
    expect(coordinator).toContain("numberOfTouchesRequired = 1");
    expect(coordinator).toContain("longPressGesture.numberOfTouches == 1");
    expect(coordinator).toContain("if longPressGesture.numberOfTouches >= 1");
    expect(coordinator).toContain("case .began:");
    expect(coordinator).toContain("case .changed:");
    expect(coordinator).toContain("case .ended:");
    expect(coordinator).toContain("selectionHaptic.selectionChanged()");
    expect(began).toContain("model.beginCreationPreview(");
    expect(began).not.toContain("actions.requestCreateEntry");
    expect(changed).toContain("updateCreationDrag(");
    expect(ended).toContain("completeCreationInteraction()");
    expect(coordinator.slice(coordinator.indexOf("private func completeCreationInteraction"))).toContain(
      "actions.requestCreateEntry(request)"
    );
    expect(rootView).not.toContain("onLongPressGesture");
    expect(dashboard).not.toContain("Gesture.LongPress");
  });

  it("keeps the creation preview native, ephemeral, non-interactive, and separate from entries", () => {
    const core = readFileSync(`${moduleRoot}ios/DayframeCalendarCore.swift`, "utf8");
    const model = readFileSync(`${moduleRoot}ios/DayframeCalendarModel.swift`, "utf8");
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const previewView = rootView.slice(
      rootView.indexOf("private struct DayframeCalendarCreationPreviewLayer"),
      rootView.indexOf("private struct DayframeCalendarHourGrid")
    );

    expect(core).toContain("public static let creationPreviewDurationMinutes = 30");
    expect(core).toContain("public enum DayframeCalendarCreationPreviewMath");
    expect(model).toContain("@Published private(set) var creationPreview");
    expect(model).toContain("func beginCreationPreview(dayKey: String, startMinute: Int)");
    expect(model).toContain("func updateCreationPreview(sessionToken: UInt64, startMinute: Int)");
    expect(model).toContain("func clearCreationPreview(sessionToken: UInt64? = nil)");
    expect(model).toContain("if creationPreview?.dayKey != next.selectedDayKey");
    expect(rootView).toContain("preview.dayKey == presentation.selectedDayKey");
    expect(previewView).toContain("DayframeCalendarBlockVisualMath.metrics");
    expect(previewView).toContain("cornerRadius: CGFloat(visual.cornerRadius)");
    expect(previewView).toContain("StrokeStyle(lineWidth: 1");
    expect(previewView).toContain("dash: [5, 3]");
    expect(previewView).toContain('Text("New entry")');
    expect(previewView).toContain("theme.accent");
    expect(previewView).toContain(".monospacedDigit()");
    expect(rootView).toContain(".zIndex(10_000)");
    expect(rootView).toContain(".allowsHitTesting(false)");
    expect(rootView).toContain(".accessibilityHidden(true)");
    expect(previewView).not.toContain("presentation.entries");
    expect(previewView).not.toContain("entry.color");
    expect(previewView).not.toContain('Image(systemName: "tag.fill")');
    expect(previewView).not.toContain("play.fill");
  });

  it("uses one coordinator-owned display link and restores competing gestures deterministically", () => {
    const coordinator = readFileSync(`${moduleRoot}ios/DayframeCalendarScrollCoordinator.swift`, "utf8");

    expect(coordinator.match(/private var edgeAutoscrollDisplayLink: CADisplayLink\?/g)).toHaveLength(1);
    expect(coordinator).toContain("DayframeCalendarEdgeAutoscrollMath.velocity(");
    expect(coordinator).toContain("DayframeCalendarEdgeAutoscrollMath.nextContentOffset(");
    expect(coordinator).toContain("animated: false");
    expect(coordinator).toContain("stopEdgeAutoscroll()");
    expect(coordinator).toContain("setCreationGestureLock(true)");
    expect(coordinator).toContain("setCreationGestureLock(false)");
    expect(coordinator).toContain("UIApplication.willResignActiveNotification");
    expect(coordinator).toContain("static func dismantleUIView");
    expect(coordinator).not.toMatch(/\bTimer\b/);
  });

  it("bridges only dayKey and startMinute to the React-owned manual draft", () => {
    const expoView = readFileSync(`${moduleRoot}ios/DayframeCalendarExpoView.swift`, "utf8");
    const module = readFileSync(`${moduleRoot}ios/DayframeCalendarModule.swift`, "utf8");
    const wrapper = readFileSync(`${moduleRoot}src/DayframeCalendarView.tsx`, "utf8");
    const presentation = readFileSync(`${mobileRoot}src/lib/nativeCalendarPresentation.ts`, "utf8");
    const dashboard = readFileSync(dashboardPath, "utf8");

    expect(module).toContain('"onRequestCreateEntry"');
    expect(expoView).toContain('"dayKey": request.dayKey');
    expect(expoView).toContain('"startMinute": request.startMinute');
    expect(wrapper).toContain("export type DayframeCalendarCreateEntryEvent = { dayKey: string; startMinute: number }");
    expect(dashboard).toContain("resolveCalendarManualEntryRequest({");
    expect(dashboard).toContain("onRequestCreateEntry={(event) => {");
    expect(dashboard).toContain('Alert.alert("Unable to add time", result.error)');
    expect(presentation).toContain("modelVersion: 3");
    expect(presentation).not.toContain("modelVersion: 4");
    expect(expoView).not.toContain("createManualTimeEntry");
  });

  it("keeps Calendar creation separate while Plus can draft time before an active timer", () => {
    const dashboard = readFileSync(dashboardPath, "utf8");
    const handler = dashboard.slice(
      dashboard.indexOf("function openCalendarManualEntry"),
      dashboard.indexOf("async function saveManualEntry")
    );
    const plusHandler = dashboard.slice(
      dashboard.indexOf("function openManualEntry"),
      dashboard.indexOf("function openCalendarManualEntry")
    );

    expect(handler).toContain("resolveCalendarManualEntryRequest");
    expect(handler).toContain("presentManualEntry(result.entry)");
    expect(handler).not.toContain("openManualEntry()");
    expect(handler).not.toContain("setActiveEditVisible");
    expect(handler).not.toContain("startTimer");
    expect(handler).not.toContain("stopTimer");
    expect(plusHandler).toContain("presentManualEntry(createManualDraftEntry(Date.now()))");
    expect(plusHandler).not.toContain("latestData.current?.activeEntry?.startedAt");
    expect(plusHandler).not.toContain("stopTimer");
    expect(dashboard).toContain("manualEntrySavingRef.current = true");
    expect(dashboard).toContain("await createManualTimeEntry({");
    expect(dashboard).toContain("await load({ silent: true })");
    expect(dashboard).toContain("const startedAt = new Date(nowMs - 30 * 60 * 1000)");
    expect(dashboard).toContain("durationSeconds: 30 * 60");
  });
});
