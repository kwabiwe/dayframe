import { describe, expect, it } from "vitest";
import { TIMELINE_GAP_MINIMUM_MS, timelineGaps, timelineLegs } from "./location-timeline-service";

const at = (minutes: number) => Date.parse("2026-10-20T08:00:00.000Z") + minutes * 60_000;
const iso = (minutes: number) => new Date(at(minutes)).toISOString();

describe("location timeline (location v4 step 8)", () => {
  it("reports uncovered stretches from ten minutes, clipped to the window", () => {
    expect(TIMELINE_GAP_MINIMUM_MS).toBe(600_000);
    expect(timelineGaps([[at(0), at(60)], [at(65), at(120)], [at(150), at(400)]], at(-30), at(300))).toEqual([
      { kind: "gap", startedAt: iso(-30), stoppedAt: iso(0) },
      { kind: "gap", startedAt: iso(120), stoppedAt: iso(150) }
    ]);
    expect(timelineGaps([], at(0), at(9))).toEqual([]);
    expect(timelineGaps([[at(0), at(100)], [at(20), at(40)]], at(0), at(120))).toEqual([{ kind: "gap", startedAt: iso(100), stoppedAt: iso(120) }]);
  });

  it("rebuilds stored legs from known fields only", () => {
    expect(timelineLegs([
      { startedAt: iso(0), stoppedAt: iso(10), mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true,
        distanceMeters: 4_321.6, latitude: 51.5, note: "x" },
      { startedAt: iso(10), stoppedAt: iso(20), mode: "hovercraft", confidence: "sure", distanceMeters: 10 },
      { startedAt: "soon", stoppedAt: iso(20), mode: "walking", confidence: "sure" },
      null
    ])).toEqual([{ startedAt: iso(0), stoppedAt: iso(10), mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true,
      distanceMeters: 4_322 }]);
    expect(timelineLegs(undefined)).toEqual([]);
  });
});
