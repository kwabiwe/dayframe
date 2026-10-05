import { describe, expect, it } from "vitest";
import { tripStopRows, tripStopsHeading } from "./tripStopPresentation";

const time = (value: string) => value.slice(11, 16);

describe("trip stop presentation", () => {
  it("has no heading or rows without stops", () => {
    expect(tripStopsHeading(undefined)).toBeNull();
    expect(tripStopsHeading([])).toBeNull();
    expect(tripStopRows(undefined, time)).toEqual([]);
  });

  it("lists stops in time order with visible and spoken labels", () => {
    const rows = tripStopRows([
      { startedAt: "2026-10-04T12:40:00.000Z", stoppedAt: "2026-10-04T13:45:00.000Z", durationSeconds: 3_900, approximate: true },
      { startedAt: "2026-10-04T12:22:17.000Z", stoppedAt: "2026-10-04T12:28:15.000Z", durationSeconds: 358, approximate: false }
    ], time);
    expect(rows).toEqual([
      { key: "2026-10-04T12:22:17.000Z-2026-10-04T12:28:15.000Z", label: "Stopped 12:22–12:28 · 6m",
        accessibilityLabel: "Stopped from 12:22 to 12:28, 6 minutes" },
      { key: "2026-10-04T12:40:00.000Z-2026-10-04T13:45:00.000Z", label: "Stopped about 12:40–13:45 · 1h 5m",
        accessibilityLabel: "Stopped from about 12:40 to 13:45, 65 minutes, approximate" }
    ]);
    expect(tripStopsHeading([rows[0] as never])).toBe("1 stop on this trip");
    expect(tripStopsHeading([rows[0], rows[1]] as never)).toBe("2 stops on this trip");
  });

  it("never shows a zero-minute stop", () => {
    expect(tripStopRows([{ startedAt: "2026-10-04T12:00:00.000Z", stoppedAt: "2026-10-04T12:00:20.000Z", durationSeconds: 20, approximate: false }], time)[0].label)
      .toBe("Stopped 12:00–12:00 · 1m");
  });
});
