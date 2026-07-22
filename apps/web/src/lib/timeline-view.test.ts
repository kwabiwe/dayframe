import { describe, expect, it } from "vitest";
import { timelineSearchWithView, timelineViewFromSearchParams } from "./timeline-view";

describe("timeline view URLs", () => {
  it("uses calendar by default and recognises supported local views", () => {
    expect(timelineViewFromSearchParams(new URLSearchParams())).toBe("calendar");
    expect(timelineViewFromSearchParams(new URLSearchParams("view=list"))).toBe("list");
    expect(timelineViewFromSearchParams(new URLSearchParams("view=timesheet"))).toBe("timesheet");
    expect(timelineViewFromSearchParams(new URLSearchParams("view=unknown"))).toBe("calendar");
  });

  it("preserves date context while changing the URL-backed view", () => {
    expect(timelineSearchWithView("date=2026-07-22", "list")).toBe("/timeline?date=2026-07-22&view=list");
    expect(timelineSearchWithView("date=2026-07-22&view=list", "calendar")).toBe("/timeline?date=2026-07-22");
  });
});
