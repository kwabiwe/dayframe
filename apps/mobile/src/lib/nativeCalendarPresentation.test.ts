import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME, blockColorsFor } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { MobileTheme } from "./mobileTheme";
import {
  REVIEW_LANE_WIDTH,
  buildNativeCalendarBridgeState,
  routeNativeCalendarOpenEvent,
  routeNativeCalendarRefresh
} from "./nativeCalendarPresentation";
import { minuteClock, newestShownTimestamp } from "./frameClock";

describe("native Calendar presentation boundary", () => {
  it("serializes fixed 24-hour boundaries, week state, totals, and resolved theme roles", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const data = bootstrap([
      entry({
        id: "cross-midnight",
        startedAt: iso(localTime(2026, 7, 9, 22, 30)),
        stoppedAt: iso(localTime(2026, 7, 10, 1, 30)),
        durationSeconds: 3 * 60 * 60
      })
    ]);
    const theme = darkTheme();
    const state = buildNativeCalendarBridgeState({
      data,
      now,
      reduceMotion: true,
      reduceTransparency: true,
      refreshing: false,
      selectedDayKey: "2026-07-10",
      theme,
      transitionDirection: 1
    });

    expect(state.model.modelVersion).toBe(4);
    expect(state.model.dayEndMs - state.model.dayStartMs).toBe(24 * 60 * 60 * 1000);
    expect(state.model.totalSeconds).toBe(90 * 60);
    expect(state.model.loggedSeconds).toBe(90 * 60);
    expect(state.model.coveredSeconds).toBe(90 * 60);
    expect(state.model.weekDays).toHaveLength(7);
    expect(state.model.weekDays.filter((day) => day.isSelected)).toEqual([
      expect.objectContaining({ dayKey: "2026-07-10" })
    ]);
    expect(state.model.theme).toMatchObject({
      accent: theme.accent,
      background: theme.background,
      border: theme.border,
      surfaceMuted: theme.surfaceMuted,
      textPrimary: theme.textPrimary
    });
    expect(state.model.reduceMotion).toBe(true);
    expect(state.model.reduceTransparency).toBe(true);
  });

  it("uses now for active-entry geometry and keeps the stable active entry identifier", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const active = entry({
      id: "active-entry",
      startedAt: iso(localTime(2026, 7, 10, 10, 0)),
      stoppedAt: null,
      durationSeconds: 1
    });
    const data = bootstrap([active], { activeEntry: active });
    const state = build(now, data);
    const serialized = state.model.entries[0];

    expect(serialized).toMatchObject({
      actionId: "active-entry",
      actionKind: "active",
      entryId: "active-entry",
      isActive: true,
      stoppedAtMs: null
    });
    expect(serialized.meta).toContain("running");
    expect(state.model.totalSeconds).toBe(2 * 60 * 60);
  });

  it("keeps Calendar populated when a refresh returns today entries outside the legacy entries pool", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const dayEntry = entry({ id: "day-entry" });
    const historyEntry = entry({
      id: "history-entry",
      startedAt: iso(localTime(2026, 7, 10, 10, 0)),
      stoppedAt: iso(localTime(2026, 7, 10, 11, 0))
    });
    const data = bootstrap([], {
      dayEntries: [dayEntry],
      historyEntries: [historyEntry],
      weekEntries: []
    });

    const state = build(now, data);

    expect(state.model.entries.map((item) => item.entryId)).toEqual(["day-entry", "history-entry"]);
    expect(state.model.totalSeconds).toBe(2 * 60 * 60);
  });

  it("clips cross-midnight totals and serializes both continuation flags", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const state = build(now, bootstrap([
      entry({
        id: "from-previous",
        startedAt: iso(localTime(2026, 7, 9, 22, 0)),
        stoppedAt: iso(localTime(2026, 7, 10, 1, 0)),
        durationSeconds: 3 * 60 * 60
      }),
      entry({
        id: "into-next",
        startedAt: iso(localTime(2026, 7, 10, 23, 0)),
        stoppedAt: iso(localTime(2026, 7, 11, 2, 0)),
        durationSeconds: 3 * 60 * 60
      })
    ]));

    expect(state.model.totalSeconds).toBe(2 * 60 * 60);
    expect(state.model.entries.find((item) => item.entryId === "from-previous")).toMatchObject({
      startsBeforeDay: true,
      continuesIntoNextDay: false
    });
    expect(state.model.entries.find((item) => item.entryId === "into-next")).toMatchObject({
      startsBeforeDay: false,
      continuesIntoNextDay: true
    });
  });

  it("keeps review callback identifiers separate from their rendered entry identifiers", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const data = bootstrap([], {
      reviewItems: [{
        categoryColor: "amber",
        categoryName: "Commute",
        confidence: "medium",
        createdAt: iso(localTime(2026, 7, 10, 8, 0)),
        eventSource: "location",
        eventType: "commute_detected",
        id: "review-123",
        notes: null,
        placeName: null,
        rawPayload: null,
        status: "open",
        suggestedCategoryId: "category-commute",
        suggestedPlaceId: null,
        suggestedStartedAt: iso(localTime(2026, 7, 10, 8, 0)),
        suggestedStoppedAt: iso(localTime(2026, 7, 10, 8, 30)),
        title: "Commute",
        type: "review"
      }]
    });
    const state = build(now, data);

    expect(state.model.entries[0]).toMatchObject({
      actionId: "review-123",
      actionKind: "review",
      entryId: "review:review-123"
    });
  });

  it("presents one-time place labels as Calendar locations", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const state = build(now, bootstrap([entry({
      placeName: "Wagamama",
      placeKind: "one_time"
    })]));

    expect(state.model.entries[0]).toMatchObject({
      placeText: "Wagamama",
      accessibilityLabel: expect.stringContaining("Place: Wagamama")
    });
  });

  it("routes active, completed, review, and refresh callbacks without a timer mutation path", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const active = entry({ id: "active", stoppedAt: null });
    const completed = entry({ id: "completed" });
    const actionEntries = [
      { ...active, isActive: true },
      { ...completed, isActive: false }
    ];
    const onOpenActive = vi.fn();
    const onOpenCompleted = vi.fn();
    const onOpenReview = vi.fn();
    const onRequestRefresh = vi.fn();
    const directTimerMutation = vi.fn();
    const handlers = { onOpenActive, onOpenCompleted, onOpenReview };

    expect(routeNativeCalendarOpenEvent({ actionId: "active", kind: "active" }, actionEntries, handlers)).toBe(true);
    expect(routeNativeCalendarOpenEvent({ actionId: "completed", kind: "completed" }, actionEntries, handlers)).toBe(true);
    expect(routeNativeCalendarOpenEvent({ actionId: "review-9", kind: "review" }, actionEntries, handlers)).toBe(true);
    routeNativeCalendarRefresh(onRequestRefresh);

    expect(onOpenActive).toHaveBeenCalledWith("active");
    expect(onOpenCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: "completed" }));
    expect(onOpenReview).toHaveBeenCalledWith("review-9");
    expect(onRequestRefresh).toHaveBeenCalledOnce();
    expect(directTimerMutation).not.toHaveBeenCalled();
    expect(build(now, bootstrap([])).model.nowMs).toBe(now);
  });

  it("serializes quiet tag metadata for Swift without giving Swift a tag data store", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const state = build(now, bootstrap([entry({
      tags: [
        { id: "tag-1", name: "Planning", normalizedName: "planning" },
        { id: "tag-2", name: "Deep work", normalizedName: "deep-work" }
      ]
    })]));

    expect(state.model.entries[0].tagText).toBe("Planning · Deep work");
    expect(state.model.entries[0].accessibilityLabel).toContain("Tags: Planning · Deep work");
  });

  it("serializes deterministic contained, partial, and dense overlap layout intent", () => {
    const now = localTime(2026, 7, 10, 14, 0);
    const contained = build(now, bootstrap([
      entry({
        id: "base",
        startedAt: iso(localTime(2026, 7, 10, 9, 0)),
        stoppedAt: iso(localTime(2026, 7, 10, 12, 0))
      }),
      entry({
        id: "short",
        startedAt: iso(localTime(2026, 7, 10, 10, 0)),
        stoppedAt: iso(localTime(2026, 7, 10, 10, 30))
      })
    ]));
    expect(contained.model.entries.find((item) => item.entryId === "short")).toMatchObject({
      layoutMode: "insetOverlay",
      offsetFraction: 0.18,
      widthFraction: 0.8200000000000001,
      overlapCount: 1,
      overlapSeconds: 1_800
    });
    expect(contained.model).toMatchObject({
      loggedSeconds: 12_600,
      coveredSeconds: 10_800,
      additionalOverlapSeconds: 1_800
    });

    const dense = build(now, bootstrap([
      entry({ id: "a", startedAt: iso(localTime(2026, 7, 10, 9, 0)), stoppedAt: iso(localTime(2026, 7, 10, 12, 0)) }),
      entry({ id: "b", startedAt: iso(localTime(2026, 7, 10, 10, 0)), stoppedAt: iso(localTime(2026, 7, 10, 13, 0)) }),
      entry({ id: "c", startedAt: iso(localTime(2026, 7, 10, 11, 0)), stoppedAt: iso(localTime(2026, 7, 10, 14, 0)) })
    ]));
    expect(dense.model.entries.every((item) => item.layoutMode === "compactLane")).toBe(true);
    expect(dense.model.entries.every((item) => item.textDensity === "none")).toBe(true);
  });
});

