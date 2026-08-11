import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const entries = source("./EntriesTable.tsx");
const styles = source("../app/globals.css");

describe("Timeline inline row layout contract", () => {
  it("keeps every task-row element vertically centred while Description owns the only expanding lane", () => {
    expect(styles).toMatch(/\.timeline-inline-description \{[^}]*width: max-content;[^}]*flex: 0 1 auto;/s);
    expect(styles).toMatch(/\.timeline-inline-description \{[^}]*height: 28px;[^}]*align-items: center;/s);
    expect(styles).toMatch(/\.timeline-inline-description-input \{[^}]*position: absolute;[^}]*inset: 0;[^}]*width: 100%;/s);
    expect(styles).toMatch(/\.timeline-inline-description\.is-editing \{[^}]*width: auto;[^}]*flex: 1 1 auto;/s);
    expect(styles).toMatch(/\.timeline-task-category-dot \{[^}]*margin: 0;[^}]*align-self: center;/s);
    expect(styles).toMatch(/\.timeline-task-primary-line \{[^}]*display: flex;[^}]*min-height: 28px;[^}]*align-items: center;[^}]*gap: 8px;/s);
    expect(styles).toMatch(/\.timeline-task-primary-line \.timeline-task-meta,[\s\S]*\.timeline-task-primary-line \.tag-metadata \{[^}]*min-height: 28px;[^}]*align-items: center;/s);
    expect(styles).toMatch(/\.timeline-list-table tbody > tr:not\(\.timeline-list-day-heading\) > td \{[^}]*vertical-align: middle;/s);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.timeline-inline-description \{[^}]*transition: none;/s);
  });

  it("keeps separate time inputs inside one rounded visual control and opens the themed picker without an icon", () => {
    expect(entries).toContain("updateDatePickerOpen(true)");
    expect(entries).toContain("showTrigger={false}");
    expect(entries).toContain('className="timeline-inline-time-input"');
    expect(entries).not.toContain("timeline-inline-date-trigger");
    expect(styles).toMatch(/\.timeline-inline-time \{[^}]*height: 28px;[^}]*align-items: center;[^}]*border-radius: 8px;[^}]*padding: 0 4px;/s);
    expect(styles).toMatch(/\.timeline-inline-time:hover,[\s\S]*\.timeline-inline-time:focus-within \{[^}]*background: var\(--surface-muted\);/s);
    expect(styles).toMatch(/\.timeline-inline-time-input \{[^}]*width: 5ch;[^}]*padding: 0;[^}]*text-align: left;/s);
    expect(styles).toMatch(/\.timeline-inline-time-input:focus \{[^}]*background: transparent;/s);
    expect(styles).toMatch(/\.timeline-inline-date-picker \{[^}]*display: contents;/s);
  });
});
