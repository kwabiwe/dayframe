import { describe, expect, it } from "vitest";
import { listDayTotals } from "./EntriesTable";

const label = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

describe("Calendar › List day totals (Codex r1 on #304)", () => {
  it("splits an overnight block across both days instead of giving its start day everything", () => {
    const totals = listDayTotals([{ startedAt: at(9, 23, 30), stoppedAt: at(10, 1, 30) }], new Date(2026, 9, 11), label);
    expect(totals.get("2026-10-9")?.seconds).toBe(30 * 60);
    expect(totals.get("2026-10-10")?.seconds).toBe(90 * 60);
  });

  it("counts a running block up to the captured time, and only on the days it covers", () => {
    const totals = listDayTotals([{ startedAt: at(10, 22), stoppedAt: null }], new Date(2026, 9, 11, 0, 45), label);
    expect(totals.get("2026-10-10")?.seconds).toBe(2 * 3600);
    expect(totals.get("2026-10-11")?.seconds).toBe(45 * 60);
  });

  it("adds blocks on the same day and ignores empty intervals", () => {
    const totals = listDayTotals([
      { startedAt: at(6, 9), stoppedAt: at(6, 10) },
      { startedAt: at(6, 14), stoppedAt: at(6, 14, 30) },
      { startedAt: at(6, 15), stoppedAt: at(6, 15) }
    ], new Date(2026, 9, 11), label);
    expect(totals.get("2026-10-6")?.seconds).toBe(90 * 60);
    expect(totals.size).toBe(1);
  });
});
