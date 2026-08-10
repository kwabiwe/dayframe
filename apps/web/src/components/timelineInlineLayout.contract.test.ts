import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const entries = source("./EntriesTable.tsx");
const styles = source("../app/globals.css");

describe("Timeline inline row layout contract", () => {
  it("keeps idle metadata content-adjacent and gives Description edit the only expanding lane", () => {
    expect(styles).toMatch(/\.timeline-inline-description \{[^}]*width: max-content;[^}]*flex: 0 1 auto;/s);
    expect(styles).toMatch(/\.timeline-inline-description-input \{[^}]*position: absolute;[^}]*inset: 0;[^}]*width: 100%;/s);
    expect(styles).toMatch(/\.timeline-inline-description\.is-editing \{[^}]*width: auto;[^}]*flex: 1 1 auto;/s);
    expect(styles).toMatch(/\.timeline-task-primary-line \{[^}]*display: flex;[^}]*align-items: baseline;[^}]*gap: 8px;/s);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.timeline-inline-description \{[^}]*transition: none;/s);
  });

  it("opens the themed date picker from the compact time input with no icon column", () => {
    expect(entries).toContain("updateDatePickerOpen(true)");
    expect(entries).toContain("showTrigger={false}");
    expect(entries).toContain('className="timeline-inline-time-input"');
    expect(entries).not.toContain("timeline-inline-date-trigger");
    expect(styles).toMatch(/\.timeline-inline-time-input \{[^}]*width: 5ch;[^}]*padding: 0;[^}]*text-align: left;/s);
    expect(styles).toMatch(/\.timeline-inline-date-picker \{[^}]*display: contents;/s);
  });
});
