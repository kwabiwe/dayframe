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
    expect(overviewSource).toContain("Entries can contain multiple tags, so tag totals may overlap.");
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

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
