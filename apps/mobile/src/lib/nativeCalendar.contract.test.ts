import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardPath = fileURLToPath(new URL("../components/DayframeDashboard.tsx", import.meta.url));
const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const moduleRoot = fileURLToPath(new URL("../../modules/dayframe-calendar/", import.meta.url));

describe("native Calendar production contract", () => {
  it("tells VoiceOver a \"?\" block opens its question, never Review (Codex r12 on #610)", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    expect(rootView).toContain('.accessibilityHint(entry.isReview ? "Opens its question" : entry.isActive ? "Opens Edit Timer" : "Opens entry editor")');
    expect(rootView).not.toContain('"Opens Review"');
  });

  it("shares the Places lane's 44-point targets with the long press, and clips a trip's legs to the drawn day (Codex r1 on #610)", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const coordinator = readFileSync(`${moduleRoot}ios/DayframeCalendarScrollCoordinator.swift`, "utf8");
    const model = readFileSync(`${moduleRoot}ios/DayframeCalendarModel.swift`, "utf8");
    expect(model).toContain("DayframeCalendarPlacesLaneMath.hitFrames(spans:");
    expect(rootView).toContain("let lane = DayframeCalendarLaneLayout.layout(");
    // One arbitration for a touch (the nearest drawn centre), and each item its own VoiceOver button (Codex r2 on #610).
    expect(rootView).toContain("DayframeCalendarPlacesLaneMath.hitIndex(point: point, spans: lane.map(\\.span), frames: lane.map(\\.frame))");
    expect(rootView).toContain(".accessibilityAction { openLaneItem(item) }");
    expect(coordinator).toContain("let laneFrames = DayframeCalendarLaneLayout.layout(");
    expect(coordinator).toContain("frames: hitFrames + momentFrames + laneFrames");
    expect(rootView).toContain("DayframeCalendarLegStripMath.segments(");
    expect(rootView).not.toContain("minimumHeight: 4\n        ) {");
  });

  it("hands the Grid only the \"?\" that still ask, outings folded, and routes every one it draws (Codex r1 on #610)", () => {
    const dashboard = readFileSync(dashboardPath, "utf8");
    expect(dashboard).toContain("const gridReviewItemIds = useMemo(() => new Set(askingChecks.map((check) => check.id)), [askingChecks]);");
    expect(dashboard).toContain("reviewItemIds: gridReviewItemIds,");
    // askingChecks comes from calendarChecks (outings folded), which the Grid's "?" routing looks up.
    expect(dashboard).toContain("checksOldestFirst(calendarChecks.checks.filter(");
    expect(dashboard).toContain(": calendarChecks.checks.find((check) => check.id === reviewItemId)?.segmentId ?? null;");
  });

  it("shows the Calendar v3 header: month title, one round one-tap Day / List toggle, no − / +, and no framed line under the week strip", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const header = rootView.slice(
      rootView.indexOf("private func calendarHeader("),
      rootView.indexOf("private func weekStrip(")
    );
    expect(header).toContain("presentation.monthTitle");
    expect(header).toContain('.font(.custom("BricolageGrotesque-Bold", size: 30, relativeTo: .largeTitle))');
    expect(header).toContain(".dynamicTypeSize(.xSmall ... .xxxLarge)");
    // Owner item J (28 Oct 2026): one round 44-point button; one tap switches, its icon showing where it goes
    // (owner: no Multi Day, now or later). No menu.
    expect(header).toContain('actions.changeLayout(presentation.isList ? "grid" : "list")');
    expect(header).toContain('DayframeCalendarGlyph(name: presentation.isList ? "view-day" : "view-list"');
    expect(header).toContain('.accessibilityLabel(presentation.isList ? "Show as day" : "Show as list")');
    expect(rootView).not.toContain("Menu {");
    expect(rootView).not.toContain("legacyViewMenu");
    expect(rootView).not.toContain("viewMenuItem(");
    expect(rootView).not.toMatch(/Multi ?Day/i);
    expect(header).toContain(".frame(width: 44, height: 44)");
    expect(header).toContain(".background(Circle().fill(Color(dayframeCSS: theme.surface)))");
    // No zoom buttons: pinch, and VoiceOver's adjustable action on the timeline.
    expect(rootView).not.toContain("zoomPill");
    expect(rootView).not.toContain('"Zoom in" : "Zoom out"');
    expect(rootView).toContain(".accessibilityAdjustableAction { direction in");
    expect(rootView).toContain("case .increment: model.requestZoom(direction: 1)");
    // Card C item 1 (owner, 25 Oct 2026): no "framed" line under the strip; the day heading says "logged".
    expect(rootView).not.toContain("framedLine(");
    expect(rootView).not.toContain("framedLabel");
    expect(header).not.toContain("coveredLabel");
    expect(rootView).not.toContain("private func calendarPanel(");
  });

  it("draws the week strip with a sliding selected circle, coral today and activity bars", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const strip = rootView.slice(rootView.indexOf("private func weekStrip("), rootView.indexOf("private func dayNumberColor("));
    expect(strip).toContain(".matchedGeometryEffect(id: \"selected-day\", in: weekStripSelection)");
    expect(strip).toContain("ForEach(Array(day.bars.enumerated())");
    expect(strip).toContain(".frame(width: 5, height: 4)");
    expect(strip).toContain("presentation.reduceMotion ? nil : .spring(");
    expect(strip).toContain("actions.changeWeek(");
    expect(strip).toContain("if !day.isSelected { playSelectionHaptic() }");
    expect(rootView).toContain("return day.isToday ? theme.accent : theme.textPrimary");
    expect(rootView).toContain("guard model.presentation.hapticsEnabled else { return }");
  });

  it("animates the zoom buttons in the one scroll coordinator and yields to a finger", () => {
    const coordinator = readFileSync(`${moduleRoot}ios/DayframeCalendarScrollCoordinator.swift`, "utf8");
    const model = readFileSync(`${moduleRoot}ios/DayframeCalendarModel.swift`, "utf8");
    const pinch = coordinator.slice(coordinator.indexOf("@objc private func handlePinch"), coordinator.indexOf("@objc private func handleHorizontalPan"));
    const frame = coordinator.slice(coordinator.indexOf("fileprivate func handleButtonZoomFrame"), coordinator.indexOf("private func applyButtonZoom("));
    const begin = coordinator.slice(coordinator.indexOf("private func beginButtonZoom("), coordinator.indexOf("fileprivate func handleButtonZoomFrame"));

    expect(model).toContain("@Published private(set) var zoomRequest: DayframeCalendarZoomRequest?");
    expect(coordinator).toContain("if let request = model.zoomRequest, request.token != handledZoomToken {");
    expect(coordinator).toContain("handledZoomToken = model.zoomRequest?.token ?? 0");
    expect(begin).toContain("let fromHeight = buttonZoom?.targetHourHeight ?? Double(model.hourHeight)");
    expect(begin).toContain("if model.presentation.reduceMotion {");
    expect(begin).toContain("midpointY: Double(scrollView.bounds.height) / 2");
    expect(frame).toContain("!scrollView.isDragging");
    expect(frame).toContain("DayframeCalendarZoomMath.buttonAnimationDuration");
    expect(pinch).toContain("stopButtonZoom()");
    expect(coordinator).toMatch(/stopButtonZoom\(\)\n\s+setCreationGestureLock\(true\)/);
    expect(coordinator.match(/transition\.shouldTriggerHaptic, model\.presentation\.hapticsEnabled/g)).toHaveLength(2);
  });

  it("marks now with a red line on the minute and the time in a red pill in the gutter (Calendar v3)", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const marker = rootView.slice(rootView.indexOf("private struct DayframeCalendarNowMarker"), rootView.indexOf("private struct DayframeCalendarCreationPreviewLayer"));
    expect(rootView).toContain("DayframeCalendarNowMarker(");
    expect(marker).toContain("Color(dayframeCSS: light ? theme.dangerText : theme.danger)");
    expect(marker).toContain(".background(Capsule(style: .continuous).fill(red))");
    expect(marker).not.toContain("Circle()");
    // #255: an hour label hides only where the pill actually covers its digits (DayframeCalendarNowPillMath).
    expect(rootView).toContain("DayframeCalendarNowPillMath.coversHourLabel(nowY: Double($0), labelCenterY: Double(labelTop), labelGlyphHeight: Double(labelGlyphHeight))");
    expect(rootView).toContain("@ScaledMetric(relativeTo: .caption2) private var labelGlyphHeight: CGFloat = 8");
    expect(rootView).not.toContain("abs($0 - labelTop) < 12");
  });

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
    // Dense-day rules: the title wins; place and tags leave the block face and stay in its
    // VoiceOver label, which React writes.
    expect(rootView).not.toContain("entry.tagText");
    expect(rootView).not.toContain("entry.placeText");
    expect(rootView).toContain("theme.textSecondary");
    expect(rootView).not.toContain("URLSession");
  });

  it("animates only horizontal collision reflow and disables it for Reduce Motion", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");

    expect(rootView).toContain("private struct DayframeCalendarHorizontalGeometry: AnimatableModifier");
    expect(rootView).toContain("var animatableData: AnimatablePair<CGFloat, CGFloat>");
    expect(rootView).toContain("presentation.reduceMotion ? nil : .easeOut(duration: 0.21)");
    expect(rootView).not.toContain("value: presentation.entries");
    // Within-day presence fades through the transition's own animation, never a subtree animation.
    expect(rootView).toContain(".opacity.animation(.easeOut(duration: 0.21))");
    // The lane animation is scoped to the horizontal modifier (iOS 17), never the block's content.
    expect(rootView).toContain("content.animation(animation) { view in");
    expect(rootView).not.toContain("transaction.animation = nil");
  });

  it("draws named-pattern brackets from React's model under the one timeline owner (location v3 PR 14b)", () => {
    const records = readFileSync(`${moduleRoot}ios/DayframeCalendarRecords.swift`, "utf8");
    const model = readFileSync(`${moduleRoot}ios/DayframeCalendarModel.swift`, "utf8");
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const coordinator = readFileSync(`${moduleRoot}ios/DayframeCalendarScrollCoordinator.swift`, "utf8");
    const entriesLayer = rootView.slice(
      rootView.indexOf("private struct DayframeCalendarEntriesLayer"),
      rootView.indexOf("private struct DayframeCalendarBlockView")
    );
    const bracketView = rootView.slice(
      rootView.indexOf("private struct DayframeCalendarBracketView"),
      rootView.indexOf("private struct DayframeCalendarLiveRing")
    );

    // An optional field: an older bundle without brackets still decodes.
    expect(records).toContain("var brackets: [DayframeCalendarBracketRecord]?");
    expect(model).toContain("brackets = (record.brackets ?? []).map(DayframeCalendarBracket.init)");
    // Drawn in the entries layer (the day's transition, zoom and scroll) with the blocks' own maths.
    expect(entriesLayer).toContain("ForEach(presentation.brackets)");
    // Dense-day rules: the rail at the hour gutter's edge, the name level in the gutter.
    expect(entriesLayer).toContain("DayframeCalendarBracketView(height: height, name: bracket.name, nameWidth: max(0, hourLabelWidth - 6), theme: presentation.theme)");
    // Its bounds are its parts as drawn, part by part, never the trip measured as one block.
    expect(entriesLayer).toContain("DayframeCalendarBracketMath.span(");
    expect(entriesLayer).toContain("bracket.memberIds.contains($0.entryId)");
    expect(entriesLayer).not.toContain("startedAtMs: bracket.startedAtMs");
    expect(entriesLayer).toContain(".opacity.animation(.easeOut(duration: 0.21))");
    // Never takes a touch or a VoiceOver stop; the parts' labels name the trip.
    expect(entriesLayer).toContain(".allowsHitTesting(false)");
    expect(entriesLayer).toContain(".accessibilityHidden(true)");
    // The rail is shared by render and long-press hit geometry.
    expect(entriesLayer).toContain("leadingInset: presentation.entryLeadingInset");
    expect(coordinator).toContain("leadingInset: presentation.entryLeadingInset");
    // Theme roles only, never a literal colour, and no data of its own.
    expect(bracketView).toContain("theme.textSecondary");
    expect(bracketView).toContain("theme.textMuted");
    expect(bracketView).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(bracketView).not.toContain("actions.");
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

    expect(core).toContain("public static let blockCornerRadius = 5.0");
    expect(core).toContain("public static let blockVisualGap = 2.0");
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
    // Calendar v3: a translucent tint (opaque only under Reduce Transparency) with a 3-point colour bar
    // (dashed for a suggestion), no outline, and text in a darker or lighter shade of the block's own
    // hue, never measured on-block text.
    expect(rootView).toContain(": Color(uiColor: blockColor).opacity(Double(tint))");
    expect(rootView).toContain("shape.fill(fill)");
    expect(rootView).toContain("blockColor.dayframeBlended(over: dark ? .white : .black, alpha: dark ? 0.62 : 0.52)");
    expect(rootView).toContain("DayframeCalendarColourBar(color: Color(uiColor: blockColor), dashed: entry.isReview)");
    expect(rootView).not.toContain("strokeBorder(Color(uiColor: blockColor)");
    expect(rootView).not.toContain("entry.textColor");
    expect(rootView).toContain(".foregroundStyle(ink)");
    // Calendar v3: no overlap dot on the block face (overlaps are drawn side by side or nested).
    expect(rootView).not.toContain("showsWarning");
    expect(rootView).toContain("DayframeCalendarLiveRing(color: Color(uiColor: blockColor), reduceMotion: reduceMotion, shape: shape)");
    expect(rootView).toContain(".opacity(reduceMotion ? 0.6 : bright ? 1 : 0.35)");
    // Owner item K (28 Oct 2026): a suggestion is a light fill with a dashed amber edge and the amber dot; no hatch
    // and no "? " ahead of its title (the hatch stays only for an unsure leg in a trip's strip).
    expect(rootView).toContain("let tint: CGFloat = entry.isReview ? (dark ? 0.08 : 0.05) : (dark ? 0.28 : 0.18)");
    expect(rootView).toContain("shape.stroke(Color(dayframeCSS: theme.warning).opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))");
    expect(rootView).toContain("Circle().fill(Color(dayframeCSS: theme.warning)).frame(width: 9, height: 9)");
    expect(rootView).not.toContain("DayframeCalendarHatch(color: Color(dayframeCSS: theme.textPrimary))");
    expect(rootView).not.toContain('"? "');
    expect(rootView).not.toContain("prototype");
    expect(rootView).toContain("theme.warningText");
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
    expect(previewView).toContain("shape.strokeBorder(Color(uiColor: accentColor), lineWidth: 2)");
    expect(previewView).toContain('Text("New block")');
    expect(previewView).toContain("theme.accent");
    expect(previewView).toContain(".monospacedDigit()");
    expect(rootView).toContain(".zIndex(10_000)");
    expect(rootView).toContain(".allowsHitTesting(false)");
    expect(rootView).toContain(".accessibilityHidden(true)");
    expect(previewView).not.toContain("presentation.entries");
    expect(previewView).not.toContain("entry.color");
    expect(previewView).not.toContain('DayframeCalendarGlyph(name: "tag"');
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
    expect(presentation).toContain("modelVersion: 4");
    expect(expoView).toContain("record.modelVersion == 4");
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

describe("native Calendar titles at every zoom (location v4 C6)", () => {
  const core = readFileSync(`${moduleRoot}ios/DayframeCalendarCore.swift`, "utf8");
  const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
  const coordinator = readFileSync(`${moduleRoot}ios/DayframeCalendarScrollCoordinator.swift`, "utf8");
  const model = readFileSync(`${moduleRoot}ios/DayframeCalendarModel.swift`, "utf8");
  const swiftConstant = (name: string) => Number(core.match(new RegExp(`public static let ${name} = ([0-9.]+)`))?.[1]);

  it("mirrors the shared dense-day label rule's numbers (owner, 24 Oct 2026)", async () => {
    const { CALENDAR_BLOCK_LABEL, CALENDAR_DENSE_LABEL, CALENDAR_V3_OVERLAP, CALENDAR_V3_TINT } = await import("@dayframe/shared");
    expect(swiftConstant("labelLineMinimumHeight")).toBe(CALENDAR_DENSE_LABEL.minimumHeight);
    expect(swiftConstant("compactTextMaximumHeight")).toBe(CALENDAR_DENSE_LABEL.compactTextMaximumHeight);
    expect(swiftConstant("compactTextMaximumWidth")).toBe(CALENDAR_DENSE_LABEL.compactTextMaximumWidth);
    expect(swiftConstant("detailMinimumWidth")).toBe(CALENDAR_DENSE_LABEL.detailMinimumWidth);
    expect(swiftConstant("sliverMaximumWidth")).toBe(CALENDAR_DENSE_LABEL.sliverMaximumWidth);
    // Calendar v3's hybrid overlap and corners.
    expect(swiftConstant("overlapCloseMinutes")).toBe(CALENDAR_V3_OVERLAP.closeMinutes);
    expect(swiftConstant("overlapIndent")).toBe(CALENDAR_V3_OVERLAP.indent);
    expect(swiftConstant("overlapMinimumNestedWidth")).toBe(CALENDAR_V3_OVERLAP.minimumNestedWidth);
    expect(swiftConstant("blockCornerRadius")).toBe(CALENDAR_V3_OVERLAP.cornerRadius);
    expect(swiftConstant("nestedCanvasWash")).toBe(CALENDAR_V3_TINT.nestedCanvasWash);
    expect(swiftConstant("maximumLabelTextScale")).toBe(CALENDAR_BLOCK_LABEL.iosMaximumTextScale);
    expect(swiftConstant("legStripMinimumHeight")).toBe(CALENDAR_BLOCK_LABEL.legStripMinimumHeight);
    expect(swiftConstant("columnTouchTolerance")).toBe(CALENDAR_BLOCK_LABEL.touchTolerance);
    // The title wins: no length beside it, and words are never split (DayframeCalendarTitleFit).
    expect(rootView).not.toContain("entry.lengthLabel");
    expect(rootView).toContain("DayframeCalendarTitleFit.lines(");
    expect(core).toContain("public enum DayframeCalendarTitleFit");
    // Columns spread right where the next is free; suggestions share them.
    expect(core).toContain("DayframeCalendarColumnMath.layout(members, expandRight: true)");
    // The old 4-point minimum and "no title under 24 points" rules are gone.
    expect(core).not.toContain("minimumVisibleBlockHeight");
    expect(core).not.toContain("titleMinimumHeight");
  });

  it("lays out columns natively at every zoom, with drawing and hit testing sharing one layout", () => {
    expect(core).toContain("public enum DayframeCalendarColumnMath");
    expect(core).toContain("public enum DayframeCalendarDayLayout");
    expect(rootView).toContain("let dayLayout = DayframeCalendarDayLayout.layout(");
    expect(coordinator).toContain("let dayLayout = DayframeCalendarDayLayout.layout(");
    expect(rootView).toContain("textScale: labelTextScale");
    expect(coordinator).toContain("textScale: model.labelTextScale");
    // Zoom is direct manipulation: no easing of column changes while the fingers move.
    expect(model).toMatch(/func updateHourHeight[\s\S]*?transaction\.disablesAnimations = true/);
  });

  it("still ships a glyph for every activity icon; a column too narrow for words is colour only", () => {
    const manifest = JSON.parse(readFileSync(`${moduleRoot}ios/Glyphs/manifest.json`, "utf8")) as Record<string, unknown>;
    const icons = readFileSync(fileURLToPath(new URL("../../../../packages/shared/src/icons.ts", import.meta.url)), "utf8");
    for (const [, glyph] of icons.matchAll(/glyph: "([a-z0-9-]+)"/g)) expect(manifest).toHaveProperty(`activity-${glyph}`);
    expect(manifest).toHaveProperty("activity-circle-dot");
    expect(rootView).not.toContain('DayframeCalendarGlyph(name: "activity-');
    expect(rootView).toContain("if !label.sliver {");
  });

  it("switches Day · List from the view menu and, in List, sizes itself to its header (location v4 step 9, Calendar v3)", () => {
    const rootView = readFileSync(`${moduleRoot}ios/DayframeCalendarRootView.swift`, "utf8");
    const moduleSource = readFileSync(`${moduleRoot}ios/DayframeCalendarModule.swift`, "utf8");
    const dashboard = readFileSync(dashboardPath, "utf8");
    expect(rootView).toContain('actions.changeLayout(presentation.isList ? "grid" : "list")');
    expect(rootView).toContain("actions.reportHeaderHeight(");
    expect(rootView).toContain("if !presentation.isList {");
    // The app owns the Day ↔ List handoff: its List fades over the native view, which switches at once.
    // Nothing in the view animates the switch.
    expect(rootView).not.toMatch(/value: presentation\.isList/);
    expect(dashboard).toContain("exiting={localPresenceExiting(reduceMotion)}");
    expect(moduleSource).toContain('"onChangeLayout"');
    expect(moduleSource).toContain('"onHeaderHeight"');
    expect(dashboard).toContain("<CalendarListView");
    expect(dashboard).toContain("AsyncStorage.setItem(CALENDAR_LAYOUT_KEY, layout)");
  });
});

