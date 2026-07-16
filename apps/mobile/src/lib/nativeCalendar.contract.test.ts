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
});
