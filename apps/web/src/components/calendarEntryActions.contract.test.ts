import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TimeReviewViews.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("./CalendarEntryCompactEditor.tsx", import.meta.url), "utf8");
const editDialog = readFileSync(new URL("./EditTimeEntryDialog.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./AppShellRuntime.tsx", import.meta.url), "utf8");
const deleteHook = readFileSync(new URL("./useTimelineDeleteUndo.ts", import.meta.url), "utf8");
const controller = readFileSync(new URL("../lib/timeline-delete-undo-controller.ts", import.meta.url), "utf8");

describe("Calendar compact entry editor", () => {
  it("replaces the bottom quick card with one anchored portalled editor", () => {
    expect(source).toContain("<CalendarEntryCompactEditor");
    expect(source).toContain("anchor={visibleSelectedTarget.anchor}");
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
    expect(editor).toContain('placeholder="Enter task description"');
    expect(editor).not.toContain("Times use this entry’s original dates.");
    expect(styles).toMatch(/\.calendar-compact-editor input:focus-visible\s*\{[^}]*var\(--focus\)/s);
    expect(styles).toMatch(/--focus:\s*#7d8797;/s);
    expect(styles).toMatch(/\.calendar-compact-icon-action:focus-visible,[\s\S]*outline:\s*2px solid var\(--focus\);/s);
    expect(editDialog).toContain('className="edit-time-entry-dialog"');
    expect(styles).toMatch(/\.edit-time-entry-dialog \.ui-control:focus-visible,[\s\S]*border-color:\s*var\(--focus\);/s);
  });

  it("guards outside dismissal when the local draft has unsaved changes", () => {
    expect(editor).toContain("calendarEntryCompactDraftHasChanges");
    expect(editor).toContain("Discard unsaved changes?");
    expect(editor).toContain("Go back");
    expect(editor).toMatch(/className="calendar-compact-discard-confirm"[^>]*>\s*Discard\s*</s);
    expect(editor).toContain("event.stopPropagation()");
    expect(editor).toContain("discardReturnFocusRef");
    expect(editor).toContain("if (discardPromptRef.current) return;");
    expect(editor).toContain("onClick={() => attemptDismiss(Boolean(entry))}");
    expect(editor).toContain("attemptDismiss(Boolean(entry));");
    expect(styles).toContain(".calendar-compact-discard-confirmation");
    expect(styles).toContain(".calendar-compact-editor-footer.is-confirming-discard");
  });

  it("layers normal, validation, overlap, and discard states in one fixed feedback region", () => {
    expect(editor).toContain('data-feedback-mode={feedbackMode}');
    expect(editor).toMatch(/const feedbackMode = discardPrompt[\s\S]*\? "discard"[\s\S]*displayError[\s\S]*\? "error"[\s\S]*overlap\?\.overlapCount[\s\S]*\? "overlap"[\s\S]*: "default";/s);
    expect(editor).not.toContain('className="calendar-compact-editor-error"');
    expect(editor).toContain('className="calendar-compact-feedback-actions"');
    expect(editor).toContain('role="alert" aria-atomic="true" aria-live="assertive"');
    expect(editor).toContain('aria-invalid={startIsInvalid || undefined}');
    expect(editor).toContain('aria-invalid={finishIsInvalid || undefined}');
    expect(editor).toContain('id="calendar-compact-time-error"');
    expect(styles).toMatch(/input\[aria-invalid="true"\]:focus-visible,[\s\S]*border-color: var\(--web-focus-border\);[\s\S]*box-shadow: inset 0 -2px 0 var\(--danger\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor \{[^}]*--web-control-height:\s*44px;[^}]*--calendar-compact-horizontal-inset:\s*12px;[^}]*--calendar-compact-feedback-height:\s*72px;/s);
    expect(styles).toMatch(/\.calendar-compact-editor-fields \{[^}]*padding:\s*12px var\(--calendar-compact-horizontal-inset\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-header,\s*\.calendar-compact-editor-footer \{[^}]*padding:\s*10px var\(--calendar-compact-horizontal-inset\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-footer \{[^}]*display:\s*grid;[^}]*width:\s*100%;[^}]*height:\s*var\(--calendar-compact-feedback-height\);[^}]*max-height:\s*var\(--calendar-compact-feedback-height\);[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.calendar-compact-editor-default-actions,\s*\.calendar-compact-feedback-actions,\s*\.calendar-compact-discard-confirmation \{[^}]*grid-area:\s*1 \/ 1;[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
    expect(styles).toMatch(/\.calendar-compact-feedback-copy \{[^}]*max-height:\s*44px;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
    expect(styles).toContain(".calendar-compact-editor-footer.is-showing-feedback .calendar-compact-feedback-actions");
    expect(styles).toMatch(/\.calendar-compact-save,[\s\S]*\.calendar-compact-discard-confirm \{[^}]*height:\s*var\(--web-control-height\);[^}]*font-size:\s*14px;[^}]*font-weight:\s*650;/s);
    expect(styles).toMatch(/\.calendar-compact-save \{[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--on-accent\);/s);
    expect(styles).toMatch(/\.calendar-compact-discard-confirm \{[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--on-accent\);/s);
    expect(styles).toMatch(/@media \(max-width: 350px\)[\s\S]*--calendar-compact-feedback-height:\s*104px;[\s\S]*\.calendar-compact-feedback-actions \{[^}]*grid-template-areas:[^}]*"message message"[^}]*"spacer action";[\s\S]*\.calendar-compact-discard-confirmation \{[^}]*grid-template-areas:[^}]*"prompt prompt"[^}]*"back discard";/s);
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
    expect(source).toContain('key={`${visibleSelectedTarget.blockKey}:${visibleSelectedTarget.sessionId}`}');
    expect(editor).toContain("window.clearTimeout(exitTimeoutRef.current)");
    expect(editor).toContain("closeTokenRef.current += 1");
  });
});