describe("native Calendar Blocks presentation", () => {
  it("titles the screen with the month and says how much was framed on the selected day", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const state = build(now, bootstrap([entry({ durationSeconds: 80 * 60, stoppedAt: iso(localTime(2026, 7, 10, 10, 20)) })]));
    const weekday = new Date(localTime(2026, 7, 10, 0, 0)).toLocaleDateString(undefined, { weekday: "long" });

    expect(state.model.monthTitle).toBe(new Date(now).toLocaleDateString(undefined, { month: "long" }));
    expect(state.model.framedLabel).toBe(`1h 20m framed on ${weekday}`);

    const empty = build(now, bootstrap([]));
    expect(empty.model.framedLabel).toBe(`Nothing framed on ${weekday}`);
  });

  it("adds the year to the month title outside the current year", () => {
    const now = localTime(2026, 1, 3, 12, 0);
    const state = buildNativeCalendarBridgeState({
      data: bootstrap([]),
      now,
      reduceMotion: false,
      reduceTransparency: false,
      refreshing: false,
      selectedDayKey: "2025-12-30",
      theme: darkTheme(),
      transitionDirection: -1
    });
    expect(state.model.monthTitle).toBe(new Date(2025, 11, 30).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  });

  it("gives each week-strip day up to three bars for its biggest activities, Review excluded", () => {
    const now = localTime(2026, 7, 10, 23, 0);
    const theme = darkTheme();
    const data = bootstrap([
      entry({ id: "work", categoryId: "work", categoryName: "Work", categoryColor: "blue", startedAt: iso(localTime(2026, 7, 10, 9, 0)), stoppedAt: iso(localTime(2026, 7, 10, 12, 0)) }),
      entry({ id: "gym", categoryId: "gym", categoryName: "Gym", categoryColor: "green", startedAt: iso(localTime(2026, 7, 10, 13, 0)), stoppedAt: iso(localTime(2026, 7, 10, 14, 0)) }),
      entry({ id: "none", categoryId: null, categoryName: null, categoryColor: null, startedAt: iso(localTime(2026, 7, 10, 14, 0)), stoppedAt: iso(localTime(2026, 7, 10, 16, 0)) }),
      entry({ id: "read", categoryId: "read", categoryName: "Reading", categoryColor: "violet", startedAt: iso(localTime(2026, 7, 10, 20, 0)), stoppedAt: iso(localTime(2026, 7, 10, 20, 30)) }),
      entry({ id: "pending", categoryId: "rest", categoryName: "Rest", categoryColor: "red", reviewStatus: "needs_review", startedAt: iso(localTime(2026, 7, 10, 0, 0)), stoppedAt: iso(localTime(2026, 7, 10, 8, 0)) })
    ]);
    const state = buildNativeCalendarBridgeState({
      data,
      now,
      reduceMotion: false,
      reduceTransparency: false,
      refreshing: false,
      selectedDayKey: "2026-07-10",
      theme,
      transitionDirection: 1
    });
    const friday = state.model.weekDays.find((day) => day.dayKey === "2026-07-10");
    const thursday = state.model.weekDays.find((day) => day.dayKey === "2026-07-09");

    expect(friday?.bars).toEqual([
      blockColorsFor("blue", "dark").fill,
      theme.textMuted,
      blockColorsFor("green", "dark").fill
    ]);
    expect(thursday?.bars).toEqual([]);
  });

  it("serializes solid block colours with measured text and puts Review suggestions in their own right lane", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const theme = darkTheme();
    const data = bootstrap([
      entry({ id: "work", startedAt: iso(localTime(2026, 7, 10, 8, 0)), stoppedAt: iso(localTime(2026, 7, 10, 9, 0)) })
    ], {
      reviewItems: [{
        categoryColor: "amber",
        categoryName: "Commute",
        confidence: "medium",
        createdAt: iso(localTime(2026, 7, 10, 8, 0)),
        eventSource: "location",
        eventType: "commute_detected",
        id: "review-123",
        notes: null,
        placeName: null,
        rawPayload: null,
        status: "open",
        suggestedCategoryId: "category-commute",
        suggestedPlaceId: null,
        suggestedStartedAt: iso(localTime(2026, 7, 10, 8, 0)),
        suggestedStoppedAt: iso(localTime(2026, 7, 10, 8, 30)),
        title: "Commute",
        type: "review"
      }]
    });
    const state = build(now, data, theme);
    const work = state.model.entries.find((candidate) => candidate.entryId === "work");
    const review = state.model.entries.find((candidate) => candidate.isReview);

    expect(work).toMatchObject({
      color: blockColorsFor("blue", "dark").fill,
      offsetFraction: 0,
      overlapCount: 0,
      textColor: blockColorsFor("blue", "dark").text,
      widthFraction: 1
    });
    expect(review).toMatchObject({
      color: blockColorsFor("amber", "dark").fill,
      overlapCount: 0,
      textColor: theme.textPrimary
    });
    expect(review?.offsetFraction).toBeCloseTo(1 - REVIEW_LANE_WIDTH);
    expect(review?.widthFraction).toBeCloseTo(REVIEW_LANE_WIDTH);
    expect(review!.zIndex).toBeGreaterThan(work!.zIndex);
  });

  it("passes the Dayframe haptics setting to the native view", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const base = {
      data: bootstrap([]),
      now,
      reduceMotion: false,
      reduceTransparency: false,
      refreshing: false,
      selectedDayKey: "2026-07-10",
      theme: darkTheme(),
      transitionDirection: 1
    };
    expect(buildNativeCalendarBridgeState(base).model.hapticsEnabled).toBe(true);
    expect(buildNativeCalendarBridgeState({ ...base, hapticsEnabled: false }).model.hapticsEnabled).toBe(false);
  });
});

