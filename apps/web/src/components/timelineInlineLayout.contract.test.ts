import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const entries = source("./EntriesTable.tsx");
const styles = source("../app/globals.css");

describe("Timeline inline row layout contract", () => {
  it("aligns visible task text by baseline while circles stay centred on the primary line", () => {
    expect(styles).toMatch(/\.timeline-inline-description \{[^}]*width: max-content;[^}]*flex: 0 1 auto;/s);
    expect(styles).toMatch(/\.timeline-inline-description \{[^}]*height: var\(--timeline-task-primary-height\);[^}]*align-items: center;/s);
    expect(styles).toMatch(/\.timeline-inline-description-input \{[^}]*position: absolute;[^}]*inset: 0;[^}]*width: 100%;/s);
    expect(styles).toMatch(/\.timeline-inline-description\.is-editing \{[^}]*width: auto;[^}]*flex: 1 1 auto;/s);
    expect(styles).toMatch(/\.timeline-task-cell \{[^}]*--timeline-task-primary-height: var\(--web-control-height\);[^}]*min-height: var\(--timeline-task-primary-height\);[^}]*align-items: start;/s);
    expect(styles).toMatch(/\.timeline-group-count \{[^}]*height: 28px;[^}]*margin-top: calc\(\(var\(--timeline-task-primary-height\) - 28px\) \/ 2\);[^}]*align-self: start;/s);
    expect(styles).toMatch(/\.timeline-task-category-dot \{[^}]*height: 12px;[^}]*margin: calc\(\(var\(--timeline-task-primary-height\) - 12px\) \/ 2\) 0 0;[^}]*align-self: start;/s);
    expect(styles).toMatch(/\.timeline-task-primary-line \{[^}]*display: flex;[^}]*height: var\(--timeline-task-primary-height\);[^}]*align-items: baseline;[^}]*gap: 8px;/s);
    expect(styles).toMatch(/\.timeline-task-primary-line \.timeline-task-meta,[\s\S]*\.timeline-task-primary-line \.tag-metadata \{[^}]*height: auto;[^}]*min-height: 0;[^}]*align-items: baseline;[^}]*line-height: var\(--timeline-task-text-line-height\);/s);
    expect(styles).toMatch(/\.timeline-inline-description-input \{[^}]*height: var\(--timeline-task-primary-height\);[^}]*padding: calc\(\(var\(--timeline-task-primary-height\) - var\(--timeline-task-text-line-height\)\) \/ 2\) 0;[^}]*line-height: var\(--timeline-task-text-line-height\);/s);
    expect(styles).toMatch(/\.timeline-inline-description-measure \{[^}]*visibility: visible;/s);
    expect(styles).toMatch(/\.timeline-inline-description\.is-editing \.timeline-inline-description-measure \{[^}]*visibility: hidden;/s);
    expect(styles).toMatch(/\.timeline-inline-description:not\(\.is-editing\) \.timeline-inline-description-input\[readonly\] \{[^}]*color: transparent;[^}]*caret-color: transparent;/s);
    expect(styles).toMatch(/\.timeline-list-table tbody > tr:not\(\.timeline-list-day-heading\) > td \{[^}]*vertical-align: middle;/s);
    expect(styles).toMatch(/\.timeline-list-table tbody > tr:not\(\.timeline-list-day-heading\) > td:first-child \{[^}]*vertical-align: top;/s);
    expect(styles).not.toContain("tr.has-secondary-task-line > td");
    expect(styles).toMatch(/\.timeline-task-details > \.overlap-marker \{[^}]*margin-top: 0;/s);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.timeline-inline-description \{[^}]*transition: none;/s);
  });

  it("keeps separate time inputs inside one rounded visual control and opens the themed picker without an icon", () => {
    expect(entries).toContain("updateDatePickerOpen(true)");
    expect(entries).toContain("showTrigger={false}");
    expect(entries).toContain('className="timeline-inline-time-input"');
    expect(entries).toContain('className="timeline-inline-time-separator"');
    expect(entries).not.toContain("timeline-inline-date-trigger");
    expect(styles).toMatch(/\.timeline-inline-time \{[^}]*box-sizing: border-box;[^}]*display: inline-grid;[^}]*width: max-content;[^}]*max-width: 100%;[^}]*height: var\(--web-control-height\);[^}]*grid-template-columns: 5ch 16px 5ch;[^}]*flex: 0 0 auto;[^}]*border: 0;[^}]*padding: 0 8px;/s);
    expect(styles).toMatch(/\.timeline-inline-time:hover,[\s\S]*\.timeline-inline-time:focus-within \{[^}]*background: var\(--surface-muted\);/s);
    expect(styles).toMatch(/\.timeline-inline-time:has\(\.timeline-inline-time-input:focus-visible\),[\s\S]*\.timeline-inline-time \.timeline-inline-time-input:focus-visible \{[^}]*border: 0;[^}]*outline: 0;[^}]*box-shadow: none;/s);
    expect(styles).toMatch(/\.timeline-inline-time-input \{[^}]*width: 100%;[^}]*height: var\(--web-control-height\);[^}]*min-width: 0;[^}]*padding: 0;[^}]*text-align: center;/s);
    expect(styles).toMatch(/\.timeline-inline-time-input:focus \{[^}]*border: 0;[^}]*background: transparent;[^}]*outline: 0;[^}]*box-shadow: none;/s);
    expect(styles).toMatch(/\.timeline-inline-time-separator \{[^}]*width: 16px;[^}]*height: var\(--web-control-height\);[^}]*align-items: center;[^}]*justify-content: center;/s);
    expect(styles).toMatch(/\.timeline-list-time-content,[\s\S]*\.timeline-list-actions \{[^}]*min-width: 0;[^}]*min-height: var\(--web-control-height\);[^}]*align-items: center;/s);
    expect(styles).toMatch(/\.swiss-timeline-surface \.timeline-inline-time-control > \.timeline-inline-date-picker \{[^}]*display: contents;[^}]*min-width: 0;/s);
  });
});
