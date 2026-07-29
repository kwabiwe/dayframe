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

  it("forwards vertical wheel intent without changing horizontal gestures", () => {
    expect(source).toContain("Math.abs(event.deltaY) <= Math.abs(event.deltaX)");
    expect(source).toContain('window.scrollBy({ top: event.deltaY, behavior: "auto" })');
  });
});
