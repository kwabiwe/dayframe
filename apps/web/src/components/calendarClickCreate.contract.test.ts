import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TimeReviewViews.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("./CalendarEntryCompactEditor.tsx", import.meta.url), "utf8");
const quickEditor = readFileSync(new URL("./TimeEntryQuickEditor.tsx", import.meta.url), "utf8");
const createPlan = readFileSync(new URL("../lib/calendar-entry-compact-editor.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./AppShellRuntime.tsx", import.meta.url), "utf8");

describe("Calendar click-to-create contract", () => {
  it("owns one fine-pointer sequence on the empty day body", () => {
    expect(source).toContain("onPointerDown={(event) => startCalendarCreatePointer(day, event)}");
    expect(source).toContain("onPointerUp={(event) => finishCalendarCreatePointer(day, event)}");
    expect(source).toContain("calendarCreatePointerSequenceAccepted");
    expect(source).toContain("calendarPointHitsSemanticBlock");
    expect(source).not.toContain("onDoubleClick={(event) => createCalendarDraft");
  });

  it("uses a real create target and a non-interactive provisional anchor", () => {
    expect(source).toContain('kind: "create"');
    expect(source).toContain('mode="create"');
    expect(source).toContain("data-calendar-draft-session");
    expect(source).toContain("calculateCalendarDraftAnchorGeometry");
    expect(styles).toMatch(/\.calendar-draft-slot-anchor\s*\{[^}]*pointer-events:\s*none;/s);
    expect(styles).toMatch(/\.calendar-draft-slot-anchor\s*\{[^}]*border:\s*1px dashed/s);
  });

  it("consumes the pointer that dismisses the previous editor", () => {
    expect(source).toContain("onOutsidePointerDown={(pointer) => consumeCalendarEditorPointer");
    expect(source).toContain("calendarPointerMatchesConsumed");
    expect(editor).toContain("pointerDownTimeStamp: event.timeStamp");
    expect(editor).toMatch(/onOutsidePointerDown\?\.\(\{\s*pointerId: event\.pointerId,\s*pointerDownTimeStamp: event\.timeStamp/s);
  });

  it("reuses the compact editor without entry-only actions", () => {
    expect(editor).toContain("<TimeEntryQuickEditorPanel");
    expect(quickEditor).toContain('props.mode === "entry" ? props.entry : null');
    expect(quickEditor).toContain('aria-label={entry ? `Edit ${title}` : "Create Calendar entry"}');
    expect(quickEditor).toContain("formatCalendarEntryCompactDuration(preview.plan.durationSeconds)");
    expect(quickEditor.match(/<DatePickerPopover/g)).toHaveLength(2);
    expect(quickEditor.match(/iconOnly/g)).toHaveLength(2);
    expect(quickEditor).toMatch(/\{props\.mode === "entry" && props\.onDelete \? \([\s\S]*aria-label=\{`Delete \$\{title\}`\}/s);
  });

  it("saves through the existing manual-entry runtime with no hidden metadata", () => {
    expect(source).toContain("return createManualEntry(plan.input)");
    expect(createPlan).toContain("tagNames,");
    expect(createPlan).not.toMatch(/CalendarEntryCompactCreatePlan[\s\S]*placeId/s);
    const createManualEntry = runtime.slice(
      runtime.indexOf("const createManualEntry"),
      runtime.indexOf("const toggleTimer")
    );
    expect(createManualEntry).toContain('clientFetch("/api/time-entries"');
    expect(createManualEntry).not.toContain("activeEntry");
    expect(createManualEntry).not.toContain("stop");
  });
});
