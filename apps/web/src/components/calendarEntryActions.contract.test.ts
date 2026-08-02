import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TimeReviewViews.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("./CalendarEntryCompactEditor.tsx", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./AppShellRuntime.tsx", import.meta.url), "utf8");
const deleteHook = readFileSync(new URL("./useTimelineDeleteUndo.ts", import.meta.url), "utf8");
const controller = readFileSync(new URL("../lib/timeline-delete-undo-controller.ts", import.meta.url), "utf8");

describe("Calendar compact entry editor", () => {
  it("replaces the bottom quick card with one anchored portalled editor", () => {
    expect(source).toContain("<CalendarEntryCompactEditor");
    expect(source).toContain("anchor={selectedTarget.anchor}");
    expect(source).not.toContain("calendar-entry-quick-card");
    expect(editor).toContain("createPortal(");
    expect(editor).toContain('data-testid="calendar-compact-editor"');
    expect(editor).toContain("calculateCalendarEditorPosition");
  });

  it("keeps the compact surface to the owned edit fields and icon actions", () => {
    expect(editor).toContain(">Description</");
    expect(editor).toContain('>Category</span>');
    expect(editor).toContain(">Start</span>");
    expect(editor).toContain(">Finish</span>");
    expect(editor).toContain('aria-label={`Delete ${title}`}');
    expect(editor).toContain('aria-label="Close editor"');
    expect(editor).toContain("onStartAgain");
    expect(editor).not.toContain("placeId");
    expect(editor).not.toContain("projectId");
    expect(editor).not.toContain("tagNames");
    expect(editor).not.toContain("EditTimeEntryDialog");
  });

  it("sends only the compact partial payload and routes active edits through the shell gate", () => {
    expect(source).toContain("body: JSON.stringify(plan.payload)");
    expect(source).toContain("updateActiveEntryFromCalendar({ plan })");
    expect(runtime).toContain("runActiveEntryCompactMutation");
    expect(runtime).toContain("mutationGateRef.current");
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

  it("retains the full editor on Enter and double click while Space opens the compact editor", () => {
    expect(source).toContain('if (event.key === "Enter")');
    expect(source).toContain('event.key === " " || event.key === "Spacebar"');
    expect(source).toContain("editCalendarEntry(entry)");
    expect(source).toContain("focusOnOpen: event.detail === 0");
    expect(editor).toContain("window.requestAnimationFrame(() => descriptionRef.current?.focus())");
  });

  it("invalidates stale exit work when a newer editor session replaces it", () => {
    expect(source).toContain("selectionSessionRef");
    expect(source).toContain("selectedTargetRef.current?.sessionId !== target.sessionId");
    expect(source).toContain('key={`${selectedTarget.blockKey}:${selectedTarget.sessionId}`}');
    expect(editor).toContain("window.clearTimeout(exitTimeoutRef.current)");
    expect(editor).toContain("closeTokenRef.current += 1");
  });
});
