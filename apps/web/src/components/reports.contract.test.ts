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
    for (const label of ["<b>Activities</b>", 'label="Tags"', 'label="Places"', 'label="Sources"']) {
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
    expect(overviewSource).toContain("totals may overlap");
    expect(panelSource).toContain('summary="Exact time by activity"');
  });

  it("keeps dates explicit, inclusive and cancellable", () => {
    expect(rangeSource).toContain('label="From"');
    expect(rangeSource).toContain('label="To (inclusive)"');
    expect(rangeSource).toContain("Cancel");
    expect(rangeSource).toContain("Apply");
  });

  it("preserves the active URL on edit refresh", () => {
    expect(detailsSource).toContain("startTransition(() => router.refresh())");
    expect(detailsSource).toContain("<TimeEntryQuickEditorModal");
    expect(detailsSource).not.toContain("EditTimeEntryDialog");
    expect(detailsSource).toContain("saveTimeEntryQuickEdit");
    expect(detailsSource).toContain("Running");
    expect(detailsSource).not.toContain("Confidence");
    expect(detailsSource).not.toContain("Review status");
  });
});

describe("Reports in Blocks audit fixes (W8)", () => {
  it("never paints data, disclosures or pagination coral (UIA-302)", () => {
    for (const selector of [".report-ranked-track i", ".report-trend-track span", ".report-data-table > summary", ".report-pagination a,\n.report-pagination > span"]) {
      expect(rule(selector)).not.toMatch(/--accent/);
    }
    expect(rule(".df-erow-dur")).not.toMatch(/--accent/);
    // A running row in Reports overrides Today's coral live duration (Codex r2).
    expect(rule(".df-report-row.df-erow.is-live .df-erow-dur")).toContain("var(--text-primary)");
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
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-range-menu,\s*\.df-range-menu\.is-closing \{\s*animation: none;/);
    // The phone sheet sits above the tab bar (z-index 40), clear of the safe area, with a close control.
    expect(styles).toMatch(/\.df-range-menu \{\s*position: fixed;\s*z-index: 70;[^}]*safe-area-inset-bottom/);
    expect(rangeSource).toContain("Close date ranges");
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

describe("Reports staging feedback I1–I3", () => {
  it("traces from blocks with a neutral inner focus ring and no transitions under Reduce Motion (I1)", () => {
    // The day column or month cell is the hit area, never the 2–3 px block (review 3).
    expect(rule(".df-tblock")).toContain("pointer-events: none");
    expect(panelSource).toContain("{...pointerProps}");
    // Touch picks a day; its activities are 44 px rows in a panel that collapses at once under
    // Reduce Motion (review 3).
    expect(rule(".df-day-pick-row")).toContain("min-height: 44px");
    expect(rule(".df-day-pick-close")).toContain("height: 44px");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-day-pick \{\s*transition: none;/);
    // React never sets the panel's inert: the layout effect does, after focus has left (review r4).
    expect(panelSource).not.toMatch(/\binert=\{/);
    expect(panelSource).toContain('panel.setAttribute("inert", "")');
    // Day targets on phones (review r3, r4): every day column and month cell at least 44 px, 2 px
    // gaps and 14 px card sides (a week and a month fit at 375 px), scrolling inside the card.
    expect(styles).toMatch(/@media \(max-width: 640px\) \{\s*\.df-report-blocks \{\s*padding-right: 14px;\s*padding-left: 14px;\s*\}\s*\.df-wblocks \{\s*grid-auto-columns: minmax\(44px, 1fr\);\s*gap: 2px;\s*overflow-x: auto;/);
    expect(styles).toMatch(/\.df-month \{\s*grid-template-columns: repeat\(7, minmax\(44px, 1fr\)\);\s*gap: 2px;\s*overflow-x: auto;/);
    // 7 × 44 + 6 × 2 fits a 375 px phone's card (375 − 2 × 12 page − 2 × 14 card = 323).
    expect(7 * 44 + 6 * 2).toBeLessThanOrEqual(375 - 2 * 12 - 2 * 14);
    expect(rule(".df-wb[data-roving-key]:focus-visible,\n.df-mday[data-roving-key]:focus-visible")).toContain("outline-offset: -2px");
    expect(rule(".df-tblock:focus-visible")).toContain("outline: 2px solid var(--focus)");
    expect(rule(".df-tblock:focus-visible")).toContain("outline-offset: -2px");
    expect(rule(".df-wblocks.has-hot .df-tblock,\n.df-month.has-hot .df-tblock")).toContain("opacity: 0.22");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-tblock,\s*\.df-donut-seg \{\s*transition: none;/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-wb-stack > \.df-tblock \{\s*animation: none;/);
  });

  it("draws the Filter button with a generic funnel before its label (I3)", () => {
    expect(filtersSource).toMatch(/import \{[^}]*\bFunnel\b[^}]*\} from "lucide-react"/);
    expect(filtersSource).toMatch(/className="df-rbtn df-rbtn--sm df-report-filter-button"/);
    expect(filtersSource).toMatch(/<Funnel aria-hidden="true" size=\{16\} \/>\s*Filter\{/);
  });
});

describe("Reports rows and Filter dialog in Blocks (W8b)", () => {
  it("ends Reports at Where it went, collapsed Tags and More insights, and Blocks rows (UIA-303)", () => {
    expect(overviewSource).not.toContain("report-allocation-title");
    expect(overviewSource).not.toContain("report-analysis-grid");
    expect(overviewSource).toMatch(/<details className="fill-group-surface report-secondary-insights report-tags"/);
    expect(overviewSource).not.toMatch(/<details[^>]*\bopen\b/);
    expect(pageSource).toContain("exactRows={report.byCategory}");
    expect(detailsSource).not.toContain("<table");
    expect(detailsSource).not.toContain("No place");
    expect(detailsSource).toContain('className="df-rows df-report-rows"');
    expect(detailsSource).toContain("df-erow df-report-row");
    expect(rule(".df-report-row .df-erow-block")).toContain("var(--activity-marker-radius)");
    // Phones keep the date and range (Today hides its time column there).
    expect(styles).toMatch(/\.df-report-row \.df-erow-when \{\s*display: block;/);
  });

  it("matches the prototype Filter dialog and keeps every filter (UIA-307)", () => {
    expect(filtersSource).toContain(">None</button>");
    expect(filtersSource).toContain("df-rf-more${moreOpen");
    expect(filtersSource).toContain("inert={!moreOpen}");
    expect(filtersSource).not.toContain("<details");
    expect(filtersSource).toContain("More filters");
    expect(filtersSource).toContain("sourcesInRange.includes(source.id) || draft.sources.includes(source.id)");
    expect(filtersSource).toContain("Show ${count}");
    expect(filtersSource).not.toContain("df-rbtn\" onClick={onClose}");
    expect(rule(".df-rf-more-toggle")).toContain("min-height: 44px");
    // One transition owner for expand/collapse: the panel's grid rows with opacity.
    expect(rule(".df-rf-more-panel")).toMatch(/grid-template-rows: 0fr;[\s\S]*transition: grid-template-rows/);
    expect(rule(".df-rf-more.is-open .df-rf-more-panel")).toContain("grid-template-rows: 1fr");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-rf-more-chevron,\s*\.df-rf-more-panel \{\s*transition: none;/);
    // The old matching table's styles are gone; the shared exact-data table stays.
    expect(styles).not.toMatch(/\.report-(detail-table|entry-|running-pill|sort-control|allocation)/);
    expect(styles).toContain(".report-data-table table {");
    expect(pageSource).toContain("sourcesInRange={report.sourcesInRange}");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
