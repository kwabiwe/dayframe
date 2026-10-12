import { describe, expect, it } from "vitest";
import {
  buildHistoricalEntrySuggestions,
  historicalSuggestionLearningTier,
  historicalSuggestionPatch,
  isReviewConfirmedLocationVisit,
  type RecentActivityEntry,
  type RecentActivitySuggestion
} from "./index";

const CONTEXT_DATE = "2026-08-07T12:00:00.000Z";

function historyEntry(
  id: string,
  description: string | null,
  overrides: Partial<RecentActivityEntry> = {}
): RecentActivityEntry {
  return {
    id,
    categoryColor: "coral",
    categoryId: "focus",
    categoryName: "Focus",
    description,
    durationSeconds: 1_800,
    reviewStatus: "confirmed",
    source: "manual_app",
    startedAt: "2026-08-06T09:00:00.000Z",
    stoppedAt: "2026-08-06T09:30:00.000Z",
    tagNames: [],
    ...overrides
  };
}

function search(
  entries: RecentActivityEntry[],
  query: string,
  options: Partial<Parameters<typeof buildHistoricalEntrySuggestions>[1]> = {}
) {
  return buildHistoricalEntrySuggestions(entries, {
    contextDate: CONTEXT_DATE,
    query,
    ...options
  });
}

