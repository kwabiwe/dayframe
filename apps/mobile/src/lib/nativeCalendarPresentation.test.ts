import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME, blockColorsFor } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { MobileTheme } from "./mobileTheme";
import {
  REVIEW_LANE_MAX_LANES,
  REVIEW_LANE_WIDTH,
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

    it("an older server without links still draws both (no dedupe guess)", () => {
      const state = build(now, bootstrap([needsReview("entry-legacy", 7, 45)], {
        reviewItems: [suggestion("workout", 7, 0, 45)]
      }));
      expect(state.model.entries).toHaveLength(2);
    });

    it("keeps two overlapping Review items side by side", () => {
      const state = build(now, bootstrap([], {
        reviewItems: [suggestion("a", 9, 0, 60), suggestion("b", 9, 15, 60)]
      }));
      const lane = state.model.entries;
      expect(lane.map((item) => item.actionId)).toEqual(["a", "b"]);
      for (const item of lane) expect(item.widthFraction).toBeCloseTo(REVIEW_LANE_WIDTH / 2);
    });

    it("collapses three or more side by side into one 'N suggestions' block over the whole crowd", () => {
      const state = build(now, bootstrap([needsReview("entry-legacy", 9, 50)], {
        reviewItems: [suggestion("a", 9, 10, 60), suggestion("b", 9, 20, 60), suggestion("c", 9, 30, 15), suggestion("later", 13, 0, 30)]
      }));
      const lane = state.model.entries;
      expect(lane.map((item) => [item.title, item.actionKind, item.actionId])).toEqual([
        ["4 suggestions", "review", "a"],
        ["Suggestion later", "review", "later"]
      ]);
      const crowd = lane[0];
      expect(crowd.startedAtMs).toBe(localTime(2026, 7, 10, 9, 0));
      expect(crowd.stoppedAtMs).toBe(localTime(2026, 7, 10, 10, 20));
      expect(crowd.widthFraction).toBeCloseTo(REVIEW_LANE_WIDTH);
      expect(crowd.isReview).toBe(true);
    });

    it("a short suggestion inside a longer one sits beside it, never as an inset strip (Codex r2)", () => {
      const state = build(now, bootstrap([], {
        reviewItems: [suggestion("gym", 9, 0, 60), suggestion("workout", 9, 15, 30)]
      }));
      const lane = state.model.entries;
      expect(lane.map((item) => [item.actionId, item.layoutMode])).toEqual([["gym", "lane"], ["workout", "lane"]]);
      for (const item of lane) expect(item.widthFraction).toBeCloseTo(REVIEW_LANE_WIDTH / 2);
      expect(lane[0].offsetFraction).not.toBeCloseTo(lane[1].offsetFraction);
    });

    it("two suggestions overlapping by under a minute still get their own lanes (Codex r3)", () => {
      const short = (id: string) => ({ ...suggestion(id, 9, 0, 1), suggestedStoppedAt: iso(localTime(2026, 7, 10, 9, 0) + 30_000) });
      const state = build(now, bootstrap([], { reviewItems: [short("a"), short("b")] }));
      const lane = state.model.entries;
      expect(lane.map((item) => item.layoutMode)).toEqual(["lane", "lane"]);
      expect(lane[0].offsetFraction).not.toBeCloseTo(lane[1].offsetFraction);
      for (const item of lane) expect(item.widthFraction).toBeCloseTo(REVIEW_LANE_WIDTH / 2);
    });

    it("adjacent short suggestions get their own lanes, since their 44-pt targets would overlap (Codex r7)", () => {
      const state = build(now, bootstrap([], { reviewItems: [suggestion("a", 9, 0, 1), suggestion("b", 9, 1, 1)] }));
      const lane = state.model.entries;
      expect(lane.map((item) => item.actionId)).toEqual(["a", "b"]);
      expect(lane[0].offsetFraction).not.toBeCloseTo(lane[1].offsetFraction);
      // Drawn at their real times.
      expect(lane[0].stoppedAtMs).toBe(localTime(2026, 7, 10, 9, 1));
    });

    it("reserves the target around iOS's 4-point minimum block, not the raw time (Codex r9)", () => {
      // 09:00–09:01 draws 4 points tall, so its target centres at 09:02:30 and reaches 09:30; the
      // 09:53–09:58 target starts at 09:28. They overlap, so they need their own lanes.
      expect(reviewTargetEnvelope(localTime(2026, 7, 10, 9, 0), localTime(2026, 7, 10, 9, 1), localTime(2026, 7, 10, 0, 0), localTime(2026, 7, 11, 0, 0)))
        .toEqual({ start: localTime(2026, 7, 10, 8, 35), end: localTime(2026, 7, 10, 9, 30) });
      expect(reviewTargetEnvelope(localTime(2026, 7, 10, 9, 53), localTime(2026, 7, 10, 9, 58), localTime(2026, 7, 10, 0, 0), localTime(2026, 7, 11, 0, 0)))
        .toEqual({ start: localTime(2026, 7, 10, 9, 28), end: localTime(2026, 7, 10, 10, 23) });
      const state = build(now, bootstrap([], { reviewItems: [suggestion("a", 9, 0, 1), suggestion("b", 9, 53, 5)] }));
      const lane = state.model.entries;
      expect(lane.map((item) => item.actionId)).toEqual(["a", "b"]);
      expect(lane[0].offsetFraction).not.toBeCloseTo(lane[1].offsetFraction);
    });

    it("targets that do not overlap share a lane (09:00–09:01 and 09:58–10:03)", () => {
      const state = build(now, bootstrap([], { reviewItems: [suggestion("a", 9, 0, 1), suggestion("b", 9, 58, 5)] }));
      const lane = state.model.entries;
      // a reaches 09:30; b (09:58–10:03) starts its target at 09:33.
      expect(lane[0].offsetFraction).toBeCloseTo(lane[1].offsetFraction);
      expect(lane[0].widthFraction).toBeCloseTo(REVIEW_LANE_WIDTH);
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
        block("gym", at(6, 59), at(8, 4), { categoryName: "Gym", categoryColor: "green", placeName: "PureGym" }),
        block("manual", at(7, 0), at(7, 5), { categoryColor: "green" })
      ]));
      const items = byId(state);
      expect(items.get("gym")).toMatchObject({ laneIndex: 0, laneCount: 2, offsetFraction: 0, widthFraction: 0.5, textDensity: "full", placeText: "PureGym" });
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

    it("an overlapping pair beside the Review lane stays side by side inside the logged part", () => {
      const state = build(now, bootstrap([
        block("gym", at(6, 59), at(8, 4)),
        block("manual", at(7, 0), at(7, 5)),
        entry({ id: "suggestion", reviewStatus: "needs_review", startedAt: iso(at(7, 30)), stoppedAt: iso(at(7, 50)) })
      ]));
      const items = byId(state);
      const loggedWidth = 1 - REVIEW_LANE_WIDTH;
      expect(items.get("gym")?.offsetFraction).toBeCloseTo(0);
      expect(items.get("gym")?.widthFraction).toBeCloseTo(loggedWidth / 2);
      expect(items.get("manual")?.offsetFraction).toBeCloseTo(loggedWidth / 2);
      expect(items.get("manual")?.widthFraction).toBeCloseTo(loggedWidth / 2);
      expect(items.get("suggestion")?.offsetFraction).toBeCloseTo(1 - REVIEW_LANE_WIDTH);
      expect(items.get("suggestion")?.overlapCount).toBe(0);
      // The Gym block overlaps the suggestion, so it keeps its exact (semantic) target.
      expect(items.get("gym")?.overlapCount).toBe(1);
      expect(items.get("manual")?.overlapCount).toBe(0);
      expectSideBySide(state, ["gym", "manual", "suggestion"]);
    });
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
      textColor: blockColorsFor("blue", "dark").text,
      warningOverlapCount: 0,
      // It shares time with a Review target, so it gives the Review lane its columns (Codex r10).
      widthFraction: 1 - REVIEW_LANE_WIDTH
    });
    expect(review).toMatchObject({
      color: blockColorsFor("amber", "dark").fill,
      textColor: theme.textPrimary,
      warningOverlapCount: 0
    });
    // The logged block keeps its exact target (it overlaps); the Review item, alone in its lane
    // beside it, gets its full 44-point target, and the logged block stays reachable to its left.
    expect(work?.overlapCount).toBe(1);
    expect(review?.overlapCount).toBe(0);
    expect(work?.accessibilityLabel).not.toContain("Overlaps");
    expect(review?.offsetFraction).toBeCloseTo(1 - REVIEW_LANE_WIDTH);
    expect(review?.widthFraction).toBeCloseTo(REVIEW_LANE_WIDTH);
    expect(review!.zIndex).toBeGreaterThan(work!.zIndex);
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

  describe("logged blocks beside the Review lane (Codex r10 on #317)", () => {
    const now = localTime(2026, 7, 10, 23, 0);
    const logged = (id: string, startHour: number, startMinute: number, minutes: number) => entry({
      id,
      startedAt: iso(localTime(2026, 7, 10, startHour, startMinute)),
      stoppedAt: iso(localTime(2026, 7, 10, startHour, startMinute) + minutes * 60_000)
    });
    const suggestion = (id: string, startHour: number, startMinute: number, minutes: number) => entry({
      id,
      reviewStatus: "needs_review",
      startedAt: iso(localTime(2026, 7, 10, startHour, startMinute)),
      stoppedAt: iso(localTime(2026, 7, 10, startHour, startMinute) + minutes * 60_000)
    });
    const expectApart = (state: ReturnType<typeof build>, loggedIds: string[], reviewId: string) => {
      const byId = new Map(state.model.entries.map((candidate) => [candidate.entryId, candidate]));
      const review = byId.get(reviewId)!;
      expect(review.offsetFraction).toBeCloseTo(1 - REVIEW_LANE_WIDTH);
      expect(review.overlapCount).toBe(0);
      for (const id of loggedIds) {
        const block = byId.get(id)!;
        expect(block.offsetFraction + block.widthFraction).toBeLessThanOrEqual(1 - REVIEW_LANE_WIDTH + 1e-9);
      }
    };

    it("three logged 09:00–09:30 lanes and a 09:10–09:11 suggestion never share a target", () => {
      const state = build(now, bootstrap([
        logged("a", 9, 0, 30), logged("b", 9, 0, 30), logged("c", 9, 0, 30), suggestion("s", 9, 10, 1)
      ]));
      expectApart(state, ["a", "b", "c"], "s");
    });

    it("three logged 09:10–09:11 blocks under a suggestion at the same time stay tappable", () => {
      const state = build(now, bootstrap([
        logged("a", 9, 10, 1), logged("b", 9, 10, 1), logged("c", 9, 10, 1), suggestion("s", 9, 10, 1)
      ]));
      expectApart(state, ["a", "b", "c"], "s");
    });

    it("a whole group of overlapping logged blocks moves together, and time away from suggestions keeps the full width", () => {
      const state = build(now, bootstrap([
        // a's target meets the suggestion's; b overlaps a, so it moves too.
        logged("a", 9, 40, 30), logged("b", 10, 0, 60), suggestion("s", 9, 0, 20),
        logged("far", 14, 0, 30)
      ]));
      expectApart(state, ["a", "b"], "s");
      const far = state.model.entries.find((candidate) => candidate.entryId === "far")!;
      expect(far.offsetFraction).toBe(0);
      expect(far.widthFraction).toBe(1);
    });
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
      for (const item of lane) expect(item.widthFraction).toBeGreaterThanOrEqual(REVIEW_LANE_WIDTH / REVIEW_LANE_MAX_LANES - 1e-9);
      for (const [index, a] of lane.entries()) {
        for (const b of lane.slice(index + 1)) {
          if (Math.abs(a.offsetFraction - b.offsetFraction) > 1e-9) continue;
          const ea = reviewTargetEnvelope(a.startedAtMs, a.stoppedAtMs!, dayStart, dayEnd);
          const eb = reviewTargetEnvelope(b.startedAtMs, b.stoppedAtMs!, dayStart, dayEnd);
          expect(ea.end <= eb.start || eb.end <= ea.start, `${a.actionId} and ${b.actionId} share a lane`).toBe(true);
        }
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
