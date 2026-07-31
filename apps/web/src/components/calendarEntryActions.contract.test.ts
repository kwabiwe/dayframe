import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TimeReviewViews.tsx", import.meta.url), "utf8");
const deleteHook = readFileSync(new URL("./useTimelineDeleteUndo.ts", import.meta.url), "utf8");
const controller = readFileSync(new URL("../lib/timeline-delete-undo-controller.ts", import.meta.url), "utf8");

describe("Calendar quick entry actions", () => {
  it("offers lightweight start, edit, and direct-delete actions", () => {
    expect(source).toContain("calendar-entry-quick-card");
    expect(source).toContain("Start again");
    expect(source).toContain("deleteCalendarEntry(selectedTarget.entry)");
  });

  it("delegates Calendar deletion to the shared five-second Undo owner", () => {
    expect(source).toContain("useTimelineDeleteUndo");
    expect(source).toContain("onDeleteEntries([entry])");
    expect(source).toContain("<TimelineDeleteUndoNotice");
    expect(source).not.toContain("calendar-delete-undo");
    expect(controller).toContain("TIMELINE_DELETE_UNDO_DELAY_MS = 5_000");
    expect(controller).toContain("if (this.pending) this.startCommit(this.pending");
  });

  it("finalises the shared pending deletion during pagehide or unmount", () => {
    expect(deleteHook).toContain('window.addEventListener("pagehide", finalizeForPageHide)');
    expect(deleteHook).toContain("controller.dispose()");
    expect(deleteHook).toContain("keepalive: options.keepalive");
  });

  it("keeps both scroll axes inside the Calendar grid workspace", () => {
    expect(source).toContain('className="calendar-grid-scroller"');
    expect(source).toContain("onScroll={onScroll}");
    expect(source).not.toContain("forwardVerticalCalendarWheel");
    expect(source).not.toContain("window.scrollBy");
  });
});
