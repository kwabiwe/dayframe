import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const filtersSource = source("./ReportFiltersPanel.tsx");
const overviewSource = source("./ReportsOverview.tsx");
const donutSegmentSource = source("./ReportDonutSegment.tsx");
const panelSource = source("./reports/ReportsBlocksPanel.tsx");
const detailsSource = source("./ReportDetailsTable.tsx");
const rangeSource = source("./ReportRangeControls.tsx");
const styles = source("../app/globals.css");
const pageSource = source("../app/reports/page.tsx");
const topSource = source("./reports/ReportsTop.tsx");

function rule(selector: string) {
  const start = styles.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return styles.slice(start, styles.indexOf("}", start));
}

describe("Reports accessibility and responsive contracts", () => {
  it("exposes the Filter dialog, toggle chips, removable applied chips and Clear all", () => {
    expect(filtersSource).toContain('aria-haspopup="dialog"');
    expect(filtersSource).toContain("<ModalDialog");
    expect(filtersSource).toContain("aria-pressed={on}");
    expect(filtersSource).toContain("<fieldset");
    expect(filtersSource).toContain("Remove ${chip.label} filter");
    expect(filtersSource).toContain("Clear all report filters");
    expect(filtersSource).toContain("Description contains");
  });

  it("keeps every filter kind reachable from the dialog", () => {
    for (const label of ['label="Activities"', 'label="Tags"', 'label="Places"', 'label="Sources"']) {
      expect(filtersSource).toContain(label);
    }
  });

  it("provides exact table alternatives and keyboard actions for every visual chart", () => {
    expect(overviewSource).toContain('tabIndex={0}');
    expect(overviewSource).toContain("View exact trend data");
    expect(overviewSource).toContain("AccessibleBreakdownTable");
    expect(panelSource).toContain("Filter by ${slice.name}");
    expect(donutSegmentSource).toContain('role="link"');
    expect(donutSegmentSource).toContain("event.key !== \"Enter\"");
    expect(donutSegmentSource).toContain("router.push(href)");
    expect(overviewSource).toContain("Blocks can contain multiple tags, so tag totals may overlap.");
  });

  it("keeps dates explicit, inclusive and cancellable", () => {
    expect(rangeSource).toContain('label="From"');
    expect(rangeSource).toContain('label="To (inclusive)"');
    expect(rangeSource).toContain("Cancel");
    expect(rangeSource).toContain("Apply");
  });

  it("preserves the active URL on edit refresh and adapts detail rows below 760px", () => {
    expect(detailsSource).toContain("startTransition(() => router.refresh())");
    expect(detailsSource).toContain("<TimeEntryQuickEditorModal");
    expect(detailsSource).not.toContain("EditTimeEntryDialog");
    expect(detailsSource).toContain("saveTimeEntryQuickEdit");
    expect(detailsSource).toContain("Running");
    expect(detailsSource).not.toContain("Confidence");
    expect(detailsSource).not.toContain("Review status");
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.report-detail-table td::before/s);
    expect(styles).toContain("content: attr(data-label);");
  });
});

describe("Reports in Blocks audit fixes (W8)", () => {
  it("never paints data, disclosures or pagination coral (UIA-302)", () => {
    for (const selector of [".report-entry-duration", ".report-ranked-track i", ".report-trend-track span", ".report-data-table > summary", ".report-pagination a,\n.report-pagination > span"]) {
      expect(rule(selector)).not.toMatch(/--accent/);
    }
    expect(rule(".report-entry-duration")).toContain("var(--text-primary)");
    expect(rule(".overlap-marker")).toContain("--warning");
  });

  it("puts the range, Filter, Week · Month and Export in one head row (UIA-304)", () => {
    const head = pageSource.slice(pageSource.indexOf('className="df-page-head df-report-head"'), pageSource.indexOf("<ReportsTop"));
    for (const part of ["<h1>Reports</h1>", "<ReportRangeControls", "<ReportFiltersPanel", "Week", "Month", "Export filtered report as CSV"]) {
      expect(head).toContain(part);
    }
    expect(rangeSource).toContain('aria-haspopup="menu"');
    expect(rangeSource).toContain("REPORT_RANGE_PRESETS.map");
    expect(rangeSource).toContain("Custom…");
    expect(rangeSource).not.toContain("<select");
    expect(rule(".df-report-panel")).toContain("align-items: stretch");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-range-menu \{\s*animation: none;/);
    expect(styles).toMatch(/\.df-range-menu \{[^}]*max-width: calc\(100vw - 24px\)/);
  });

  it("shows one total everywhere, with no covered or framed figure (UIA-305)", () => {
    for (const text of [pageSource, topSource, overviewSource, panelSource]) {
      expect(text).not.toMatch(/Total framed|Time covered|coveredSeconds|\bcovered\b/);
    }
    expect(pageSource).not.toContain("report-metric-explainer");
  });

  it("highlights today by its label only and uses coarse-pointer wording (UIA-306)", () => {
    expect(styles).not.toMatch(/\.df-wb\.is-today \{/);
    expect(rule(".df-wb.is-today .df-wb-label b")).not.toMatch(/--accent/);
    expect(styles).toMatch(/@media \(pointer: coarse\) \{\s*\.df-hint-fine \{\s*display: none;/);
    expect(styles).toMatch(/@media \(max-width: 640px\) \{\s*\.df-wb-label-full \{\s*display: none;/);
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
