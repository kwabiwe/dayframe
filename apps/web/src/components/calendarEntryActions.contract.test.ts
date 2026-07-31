import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TimeReviewViews.tsx", import.meta.url), "utf8");

describe("Calendar quick entry actions", () => {
  it("offers lightweight start, edit, and direct-delete actions", () => {
    expect(source).toContain("calendar-entry-quick-card");
    expect(source).toContain("Start again");
    expect(source).toContain("deleteCalendarEntry(selectedTarget.entry)");
  });

  it("keeps deletion undoable for five seconds and commits replaced deletes", () => {
    expect(source).toContain("5_000");
    expect(source).toContain("if (replaced) void commitCalendarDelete(replaced)");
    expect(source).toContain("pendingDeleteRef.current = null");
  });

  it("commits a pending deletion if the Calendar unmounts during Undo", () => {
    expect(source).toContain('method: "DELETE", keepalive: true');
  });

  it("keeps both scroll axes inside the Calendar grid workspace", () => {
    expect(source).toContain('className="calendar-grid-scroller"');
    expect(source).toContain("onScroll={onScroll}");
    expect(source).not.toContain("forwardVerticalCalendarWheel");
    expect(source).not.toContain("window.scrollBy");
  });
});
