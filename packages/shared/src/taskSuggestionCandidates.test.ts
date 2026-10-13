import { describe, expect, it } from "vitest";
import {
  buildHistoricalEntrySuggestions,
  buildHistoricalSuggestionCandidates,
  buildRecentActivitySuggestions,
  searchHistoricalSuggestionCandidates,
  type RecentActivityEntry
} from "./index";

// Monday 12 Oct 2026, 08:30 BST.
const CONTEXT = "2026-10-12T07:30:00.000Z";
const CONTEXT_MS = Date.parse(CONTEXT);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let sequence = 0;

function block(
  description: string,
  categoryId: string,
  startedAtMs: number,
  minutes = 45,
  overrides: Partial<RecentActivityEntry> = {}
): RecentActivityEntry {
  sequence += 1;
  return {
    id: `entry-${sequence}`,
    categoryId,
    categoryName: categoryId,
    categoryColor: "coral",
    description,
    durationSeconds: minutes * 60,
    eventType: "timer_start",
    reviewStatus: "confirmed",
    source: "manual_app",
    startedAt: new Date(startedAtMs).toISOString(),
    stoppedAt: new Date(startedAtMs + minutes * 60_000).toISOString(),
    tagNames: [],
    ...overrides
  };
}

/** `count` morning blocks spread over the `spanDays` before the context. */
function series(description: string, categoryId: string, count: number, hourUtc: number, spanDays = 120) {
  return Array.from({ length: count }, (_, index) => {
    const dayOffset = 2 + Math.floor((index * spanDays) / count);
    const day = new Date(CONTEXT_MS - dayOffset * DAY);
    day.setUTCHours(hourUtc + (index % 3), 0, 0, 0);
    return block(description, categoryId, day.getTime());
  });
}

/**
 * The owner's production shape on 13 Oct (counts from the read-only production check): frequent morning work dominates, and "App testing"
 * (8 uses, the most recently stopped description: the evening before, 16:48 BST) is rare.
 */
function ownerHistory() {
  // 8 afternoon blocks; the last stops at 16:48 BST the evening before the context.
  const appTesting = Array.from({ length: 8 }, (_, index) =>
    block("App testing", "dayframe", Date.parse("2026-10-11T15:00:00.000Z") - index * DAY, 48)
  );
  return [
    ...appTesting,
    ...series("BAU", "work", 168, 7),
    ...series("Vibe coding", "focus", 115, 8),
    ...series("PCI DSS audit", "compliance", 60, 9),
    ...series("Standup", "work", 55, 7),
    ...series("Email triage", "work", 50, 7),
    ...series("Code review", "focus", 40, 8)
  ].sort((left, right) => Date.parse(right.stoppedAt ?? "") - Date.parse(left.stoppedAt ?? ""));
}

