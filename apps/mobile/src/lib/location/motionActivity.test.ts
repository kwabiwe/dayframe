import { describe, expect, it, vi } from "vitest";
import { buildMotionTimeline, LOCATION_ENGINE_V2_CONFIG, type MotionActivity } from "@dayframe/shared";

vi.mock("./store", () => ({}));
const { motionEvidenceFromRecords } = await import("./motionActivity");

const T0 = Date.parse("2026-08-11T08:00:00Z");
const context = { deviceId: "ios-synthetic", timeZone: "Europe/London" };
const state = { version: 1 as const, bindingId: "capture-test", floorMs: T0, cursor: { lastRecordStartMs: null, last: null } };
const record = (minute: number, activity: MotionActivity) => ({
  startMs: T0 + minute * 60_000, stationary: activity === "stationary", walking: activity === "walking", running: false,
  cycling: false, automotive: activity === "automotive", unknown: false, confidence: "high" as const
});

describe("Motion & Fitness records as evidence", () => {
  it("never claims coverage beyond a truncated page", () => {
    // The page ends with stillness from 08:20 although the query ran at 09:00.
    const { evidence, next } = motionEvidenceFromRecords([record(0, "stationary"), record(10, "automotive"), record(20, "stationary")],
      state, T0 + 60 * 60_000, T0, context, true);
    // The next query pages forward from the end of this page.
    expect(next.cursor.resumeFromMs).toBe(T0 + 20 * 60_000);
    expect(new Set(evidence.map((item) => item.receivedAt))).toEqual(new Set([new Date(T0 + 20 * 60_000).toISOString()]));
    const timeline = buildMotionTimeline(evidence.map((item) => ({ evidence: item, match: null, impliedSpeedMetersPerSecond: null })),
      LOCATION_ENGINE_V2_CONFIG, T0 + 120 * 60_000)!;
    expect(timeline.coverageToMs).toBe(T0 + 20 * 60_000);
    expect(timeline.blocks[0]?.stopObserved).toBe(false);
  });

  it("covers the query time for a complete page", () => {
    const { evidence } = motionEvidenceFromRecords([record(0, "stationary"), record(10, "automotive"), record(20, "stationary")],
      state, T0 + 60 * 60_000, T0, context);
    expect(evidence.at(-1)).toMatchObject({ occurredAt: new Date(T0 + 60 * 60_000).toISOString(), metadata: { motionContinuation: true } });
  });
});
