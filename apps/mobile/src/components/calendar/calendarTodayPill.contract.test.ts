import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Owner, 30 Oct 2026: a Today pill in the Calendar header, in Grid and List. Swift draws it (the header is SwiftUI) and
// emits one semantic action; React decides; Swift alone moves the Grid.
const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const root = source("../../../modules/dayframe-calendar/ios/DayframeCalendarRootView.swift");
const coordinator = source("../../../modules/dayframe-calendar/ios/DayframeCalendarScrollCoordinator.swift");
const expoView = source("../../../modules/dayframe-calendar/ios/DayframeCalendarExpoView.swift");
const moduleSource = source("../../../modules/dayframe-calendar/ios/DayframeCalendarModule.swift");
const dashboard = source("../DayframeDashboard.tsx");

const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  return text.slice(from, text.indexOf(end, from + start.length));
};

describe("the Calendar Today pill", () => {
  it("sits in the one header row, left of the view button, whatever the layout", () => {
    const header = between(root, "private func calendarHeader(", "/// One round button");
    expect(header.indexOf("Text(presentation.monthTitle)")).toBeLessThan(header.indexOf("DayframeCalendarTodayPill("));
    expect(header.indexOf("DayframeCalendarTodayPill(")).toBeLessThan(header.indexOf("viewMenu(presentation"));
    // Never conditional on the layout or the day.
    expect(header).not.toMatch(/if [^\n]*(isList|todayKey)/);
  });

  it("is the compact pill with a 44-point target and spoken label and hint", () => {
    const pill = between(root, "private struct DayframeCalendarTodayPill: View {", "private struct DayframeCalendarTimelineCanvas");
    expect(pill).toContain("private var textSize: CGFloat = 14");
    expect(pill).toContain(".font(.system(size: textSize, weight: .bold))");
    expect(pill).toContain(".padding(.horizontal, 16)");
    expect(pill).toContain(".frame(minHeight: 32)");
    expect(pill).toContain(".frame(minHeight: 44)");
    expect(pill).toContain('.accessibilityLabel("Today")');
    expect(pill).toContain('.accessibilityHint(isOnToday ? "Scroll to now" : "Go to today")');
  });

  it("only reports the press: React decides", () => {
    expect(root).toContain("actions.pressToday()");
    expect(expoView).toContain('pressToday: { [weak self] in self?.onPressToday([:]) }');
    expect(moduleSource).toContain('"onPressToday"');
    expect(dashboard).toContain("onPressToday={pressCalendarToday}");
  });

  it("uses the Calendar tab's path, so waiting requests stay cancelled and the layout stays", () => {
    const press = between(dashboard, "const pressCalendarToday = useCallback(() => {", "}, [");
    expect(press).toContain("openCalendarToday();");
    expect(press).not.toContain("changeCalendarLayout");
    expect(press).toContain('if (action === "scroll-grid-to-now") setCalendarScrollToNow((count) => count + 1);');
    expect(press).toContain('if (action === "scroll-list-to-now") setCalendarListScrollToNow((count) => count + 1);');
    expect(dashboard).toContain("scrollToNowRequest={calendarListScrollToNow}");
    expect(dashboard).toContain("scrollToNowRequest: calendarScrollToNow");
  });

  it("leaves the Grid's scroll to Swift: one request, one owner, never replayed, jumping under Reduce Motion", () => {
    expect(coordinator).toContain("handledScrollToNowRequest = model.presentation.scrollToNowRequest");
    expect(coordinator).toContain("animated: !presentation.reduceMotion");
    expect(coordinator).toContain("fingerOnTimeline: scrollView.isTracking || pinchStart != nil || creationDragState.session != nil");
    // Used up before the scroll-view guard, so a request can't fire when a scroll view attaches later.
    const sync = between(coordinator, "func synchronize() {", "@objc private func handleRefresh()");
    expect(sync.indexOf("handledScrollToNowRequest = scrollToNowRequest")).toBeLessThan(sync.indexOf("guard let scrollView"));
  });
});