describe("native Calendar update cadence", () => {
  // The dashboard feeds the Calendar minuteClock(now, newestShownTimestamp(entries, now)).
  function clock(entries: MobileTimeEntry[], nowMs: number) {
    return minuteClock(nowMs, newestShownTimestamp(entries, nowMs));
  }

  it("sends SwiftUI the same model for every second of a minute while a timer runs", () => {
    const running = entry({ id: "running", startedAt: iso(localTime(2026, 7, 10, 9, 0)), stoppedAt: null });
    const data = bootstrap([running], { activeEntry: running });
    const at = (seconds: number) => JSON.stringify(build(clock([running], localTime(2026, 7, 10, 10, 0) + seconds * 1000), data).model);
    expect(at(1)).toBe(at(59));
    expect(at(61)).not.toBe(at(1));
  });

  it("shows a timer started earlier in the current minute at once, with a positive length", () => {
    const startedAt = localTime(2026, 7, 10, 10, 0) + 30_000;
    const running = entry({ id: "fresh", startedAt: iso(startedAt), stoppedAt: null });
    const data = bootstrap([running], { activeEntry: running });
    const state = build(clock([running], startedAt + 15_000), data);
    expect(state.model.nowMs).toBeGreaterThan(startedAt);
    expect(state.model.entries.some((item) => item.entryId === "fresh")).toBe(true);
    const later = build(clock([running], startedAt + 25_000), data);
    expect(JSON.stringify(later.model)).toBe(JSON.stringify(state.model));
  });
});

