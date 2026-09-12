import { describe, expect, it } from "vitest";
import { projectTodayReviewPresentation } from "./todayReviewPresentation";
import type { ReviewPresentationResponse } from "@dayframe/shared";
import type { MobileTimeEntry } from "./api";
import type { ReviewPresentationStoreEffect } from "./reviewSyncStore";

const start = Date.parse("2026-09-12T00:00:00.000Z");
const end = Date.parse("2026-09-13T00:00:00.000Z");
const ownerKey = "staging:workspace:user";

describe("projectTodayReviewPresentation", () => {
  it("keeps completed and provisional accounting separate", () => {
    const work = entry("work", "Work", "2026-09-12T09:00:00.000Z", "2026-09-12T11:00:00.000Z");
    const walk = review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z");
    const presentation = project({ response: response([work, walk], 1, 1) });

    expect(presentation.completedLoggedMs).toBe(2 * 3_600_000);
    expect(presentation.awaitingReviewMs).toBe(30 * 60_000);
    expect(presentation.pendingConfirmationCount).toBe(1);
    expect(presentation.donutSegments.reduce((sum, segment) => sum + segment.valueMs, 0))
      .toBe(2.5 * 3_600_000);
    expect(presentation.donutSegments.find((segment) => segment.id === "review:walk")?.provisional).toBe(true);
  });

  it("removes a locally saved proposal from geometry without inventing a canonical interval", () => {
    const work = entry("work", "Work", "2026-09-12T09:00:00.000Z", "2026-09-12T11:00:00.000Z");
    const walk = review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z");
    const presentation = project({
      response: response([work, walk], 1, 1),
      effects: [effect("walk", "pending")]
    });

    expect(presentation.completedLoggedMs).toBe(2 * 3_600_000);
    expect(presentation.awaitingReviewMs).toBe(0);
    expect(presentation.donutSegments.map((segment) => segment.id)).not.toContain("review:walk");
    expect(presentation.savedConfirmationCount).toBe(1);
    expect(presentation.daySections[0].activities.find((activity) => activity.source.kind === "review"))
      .toMatchObject({ state: "accepted_locally", countsAsLogged: false });
  });

  it("uses a linked canonical result once and removes the verified saved marker", () => {
    const work = entry("work", "Work", "2026-09-12T09:00:00.000Z", "2026-09-12T11:00:00.000Z");
    const walkResult = entry("walk-entry", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z");
    const walk = review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z", ["walk-entry"]);
    const presentation = project({
      response: response([work, walkResult, walk], 0, 0),
      effects: [effect("walk", "verified", ["walk-entry"])]
    });

    expect(presentation.completedLoggedMs).toBe(2.5 * 3_600_000);
    expect(presentation.daySections[0].activities.filter((activity) => activity.source.kind === "entry" && activity.source.entryId === "walk-entry"))
      .toHaveLength(1);
    expect(presentation.daySections[0].activities.some((activity) => activity.source.kind === "review" && activity.source.reviewItemId === "walk"))
      .toBe(false);
  });

  it("does not double-count a Sleep proposal that explicitly reuses one existing entry", () => {
    const sleep = entry("sleep-entry", "Sleep", "2026-09-12T00:00:00.000Z", "2026-09-12T07:00:00.000Z");
    const revision = review("sleep-review", "Sleep revision", "2026-09-12T00:00:00.000Z", "2026-09-12T07:00:00.000Z", ["sleep-entry"]);
    const presentation = project({ response: response([sleep, revision], 1, 1) });

    expect(presentation.completedLoggedMs).toBe(7 * 3_600_000);
    expect(presentation.daySections[0].activities.filter((activity) => activity.source.kind === "entry")).toHaveLength(1);
    expect(presentation.daySections[0].activities.filter((activity) => activity.source.kind === "review")).toHaveLength(1);
  });

  it("clips cross-midnight pending time, counts overlaps independently, and excludes running timers", () => {
    const first = entry("first", "First", "2026-09-12T09:00:00.000Z", "2026-09-12T10:00:00.000Z");
    const second = entry("second", "Second", "2026-09-12T09:30:00.000Z", "2026-09-12T10:30:00.000Z");
    const crossMidnight = review("night", "Night walk", "2026-09-11T23:30:00.000Z", "2026-09-12T07:00:00.000Z");
    const running = mobileEntry("running", "Running", "2026-09-12T13:00:00.000Z", null);
    const presentation = project({
      response: response([first, second, crossMidnight], 1, 1),
      dashboardEntries: [running]
    });

    expect(presentation.completedLoggedMs).toBe(2 * 3_600_000);
    expect(presentation.awaitingReviewMs).toBe(7 * 3_600_000);
    expect(presentation.donutSegments.some((segment) => segment.id === "category:Running")).toBe(false);
  });

  it("keeps local count adjustments qualified when snapshot membership is partial", () => {
    const walk = review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z");
    const partial = response([walk], 13, 4, false);
    const presentation = project({ response: partial, effects: [effect("walk", "pending")] });

    expect(presentation.globalReviewCount).toEqual({ value: 12, exact: false });
    expect(presentation.todayReviewCount).toEqual({ value: 3, exact: false });
  });

  it("keeps incomplete and legacy sources reachable without inventing intervals or a shortcut", () => {
    const incomplete = {
      ...review("incomplete", "Detected activity", "2026-09-12T08:00:00.000Z", "2026-09-12T08:30:00.000Z"),
      interval: { start: "2026-09-12T08:00:00.000Z", end: null },
      proposalHash: null
    };
    const legacy = {
      kind: "legacy_review_entry" as const,
      entryId: "legacy",
      eventId: null,
      title: "Older imported time",
      category: { id: null, name: null, color: null },
      place: { id: null, label: null },
      interval: { start: "2026-09-12T10:00:00.000Z", end: "2026-09-12T10:15:00.000Z" },
      confidence: "low",
      status: "needs_review" as const,
      updatedAt: "2026-09-12T10:15:00.000Z",
      linkedReviewItemId: null
    };
    const presentation = project({ response: response([incomplete, legacy], 2, 2) });

    expect(presentation.awaitingReviewMs).toBe(15 * 60_000);
    expect(presentation.donutSegments).toHaveLength(1);
    expect(presentation.daySections.find((section) => section.title === "Incomplete time")?.activities[0])
      .toMatchObject({ title: "Detected activity", quickConfirm: { eligible: false } });
    expect(presentation.daySections[0].activities.find((activity) => activity.source.kind === "legacy_review_entry")?.quickConfirm)
      .toMatchObject({ eligible: false });
  });

  it("rejects cross-owner snapshots before merging any activity", () => {
    const presentation = project({
      snapshotOwnerKey: "other:workspace:user",
      response: response([entry("work", "Work", "2026-09-12T09:00:00.000Z", "2026-09-12T10:00:00.000Z")], 0, 0)
    });
    expect(presentation.coverage).toBe("unavailable");
    expect(presentation.donutSegments).toEqual([]);
  });
});

function project(input: Partial<Parameters<typeof projectTodayReviewPresentation>[0]>) {
  return projectTodayReviewPresentation({
    ownerKey,
    snapshotOwnerKey: ownerKey,
    response: null,
    effects: [],
    dashboardEntries: [],
    day: { key: "2026-09-12", startMs: start, endMs: end },
    nowMs: end,
    ...input
  });
}

function response(records: unknown[], globalCount: number, todayCount: number, complete = true): ReviewPresentationResponse {
  const openReviewItemIds = records
    .filter((record): record is ReturnType<typeof review> => Boolean(record && typeof record === "object" && (record as { kind?: string }).kind === "review"))
    .map((record) => record.reviewItemId);
  return {
    version: 1,
    scope: {
      mode: "window",
      timeZone: "Etc/UTC",
      window: { start: "2026-07-15T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
      today: { start: "2026-09-12T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" }
    },
    snapshotToken: "snapshot",
    capturedAt: "2026-09-13T00:00:00.000Z",
    nextCursor: null,
    completeness: { records: complete, outstandingCounts: complete, completedToday: complete, partialReason: complete ? null : "page" },
    outstanding: { globalCount, todayCount, openReviewItemIds },
    records: records as never,
    links: [],
    lookup: { reviewItems: [], entries: [] }
  };
}

function entry(id: string, title: string, startedAt: string, stoppedAt: string) {
  return {
    kind: "completed_entry" as const,
    entryId: id,
    eventId: null,
    title,
    category: { id: title, name: title, color: "coral" },
    place: { id: null, label: null },
    interval: { start: startedAt, end: stoppedAt },
    confidence: "high",
    reviewStatus: "confirmed" as const,
    updatedAt: stoppedAt,
    source: "manual_app"
  };
}

function review(id: string, title: string, startedAt: string, stoppedAt: string, canonicalEntryIds: string[] = []) {
  return {
    kind: "review" as const,
    reviewItemId: id,
    eventId: null,
    locationSegmentId: null,
    sourceKind: "generic" as const,
    eventSource: "health_workout",
    eventType: "workout",
    title,
    category: { id: title, name: title, color: "moss" },
    place: { id: null, label: null },
    interval: { start: startedAt, end: stoppedAt },
    confidence: "medium",
    status: "open" as const,
    createdAt: startedAt,
    updatedAt: startedAt,
    proposalHash: "a".repeat(64),
    canonicalEntryIds,
    semanticRevision: startedAt
  };
}

function effect(
  reviewItemId: string,
  resolution: ReviewPresentationStoreEffect["resolution"],
  canonicalEntryIds: string[] = []
) {
  return {
    reviewItemId,
    action: "accept",
    state: resolution === "verified" ? "acknowledged" : "pending",
    localEffect: "hidden",
    resolution,
    canonicalEntryIds,
    source: null
  } as ReviewPresentationStoreEffect;
}

function mobileEntry(id: string, title: string, startedAt: string, stoppedAt: string | null): MobileTimeEntry {
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: title,
    categoryName: title,
    categoryColor: "coral",
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: title,
    startedAt,
    stoppedAt,
    durationSeconds: 0
  };
}
