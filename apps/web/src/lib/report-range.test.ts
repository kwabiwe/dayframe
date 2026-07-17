import { describe, expect, it } from "vitest";
import { resolveReportRange } from "./report-range";

describe("resolveReportRange", () => {
  it("defaults to the current Monday-to-Sunday week", () => {
    const range = resolveReportRange({ now: new Date(2026, 6, 17, 16) });
    expect([range.startKey, range.endKey, range.label]).toEqual([
      "2026-07-13",
      "2026-07-19",
      "13–19 July 2026"
    ]);
  });

  it("supports month and custom inclusive calendar ranges", () => {
    expect(resolveReportRange({ period: "month", start: "2026-07-17" }).endKey).toBe("2026-07-31");
    const custom = resolveReportRange({ period: "custom", start: "2026-07-20", end: "2026-07-17" });
    expect([custom.startKey, custom.endKey]).toEqual(["2026-07-17", "2026-07-20"]);
  });
});
