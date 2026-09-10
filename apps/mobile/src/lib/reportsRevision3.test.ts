import { describe, expect, it } from "vitest";
import { datePickerCells } from "./datePickerCalendar";
import {
  openReportDateDraft,
  reportDraftHighlight,
  reportDraftResult,
  selectReportDraftDay,
} from "./reportDateDraft";
import {
  canRemoveDonutVisual,
  donutTransitionTargets,
  prepareDonutArcs,
} from "./donutGeometry";
import {
  reportBucketAtX,
  reportBucketLabel,
  reportLabelIndices,
  reportTooltipLeft,
} from "./reportPlot";
import {
  formatReportDuration,
  spokenReportDuration,
  reportAxis,
} from "./reportsPresentation";
import { reportNumericColumns } from "./reportsTypography";
const now = +new Date(2026, 8, 10, 12);
describe("Revision 3 pure presentation contracts", () => {
  it("reserves actual hour capacity, remains stable within it and recovers name space on shrink", () => {
    const columns = (duration: string) =>
      reportNumericColumns(256, 3.2, [duration]);
    expect(columns("00:00:01")).toEqual(columns("26:30:50"));
    expect(columns("99:59:59").durationSample).toBe("88:88:88");
    expect(columns("100:00:00").durationSample).toBe("888:88:88");
    expect(columns("9999:59:59").durationWidth).toBeGreaterThan(
      columns("26:30:50").durationWidth,
    );
    expect(columns("00:00:01").gap).toBe(6);
  });
  it.each([
    [0, "00:00:00"],
    [0.999, "00:00:00"],
    [1, "00:00:01"],
    [59.99, "00:00:59"],
    [60, "00:01:00"],
    [3600, "01:00:00"],
    [142 * 3600 + 18 * 60 + 6, "142:18:06"],
    [9999 * 3600 + 3599, "9999:59:59"],
    [100000 * 3600, "100000:00:00"],
    [-0.01, "00:00:00"],
    [NaN, "Unavailable"],
    [Infinity, "Unavailable"],
  ])("formats %s without rounding allocations", (seconds, expected) => {
    expect(formatReportDuration(seconds as number)).toBe(expected);
  });
  it("speaks natural durations, not punctuation", () => {
    expect(spokenReportDuration(3661.99)).toBe("1 hour, 1 minute, 1 second");
    expect(spokenReportDuration(0)).toBe("0 seconds");
    expect(spokenReportDuration(NaN)).toBe("Duration unavailable");
  });
  it.each([320, 375, 390, 430])(
    "reserves full six-hour-digit numeric columns at width %s",
    (width) => {
      for (const scale of [1, 1.5, 3.2]) {
        const available = width - 64;
        const c = reportNumericColumns(available, scale, [
          "00:00:01",
          "142:18:06",
          "9999:59:59",
          "100000:00:00",
        ]);
        expect(
          c.percentWidth + c.durationWidth + c.gap * 3 + 10 + 36,
        ).toBeLessThanOrEqual(available);
        expect(c.fontSize).toBeGreaterThanOrEqual(12);
        expect(c.percentWidth).toBeGreaterThanOrEqual(
          4 * c.fontSize * Math.min(scale, 1.2) * 0.72,
        );
        expect(c.durationWidth + 1e-9).toBeGreaterThanOrEqual(
          12 * c.fontSize * Math.min(scale, 1.2) * 0.72,
        );
      }
    },
  );
  it.each(["2026-02-01", "2026-08-01", "2026-09-01"])(
    "always reserves six Monday-first weeks for %s",
    (month) => {
      const cells = datePickerCells(month, null, null, "2026-09-10");
      expect(cells).toHaveLength(42);
      expect(cells[0].date.getDay()).toBe(1);
      expect(new Set(cells.map((c) => c.key)).size).toBe(42);
      expect(cells.at(-1)?.date.getDay()).toBe(0);
    },
  );
  it("retains continuous cross-row bands, endpoints and future semantics", () => {
    const cells = datePickerCells(
      "2026-09-01",
      "2026-09-06",
      "2026-09-13",
      "2026-09-10",
      "2026-09-10",
    );
    expect(cells.find((c) => c.key === "2026-09-06")).toMatchObject({
      endpoint: true,
      band: "start",
      column: 6,
    });
    expect(cells.find((c) => c.key === "2026-09-07")).toMatchObject({
      endpoint: false,
      band: "middle",
      column: 0,
    });
    expect(cells.find((c) => c.key === "2026-09-13")).toMatchObject({
      endpoint: true,
      selected: true,
      disabled: true,
      band: "end",
    });
    expect(
      datePickerCells(
        "2026-09-01",
        "2026-09-10",
        "2026-09-10",
        "2026-09-10",
      ).filter((c) => c.selected),
    ).toMatchObject([{ band: "none", endpoint: true }]);
  });
  it("drafts presets, reverse/same-day/restarted ranges without committing incomplete choices", () => {
    let draft = openReportDateDraft("year", now);
    expect(reportDraftResult(draft, now).value).toBe("year");
    expect(reportDraftHighlight(draft, now)).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
    draft = selectReportDraftDay(draft, "2026-09-09", now);
    expect(reportDraftResult(draft, now).value).toBeUndefined();
    draft = selectReportDraftDay(draft, "2026-09-01", now);
    expect(reportDraftResult(draft, now).value).toEqual({
      start: "2026-09-01",
      end: "2026-09-09",
    });
    draft = selectReportDraftDay(draft, "2026-09-08", now);
    draft = selectReportDraftDay(draft, "2026-09-08", now);
    expect(reportDraftResult(draft, now).value).toEqual({
      start: "2026-09-08",
      end: "2026-09-08",
    });
    expect(selectReportDraftDay(draft, "2026-09-11", now)).toBe(draft);
  });
  it("renders invalid long drafts without throwing and rejects their result", () => {
    let draft = selectReportDraftDay(
      openReportDateDraft("today", now),
      "2025-09-01",
      now,
    );
    draft = selectReportDraftDay(draft, "2026-09-10", now);
    expect(reportDraftHighlight(draft, now)).toEqual({
      start: "2025-09-01",
      end: "2026-09-10",
    });
    expect(reportDraftResult(draft, now).error).toContain("366");
  });
  it.each([7, 12, 24, 31, 366])(
    "maps every fitted slot unambiguously for %s buckets",
    (count) => {
      for (let i = 0; i < count; i++) {
        expect(reportBucketAtX(((i + 0.5) * 208) / count, 208, count)).toBe(i);
        expect(reportTooltipLeft(i, count, 208, 180)).toBeGreaterThanOrEqual(0);
        expect(reportTooltipLeft(i, count, 208, 180)).toBeLessThanOrEqual(28);
      }
      expect(reportBucketAtX(208, 208, count)).toBe(count - 1);
      expect(reportBucketAtX(-1, 208, count)).toBeNull();
      expect(reportLabelIndices(count, 208).size).toBeLessThanOrEqual(4);
    },
  );
  it("handles empty and hourly sparse labels", () => {
    expect([...reportLabelIndices(0, 208)]).toEqual([]);
    expect([...reportLabelIndices(1, 208)]).toEqual([0]);
    expect(
      reportBucketLabel(
        { start: new Date(2026, 8, 10, 7), end: new Date(2026, 8, 10, 8) },
        24,
      ),
    ).toBe("07");
  });
  it("retains outgoing donut IDs but prevents stale cleanup of restored/newer visuals", () => {
    const original = prepareDonutArcs([
      { id: "a", value: 3 },
      { id: "b", value: 1 },
    ]);
    const target = donutTransitionTargets(original, [{ id: "b", value: 1 }]);
    expect(target.find((a) => a.id === "b")?.endAngle).toBe(360);
    const outgoing = target.find((a) => a.id === "a")!;
    expect(outgoing.endAngle).toBe(outgoing.startAngle);
    expect(canRemoveDonutVisual(1, 1, "a", ["b"])).toBe(true);
    expect(canRemoveDonutVisual(1, 2, "a", ["b"])).toBe(false);
    expect(canRemoveDonutVisual(1, 1, "a", ["a", "b"])).toBe(false);
  });
  it.each([
    [58 * 60, 3600],
    [75 * 60, 7200],
    [(7 * 60 + 18) * 60, 8 * 3600],
    [25 * 3600, 30 * 3600],
  ])("uses a useful three-tick ceiling for %s", (input, maximum) => {
    expect(reportAxis(input).maximum).toBe(maximum);
    expect(reportAxis(input).ticks.map((t) => t.seconds)).toEqual([
      maximum,
      maximum / 2,
      0,
    ]);
  });
});
