import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { MobileTheme } from "./mobileTheme";
import {
  buildNativeCalendarBridgeState,
  routeNativeCalendarOpenEvent,
  routeNativeCalendarRefresh
} from "./nativeCalendarPresentation";

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

    expect(state.model.modelVersion).toBe(2);
    expect(state.model.dayEndMs - state.model.dayStartMs).toBe(24 * 60 * 60 * 1000);
    expect(state.model.totalSeconds).toBe(90 * 60);
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
});

function build(now: number, data: MobileBootstrap) {
  return buildNativeCalendarBridgeState({
    data,
    now,
    reduceMotion: false,
    reduceTransparency: false,
    refreshing: false,
    selectedDayKey: "2026-07-10",
    theme: darkTheme(),
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
