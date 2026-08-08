import { describe, expect, it } from "vitest";
import {
  buildHistoricalEntrySuggestions,
  historicalSuggestionPatch,
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
