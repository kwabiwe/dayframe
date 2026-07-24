import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const timeline = source("./TimeReviewViews.tsx");
const runtime = source("./AppShellRuntime.tsx");
const entries = source("./EntriesTable.tsx");
const styles = source("../app/globals.css");

describe("Calendar readability and restart contract", () => {
  it("keeps one semantic primary action per block and pointer-only resize handles", () => {
    expect(timeline).toContain("<article");
    expect(timeline).toContain('className="calendar-entry-primary"');
    expect(timeline).not.toContain('aria-haspopup="dialog"');
    expect(timeline).not.toContain('role="button"');
    expect(timeline).toMatch(/<span[\s\S]*className="swiss-resize-handle top"[\s\S]*aria-hidden="true"/);
    expect(timeline).toMatch(/<span[\s\S]*className="swiss-resize-handle bottom"[\s\S]*aria-hidden="true"/);
    expect(timeline).not.toContain("tabIndex={-1}");
  });

  it("routes list and calendar continuations through the same guarded timer owner", () => {
    expect(timeline).toContain("await startEntryAgain(target.entry)");
    expect(entries).toContain("await startEntryAgain(entry)");
    expect(runtime).toContain("entryContinuationDecision(entry, dataRef.current?.activeEntry)");
    expect(runtime).toContain("return startTimer(decision.draft)");
    expect(timeline).not.toContain('mode: "start"');
    expect(entries).not.toContain('mode: "start"');
  });

  it("keeps tiny blocks readable without mounting a floating details surface", () => {
    expect(timeline).toContain("layoutTimeBlockLanes");
    expect(timeline).not.toContain("<CalendarEntryDetails");
    expect(timeline).not.toContain("createPortal(");
    expect(timeline).toContain("onDoubleClick={(event) =>");
    expect(timeline).toContain('className="calendar-entry-title"');
  });

  it("preserves a distinct running state and compact hover action", () => {
    const calendarRunningRule = styles.match(/\.calendar-time-block\.is-running \{([^}]*)\}/)?.[1] ?? "";
    expect(calendarRunningRule).toContain("outline:");
    expect(calendarRunningRule).not.toContain("opacity");
    expect(styles).toContain(".calendar-start-again");
    expect(styles).toMatch(/@media \(hover: none\)[\s\S]*\.calendar-start-again \{[^}]*display: none;/);
  });
});
