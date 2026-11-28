import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ NativeEventEmitter: class {}, NativeModules: {}, Platform: { OS: "ios" } }));

import { blockColorsFor, paletteColorFor } from "@dayframe/shared";
import { buildWatchDisplay, WATCH_NEUTRAL_FILL, WATCH_SEGMENT_LIMIT } from "./watchTimer";

describe("buildWatchDisplay", () => {
  it("names the running activity in its dark block colours and keeps its description", () => {
    const display = buildWatchDisplay({
      activeEntry: { categoryName: "Deep work", categoryColor: "blue", categoryId: "cat-1", description: " Watch concepts " },
      segments: [],
      totalSeconds: 0,
      goalMinutes: 480,
    });
    const colors = blockColorsFor("blue", "dark", "Deep work");
    expect(display).toMatchObject({
      activityName: "Deep work",
      activityFill: colors.fill,
      activityText: colors.text,
      title: "Watch concepts",
      goalSeconds: 28_800,
    });
  });

  it("sends a bare block with no activity colours and no placeholder title", () => {
    const display = buildWatchDisplay({
      activeEntry: { categoryName: null, categoryColor: null, categoryId: null, description: "  " },
      segments: [],
      totalSeconds: 0,
      goalMinutes: 0,
    });
    expect(display).toMatchObject({ activityName: null, activityFill: null, activityText: null, title: null, goalSeconds: null });
  });

  it("rounds today down to whole minutes and limits the strip", () => {
    const segments = Array.from({ length: 6 }, (_, index) => ({ name: `A${index}`, color: index === 1 ? null : "lime", seconds: 600 + index * 61 }));
    const display = buildWatchDisplay({ activeEntry: null, segments, totalSeconds: 12_345, goalMinutes: null });
    expect(display.todaySeconds).toBe(12_300);
    expect(display.segments).toHaveLength(WATCH_SEGMENT_LIMIT);
    expect(display.segments[0]).toEqual({ fill: paletteColorFor("lime", "A0", "dark"), seconds: 600 });
    expect(display.segments[1]).toEqual({ fill: WATCH_NEUTRAL_FILL, seconds: 660 });
    expect(display.segments.every((segment) => segment.seconds % 60 === 0)).toBe(true);
  });

  it("reads the same within a minute, so the Watch is told at most once a minute", () => {
    const at = (seconds: number) => buildWatchDisplay({
      activeEntry: null,
      segments: [{ name: "Gym", color: "lime", seconds }],
      totalSeconds: seconds,
      goalMinutes: 480,
    });
    expect(JSON.stringify(at(3_601))).toBe(JSON.stringify(at(3_659)));
    expect(JSON.stringify(at(3_660))).not.toBe(JSON.stringify(at(3_659)));
  });
});
