import { describe, expect, it } from "vitest";
import { projectTodayReviewPresentation } from "./todayReviewPresentation";
import type { ReviewPresentationSnapshot } from "@dayframe/shared";
import type { MobileTimeEntry } from "./api";
import type { ReviewPresentationStoreEffect } from "./reviewSyncStore";

const start = Date.parse("2026-09-12T00:00:00.000Z");
const end = Date.parse("2026-09-13T00:00:00.000Z");
const ownerKey = "staging:workspace:user";

describe("projectTodayReviewPresentation", () => {
  it.each([true, false])("never logs a needs-review mobile entry alongside its pending source (complete=%s)", (complete) => {
    const pending = { ...mobileEntry("pending-entry", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z"), reviewStatus: "needs_review" as const };
    const source = review("walk", "Walk", pending.startedAt, pending.stoppedAt!);
    const presentation = project({
      response: response([source], 1, 1, complete),
      dashboardEntries: [pending],
      manualProjectedEntries: [pending]
    });
    expect(presentation.completedLoggedMs).toBe(0);
    expect(presentation.awaitingReviewMs).toBe(30 * 60_000);
    expect(presentation.daySections.flatMap((section) => section.activities)).toEqual([
      expect.objectContaining({ state: "needs_review", countsAsLogged: false })
    ]);
    expect(presentation.donutSegments).toEqual([
      expect.objectContaining({ provisional: true, valueMs: 30 * 60_000 })
    ]);
  });
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

  it("never hatches a timer that ran into a trip on Today (step 15: its block UI comes later)", () => {
    const work = entry("work", "Work", "2026-09-12T09:00:00.000Z", "2026-09-12T11:00:00.000Z");
    const clash = { ...review("clash", "Team sync ran into your trip", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z"), eventType: "timer_trip_clash" };
    const walk = review("walk", "Walk", "2026-09-12T13:00:00.000Z", "2026-09-12T13:30:00.000Z");
    const presentation = project({ response: response([work, clash, walk], 2, 2) });

    expect(presentation.daySections[0].activities.filter((activity) => activity.source.kind === "review")
      .map((activity) => activity.source.kind === "review" && activity.source.reviewItemId)).toEqual(["walk"]);
    expect(presentation.donutSegments.map((segment) => segment.id)).not.toContain("review:clash");
    expect(presentation.awaitingReviewMs).toBe(30 * 60_000);
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

  it("uses an explicitly linked current Sleep entry before the local receipt is acknowledged", () => {
    const sleep = entry("sleep-entry", "Sleep", "2026-09-12T00:00:00.000Z", "2026-09-12T07:00:00.000Z");
    const revision = review("sleep-review", "Sleep revision", "2026-09-12T00:00:00.000Z", "2026-09-12T07:00:00.000Z", ["sleep-entry"]);
    const presentation = project({
      response: response([sleep, revision], 1, 1),
      effects: [effect("sleep-review", "pending")]
    });

    expect(presentation.completedLoggedMs).toBe(7 * 3_600_000);
    expect(presentation.savedConfirmationCount).toBe(0);
    expect(presentation.daySections[0].activities.filter((activity) => activity.source.kind === "entry")).toHaveLength(1);
    expect(presentation.daySections[0].activities.filter((activity) => activity.source.kind === "review")).toHaveLength(0);
  });

  it("keeps a local manual completion once through complete snapshot convergence", () => {
    const local = mobileEntry(
      "manual-local",
      "Manual stop",
      "2026-09-12T14:00:00.000Z",
      "2026-09-12T14:30:00.000Z"
    );
    const beforeCanonicalArrival = project({
      response: response([], 0, 0),
      manualProjectedEntries: [local]
    });
    const afterCanonicalArrival = project({
      response: response([
        entry("manual-local", "Manual stop", "2026-09-12T14:00:00.000Z", "2026-09-12T14:30:00.000Z")
      ], 0, 0),
      manualProjectedEntries: [local]
    });

    expect(beforeCanonicalArrival.completedLoggedMs).toBe(30 * 60_000);
    expect(beforeCanonicalArrival.daySections[0].activities.filter(
      (activity) => activity.source.kind === "entry" && activity.source.entryId === local.id
    )).toHaveLength(1);
    expect(afterCanonicalArrival.completedLoggedMs).toBe(30 * 60_000);
    expect(afterCanonicalArrival.daySections[0].activities.filter(
      (activity) => activity.source.kind === "entry" && activity.source.entryId === local.id
    )).toHaveLength(1);
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

  it("counts an outing once: deciding it takes one card off, deciding its Stay alone brings its Moves back (PR 12c)", () => {
    const part = (id: string, role: "stay" | "in" | "out", startedAt: string, stoppedAt: string) =>
      ({ ...review(id, "Outing", startedAt, stoppedAt), outing: { key: "outing:a", role } });
    const records = [part("stay", "stay", "2026-09-12T10:10:00.000Z", "2026-09-12T10:25:00.000Z"),
      part("there", "in", "2026-09-12T10:00:00.000Z", "2026-09-12T10:10:00.000Z"),
      part("back", "out", "2026-09-12T10:25:00.000Z", "2026-09-12T10:35:00.000Z"),
      review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z")];
    // The server counts cards (the outing and the walk) and sends its outing map.
    const withMap = (snapshot: ReviewPresentationSnapshot) =>
      ({ ...snapshot, outstanding: { ...snapshot.outstanding, outingStays: { there: "stay", back: "stay" } } });
    const whole = project({ response: withMap(response(records, 2, 2)), effects: ["stay", "there", "back"].map((id) => effect(id, "pending")) });
    expect(whole.globalReviewCount).toEqual({ value: 1, exact: true });
    expect(whole.todayReviewCount).toEqual({ value: 1, exact: true });
    const stayAlone = project({ response: withMap(response(records, 2, 2)), effects: [effect("stay", "pending")] });
    expect(stayAlone.globalReviewCount).toEqual({ value: 3, exact: true });
    expect(stayAlone.todayReviewCount).toEqual({ value: 3, exact: true });
  });

  it("calls counts moved without the outing map approximate (Codex r3 on #475)", () => {
    const walk = review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z");
    const snapshot = response([walk], 1, 1);
    const overflow = { ...snapshot, outstanding: { ...snapshot.outstanding, outingStaysOverflow: true as const } };
    expect(project({ response: overflow }).globalReviewCount).toEqual({ value: 1, exact: true });
    expect(project({ response: overflow, effects: [effect("walk", "pending")] }).globalReviewCount).toEqual({ value: 0, exact: false });
    const moved = { ...snapshot, outstanding: { ...snapshot.outstanding, countsApproximate: true as const } };
    expect(project({ response: moved }).todayReviewCount.exact).toBe(false);
  });

  it("moves the count exactly for an outing this window does not list (Codex r1 on #475)", () => {
    // Today's window lists one walk; an earlier outing's three cards are open but not in it.
    const walk = review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z");
    const snapshot = response([walk], 2, 1);
    const ids = ["31000000-0000-4000-8000-000000000001", "31000000-0000-4000-8000-000000000002", "31000000-0000-4000-8000-000000000003"];
    const presentation = project({
      response: { ...snapshot, outstanding: { ...snapshot.outstanding, openReviewItemIds: [...snapshot.outstanding.openReviewItemIds, ...ids],
        outingStays: { [ids[1]]: ids[0], [ids[2]]: ids[0] } } },
      effects: ids.map((id) => effect(id, "pending"))
    });
    expect(presentation.globalReviewCount).toEqual({ value: 1, exact: true });
    expect(presentation.todayReviewCount).toEqual({ value: 1, exact: true });
  });

  it("keeps an unknown saved outcome out of both logged and pending accounting", () => {
    const walk = review("walk", "Walk", "2026-09-12T12:00:00.000Z", "2026-09-12T12:30:00.000Z");
    const presentation = project({
      response: response([walk], 1, 1),
      effects: [{ ...effect("walk", "unknown"), source: {
        reviewItemId: "walk",
        sourceKind: "generic",
        title: "Walk",
        category: { id: null, name: null, color: null },
        placeLabel: null,
        interval: { start: walk.interval.start, end: walk.interval.end },
        createdAt: walk.createdAt,
        eventSource: walk.eventSource,
        eventType: walk.eventType
      } }]
    });

    expect(presentation.completedLoggedMs).toBe(0);
    expect(presentation.awaitingReviewMs).toBe(0);
    expect(presentation.donutSegments).toEqual([]);
    expect(presentation.daySections[0].activities[0]).toMatchObject({
      state: "needs_attention",
      resolution: "unknown",
      awaitingDecision: false
    });
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

function response(records: unknown[], globalCount: number, todayCount: number, complete = true): ReviewPresentationSnapshot {
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

describe("today's count after a local decision (Codex r1 on #408)", () => {
  const earlier = review("earlier", "Earlier walk", "2026-09-11T10:00:00.000Z", "2026-09-11T11:00:00.000Z");
  const evening = review("evening", "Evening run", "2026-09-12T18:00:00.000Z", "2026-09-12T19:00:00.000Z");

  it("takes a decided moment later today out of today's count even when now is earlier (a clock rollback)", () => {
    const presentation = project({
      response: response([earlier, evening], 2, 1),
      effects: [effect("evening", "pending")],
      nowMs: Date.parse("2026-09-12T12:00:00.000Z")
    });
    expect(presentation.globalReviewCount).toEqual({ value: 1, exact: true });
    expect(presentation.todayReviewCount).toEqual({ value: 0, exact: true });
  });

  it("takes a decided moment without a complete window out of today's count by when it was detected", () => {
    const open = { ...review("open", "Open stay", "2026-09-01T09:00:00.000Z", "2026-09-01T09:00:00.000Z"), interval: { start: "2026-09-01T09:00:00.000Z", end: null }, createdAt: "2026-09-12T08:00:00.000Z" };
    const presentation = project({
      response: response([earlier, open], 2, 1),
      effects: [effect("open", "pending")]
    });
    expect(presentation.todayReviewCount).toEqual({ value: 0, exact: true });
  });

  it("keeps a decided earlier-day moment out of today's adjustment", () => {
    const presentation = project({
      response: response([earlier, evening], 2, 1),
      effects: [effect("earlier", "pending")]
    });
    expect(presentation.globalReviewCount).toEqual({ value: 1, exact: true });
    expect(presentation.todayReviewCount).toEqual({ value: 1, exact: true });
  });
});
