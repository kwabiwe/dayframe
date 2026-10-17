import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit P3 (WUI-011…016, owner 17 Oct 2026): one button family, neutral hovers, 44 px
// targets, and a tooltip for every icon-only action.
const root = join(process.cwd(), "src");
const styles = readFileSync(join(root, "app/globals.css"), "utf8");
const source = (path: string) => readFileSync(join(root, path), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("buttons (web UI audit P3)", () => {
  it("keeps coral off every non-primary hover (WUI-011)", () => {
    for (const selector of [
      ".ui-button-secondary:hover,\n.ui-button-ghost:hover",
      ".ui-icon-button:hover",
      ".timeline-group-count:hover",
      ".calendar-start-again:hover",
      ".inline-selected-tag:hover .inline-selected-tag-visual"
    ]) {
      const body = rule(selector);
      expect(body, selector).not.toBe("");
      expect(body, selector).not.toMatch(/--accent/);
    }
    expect(rule(".timeline-group-count")).not.toMatch(/--accent/);
  });

  it("draws every button pill with the df-rbtn geometry (WUI-012)", () => {
    for (const selector of [".df-rbtn", ".ui-button"]) {
      expect(rule(selector), selector).toMatch(/padding: 0 16px;/);
      expect(rule(selector), selector).toMatch(/font-weight: 700;/);
    }
    expect(styles).toMatch(/\.calendar-compact-save,\n\.calendar-compact-cancel \{[^}]*padding: 0 16px;[^}]*font-weight: 700;/);
  });

  it("keeps Cancel a ghost button", () => {
    expect(source("components/library/ActivitiesLibrary.tsx")).toMatch(/className="df-rbtn df-rbtn--ghost"[^\n]*>Cancel</);
    expect(source("components/TagManager.tsx")).toMatch(/className="df-rbtn df-rbtn--sm df-rbtn--ghost"[^\n]*>Cancel</);
    expect(source("components/ReportFiltersPanel.tsx")).toMatch(/className="df-rbtn df-rbtn--ghost"[^\n]*>Cancel</);
    // Every Button that says Cancel is the ghost (Codex r1 on #471).
    for (const path of ["components/SettingsForms.tsx", "components/PlacesManager.tsx", "components/PlaceRoleSlots.tsx"]) {
      const lines = source(path).split("\n");
      lines.forEach((line, index) => {
        const opensCancel = /<Button\b/.test(line) && (/Cancel<\/Button>/.test(line) || lines[index + 1]?.trim() === "Cancel");
        if (opensCancel) expect(line, `${path}:${index + 1}`).toContain('variant="ghost"');
      });
    }
  });

  it("uses one 44 px control scale at every width (WUI-015) and 44 px targets for small icon actions (WUI-013)", () => {
    expect(styles).not.toMatch(/--web-(control-height|icon-button-size|touch-size): 38px/);
    expect(styles).toMatch(/--web-control-height-compact: 36px;/);
    expect(styles).toMatch(/\.df-icon-action::after,\n\.calendar-start-again::after,\n\.timeline-group-count::after \{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(rule(".df-icon-action")).toMatch(/position: relative;/);
    // Today's 34 px row actions sit 10 px apart, so the 44 px targets meet without overlapping.
    expect(rule(".df-erow-acts")).toMatch(/gap: 10px;/);
  });

  it("names icon-only actions with a tooltip (WUI-014)", () => {
    expect(source("components/ui/Primitives.tsx")).toMatch(/aria-label=\{label\}[\s\S]*data-tip=\{label\}/);
    expect(source("components/AppShell.tsx")).toMatch(/<TooltipHost \/>/);
    for (const [path, tips] of [
      ["components/today/TodayView.tsx", ["Start again", "Edit", "Delete"]],
      ["components/EntriesTable.tsx", ["Edit", "Delete"]],
      ["components/TimeReviewViews.tsx", ["Start again"]],
      ["components/TagManager.tsx", ["Delete"]],
      ["components/ReportDetailsTable.tsx", ["Edit"]],
      ["components/blocks/ErrorBanner.tsx", ["Dismiss"]],
      ["components/TimeEntryQuickEditor.tsx", ["Close"]]
    ] as const) {
      for (const tip of tips) expect(source(path), `${path} ${tip}`).toContain(`data-tip="${tip}"`);
    }
    // The tip is decoration: the button keeps its own name, and the pill is hidden from assistive tech.
    expect(source("components/blocks/TooltipHost.tsx")).toMatch(/aria-hidden="true" className="df-tip"/);
    expect(rule(".df-tip")).toMatch(/pointer-events: none;/);
  });
});