describe("historical entry suggestions", () => {
  it("orders exact, Description-prefix, word-prefix and substring matches explicitly", () => {
    const results = search([
      historyEntry("substring", "Debauched notes"),
      historyEntry("word-prefix", "Debauched then Bauhaus visit"),
      historyEntry("prefix", "Bauhaus planning"),
      historyEntry("exact", "  BaU  ")
    ], " BAU ");

    expect(results.map((result) => result.description)).toEqual([
      "BaU",
      "Bauhaus planning",
      "Debauched then Bauhaus visit",
      "Debauched notes"
    ]);
  });

  it("finds an arbitrary case-insensitive substring after more than six unrelated rows", () => {
    const unrelated = Array.from({ length: 20 }, (_, index) => historyEntry(
      `routine-${index}`,
      `Frequent routine ${index}`,
      {
        durationSeconds: 7_200,
        stoppedAt: `2026-08-07T${String(10 - Math.floor(index / 6)).padStart(2, "0")}:${String(index % 6)}0:00.000Z`
      }
    ));
    const target = historyEntry("target", "Review DEBAUCHED typography", {
      durationSeconds: 30,
      startedAt: "2026-06-01T09:00:00.000Z",
      stoppedAt: "2026-06-01T09:00:30.000Z"
    });

    expect(search([...unrelated, target], "bau")).toEqual([
      expect.objectContaining({ description: "Review DEBAUCHED typography" })
    ]);
  });

  it("normalizes repeated whitespace for matching and exact deduplication", () => {
    const results = search([
      historyEntry("older", "Deep   design review", {
        startedAt: "2026-08-05T09:00:00.000Z",
        stoppedAt: "2026-08-05T09:30:00.000Z",
        tagNames: ["Deep   Work", "Planning"]
      }),
      historyEntry("newer", "DEEP DESIGN   REVIEW", {
        startedAt: "2026-08-06T10:00:00.000Z",
        stoppedAt: "2026-08-06T10:30:00.000Z",
        tagNames: ["planning", "Deep Work"]
      })
    ], " deep   design review ");

    expect(results).toEqual([
      expect.objectContaining({
        description: "DEEP DESIGN REVIEW",
        tagNames: ["Deep Work", "planning"],
        totalSeconds: 3_600,
        useCount: 2
      })
    ]);
  });

  it("keeps materially different category and tag variants separately selectable", () => {
    const results = search([
      historyEntry("focus-planning-1", "Weekly review", { tagNames: ["Planning"] }),
      historyEntry("focus-planning-2", "Weekly review", {
        startedAt: "2026-08-05T09:00:00.000Z",
        stoppedAt: "2026-08-05T09:30:00.000Z",
        tagNames: ["planning"]
      }),
      historyEntry("focus-personal", "Weekly review", { tagNames: ["Personal"] }),
      historyEntry("admin-planning", "Weekly review", {
        categoryColor: "teal",
        categoryId: "admin",
        categoryName: "Admin",
        tagNames: ["Planning"]
      })
    ], "weekly");

    expect(results).toHaveLength(3);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryId: "focus", tagNames: ["Planning"], useCount: 2 }),
      expect.objectContaining({ categoryId: "focus", tagNames: ["Personal"], useCount: 1 }),
      expect.objectContaining({ categoryId: "admin", tagNames: ["Planning"], useCount: 1 })
    ]));
    expect(new Set(results.map((result) => result.key)).size).toBe(3);
  });

  it("uses score, frequency, recency, duration and a stable key for empty-query ranking", () => {
    const frequent = [
      historyEntry("frequent-1", "Frequent planning", {
        startedAt: "2026-08-04T12:00:00.000Z",
        stoppedAt: "2026-08-04T12:30:00.000Z"
      }),
      historyEntry("frequent-2", "Frequent planning", {
        startedAt: "2026-08-05T12:00:00.000Z",
        stoppedAt: "2026-08-05T12:30:00.000Z"
      }),
      historyEntry("frequent-3", "Frequent planning", {
        startedAt: "2026-08-06T12:00:00.000Z",
        stoppedAt: "2026-08-06T12:30:00.000Z"
      })
    ];
    const tiedVariants = [
      historyEntry("variant-b", "Same task", { categoryId: "b" }),
      historyEntry("variant-a", "Same task", { categoryId: "a" })
    ];
    const results = search([
      ...tiedVariants,
      historyEntry("older", "Older once", {
        startedAt: "2026-07-01T09:00:00.000Z",
        stoppedAt: "2026-07-01T09:30:00.000Z"
      }),
      historyEntry("recent", "Recent once"),
      ...frequent
    ], "");

    expect(results[0]).toMatchObject({ description: "Frequent planning", useCount: 3 });
    expect(results.findIndex((item) => item.description === "Recent once"))
      .toBeLessThan(results.findIndex((item) => item.description === "Older once"));
    expect(results.filter((item) => item.description === "Same task").map((item) => item.categoryId))
      .toEqual(["a", "b"]);
  });

  it("uses tracked duration before the stable key when score, frequency and recency tie", () => {
    const results = search([
      historyEntry("short", "Short task", {
        durationSeconds: 600,
        startedAt: "2026-08-06T09:20:00.000Z",
        stoppedAt: "2026-08-06T09:30:00.000Z"
      }),
      historyEntry("long", "Long task", {
        durationSeconds: 3_600,
        startedAt: "2026-08-06T08:30:00.000Z",
        stoppedAt: "2026-08-06T09:30:00.000Z"
      })
    ], "");

    expect(results.map((result) => result.description)).toEqual(["Long task", "Short task"]);
  });

  it("produces byte-for-byte identical results after input shuffles and tied timestamps", () => {
    const entries = [
      historyEntry("z", "Same task", { categoryName: "Zed" }),
      historyEntry("a", "Same task", { categoryName: "Alpha" }),
      historyEntry("other-b", "Another task", { categoryId: "b" }),
      historyEntry("other-a", "Another task", { categoryId: "a" })
    ];
    const expected = search(entries, "");

    expect(search([...entries].reverse(), "")).toEqual(expected);
    expect(search([entries[2], entries[0], entries[3], entries[1]], "")).toEqual(expected);
    expect(expected.find((item) => item.description.toLowerCase() === "same task"))
      .toMatchObject({ categoryName: "Alpha", description: "Same task", useCount: 2 });
  });

  it("excludes the current entry and conservatively rejects non-genuine history", () => {
    const malformed = [
      historyEntry("current", "Current edit"),
      historyEntry("blank", "   "),
      historyEntry("placeholder", " start   ACTIVITY "),
      historyEntry("running", "Still running", { stoppedAt: null }),
      historyEntry("bad-start", "Bad start", { startedAt: "not-a-date" }),
      historyEntry("backwards", "Backwards", {
        startedAt: "2026-08-06T10:00:00.000Z",
        stoppedAt: "2026-08-06T09:00:00.000Z"
      }),
      historyEntry("unreviewed", "Unreviewed", { reviewStatus: "pending" }),
      historyEntry("automatic", "Automatic", { source: "health_sleep" }),
      null,
      { ...historyEntry("bad-tags", "Valid despite malformed optional tags"), tagNames: [null, "  Keep  "] }
    ] as unknown as RecentActivityEntry[];

    expect(search(malformed, "", { currentEntryId: "current" })).toEqual([
      expect.objectContaining({
        description: "Valid despite malformed optional tags",
        tagNames: ["Keep"]
      })
    ]);
  });

  it("includes explicitly confirmed non-health history while rejecting unresolved automation", () => {
    const results = search([
      historyEntry("accepted-place", "School pickup", {
        eventType: "geofence_exit",
        source: "location_learning",
        userConfirmed: true
      }),
      historyEntry("unresolved-place", "Office visit", {
        eventType: "geofence_exit",
        source: "location_learning"
      })
    ], "");

    expect(results.map((result) => result.description)).toEqual(["School pickup"]);
  });

  it("treats whitespace-only queries as empty and enforces deterministic bounds", () => {
    const entries = Array.from({ length: 80 }, (_, index) => historyEntry(
      `entry-${String(index).padStart(2, "0")}`,
      `Task ${String(index).padStart(2, "0")}`,
      {
        startedAt: `2026-08-06T${String(index % 20).padStart(2, "0")}:00:00.000Z`,
        stoppedAt: `2026-08-06T${String(index % 20).padStart(2, "0")}:30:00.000Z`
      }
    ));

    expect(search(entries, "   ")).toEqual(search(entries, ""));
    expect(search(entries, "")).toHaveLength(12);
    expect(search(entries, "", { limit: 0 })).toEqual([]);
    expect(search(entries, "", { limit: -1 })).toEqual([]);
    expect(search(entries, "", { limit: 1 })).toHaveLength(1);
    expect(search(entries, "", { limit: 999 })).toHaveLength(50);
  });

  it("derives a deterministic context from history when contextDate is absent or invalid", () => {
    const entries = [
      historyEntry("first", "First task"),
      historyEntry("second", "Second task", {
        startedAt: "2026-08-05T15:00:00.000Z",
        stoppedAt: "2026-08-05T15:30:00.000Z"
      })
    ];

    expect(buildHistoricalEntrySuggestions(entries, { query: "" })).toEqual(
      buildHistoricalEntrySuggestions([...entries].reverse(), {
        contextDate: "invalid",
        query: ""
      })
    );
  });
});