function build(now: number, data: MobileBootstrap, theme: MobileTheme = darkTheme()) {
  return buildNativeCalendarBridgeState({
    data,
    now,
    reduceMotion: false,
    reduceTransparency: false,
    refreshing: false,
    selectedDayKey: "2026-07-10",
    theme,
    transitionDirection: 1
  });
}

function bootstrap(
  entries: MobileTimeEntry[],
  overrides: Partial<MobileBootstrap> = {}
): MobileBootstrap {
  return {
    activeEntry: null,
    categories: [{ id: "category-commute", name: "Commute", color: "amber", isPinned: false }],
    entries,
    places: [],
    projects: [],
    reviewItems: [],
    user: { id: "user", email: "user@example.com", name: "User" },
    weekEntries: entries,
    workspace: { id: "workspace", name: "Workspace" },
    ...overrides
  };
}

function entry(overrides: Partial<MobileTimeEntry> = {}): MobileTimeEntry {
  return {
    categoryColor: "blue",
    categoryId: "category-work",
    categoryName: "Work",
    clientName: null,
    confidence: "manual",
    description: "Deep work",
    durationSeconds: 60 * 60,
    id: "entry",
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "mobile_app",
    startedAt: iso(localTime(2026, 7, 10, 9, 0)),
    stoppedAt: iso(localTime(2026, 7, 10, 10, 0)),
    ...overrides
  };
}

function localTime(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function iso(milliseconds: number) {
  return new Date(milliseconds).toISOString();
}

function darkTheme(): MobileTheme {
  return {
    ...DAYFRAME_THEME.dark,
    mode: "dark",
    pressed: DAYFRAME_THEME.dark.accentPressed
  };
}
