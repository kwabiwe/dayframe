import { describe, expect, it } from "vitest";
import { latestCheckDay } from "./calendarChecks";

// Location v4 step 14 (Codex r2 on #573): synthetic local times only.
const local = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = new Date(2026, 9, 24, 20);
const check = (start: string, stop: string | null) => ({ id: "c", segmentId: null, startedAt: start, stoppedAt: stop });

describe("latestCheckDay", () => {
  it("picks today for an overnight suggestion that reaches into today", () => {
    expect(latestCheckDay([check(local(23, 23), local(24, 6))], today, { dayKey })).toBe("2026-10-24");
  });

  it("walks back to the latest earlier day that has one", () => {
    expect(latestCheckDay([check(local(20, 9), local(20, 10)), check(local(22, 9), local(22, 10))], today, { dayKey })).toBe("2026-10-22");
  });

  it("has no day for future-only or untimed suggestions", () => {
    expect(latestCheckDay([check(local(25, 9), local(25, 10))], today, { dayKey })).toBeNull();
    expect(latestCheckDay([{ id: "c", segmentId: "seg", startedAt: null, stoppedAt: null }], today, { dayKey })).toBeNull();
  });
});
