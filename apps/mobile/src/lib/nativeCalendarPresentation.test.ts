import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME, blockColorsFor } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { MobileTheme } from "./mobileTheme";
import {
  REVIEW_LANE_MAX_LANES,
  buildNativeCalendarBridgeState,
  reviewTargetEnvelope,
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
    // Dense-day rules: a running block's time and length line runs to "now" with the length so far.
    expect(serialized.meta).toMatch(/^10:00–now · 2h$/);
    expect(serialized.lengthLabel).toMatch(/^\d+(h|m)/);
    expect(serialized.accessibilityLabel).toMatch(/ to now, /);
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

  it("shows every open suggestion with a time window in the Review lane, as the ribbon does (UIA-060)", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const item = (id: string, eventType: string, startHour: number, status = "open") => ({
      categoryColor: "amber", categoryName: "Reading", confidence: "medium",
      createdAt: iso(localTime(2026, 7, 10, startHour, 0)), eventSource: "health_workout", eventType, id,
      notes: null, placeName: null, rawPayload: null, status, suggestedCategoryId: null, suggestedPlaceId: null,
      suggestedStartedAt: iso(localTime(2026, 7, 10, startHour, 0)), suggestedStoppedAt: iso(localTime(2026, 7, 10, startHour, 45)),
      title: "Reading", type: "review"
    });
    const state = build(now, bootstrap([], {
      reviewItems: [
        item("workout", "health_workout_import", 7),
        item("visit", "learned_place_visit", 9),
        item("closed", "learned_place_visit", 10, "accepted")
      ]
    }));
    expect(state.model.entries.map((entry) => entry.actionId)).toEqual(["workout", "visit"]);
    expect(state.model.entries.every((entry) => entry.actionKind === "review")).toBe(true);
    expect(state.model.emptyState).toBe("Nothing framed yet.");
  });

  describe("Review lane density and linkage (Codex r1 on #317)", () => {
    const suggestion = (id: string, startHour: number, startMinute: number, minutes: number, linkedEntryIds?: string[]) => ({
      categoryColor: null, categoryName: null, confidence: "medium",
      createdAt: iso(localTime(2026, 7, 10, startHour, startMinute)), eventSource: "health_workout",
      eventType: "health_workout_import", id, notes: null, placeName: null, rawPayload: null, status: "open",
      suggestedCategoryId: null, suggestedPlaceId: null,
      suggestedStartedAt: iso(localTime(2026, 7, 10, startHour, startMinute)),
      suggestedStoppedAt: iso(localTime(2026, 7, 10, startHour, startMinute) + minutes * 60_000),
      title: `Suggestion ${id}`, type: "review",
      ...(linkedEntryIds ? { linkedEntryIds } : {})
    });
    const needsReview = (id: string, startHour: number, minutes: number) => entry({
      id, reviewStatus: "needs_review", source: "health_workout",
      startedAt: iso(localTime(2026, 7, 10, startHour, 0)),
      stoppedAt: iso(localTime(2026, 7, 10, startHour, 0) + minutes * 60_000)
    });
    const now = localTime(2026, 7, 10, 23, 0);

    it("draws a linked suggestion and its needs-review entry once, as the suggestion", () => {
      const state = build(now, bootstrap([needsReview("entry-linked", 7, 45)], {
        reviewItems: [suggestion("workout", 7, 0, 45, ["entry-linked"])]
      }));
      expect(state.model.entries.map((item) => [item.entryId, item.actionKind, item.actionId])).toEqual([
        ["review:workout", "review", "workout"]
      ]);
    });

    it("keeps unlinked needs-review entries and confirmed time that overlap a suggestion", () => {
      const state = build(now, bootstrap([
        needsReview("entry-legacy", 7, 30),
        entry({ id: "entry-work", startedAt: iso(localTime(2026, 7, 10, 7, 0)), stoppedAt: iso(localTime(2026, 7, 10, 8, 0)) })
      ], {
        reviewItems: [suggestion("workout", 7, 0, 45, ["some-other-entry"])]
      }));
      expect(state.model.entries.map((item) => item.entryId).sort()).toEqual(["entry-legacy", "entry-work", "review:workout"]);
    });

    it("draws only the suggestions the Grid is given, the \"?\" that still ask, as the List does (Codex r1 on #610)", () => {
      const data = bootstrap([], { reviewItems: [suggestion("asking", 9, 0, 60), suggestion("expired", 13, 0, 60), suggestion("folded", 15, 0, 30)] });
      const state = buildNativeCalendarBridgeState({ data, now, reduceMotion: false, reduceTransparency: false, refreshing: false,
        reviewItemIds: new Set(["asking"]), selectedDayKey: "2026-07-10", theme: darkTheme(), transitionDirection: 1 });
      expect(state.model.entries.map((item) => item.entryId)).toEqual(["review:asking"]);
      // Without the set, every open suggestion still draws (an older caller).
      expect(build(now, data).model.entries).toHaveLength(3);
    });

    it("an older server without links still draws both (no dedupe guess)", () => {
      const state = build(now, bootstrap([needsReview("entry-legacy", 7, 45)], {
        reviewItems: [suggestion("workout", 7, 0, 45)]
      }));
      expect(state.model.entries).toHaveLength(2);
    });

    it("puts overlapping suggestions side by side in the blocks' own columns (dense-day rules)", () => {
      const state = build(now, bootstrap([], {
        reviewItems: [suggestion("a", 9, 0, 60), suggestion("b", 9, 15, 60)]
      }));
      const items = state.model.entries;
      expect(items.map((item) => item.actionId)).toEqual(["a", "b"]);
      for (const item of items) {
        expect(item).toMatchObject({ columnGroup: "logged", isReview: true, regionOffsetFraction: 0, regionWidthFraction: 1 });
        expect(item.widthFraction).toBeCloseTo(0.5);
      }
      expect(items[0].offsetFraction).not.toBeCloseTo(items[1].offsetFraction);
    });

    it("collapses three or more side by side into one 'N suggestions' block over the whole crowd", () => {
      const state = build(now, bootstrap([needsReview("entry-legacy", 9, 50)], {
        reviewItems: [suggestion("a", 9, 10, 60), suggestion("b", 9, 20, 60), suggestion("c", 9, 30, 15), suggestion("later", 13, 0, 30)]
      }));
      const items = state.model.entries;
      expect(items.map((item) => [item.title, item.actionKind, item.actionId])).toEqual([
        ["4 suggestions", "review", "a"],
        ["Suggestion later", "review", "later"]
      ]);
      const crowd = items[0];
      expect(crowd.startedAtMs).toBe(localTime(2026, 7, 10, 9, 0));
      expect(crowd.stoppedAtMs).toBe(localTime(2026, 7, 10, 10, 20));
      expect(crowd.widthFraction).toBeCloseTo(1);
      expect(crowd.isReview).toBe(true);
    });

    it("a short suggestion inside a longer one sits beside it, never as an inset strip (Codex r2)", () => {
      const state = build(now, bootstrap([], {
        reviewItems: [suggestion("gym", 9, 0, 60), suggestion("workout", 9, 15, 30)]
      }));
      const items = state.model.entries;
      expect(items.map((item) => [item.actionId, item.layoutMode])).toEqual([["gym", "lane"], ["workout", "lane"]]);
      for (const item of items) expect(item.widthFraction).toBeCloseTo(0.5);
      expect(items[0].offsetFraction).not.toBeCloseTo(items[1].offsetFraction);
    });

    it("keeps the target envelope that forms crowds (Codex r9; location v4 C6)", () => {
      // 09:00–09:01 draws 4 points on an older build and one label line on a current one, so its
      // 55-minute envelope is 08:35–09:39:41.25. iOS itself lays suggestions out by what it draws.
      const seconds = (value: number) => value * 1000;
      expect(reviewTargetEnvelope(localTime(2026, 7, 10, 9, 0), localTime(2026, 7, 10, 9, 1), localTime(2026, 7, 10, 0, 0), localTime(2026, 7, 11, 0, 0)))
        .toEqual({ start: localTime(2026, 7, 10, 8, 35), end: localTime(2026, 7, 10, 9, 39) + seconds(41.25) });
    });

    it("suggestions apart in time keep the whole width", () => {
      const state = build(now, bootstrap([], { reviewItems: [suggestion("a", 9, 0, 1), suggestion("b", 10, 5, 5)] }));
      for (const item of state.model.entries) {
        expect(item.offsetFraction).toBe(0);
        expect(item.widthFraction).toBe(1);
      }
    });

    it("each crowd says its own time range and what it opens (Codex r2)", () => {
      const state = build(now, bootstrap([], {
        reviewItems: [
          suggestion("a", 9, 0, 60), suggestion("b", 9, 10, 60), suggestion("c", 9, 20, 30),
          suggestion("d", 14, 0, 30), suggestion("e", 14, 5, 30), suggestion("f", 14, 10, 30)
        ]
      }));
      expect(state.model.entries.map((item) => item.accessibilityLabel)).toEqual([
        "Needs review: 3 suggestions, 09:00 to 10:10. Opens Suggestion a first.",
        "Needs review: 3 suggestions, 14:00 to 14:40. Opens Suggestion d first."
      ]);
    });

    it("a chain that never has three at once stays as separate blocks", () => {
      const state = build(now, bootstrap([], {
        reviewItems: [suggestion("a", 9, 0, 40), suggestion("b", 9, 30, 40), suggestion("c", 10, 0, 40)]
      }));
      expect(state.model.entries.map((item) => item.actionId)).toEqual(["a", "b", "c"]);
    });

    it("a crowd of only older needs-review entries opens the Review list", () => {
      const state = build(now, bootstrap([needsReview("x", 9, 60), needsReview("y", 9, 60), needsReview("z", 9, 60)]));
      expect(state.model.entries.map((item) => [item.title, item.actionKind, item.actionId])).toEqual([
        ["3 suggestions", "review", ""]
      ]);
      expect(state.model.entries[0].accessibilityLabel).toBe("Needs review: 3 suggestions, 09:00 to 10:00. Opens the Review list.");
      const onOpenReview = vi.fn();
      routeNativeCalendarOpenEvent({ actionId: "", kind: "review" }, state.actionEntries, {
        onOpenActive: vi.fn(), onOpenCompleted: vi.fn(), onOpenReview
      });
      expect(onOpenReview).toHaveBeenCalledWith("");
    });
  });

  it("presents one-time place labels as Calendar locations", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const state = build(now, bootstrap([entry({
      placeName: "Noodle House",
      placeKind: "one_time"
    })]));

    expect(state.model.entries[0]).toMatchObject({
      placeText: "Noodle House",
      accessibilityLabel: expect.stringContaining("Place: Noodle House")
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
    // Side by side, never an inset over the longer block (Trello 210): the longer block keeps the
    // left column with its text, the short one the right. Apart horizontally, so the short block's
    // hit geometry no longer counts the longer one.
    expect(contained.model.entries.find((item) => item.entryId === "base")).toMatchObject({
      layoutMode: "lane",
      offsetFraction: 0,
      widthFraction: 0.5,
      overlapCount: 0,
      warningOverlapCount: 1
    });
    expect(contained.model.entries.find((item) => item.entryId === "short")).toMatchObject({
      layoutMode: "lane",
      offsetFraction: 0.5,
      widthFraction: 0.5,
      overlapCount: 0,
      overlapSeconds: 1_800,
      textDensity: "full",
      warningOverlapCount: 1
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
    // Three columns; iOS measures each column and shows the title wherever it fits.
    expect(dense.model.entries.map((item) => [item.entryId, item.laneIndex, item.laneCount])).toEqual([
      ["a", 0, 3], ["b", 1, 3], ["c", 2, 3]
    ]);
    expect(dense.model.entries.every((item) => item.layoutMode === "lane" && item.textDensity === "full")).toBe(true);
  });

  describe("overlap columns (Trello 210)", () => {
    const now = localTime(2026, 7, 10, 23, 0);
    const at = (hour: number, minute: number, second = 0) => localTime(2026, 7, 10, hour, minute) + second * 1000;
    const block = (id: string, start: number, stop: number | null, overrides: Partial<MobileTimeEntry> = {}) =>
      entry({ id, startedAt: iso(start), stoppedAt: stop === null ? null : iso(stop), ...overrides });
    const byId = (state: ReturnType<typeof build>) => new Map(state.model.entries.map((item) => [item.entryId, item]));
    const expectSideBySide = (state: ReturnType<typeof build>, ids: string[]) => {
      const items = byId(state);
      for (const [index, left] of ids.entries()) {
        for (const right of ids.slice(index + 1)) {
          const a = items.get(left)!;
          const b = items.get(right)!;
          const apart = a.offsetFraction + a.widthFraction <= b.offsetFraction + 1e-9
            || b.offsetFraction + b.widthFraction <= a.offsetFraction + 1e-9;
          expect(apart, `${left} and ${right} share horizontal space`).toBe(true);
        }
      }
    };

    it("the owner's Gym block and a 07:00–07:05 manual block sit side by side, the Gym block on the left", () => {
      const state = build(now, bootstrap([
        block("gym", at(6, 59), at(8, 4), { categoryName: "Gym", categoryColor: "green", placeName: "Example Gym" }),
        block("manual", at(7, 0), at(7, 5), { categoryColor: "green" })
      ]));
      const items = byId(state);
      expect(items.get("gym")).toMatchObject({ laneIndex: 0, laneCount: 2, offsetFraction: 0, widthFraction: 0.5, textDensity: "full", placeText: "Example Gym" });
      expect(items.get("manual")).toMatchObject({ laneIndex: 1, laneCount: 2, offsetFraction: 0.5, widthFraction: 0.5, textDensity: "full" });
      // Apart, so the short block keeps its 44-point target inside its own column.
      expect(items.get("manual")?.overlapCount).toBe(0);
      expect(items.get("gym")?.overlapCount).toBe(0);
      // The overlap dot and VoiceOver note still say they overlap.
      expect(items.get("manual")?.warningOverlapCount).toBe(1);
      expect(items.get("manual")?.accessibilityLabel).toContain("Overlaps 1 other entry.");
      expectSideBySide(state, ["gym", "manual"]);
    });

    it("blocks starting together put the longer one on the left", () => {
      const state = build(now, bootstrap([
        block("short", at(7, 0), at(7, 5)),
        block("long", at(7, 0), at(8, 0))
      ]));
      const items = byId(state);
      expect(items.get("long")?.laneIndex).toBe(0);
      expect(items.get("short")?.laneIndex).toBe(1);
    });

    it("a nested pair inside a longer block takes three columns", () => {
      const state = build(now, bootstrap([
        block("outer", at(9, 0), at(12, 0)),
        block("middle", at(9, 30), at(11, 0)),
        block("inner", at(10, 0), at(10, 30))
      ]));
      const items = byId(state);
      expect(["outer", "middle", "inner"].map((id) => [items.get(id)?.laneIndex, items.get(id)?.laneCount])).toEqual([[0, 3], [1, 3], [2, 3]]);
      expectSideBySide(state, ["outer", "middle", "inner"]);
    });

    it("a chain of overlaps is one cluster of two columns, and a later block reuses a free column", () => {
      const state = build(now, bootstrap([
        block("a", at(9, 0), at(10, 0)),
        block("b", at(9, 30), at(11, 0)),
        block("c", at(10, 30), at(12, 0)),
        block("apart", at(14, 0), at(15, 0))
      ]));
      const items = byId(state);
      expect(["a", "b", "c"].map((id) => [items.get(id)?.laneIndex, items.get(id)?.laneCount])).toEqual([[0, 2], [1, 2], [0, 2]]);
      expectSideBySide(state, ["a", "b"]);
      expectSideBySide(state, ["b", "c"]);
      expect(items.get("apart")).toMatchObject({ layoutMode: "full", offsetFraction: 0, widthFraction: 1, laneCount: 1, zIndex: 0 });
    });

    it("lays the running block out to now, keeping it active and side by side", () => {
      const running = block("running", at(22, 0), null, { durationSeconds: 1 });
      const state = build(now, bootstrap([
        running,
        block("added", at(22, 30), at(22, 40))
      ], { activeEntry: running }));
      const items = byId(state);
      expect(items.get("running")).toMatchObject({ actionKind: "active", isActive: true, laneIndex: 0, laneCount: 2, stoppedAtMs: null });
      expect(items.get("added")).toMatchObject({ laneIndex: 1, laneCount: 2 });
      // Before the running block reaches 22:30 the two do not overlap and both keep the full width.
      const earlier = byId(build(at(22, 20), bootstrap([running, block("added", at(22, 30), at(22, 40))], { activeEntry: running })));
      expect(earlier.get("running")).toMatchObject({ laneCount: 1, widthFraction: 1 });
    });

    it("a very short block inside a longer one still gets its own column, and keeps a full target there", () => {
      // 30 seconds: under the one-minute overlap rule, but iOS draws it at least 4 points tall.
      const state = build(now, bootstrap([
        block("gym", at(6, 59), at(8, 0)),
        block("blip", at(7, 0), at(7, 0, 30))
      ]));
      const items = byId(state);
      expect(items.get("blip")).toMatchObject({ laneIndex: 1, laneCount: 2, overlapCount: 0, warningOverlapCount: 0 });
      expectSideBySide(state, ["gym", "blip"]);
    });

    it("back-to-back and sub-minute brushes stay full width", () => {
      const state = build(now, bootstrap([
        block("first", at(7, 0), at(7, 2)),
        block("next", at(7, 2), at(8, 0)),
        // Shares 30 seconds with "next" at its end: drawn as touching, as before.
        block("brush", at(7, 59, 30), at(8, 30))
      ]));
      for (const item of state.model.entries) {
        expect(item).toMatchObject({ layoutMode: "full", offsetFraction: 0, widthFraction: 1 });
      }
    });

    it("short blocks sharing a reused column never grow targets over each other at any zoom (Codex r1 on #357)", () => {
      const close = build(now, bootstrap([
        block("long", at(9, 0), at(12, 0)),
        block("s1", at(9, 30), at(9, 35)),
        block("s2", at(9, 36), at(9, 41))
      ]));
      const items = byId(close);
      expect([items.get("s1")?.laneIndex, items.get("s2")?.laneIndex]).toEqual([1, 1]);
      // Their targets would meet: neither grows past its painted block.
      expect(items.get("s1")?.overlapCount).toBeGreaterThan(0);
      expect(items.get("s2")?.overlapCount).toBeGreaterThan(0);
      expectTapsResolve(close);

      // Far apart in the same column, both keep the 44-point target.
      const apart = build(now, bootstrap([
        block("long", at(9, 0), at(12, 0)),
        block("s1", at(9, 30), at(9, 35)),
        block("s2", at(10, 40), at(10, 45))
      ]));
      const apartItems = byId(apart);
      expect([apartItems.get("s1")?.laneIndex, apartItems.get("s2")?.laneIndex]).toEqual([1, 1]);
      expect([apartItems.get("s1")?.overlapCount, apartItems.get("s2")?.overlapCount]).toEqual([0, 0]);
      expectTapsResolve(apart);
    });

    it("the owner's case resolves every tap to the block under the finger at any zoom", () => {
      expectTapsResolve(build(now, bootstrap([
        block("gym", at(6, 59), at(8, 4)),
        block("manual", at(7, 0), at(7, 5)),
        block("after", at(8, 30), at(9, 0))
      ])));
    });

    it("blocks drawn at the same place after the autumn clock change get a column each (Codex r1 on #357)", () => withTz("Europe/London", () => {
      // 25 Oct 2026: 00:45Z is 01:45 BST; 01:15Z and 01:20Z are 01:15 and 01:20 GMT. iOS draws both
      // at 01:45, 4 points tall.
      const state = build(Date.parse("2026-10-25T20:00:00Z"), bootstrap([
        entry({ id: "a", startedAt: "2026-10-25T00:45:00.000Z", stoppedAt: "2026-10-25T01:15:00.000Z" }),
        entry({ id: "b", startedAt: "2026-10-25T00:45:00.000Z", stoppedAt: "2026-10-25T01:20:00.000Z" })
      ]), undefined, "2026-10-25");
      const items = byId(state);
      expect(items.get("a")?.laneCount).toBe(2);
      expect(items.get("b")?.laneCount).toBe(2);
      expect(items.get("a")?.laneIndex).not.toBe(items.get("b")?.laneIndex);
      expectSideBySide(state, ["a", "b"]);
      expectTapsResolve(state);
    }));

    it("a block stretched across the spring clock change lanes with what is drawn beside it (Codex r1 on #357)", () => withTz("Europe/London", () => {
      // 29 Mar 2026: 01:00Z is 02:00 BST. "gap" is drawn 00:50–02:10, "inside" 02:05–02:08 and
      // "after" 02:10–02:30, back to back with "gap".
      const state = build(Date.parse("2026-03-29T20:00:00Z"), bootstrap([
        entry({ id: "gap", startedAt: "2026-03-29T00:50:00.000Z", stoppedAt: "2026-03-29T01:10:00.000Z" }),
        entry({ id: "inside", startedAt: "2026-03-29T01:05:00.000Z", stoppedAt: "2026-03-29T01:08:00.000Z" }),
        entry({ id: "after", startedAt: "2026-03-29T01:10:00.000Z", stoppedAt: "2026-03-29T01:30:00.000Z" })
      ]), undefined, "2026-03-29");
      const items = byId(state);
      expect([items.get("gap")?.laneIndex, items.get("inside")?.laneIndex]).toEqual([0, 1]);
      expect(items.get("inside")?.laneCount).toBe(2);
      expect(items.get("after")).toMatchObject({ laneCount: 1, widthFraction: 1 });
      expectTapsResolve(state);
    }));

    it("an overlapping pair and a suggestion share one set of columns (dense-day rules)", () => {
      const state = build(now, bootstrap([
        block("gym", at(6, 59), at(8, 4)),
        block("manual", at(7, 0), at(7, 5)),
        entry({ id: "suggestion", reviewStatus: "needs_review", startedAt: iso(at(7, 30)), stoppedAt: iso(at(7, 50)) })
      ]));
      const items = byId(state);
      expect(items.get("gym")?.offsetFraction).toBeCloseTo(0);
      expect(items.get("gym")?.widthFraction).toBeCloseTo(0.5);
      expect(items.get("manual")?.offsetFraction).toBeCloseTo(0.5);
      // The suggestion takes the column Manual has finished with, beside Gym.
      expect(items.get("suggestion")?.offsetFraction).toBeCloseTo(0.5);
      expect(items.get("suggestion")?.widthFraction).toBeCloseTo(0.5);
      expect(items.get("suggestion")?.regionWidthFraction).toBe(1);
      expectSideBySide(state, ["gym", "manual"]);
      expectSideBySide(state, ["gym", "suggestion"]);
    });
  });
});

describe("native Calendar Blocks presentation", () => {
  it("titles the screen with the month and sends no framed line (card C item 1: the day heading says logged)", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const state = build(now, bootstrap([entry({ durationSeconds: 80 * 60, stoppedAt: iso(localTime(2026, 7, 10, 10, 20)) })]));
    const fullDate = new Date(localTime(2026, 7, 10, 0, 0)).toLocaleDateString(undefined, { day: "numeric", month: "long", weekday: "long" });

    expect(state.model.monthTitle).toBe(new Date(now).toLocaleDateString(undefined, { month: "long" }));
    // Kept, always empty, for a native Calendar built before card C (it requires the key, hides "").
    expect(state.model.framedLabel).toBe("");
    expect(state.model).not.toHaveProperty("framedAccessibilityLabel");
    // The selected day in the strip reads its full date; today says so.
    const friday = state.model.weekDays.find((day) => day.isSelected);
    expect(friday?.accessibilityLabel).toBe(`${fullDate}, today`);
    expect(state.model.weekDays.find((day) => !day.isToday)?.accessibilityLabel).not.toContain("today");
  });

  it("gives a block its icon lines: the place, a trip's route or Apple Health, the tags, then the times (Calendar v3)", () => {
    const now = localTime(2026, 7, 10, 23, 0);
    const stoppedAt = iso(localTime(2026, 7, 10, 10, 20));
    const lines = (overrides: Parameters<typeof entry>[0]) =>
      build(now, bootstrap([entry({ durationSeconds: 80 * 60, stoppedAt, ...overrides })])).model.entries[0]?.detailLines;
    expect(lines({ placeName: "Exampleton Library", tags: [{ id: "t", name: "planning" } as never] })).toEqual([
      { glyph: "place", text: "Exampleton Library" },
      { glyph: "tag", text: "planning" },
      { glyph: "time", text: "09:00–10:20" }
    ]);
    expect(lines({ placeName: "Exampleton Station", automaticMoveEventId: "move-1" })?.[0]).toEqual({ glyph: "trip", text: "Exampleton Station" });
    expect(lines({ source: "health_workout", placeName: "Exampleton Park" })?.[0]).toEqual({ glyph: "health", text: "From Apple Health" });
    expect(lines({})).toEqual([{ glyph: "time", text: "09:00–10:20" }]);
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

  it("serializes block colours and puts a Review suggestion beside the block it overlaps (dense-day rules)", () => {
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
      textColor: blockColorsFor("blue", "dark").text,
      warningOverlapCount: 0,
      // Dense-day rules: it shares time with the suggestion, so the two sit side by side.
      widthFraction: 0.5
    });
    expect(review).toMatchObject({
      color: blockColorsFor("amber", "dark").fill,
      textColor: theme.textPrimary,
      warningOverlapCount: 0
    });
    // Side by side, neither covers the other's target; no overlap warning for a suggestion.
    expect(work?.accessibilityLabel).not.toContain("Overlaps");
    expect(review?.offsetFraction).toBeCloseTo(0.5);
    expect(review?.widthFraction).toBeCloseTo(0.5);
    expect(review?.regionWidthFraction).toBe(1);
  });

  it("gives nested Review suggestions full targets in their own lanes, and keeps logged overlaps (Codex r8)", () => {
    const now = localTime(2026, 7, 10, 12, 0);
    const suggestion = (id: string, start: number, stop: number) => entry({
      id,
      reviewStatus: "needs_review",
      startedAt: iso(start),
      stoppedAt: iso(stop)
    });
    const state = build(now, bootstrap([
      suggestion("long", localTime(2026, 7, 10, 9, 0), localTime(2026, 7, 10, 10, 0)),
      suggestion("short", localTime(2026, 7, 10, 9, 20), localTime(2026, 7, 10, 9, 25)),
      entry({ id: "logged-a", startedAt: iso(localTime(2026, 7, 10, 11, 0)), stoppedAt: iso(localTime(2026, 7, 10, 11, 30)) }),
      entry({ id: "logged-b", startedAt: iso(localTime(2026, 7, 10, 11, 15)), stoppedAt: iso(localTime(2026, 7, 10, 11, 45)) })
    ]));
    const byId = new Map(state.model.entries.map((candidate) => [candidate.entryId, candidate]));

    // Separate Review lanes, so iOS may give each its 44-point target.
    expect(byId.get("short")?.overlapCount).toBe(0);
    expect(byId.get("long")?.overlapCount).toBe(0);
    expect(byId.get("short")?.offsetFraction).not.toBeCloseTo(byId.get("long")?.offsetFraction ?? 0);
    expect(byId.get("short")?.warningOverlapCount).toBe(0);
    expect(byId.get("logged-a")?.warningOverlapCount).toBe(1);
    expect(byId.get("logged-a")?.accessibilityLabel).toContain("Overlaps 1 other entry.");
  });

  it("logged blocks and suggestions overlapping in time never share horizontal space (dense-day rules)", () => {
    const now = localTime(2026, 7, 10, 23, 0);
    const span = (id: string, startHour: number, startMinute: number, minutes: number, review = false) => entry({
      id,
      ...(review ? { reviewStatus: "needs_review" } : {}),
      startedAt: iso(localTime(2026, 7, 10, startHour, startMinute)),
      stoppedAt: iso(localTime(2026, 7, 10, startHour, startMinute) + minutes * 60_000)
    });
    const state = build(now, bootstrap([
      span("a", 9, 0, 30), span("b", 9, 0, 30), span("s", 9, 10, 20, true), span("far", 14, 0, 30)
    ]));
    const items = state.model.entries.filter((candidate) => candidate.entryId !== "far");
    for (const [index, left] of items.entries()) {
      for (const right of items.slice(index + 1)) {
        const apart = left.offsetFraction + left.widthFraction <= right.offsetFraction + 1e-9
          || right.offsetFraction + right.widthFraction <= left.offsetFraction + 1e-9;
        expect(apart, `${left.entryId} and ${right.entryId}`).toBe(true);
      }
    }
    const far = state.model.entries.find((candidate) => candidate.entryId === "far")!;
    expect(far.offsetFraction).toBe(0);
    expect(far.widthFraction).toBe(1);
  });

  it("draws a crowd over its drawn (wall-clock) span across a clock change (Codex r11)", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      // 00:45Z is 01:45 BST; 01:00Z and 01:05Z are 01:00 and 01:05 GMT. Drawn: 01:00 to 01:50.
      const suggestion = (id: string, start: string, stop: string) => entry({ id, reviewStatus: "needs_review", startedAt: start, stoppedAt: stop });
      const state = build(Date.parse("2026-10-25T20:00:00Z"), bootstrap([
        suggestion("a", "2026-10-25T00:45:00.000Z", "2026-10-25T00:50:00.000Z"),
        suggestion("b", "2026-10-25T01:00:00.000Z", "2026-10-25T01:05:00.000Z"),
        suggestion("c", "2026-10-25T01:05:00.000Z", "2026-10-25T01:10:00.000Z")
      ]), undefined, "2026-10-25");
      const crowd = state.model.entries.filter((candidate) => candidate.isReview);
      expect(crowd).toHaveLength(1);
      expect(crowd[0].stoppedAtMs).toBeGreaterThan(crowd[0].startedAtMs);
      const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
      expect(clock(crowd[0].startedAtMs)).toBe("01:00");
      expect(clock(crowd[0].stoppedAtMs!)).toBe("01:50");
      expect(crowd[0].accessibilityLabel).toContain("01:00 to 01:50");
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it("a crowd covers an item whose drawn end folds back before its start (Codex r12)", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      // 00:50–01:10Z is drawn at 01:50 BST with iOS's minimum height (its end, 01:10 GMT, is earlier).
      const suggestion = (id: string, start: string, stop: string) => entry({ id, reviewStatus: "needs_review", startedAt: start, stoppedAt: stop });
      const state = build(Date.parse("2026-10-25T20:00:00Z"), bootstrap([
        suggestion("a", "2026-10-25T00:50:00.000Z", "2026-10-25T01:10:00.000Z"),
        suggestion("b", "2026-10-25T01:30:00.000Z", "2026-10-25T01:35:00.000Z"),
        suggestion("c", "2026-10-25T01:35:00.000Z", "2026-10-25T01:40:00.000Z")
      ]), undefined, "2026-10-25");
      const crowd = state.model.entries.filter((candidate) => candidate.isReview);
      expect(crowd).toHaveLength(1);
      const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
      expect(clock(crowd[0].startedAtMs)).toBe("01:30");
      expect(clock(crowd[0].stoppedAtMs!)).toBe("01:55");
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it("a crowd that starts the night before is drawn from midnight on the selected day (Codex r13)", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      const suggestion = (id: string, start: string, stop: string) => entry({ id, reviewStatus: "needs_review", startedAt: start, stoppedAt: stop });
      const state = build(Date.parse("2026-07-10T20:00:00Z"), bootstrap([
        suggestion("a", "2026-07-09T22:00:00.000Z", "2026-07-09T23:01:00.000Z"),
        suggestion("b", "2026-07-09T23:01:00.000Z", "2026-07-09T23:02:00.000Z"),
        suggestion("c", "2026-07-09T23:02:00.000Z", "2026-07-09T23:03:00.000Z")
      ]), undefined, "2026-07-10");
      const crowd = state.model.entries.filter((candidate) => candidate.isReview);
      expect(crowd).toHaveLength(1);
      const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
      expect(new Date(crowd[0].startedAtMs).getDate()).toBe(10);
      expect(clock(crowd[0].startedAtMs)).toBe("00:00");
      expect(clock(crowd[0].stoppedAtMs!)).toBe("00:07");
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it("a crowd's end lands on its drawn wall-clock time across the fold (Codex r13)", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      const suggestion = (id: string, start: string, stop: string) => entry({ id, reviewStatus: "needs_review", startedAt: start, stoppedAt: stop });
      const state = build(Date.parse("2026-10-25T20:00:00Z"), bootstrap([
        suggestion("a", "2026-10-25T00:40:00.000Z", "2026-10-25T00:45:00.000Z"),
        suggestion("b", "2026-10-25T00:55:00.000Z", "2026-10-25T01:10:00.000Z"),
        suggestion("c", "2026-10-25T00:59:00.000Z", "2026-10-25T01:10:00.000Z")
      ]), undefined, "2026-10-25");
      const crowd = state.model.entries.filter((candidate) => candidate.isReview);
      expect(crowd).toHaveLength(1);
      const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
      expect(clock(crowd[0].startedAtMs)).toBe("01:40");
      expect(clock(crowd[0].stoppedAtMs!)).toBe("02:04");
      expect(crowd[0].stoppedAtMs!).toBeGreaterThan(crowd[0].startedAtMs);
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it("a crowd whose drawn end falls in the skipped hour still covers its members (Codex r14)", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      // 29 Mar 2026: 01:00 GMT jumps to 02:00 BST. Drawn: 00:40, 00:55 and 00:58 (min height to 01:03).
      const suggestion = (id: string, start: string, stop: string) => entry({ id, reviewStatus: "needs_review", startedAt: start, stoppedAt: stop });
      const state = build(Date.parse("2026-03-29T20:00:00Z"), bootstrap([
        suggestion("a", "2026-03-29T00:40:00.000Z", "2026-03-29T00:45:00.000Z"),
        suggestion("b", "2026-03-29T00:55:00.000Z", "2026-03-29T00:56:00.000Z"),
        suggestion("c", "2026-03-29T00:58:00.000Z", "2026-03-29T00:59:00.000Z")
      ]), undefined, "2026-03-29");
      const crowd = state.model.entries.filter((candidate) => candidate.isReview);
      expect(crowd).toHaveLength(1);
      const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
      expect(clock(crowd[0].startedAtMs)).toBe("00:40");
      // The first moment drawn at or after 01:03 is 02:00 BST.
      expect(clock(crowd[0].stoppedAtMs!)).toBe("02:00");
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  describe("the Review lane after a clock change keeps targets apart (Codex r15)", () => {
    const withTz = (tz: string, run: () => void) => {
      const previousTz = process.env.TZ;
      process.env.TZ = tz;
      try { run(); } finally {
        if (previousTz === undefined) delete process.env.TZ;
        else process.env.TZ = previousTz;
      }
    };
    const suggestion = (id: string, start: string, stop: string) => entry({ id, reviewStatus: "needs_review", startedAt: start, stoppedAt: stop });
    const expectApart = (state: ReturnType<typeof build>, dayKey: string) => {
      const lane = state.model.entries.filter((candidate) => candidate.isReview);
      const [year, month, day] = dayKey.split("-").map(Number);
      const dayStart = new Date(year, month - 1, day).getTime();
      const dayEnd = new Date(year, month - 1, day + 1).getTime();
      // Crowds keep at most REVIEW_LANE_MAX_LANES suggestions at once; all share the day's columns.
      for (const item of lane) expect(item).toMatchObject({ columnGroup: "logged", isReview: true, regionOffsetFraction: 0, regionWidthFraction: 1 });
      for (const [index, a] of lane.entries()) {
        const meeting = lane.filter((b, other) => other !== index && b.startedAtMs < dayEnd && a.startedAtMs < dayEnd
          && reviewTargetEnvelope(a.startedAtMs, a.stoppedAtMs!, dayStart, dayEnd).start < reviewTargetEnvelope(b.startedAtMs, b.stoppedAtMs!, dayStart, dayEnd).end
          && reviewTargetEnvelope(b.startedAtMs, b.stoppedAtMs!, dayStart, dayEnd).start < reviewTargetEnvelope(a.startedAtMs, a.stoppedAtMs!, dayStart, dayEnd).end);
        expect(meeting.length + 1, `${a.actionId} crowd`).toBeLessThanOrEqual(REVIEW_LANE_MAX_LANES);
      }
      return lane;
    };

    it("a crowd stretched into the skipped hour forms again with later suggestions, never three lanes", () => withTz("Europe/London", () => {
      const state = build(Date.parse("2026-03-29T20:00:00Z"), bootstrap([
        suggestion("a", "2026-03-29T00:40:00.000Z", "2026-03-29T00:45:00.000Z"),
        suggestion("b", "2026-03-29T00:55:00.000Z", "2026-03-29T00:56:00.000Z"),
        suggestion("c", "2026-03-29T00:58:00.000Z", "2026-03-29T00:59:00.000Z"),
        suggestion("d", "2026-03-29T01:01:00.000Z", "2026-03-29T01:02:00.000Z"),
        suggestion("e", "2026-03-29T01:05:00.000Z", "2026-03-29T01:06:00.000Z")
      ]), undefined, "2026-03-29");
      const lane = expectApart(state, "2026-03-29");
      const crowd = lane.find((item) => item.accessibilityLabel.includes("suggestions"));
      expect(crowd?.accessibilityLabel).toContain("5 suggestions");
    }));

    it("a day that starts at 01:00 ends at the next local midnight, so the next day's first hour stays out (Codex r16)", () => withTz("America/Santiago", () => {
      const state = build(Date.parse("2026-09-07T20:00:00Z"), bootstrap([
        suggestion("a", "2026-09-06T04:00:00.000Z", "2026-09-06T04:01:00.000Z"),
        suggestion("b", "2026-09-06T04:15:00.000Z", "2026-09-06T04:16:00.000Z"),
        // 7 Sep 00:30 local: the next day.
        suggestion("c", "2026-09-07T03:30:00.000Z", "2026-09-07T03:31:00.000Z")
      ]), undefined, "2026-09-06");
      expect(new Date(state.model.dayEndMs).getDate()).toBe(7);
      expect(new Date(state.model.dayEndMs).getHours()).toBe(0);
      const lane = expectApart(state, "2026-09-06");
      expect(lane.every((item) => item.startedAtMs < state.model.dayEndMs)).toBe(true);
      expect(lane.map((item) => item.actionId).sort()).toEqual(["a", "b"]);
    }));

    it("a day that starts at 01:00 is drawn from 01:00 (America/Santiago, 6 Sep 2026)", () => withTz("America/Santiago", () => {
      // Clocks go from 00:00 to 01:00; 04:00Z is 01:00 local.
      const state = build(Date.parse("2026-09-06T20:00:00Z"), bootstrap([
        suggestion("a", "2026-09-06T04:00:00.000Z", "2026-09-06T04:01:00.000Z"),
        suggestion("b", "2026-09-06T04:01:00.000Z", "2026-09-06T04:02:00.000Z"),
        suggestion("c", "2026-09-06T04:45:00.000Z", "2026-09-06T04:46:00.000Z")
      ]), undefined, "2026-09-06");
      expectApart(state, "2026-09-06");
    }));
  });

  it("reserves Review targets by the wall-clock time iOS draws, across a clock change (Codex r10)", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      // 25 Oct 2026: 00:00Z is 01:00 BST and 01:00Z is 01:00 GMT, so iOS draws both at 01:00.
      const day = new Date(2026, 9, 25);
      const at = (iso: string) => Date.parse(iso);
      const dayStart = day.getTime();
      const dayEnd = new Date(2026, 9, 26).getTime();
      expect(reviewTargetEnvelope(at("2026-10-25T00:00:00Z"), at("2026-10-25T00:05:00Z"), dayStart, dayEnd))
        .toEqual(reviewTargetEnvelope(at("2026-10-25T01:00:00Z"), at("2026-10-25T01:05:00Z"), dayStart, dayEnd));
      const suggestion = (id: string, start: string, stop: string) => entry({ id, reviewStatus: "needs_review", startedAt: start, stoppedAt: stop });
      const state = build(at("2026-10-25T20:00:00Z"), bootstrap([
        suggestion("bst", "2026-10-25T00:00:00.000Z", "2026-10-25T00:05:00.000Z"),
        suggestion("gmt", "2026-10-25T01:00:00.000Z", "2026-10-25T01:05:00.000Z")
      ]), undefined, "2026-10-25");
      const lane = state.model.entries.filter((candidate) => candidate.isReview);
      expect(lane).toHaveLength(2);
      expect(lane[0].offsetFraction).not.toBeCloseTo(lane[1].offsetFraction);
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
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

  it("passes the phone's 12/24-hour format and writes block times in it (PRD D18)", () => {
    const now = localTime(2026, 7, 10, 23, 0);
    const finished = entry({
      id: "evening",
      startedAt: iso(localTime(2026, 7, 10, 21, 5)),
      stoppedAt: iso(localTime(2026, 7, 10, 22, 0)),
      durationSeconds: 55 * 60
    });
    const base = {
      data: bootstrap([finished]),
      now,
      reduceMotion: false,
      reduceTransparency: false,
      refreshing: false,
      selectedDayKey: "2026-07-10",
      theme: darkTheme(),
      transitionDirection: 1
    };
    const twentyFour = buildNativeCalendarBridgeState(base).model;
    expect(twentyFour.clockFormat).toBe("24h");
    expect(twentyFour.entries[0].meta).toContain("21:05–22:00");
    expect(twentyFour.entries[0].accessibilityLabel).toContain("21:05 to 22:00, 55 minutes");
    const twelve = buildNativeCalendarBridgeState({ ...base, clockFormat: "12h" }).model;
    expect(twelve.clockFormat).toBe("12h");
    expect(twelve.entries[0].meta).toContain("9:05 PM–10:00 PM");
  });

  describe("named patterns (location v3 PR 14b)", () => {
    const tag = { key: "trip-1", name: "School run", parts: 3 };
    const part = (id: string, from: number, to: number) => entry({
      id,
      description: id,
      source: "location_learning",
      locationGroup: tag,
      startedAt: iso(from),
      stoppedAt: iso(to)
    });
    const at = (hour: number, minute: number, day = 10) => localTime(2026, 7, day, hour, minute);
    const trip = () => [part("there", at(8, 0), at(8, 10)), part("stay", at(8, 10), at(8, 30)), part("back", at(8, 30), at(8, 40))];
    const label = (state: ReturnType<typeof build>, id: string) =>
      state.model.entries.find((item) => item.entryId === id)?.accessibilityLabel ?? "";

    it("sends Swift one bracket for a complete trip and keeps its parts as blocks", () => {
      const state = build(at(12, 0), bootstrap([...trip(), entry({ id: "work", startedAt: iso(at(9, 0)), stoppedAt: iso(at(11, 0)) })]));
      expect(state.model.brackets).toEqual([{
        key: "named:trip-1",
        memberIds: ["there", "stay", "back"],
        name: "School run",
        startedAtMs: at(8, 0),
        stoppedAtMs: at(8, 40)
      }]);
      expect(state.model.entries.map((item) => item.entryId)).toEqual(["there", "stay", "back", "work"]);
      expect(JSON.parse(JSON.stringify(state.model)).brackets).toEqual(state.model.brackets);
      // Swift spans the bracket over these parts as drawn, so each must be one of the model's blocks.
      const drawn = new Set(state.model.entries.map((item) => item.entryId));
      expect(state.model.brackets[0].memberIds.every((id) => drawn.has(id))).toBe(true);
    });

    it("says each part's place in the trip once, in that part's own label", () => {
      const state = build(at(12, 0), bootstrap([...trip(), entry({ id: "work", startedAt: iso(at(9, 0)), stoppedAt: iso(at(11, 0)) })]));
      expect(label(state, "there")).toBe("Open time block: there, 08:00 to 08:10, 10 minutes. Part 1 of 3 of School run");
      expect(label(state, "stay")).toContain(". Part 2 of 3 of School run");
      expect(label(state, "back")).toContain(". Part 3 of 3 of School run");
      expect(label(state, "work")).not.toContain("School run");
    });

    it("sends no bracket while a part is missing, a block sits between the parts or the trip runs", () => {
      const [there, stay, back] = trip();
      expect(build(at(12, 0), bootstrap([there, back])).model.brackets).toEqual([]);
      const between = entry({ id: "coffee", startedAt: iso(at(8, 15)), stoppedAt: iso(at(8, 20)) });
      expect(build(at(12, 0), bootstrap([there, stay, between, back])).model.brackets).toEqual([]);
      const running = { ...back, stoppedAt: null };
      expect(build(at(8, 35), bootstrap([there, stay, running], { activeEntry: running })).model.brackets).toEqual([]);
      expect(label(build(at(12, 0), bootstrap([there, back])), "there")).not.toContain("Part");
    });

    it("sends no bracket for a trip across midnight on either day", () => {
      const late = [
        part("there", at(23, 40, 9), at(23, 50, 9)),
        part("stay", at(23, 50, 9), at(0, 20)),
        part("back", at(0, 20), at(0, 30))
      ];
      expect(build(at(12, 0), bootstrap(late)).model.brackets).toEqual([]);
      expect(build(at(12, 0), bootstrap(late), darkTheme(), "2026-07-09").model.brackets).toEqual([]);
    });
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

/** The zooms iOS supports: the most zoomed-out, the default and the closest (hour heights). */
const CALENDAR_ZOOMS = [48, 72, 128];

/**
 * Where iOS draws each block and its tap target at one zoom, mirroring DayframeCalendarBlockMath,
 * DayframeCalendarHorizontalMath and DayframeCalendarVerticalMath (horizontal in column fractions).
 */
/**
 * The hit geometry an older native build (before location v4 C6) gives this model: React's column
 * fractions and its 4-point minimum. Such builds still read the model, so React's own layout must
 * stay tap-safe. A current build lays out columns natively; DayframeCalendarCoreTests checks its taps.
 */
function nativeFrames(state: ReturnType<typeof build>, hourHeight: number) {
  const { dayEndMs, dayStartMs, nowMs } = state.model;
  const minuteOf = (ms: number) => {
    if (ms >= dayEndMs) return 24 * 60;
    const date = new Date(ms);
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60_000;
  };
  return state.model.entries.flatMap((item, order) => {
    const visibleStart = Math.max(item.startedAtMs, dayStartMs);
    const visibleEnd = Math.min(item.stoppedAtMs ?? nowMs, dayEndMs);
    if (!(visibleEnd > visibleStart)) return [];
    const startMinute = minuteOf(visibleStart);
    const height = Math.max(4, (Math.max(1, minuteOf(visibleEnd) - startMinute) / 60) * hourHeight);
    const top = (startMinute / 60) * hourHeight;
    const hitHeight = item.overlapCount > 0 ? height : Math.max(44, height);
    const hitTop = Math.min(Math.max(0, top - (hitHeight - height) / 2), Math.max(0, 24 * hourHeight - hitHeight));
    return [{
      id: item.entryId,
      order,
      zIndex: item.zIndex,
      minX: item.offsetFraction,
      maxX: item.offsetFraction + item.widthFraction,
      paintedCentreY: top + height / 2,
      minY: hitTop,
      maxY: hitTop + hitHeight
    }];
  });
}

/** At every zoom, a tap on the middle of any painted block opens that block and nothing else. */
function expectTapsResolve(state: ReturnType<typeof build>) {
  for (const hourHeight of CALENDAR_ZOOMS) {
    const frames = nativeFrames(state, hourHeight);
    for (const frame of frames) {
      const x = (frame.minX + frame.maxX) / 2;
      const y = frame.paintedCentreY;
      const under = frames.filter((other) => other.minX <= x && x <= other.maxX && other.minY <= y && y <= other.maxY);
      const top = Math.max(...under.map((other) => other.zIndex));
      const winners = under.filter((other) => other.zIndex === top);
      expect(winners.map((other) => other.id), `tap on ${frame.id} at ${hourHeight} points an hour`).toEqual([frame.id]);
    }
  }
}

function withTz(tz: string, run: () => void) {
  const previousTz = process.env.TZ;
  process.env.TZ = tz;
  try { run(); } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
}

function build(now: number, data: MobileBootstrap, theme: MobileTheme = darkTheme(), selectedDayKey = "2026-07-10") {
  return buildNativeCalendarBridgeState({
    data,
    now,
    reduceMotion: false,
    reduceTransparency: false,
    refreshing: false,
    selectedDayKey,
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
