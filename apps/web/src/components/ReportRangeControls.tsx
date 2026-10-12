"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Field, ModalDialog } from "@/components/ui/Primitives";
import {
  REPORT_RANGE_PRESETS,
  filtersForCustomRange,
  filtersForPreset,
  reportRangePresetLabel,
  reportsHref,
  shiftReportRange,
  type ReportFilters,
  type ReportRangeMetadata
} from "@/lib/report-filters";

/**
 * The Reports range subtitle (UIA-304): ‹ range › under the page title. The range itself opens a
 * menu with every preset (Today, Last 30 days…) and "Custom…", which opens a small dialog for the
 * From / To dates. Week and Month stay as the segmented control on the right of the head row.
 * Motion: the menu fades in (opacity only, 120ms) and has no animation under Reduce Motion.
 */
export function ReportRangeControls({
  filters,
  range
}: {
  filters: ReportFilters;
  range: ReportRangeMetadata;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [fromDraft, setFromDraft] = useState(filters.from);
  const [toDraft, setToDraft] = useState(filters.to);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    wrapRef.current?.querySelector<HTMLElement>("[role=menuitemradio][aria-checked=true], [role=menuitemradio]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function openCustom() {
    setMenuOpen(false);
    setFromDraft(filters.from);
    setToDraft(filters.to);
    setCustomOpen(true);
  }

  return (
    <div className="df-range" aria-label="Report range">
      <Link className="df-range-nav" href={reportsHref(shiftReportRange(filters, "previous"))} aria-label="Previous report period">
        <ChevronLeft aria-hidden="true" size={18} />
      </Link>
      <div className="df-range-menu-wrap" ref={wrapRef}>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Date range: ${range.label}, ${range.dayCount} calendar day${range.dayCount === 1 ? "" : "s"}. Change range`}
          className="df-range-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          ref={triggerRef}
          type="button"
        >
          <span aria-live="polite" id="report-date-range-title">{range.label}</span>
        </button>
        {menuOpen ? (
          <div aria-label="Choose a date range" className="df-range-menu" role="menu">
            {REPORT_RANGE_PRESETS.map((preset) =>
              preset === "custom" ? (
                <button aria-checked={filters.range === "custom"} key={preset} onClick={openCustom} role="menuitemradio" type="button">
                  {filters.range === "custom" ? "Edit dates…" : "Custom…"}
                </button>
              ) : (
                <button
                  aria-checked={filters.range === preset}
                  key={preset}
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(reportsHref(filtersForPreset(filters, preset)));
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  {reportRangePresetLabel(preset)}
                </button>
              )
            )}
          </div>
        ) : null}
      </div>
      {range.canNavigateNext ? (
        <Link className="df-range-nav" href={reportsHref(shiftReportRange(filters, "next"))} aria-label="Next report period">
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      ) : (
        <span className="df-range-nav is-disabled" aria-label="Next report period unavailable" aria-disabled="true">
          <ChevronRight aria-hidden="true" size={18} />
        </span>
      )}
      {range.wasClamped ? <span className="df-faint df-range-note" role="status">Custom ranges are limited to 366 days.</span> : null}

      {customOpen ? (
        <ModalDialog
          className="df-range-custom"
          footer={(
            <>
              <span className="df-spacer" />
              <button className="df-rbtn df-rbtn--ghost" onClick={() => setCustomOpen(false)} type="button">Cancel</button>
              <button
                className="df-rbtn df-rbtn--live"
                disabled={!fromDraft || !toDraft}
                onClick={() => {
                  setCustomOpen(false);
                  router.push(reportsHref(filtersForCustomRange(filters, fromDraft, toDraft)));
                }}
                type="button"
              >
                Apply
              </button>
            </>
          )}
          onClose={() => setCustomOpen(false)}
          title="Custom dates"
        >
          <div className="report-custom-range" aria-label="Custom report dates">
            <Field htmlFor="report-custom-from" label="From">
              <input className="ui-control" id="report-custom-from" type="date" value={fromDraft} onChange={(event) => setFromDraft(event.target.value)} />
            </Field>
            <Field htmlFor="report-custom-to" label="To (inclusive)">
              <input className="ui-control" id="report-custom-to" type="date" value={toDraft} onChange={(event) => setToDraft(event.target.value)} />
            </Field>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}