describe("typed Description search over the recent candidate pool", () => {
  it("reproduces the 13 Oct bug: App testing is outside the contextual top 6 and the old filter finds nothing", () => {
    const history = ownerHistory();
    expect(history[0]?.description).toBe("App testing");

    const contextual = buildRecentActivitySuggestions(history, {
      contextDate: CONTEXT,
      limit: 6,
      minDurationSeconds: 60
    });
    expect(contextual).toHaveLength(6);
    expect(contextual.map((suggestion) => suggestion.description)).not.toContain("App testing");

    // The pre-fix web filter only ever searched those 6.
    const oldFilter = contextual.filter((suggestion) =>
      suggestion.description.toLocaleLowerCase().includes("app testing")
    );
    expect(oldFilter).toEqual([]);
  });

  it("finds App testing from the candidate pool, case-insensitively and ignoring surrounding whitespace", () => {
    const candidates = buildHistoricalSuggestionCandidates(ownerHistory(), {
      contextDate: CONTEXT,
      limit: 150,
      minDurationSeconds: 60
    });
    expect(candidates.map((candidate) => candidate.description)).toContain("App testing");

    for (const query of ["app testing", "  APP Testing  ", "app", "testing"]) {
      const results = searchHistoricalSuggestionCandidates(candidates, query, { limit: 5 });
      expect(results[0]).toEqual(expect.objectContaining({
        description: "App testing",
        categoryId: "dayframe",
        useCount: 8
      }));
      expect(results[0]).not.toHaveProperty("learningTier");
    }
  });

  it("ranks exact, prefix, word and substring matches, then frequency within a tier", () => {
    const now = CONTEXT_MS - DAY;
    const candidates = buildHistoricalSuggestionCandidates([
      block("Whatsapp support", "work", now - 1 * HOUR),
      block("Fix the app", "work", now - 2 * HOUR),
      block("App testing", "work", now - 3 * HOUR),
      block("App", "work", now - 4 * HOUR),
      block("Apple store", "work", now - 5 * HOUR),
      block("Apple store", "work", now - 30 * HOUR),
      block("Apple store", "work", now - 54 * HOUR)
    ], { contextDate: CONTEXT });

    expect(searchHistoricalSuggestionCandidates(candidates, "app", { limit: 5 }).map((result) => result.description))
      .toEqual(["App", "Apple store", "App testing", "Fix the app", "Whatsapp support"]);
    expect(searchHistoricalSuggestionCandidates(candidates, "app", { limit: 2 })).toHaveLength(2);
    expect(searchHistoricalSuggestionCandidates(candidates, "   ", { limit: 5 })).toEqual([]);
    expect(searchHistoricalSuggestionCandidates(candidates, "zzz", { limit: 5 })).toEqual([]);
  });

  it("bounds the pool to the most recently used variants and drops short blocks", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      block(`Task ${index}`, "work", CONTEXT_MS - (index + 1) * HOUR)
    );
    entries.push(block("Blip", "work", CONTEXT_MS - 30 * 60_000, 0.5));

    const candidates = buildHistoricalSuggestionCandidates(entries, {
      contextDate: CONTEXT,
      limit: 5,
      minDurationSeconds: 60
    });
    expect(candidates.map((candidate) => candidate.description))
      .toEqual(["Task 0", "Task 1", "Task 2", "Task 3", "Task 4"]);
    expect(buildHistoricalSuggestionCandidates(entries, { contextDate: CONTEXT, limit: 0 })).toEqual([]);
    expect(buildHistoricalSuggestionCandidates(entries, { contextDate: CONTEXT, limit: 10_000 })).toHaveLength(13);
  });

  it("keeps the Recent eligibility and #363 owner-authored rules", () => {
    const at = CONTEXT_MS - DAY;
    const candidates = buildHistoricalSuggestionCandidates([
      block("Typed work", "work", at),
      block("Night sleep", "sleep", at, 480, { source: "health_sleep", eventType: "health_sleep_import", userConfirmed: false }),
      block("Visit Example Clinic", "health", at, 60, {
        source: "location_learning",
        eventType: "learned_place_visit",
        confirmedInReview: true,
        ownerAuthoredInReview: false,
        userConfirmed: true
      }),
      block("Lunch with friends", "social", at, 60, {
        source: "location_learning",
        eventType: "unknown_stay",
        confirmedInReview: true,
        ownerAuthoredInReview: true,
        userConfirmed: true
      }),
      block("Needs review", "work", at, 60, { reviewStatus: "needs_review" })
    ], { contextDate: CONTEXT });

    expect(candidates.map((candidate) => [candidate.description, candidate.learningTier]).sort())
      .toEqual([["Lunch with friends", 2], ["Typed work", 1]]);
  });

  it("leaves buildHistoricalEntrySuggestions' ranking unchanged", () => {
    const history = ownerHistory();
    const viaBuilder = buildHistoricalEntrySuggestions(history, { contextDate: CONTEXT, query: "a", limit: 10 });
    const viaPool = searchHistoricalSuggestionCandidates(
      buildHistoricalSuggestionCandidates(history, { contextDate: CONTEXT }),
      "a",
      { limit: 10 }
    );
    expect(viaPool).toEqual(viaBuilder);
  });
});
