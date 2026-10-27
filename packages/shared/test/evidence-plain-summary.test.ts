import { describe, expect, it } from "vitest";
import { evidencePlainSummary } from "../src/location/evidenceDto";

// Location v4 step 12: synthetic times only.
const time = (iso: string) => iso.slice(11, 16);
const base = {
  segment: { evidenceCount: 25 },
  map: { gaps: [{ startedAt: "2026-10-27T18:06:00.000Z", stoppedAt: "2026-10-27T19:21:00.000Z" }] },
  stops: [],
  evidenceExpired: false,
  rawEvidenceAvailable: true
} as never;

describe("the map's words (location v4 step 12)", () => {
  it("says the readings and each silence in plain words, never the diagnostic text", () => {
    expect(evidencePlainSummary(base, time)).toBe("25 readings · No readings 18:06–19:21");
  });

  it("says a stop inside a trip, one reading, none, and readings that have been deleted", () => {
    const stop = { ...(base as object), segment: { evidenceCount: 1 }, map: { gaps: [] },
      stops: [{ startedAt: "2026-10-27T09:05:00.000Z", stoppedAt: "2026-10-27T09:21:00.000Z", durationSeconds: 960, approximate: false }] } as never;
    expect(evidencePlainSummary(stop, time)).toBe("1 reading · Stopped 16 min 09:05–09:21");
    expect(evidencePlainSummary({ ...(base as object), segment: { evidenceCount: 0 }, map: { gaps: [] } } as never, time)).toBe("No readings");
    // An approximate stop says so (Codex r1 on #599).
    const roughly = { ...(stop as object), stops: [{ startedAt: "2026-10-27T09:05:00.000Z", stoppedAt: "2026-10-27T09:21:00.000Z", durationSeconds: 960, approximate: true }] } as never;
    expect(evidencePlainSummary(roughly, time)).toBe("1 reading · Stopped about 16 min 09:05–09:21");
    expect(evidencePlainSummary({ ...(base as object), evidenceExpired: true } as never, time)).toBe("Its readings have been deleted; only the times remain.");
  });
});
