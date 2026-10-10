import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const timeline = readFileSync(fileURLToPath(new URL("./TimeReviewViews.tsx", import.meta.url)), "utf8");

describe("Calendar in Blocks contract", () => {
  it("draws every line and control on a solid block in its on-block colour", () => {
    expect(styles).toMatch(/\.calendar-time-block\.df-block \.calendar-entry-primary,[\s\S]*?\.calendar-time-block\.df-block \.calendar-start-again \{[^}]*color: var\(--on-block\);/);
    expect(styles).toMatch(/\.calendar-time-block\.df-block \.calendar-entry-category,[\s\S]*?\{[^}]*color: color-mix\(in srgb, var\(--on-block\) 80%, transparent\);/);
  });

  it("layers Review suggestions above entries' lanes but below a hovered, selected or resizing entry and the now line", () => {
    const zOf = (selector: RegExp) => Number(styles.match(selector)?.[1]);
    const review = zOf(/\.calendar-review-block \{[^}]*z-index: (\d+);/);
    const raised = zOf(/\.calendar-time-block\.is-resizing,[\s\S]*?\{\s*z-index: (\d+) !important;/);
    const now = zOf(/\.calendar-now-line \{[^}]*z-index: (\d+);/);
    expect(review).toBeGreaterThan(10);
    expect(raised).toBeGreaterThan(review);
    expect(now).toBeGreaterThan(review);
    // Sticky day headings stay above everything in the columns.
    expect(raised).toBeLessThan(40);
  });

  it("keeps Calendar's clock moving while nothing runs, so the now line advances", () => {
    expect(timeline).toContain("hasRunningEntry ? 1_000 : 30_000");
  });
});
