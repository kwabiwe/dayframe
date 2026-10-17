import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit P6b (WUI-028, 029, 030, 031; owner 17 Oct 2026).
const root = join(process.cwd(), "src");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const styles = source("app/globals.css");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Every top-level block for the selector, so a later declaration counts too.
  return [...styles.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]).join("\n");
}

describe("rows (WUI-028, WUI-029)", () => {
  it("draws List rows as Today's: transparent with hairlines, a 36 px X3 block, two lines, quiet actions", () => {
    const entries = source("components/EntriesTable.tsx");
    expect(entries).toContain('className="timeline-task-secondary-line"');
    expect(rule(".timeline-task-block")).toMatch(/width: 36px;[\s\S]*height: 36px;[\s\S]*border-radius: calc\(36px \* 0\.3\);/);
    expect(rule(".df-erow-block")).toContain("border-radius: calc(36px * 0.3);");
    expect(rule(".timeline-list-row:hover > td,\n.timeline-list-row:has(:focus-visible) > td")).toContain("var(--surface-muted)");
    // Actions appear on hover or focus, and always on touch-only screens and narrow layouts.
    expect(rule(".timeline-list-actions")).toMatch(/opacity: 0;/);
    expect(styles).toMatch(/@media \(hover: none\), \(max-width: 860px\) \{\s*\.timeline-list-actions \{\s*opacity: 1;/);
  });

  it("gives Places and Settings rows the 56 px management row", () => {
    expect(rule(".df-library .place-list-row")).toMatch(/min-height: 56px;/);
    expect(rule(".settings-group .ui-settings-row")).toMatch(/min-height: 56px;/);
  });
});

describe("states (WUI-030)", () => {
  it("shows page and panel errors on one banner with a 44 px Dismiss", () => {
    const banner = source("components/blocks/ErrorBanner.tsx");
    expect(banner).toContain('className="df-review-error"');
    expect(banner).toContain('className="df-icon-action" data-tip="Dismiss"');
    for (const path of [
      "components/AppShell.tsx",
      "components/EntriesTable.tsx",
      "components/PersistentTimerBar.tsx",
      "components/TagManager.tsx",
      "components/library/ActivitiesLibrary.tsx",
      "components/review/ReviewDeck.tsx",
      "components/today/TodayView.tsx"
    ]) {
      const text = source(path);
      expect(text, path).toContain("<ErrorBanner");
      expect(text, path).not.toContain("swiss-inline-error");
      expect(text, path).not.toMatch(/<p className="df-review-error"/);
    }
    // Places is a Places file, so its delete failure keeps its class and takes the banner look here.
    expect(rule(".swiss-inline-error")).toMatch(/border-radius: 14px;[\s\S]*background: color-mix\(in oklab, var\(--danger\) 12%, var\(--surface\)\);/);
  });

  it("keeps field errors beside their field in 12 px danger text", () => {
    expect(source("components/PersistentTimerBar.tsx")).toMatch(/<p className="ui-field-error" id="active-start-time-error" role="alert">/);
    expect(styles).toMatch(/\.ui-field-error \{\s*min-height: 17px;\s*font-size: 12px;/);
    expect(rule(".ui-field-error")).toContain("var(--danger-text)");
  });

  it("writes empty states as one muted 14 px sentence", () => {
    expect(rule(".df-muted")).toMatch(/color: var\(--text-secondary\);\s*font-size: 14px;/);
    expect(rule(".places-empty-state")).toMatch(/color: var\(--text-secondary\);[\s\S]*font-size: 14px;/);
    expect(styles).not.toMatch(/\.(inline-tag-empty|report-secondary-empty)\b/);
    expect(source("components/InlineTagInput.tsx")).not.toContain("inline-tag-empty");
  });
});

describe("Reports sections (WUI-031)", () => {
  it("draws Tags and More insights as collapsed Blocks cards with Today-style rows", () => {
    const overview = source("components/ReportsOverview.tsx");
    expect(overview).not.toContain("fill-group-surface");
    expect(overview).not.toContain("report-ranked");
    expect(overview).toContain('<details className="df-card df-report-more report-tags"');
    expect(overview).toContain('<details className="df-card df-report-more" aria-labelledby="report-more-title"');
    expect(overview).toContain('<li className="df-erow df-rank-row">');
    expect(overview).toContain('<section className="df-card report-trend"');
    expect(styles).not.toMatch(/\.(fill-group-surface|report-ranked-[\w-]+|report-secondary-[\w-]+|report-section-header)\b/);
  });
});
