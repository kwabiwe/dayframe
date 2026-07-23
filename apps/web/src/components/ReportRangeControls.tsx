"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Field } from "@/components/ui/Primitives";
import {
  REPORT_RANGE_PRESETS,
  filtersForCustomRange,
  filtersForPreset,
  reportRangePresetLabel,
  reportsHref,
  shiftReportRange,
  type ReportFilters,
  type ReportRangeMetadata,
  type ReportRangePreset
} from "@/lib/report-filters";

export function ReportRangeControls({
  filters,
  range
}: {
  filters: ReportFilters;
  range: ReportRangeMetadata;
}) {
  const router = useRouter();
  const [customOpen, setCustomOpen] = useState(filters.range === "custom");
  const [fromDraft, setFromDraft] = useState(filters.from);
  const [toDraft, setToDraft] = useState(filters.to);

  function choosePreset(preset: ReportRangePreset) {
    if (preset === "custom") {
      setCustomOpen(true);
      return;
    }
    router.push(reportsHref(filtersForPreset(filters, preset)));
  }

  function applyCustom() {
    router.push(reportsHref(filtersForCustomRange(filters, fromDraft, toDraft)));
  }

  function cancelCustom() {
    setFromDraft(filters.from);
    setToDraft(filters.to);
    setCustomOpen(false);
  }

  return (
    <section className="fill-group-surface report-range-controls" aria-labelledby="report-date-range-title">
      <div className="report-range-primary">
        <Field htmlFor="report-range-preset" label="Date range">
          <select
            className="ui-control report-range-preset"
            id="report-range-preset"
            value={customOpen ? "custom" : filters.range}
            onChange={(event) => choosePreset(event.target.value as ReportRangePreset)}
          >
            {REPORT_RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>{reportRangePresetLabel(preset)}</option>
            ))}
          </select>
        </Field>

        <div className="report-range-navigation" aria-label="Move report period">
          <Link
            className="report-range-nav-button"
            href={reportsHref(shiftReportRange(filters, "previous"))}
            aria-label="Previous report period"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </Link>
          <div id="report-date-range-title" aria-live="polite">
            <strong>{range.label}</strong>
            <span>{range.dayCount} calendar day{range.dayCount === 1 ? "" : "s"}</span>
          </div>
          {range.canNavigateNext ? (
            <Link
              className="report-range-nav-button"
              href={reportsHref(shiftReportRange(filters, "next"))}
              aria-label="Next report period"
            >
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          ) : (
            <span className="report-range-nav-button is-disabled" aria-label="Next report period unavailable" aria-disabled="true">
              <ChevronRight aria-hidden="true" size={18} />
            </span>
          )}
        </div>

        {filters.range === "custom" && !customOpen ? (
          <Button compact onClick={() => setCustomOpen(true)}>Edit dates</Button>
        ) : null}
      </div>

      {customOpen ? (
        <div className="report-custom-range" aria-label="Custom report dates">
          <Field htmlFor="report-custom-from" label="From">
            <input
              className="ui-control"
              id="report-custom-from"
              type="date"
              value={fromDraft}
              onChange={(event) => setFromDraft(event.target.value)}
            />
          </Field>
          <Field htmlFor="report-custom-to" label="To (inclusive)">
            <input
              className="ui-control"
              id="report-custom-to"
              type="date"
              value={toDraft}
              onChange={(event) => setToDraft(event.target.value)}
            />
          </Field>
          <div className="report-custom-actions">
            <Button onClick={cancelCustom}>Cancel</Button>
            <Button variant="primary" onClick={applyCustom} disabled={!fromDraft || !toDraft}>Apply</Button>
          </div>
        </div>
      ) : null}

      {range.wasClamped ? (
        <p className="report-range-note" role="status">Custom ranges are limited to 366 days.</p>
      ) : null}
    </section>
  );
}
