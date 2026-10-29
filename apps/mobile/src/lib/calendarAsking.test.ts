import { describe, expect, it } from "vitest";
import { CHECK_ASKING_DAYS, checkAskingStartMs, checksOldestFirst, checkStillAsks } from "@dayframe/shared";

// Owner, 28 Oct 2026 (concern 4): a "?" asks for 7 days, today and the 6 days before. Synthetic local times only.
const local = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const check = (id: string, start: string | null, stop: string | null) => ({ id, segmentId: null, startedAt: start, stoppedAt: stop });

describe("the 7-day asking window", () => {
  const todayStart = new Date(2026, 9, 28).getTime();
  const from = checkAskingStartMs(todayStart);

  it("starts at local midnight six days before today", () => {
    expect(CHECK_ASKING_DAYS).toBe(7);
    expect(from).toBe(new Date(2026, 9, 22).getTime());
  });

  it("asks while a check ends inside the window, and stops for older ones", () => {
    expect(checkStillAsks(check("today", local(28, 9), local(28, 10)), from)).toBe(true);
    expect(checkStillAsks(check("six-days", local(22, 9), local(22, 10)), from)).toBe(true);
    // Overnight from the 21st into the 22nd still asks; all on the 21st does not.
    expect(checkStillAsks(check("overnight", local(21, 23), local(22, 6)), from)).toBe(true);
    expect(checkStillAsks(check("seven-days", local(21, 9), local(21, 10)), from)).toBe(false);
    // Without an end, its start decides; without either, it never asks.
    expect(checkStillAsks(check("open", local(27, 9), null), from)).toBe(true);
    expect(checkStillAsks(check("none", null, null), from)).toBe(false);
  });

  it("steps through the asking checks oldest first, across days", () => {
    const ordered = checksOldestFirst([check("b", local(27, 9), null), check("a", local(23, 9), null), check("c", local(28, 7), null)]);
    expect(ordered.map((each) => each.id)).toEqual(["a", "b", "c"]);
  });
});
