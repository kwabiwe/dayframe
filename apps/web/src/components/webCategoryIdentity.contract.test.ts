import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8"
);
const calendar = readFileSync(
  fileURLToPath(new URL("./TimeReviewViews.tsx", import.meta.url)),
  "utf8"
);
const entries = readFileSync(
  fileURLToPath(new URL("./EntriesTable.tsx", import.meta.url)),
  "utf8"
);
const allocation = readFileSync(
  fileURLToPath(new URL("./TimeAllocationPie.tsx", import.meta.url)),
  "utf8"
);

describe("web category identity contract", () => {
  it("marks uncategorized Calendar blocks for the shared hatch treatment", () => {
    expect(calendar).toContain('entry.categoryId ? "df-block" : "is-uncategorized"');
    expect(styles).toMatch(
      /\.calendar-time-block\.is-uncategorized\s*\{[^}]*background-image:\s*repeating-linear-gradient/s
    );
  });

  it("keeps category markers circular and borders only Uncategorized", () => {
    expect(styles).toMatch(
      /\.category-data-marker\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*999px;/s
    );
    expect(allocation).toContain("category-data-marker");
  });

  it("shows Calendar › List rows with the activity block, neutral for no activity (UIA-203)", () => {
    expect(entries).toContain('className={`timeline-task-block${entry.categoryId ? " df-block" : ""}`}');
    expect(styles).toMatch(/\.timeline-task-block\.df-block \{[^}]*background: var\(--block\);/);
    expect(entries).not.toContain("timeline-task-category-dot");
  });
});