function confirmedVisit(
  id: string,
  description: string | null,
  overrides: Partial<RecentActivityEntry> = {}
): RecentActivityEntry {
  return historyEntry(id, description, {
    categoryColor: "teal",
    categoryId: "exercise",
    categoryName: "Exercise",
    confirmedInReview: true,
    source: "location_learning",
    ...overrides
  });
}

describe("Recent learns from visits confirmed in Review (E1)", () => {
  it("admits only location visits confirmed through a Review decision as tier 2", () => {
    expect(historicalSuggestionLearningTier(historyEntry("typed", "Planning"))).toBe(1);
    expect(historicalSuggestionLearningTier(historyEntry("started", "Planning", { source: "mobile_app" }))).toBe(1);
    expect(historicalSuggestionLearningTier(confirmedVisit("visit", "Gym"))).toBe(2);
    expect(historicalSuggestionLearningTier(confirmedVisit("journey", "School run", {
      eventType: "commute_detected"
    }))).toBe(2);
    expect(historicalSuggestionLearningTier(confirmedVisit("geofence", "Gym", {
      eventType: "geofence_exit",
      source: "geofence_specific"
    }))).toBe(2);

    // Auto-logged trusted-place visit: confirmed block, but no Review decision.
    expect(historicalSuggestionLearningTier(confirmedVisit("auto", "Gym", { confirmedInReview: false }))).toBeNull();
    expect(historicalSuggestionLearningTier(confirmedVisit("auto-legacy", "Gym", { confirmedInReview: undefined }))).toBeNull();
    // Open suggestion (needs-review block) and a skipped one (ignored).
    expect(historicalSuggestionLearningTier(confirmedVisit("open", "Gym", { reviewStatus: "needs_review" }))).toBeNull();
    expect(historicalSuggestionLearningTier(confirmedVisit("skipped", "Gym", { reviewStatus: "ignored" }))).toBeNull();
    // Health stays out even when confirmed in Review.
    expect(historicalSuggestionLearningTier(confirmedVisit("sleep", "Sleep", {
      eventType: "health_sleep_import",
      source: "health_sleep"
    }))).toBeNull();
    expect(historicalSuggestionLearningTier(confirmedVisit("walk", "Walk", {
      eventType: "health_workout_import",
      source: "location_learning"
    }))).toBeNull();
    // Other accepted Review items (shortcuts, calendar hints) are not location visits.
    expect(historicalSuggestionLearningTier(confirmedVisit("shortcut", "Focus", {
      eventType: "shortcut_action",
      source: "shortcut"
    }))).toBeNull();
    expect(isReviewConfirmedLocationVisit(confirmedVisit("visit", "Gym"))).toBe(true);
    expect(isReviewConfirmedLocationVisit(historyEntry("typed", "Gym", { confirmedInReview: true }))).toBe(false);
  });

  it("keeps unconfirmed, auto-logged, skipped and Health blocks out of Recent", () => {
    const results = search([
      confirmedVisit("auto", "Auto visit", { confirmedInReview: false }),
      confirmedVisit("open", "Open visit", { reviewStatus: "needs_review" }),
      confirmedVisit("skipped", "Skipped visit", { reviewStatus: "ignored" }),
      confirmedVisit("health", "Night", { eventType: "health_sleep_import", source: "health_sleep" }),
      confirmedVisit("confirmed", "Confirmed visit")
    ], "");

    expect(results.map((result) => result.description)).toEqual(["Confirmed visit"]);
  });

  it("ranks every typed or started block before confirmed visits without a query", () => {
    const frequentVisit = Array.from({ length: 6 }, (_, index) => confirmedVisit(
      `gym-${index}`,
      "Gym",
      {
        durationSeconds: 7_200,
        startedAt: `2026-08-07T0${index}:00:00.000Z`,
        stoppedAt: `2026-08-07T0${index}:50:00.000Z`
      }
    ));
    const results = search([
      ...frequentVisit,
      historyEntry("old-typed", "Quarterly planning", {
        durationSeconds: 120,
        startedAt: "2026-06-01T09:00:00.000Z",
        stoppedAt: "2026-06-01T09:02:00.000Z"
      }),
      historyEntry("typed", "Design review")
    ], "");

    expect(results.map((result) => result.description)).toEqual([
      "Design review",
      "Quarterly planning",
      "Gym"
    ]);
  });

  it("keeps the match tiers and puts typed blocks first inside each tier", () => {
    const results = search([
      confirmedVisit("visit-exact", "Run"),
      confirmedVisit("visit-prefix", "Running club"),
      historyEntry("typed-prefix", "Run notes"),
      historyEntry("typed-substring", "Morning run"),
      confirmedVisit("visit-substring", "School run", { eventType: "commute_detected" })
    ], "run");

    expect(results.map((result) => result.description)).toEqual([
      "Run",
      "Run notes",
      "Running club",
      "Morning run",
      "School run"
    ]);
  });

  it("keeps existing scoring order inside the confirmed-visit tier", () => {
    const results = search([
      confirmedVisit("once", "Library"),
      ...Array.from({ length: 4 }, (_, index) => confirmedVisit(`pool-${index}`, "Pool", {
        startedAt: `2026-08-0${index + 3}T09:00:00.000Z`,
        stoppedAt: `2026-08-0${index + 3}T09:45:00.000Z`
      }))
    ], "");

    expect(results.map((result) => result.description)).toEqual(["Pool", "Library"]);
    expect(results[0]).toEqual(expect.objectContaining({ useCount: 4 }));
  });

  it("lets a typed Description win over a confirmed visit with the same Description", () => {
    const results = search([
      confirmedVisit("visit-a", "Gym", { stoppedAt: "2026-08-07T11:00:00.000Z", startedAt: "2026-08-07T10:00:00.000Z" }),
      confirmedVisit("visit-b", "gym ", { categoryId: "health", categoryName: "Health" }),
      historyEntry("typed", "GYM", { categoryId: "focus", tagNames: ["Strength"] })
    ], "");

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({
      categoryId: "focus",
      description: "GYM",
      tagNames: ["Strength"],
      useCount: 1
    }));
  });

  it("keeps the limit across both tiers", () => {
    const typed = Array.from({ length: 10 }, (_, index) => historyEntry(`typed-${index}`, `Typed ${index}`));
    const visits = Array.from({ length: 10 }, (_, index) => confirmedVisit(`visit-${index}`, `Visit ${index}`, {
      durationSeconds: 7_200,
      stoppedAt: "2026-08-07T11:00:00.000Z"
    }));
    const results = search([...visits, ...typed], "");

    expect(results).toHaveLength(12);
    expect(results.slice(0, 10).every((result) => result.description.startsWith("Typed"))).toBe(true);
    expect(results.slice(10).every((result) => result.description.startsWith("Visit"))).toBe(true);
    expect(search([...visits, ...typed], "", { limit: 4 }).map((result) => result.description.split(" ")[0]))
      .toEqual(["Typed", "Typed", "Typed", "Typed"]);
  });
});

describe("historical suggestion patch", () => {
  it("copies only Description, categoryId and tagNames without sharing the tag array", () => {
    const tagNames = ["Planning", "Deep work"];
    const suggestion = {
      categoryColor: "coral",
      categoryId: "focus",
      categoryName: "Focus",
      description: "Design review",
      key: "history-key",
      lastSeenAt: CONTEXT_DATE,
      score: 99,
      section: "recent",
      tagNames,
      totalSeconds: 3_600,
      useCount: 2
    } satisfies RecentActivitySuggestion;
    const patch = historicalSuggestionPatch(suggestion);

    expect(patch).toEqual({
      categoryId: "focus",
      description: "Design review",
      tagNames
    });
    expect(Object.keys(patch).sort()).toEqual(["categoryId", "description", "tagNames"]);
    expect(patch.tagNames).not.toBe(tagNames);

    const temporalEntry = {
      id: "entry-1",
      placeName: "Studio",
      source: "manual_app",
      startedAt: "2026-08-01T10:00:00.000Z",
      stoppedAt: "2026-08-01T11:00:00.000Z"
    };
    expect({ ...temporalEntry, ...patch }).toMatchObject(temporalEntry);
  });
});
