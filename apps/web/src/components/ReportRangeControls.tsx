"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
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
 *
 * Motion contract (.codex/reference/motion.md, "Web Reports range menu"): one owner, this
 * component's `menu` state. Entrance: opacity 0 → 1 over 120ms. Exit: state "closing" keeps the
 * menu mounted while it fades 1 → 0 over 120ms, then unmounts on animationend (with a timer
 * fallback). Reopening mid-exit returns to "open" and cancels the pending unmount. Reduce Motion:
 * no animation, open and close are immediate. Layout around the trigger never moves.
 *
 * Keyboard (menu pattern): opening focuses the checked preset (else the first item); Up/Down move
 * with wrap, Home/End jump; Escape closes and returns focus to the trigger; Tab closes.
 */
type MenuState = "closed" | "open" | "closing";
const EXIT_MS = 120;

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ReportRangeControls({
  filters,
  range
}: {
  filters: ReportFilters;
  range: ReportRangeMetadata;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState<MenuState>("closed");
  const [customOpen, setCustomOpen] = useState(false);
  const [fromDraft, setFromDraft] = useState(filters.from);
  const [toDraft, setToDraft] = useState(filters.to);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpen = menu === "open";

  function clearExitTimer() {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = null;
  }

  function openMenu() {
    clearExitTimer();
    setMenu("open");
  }

  function closeMenu({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    clearExitTimer();
    if (prefersReducedMotion()) {
      setMenu("closed");
    } else {
      setMenu((current) => (current === "closed" ? current : "closing"));
      exitTimer.current = setTimeout(() => setMenu((current) => (current === "closing" ? "closed" : current)), EXIT_MS + 80);
    }
    if (restoreFocus) triggerRef.current?.focus();
  }

  function menuItems() {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? []);
  }

  useEffect(() => clearExitTimer, []);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", onPointer);
    const items = menuItems();
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? items.length - 1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    } else if (event.key === "Tab") closeMenu();
  }

  function openCustom() {
    closeMenu();
    setFromDraft(filters.from);
    setToDraft(filters.to);
    setCustomOpen(true);
  }

  function closeCustom() {
    setCustomOpen(false);
    // The menu item that opened the dialog is gone; give focus back to the range trigger.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="df-range" aria-label="Report range">
      <Link className="df-range-nav" href={reportsHref(shiftReportRange(filters, "previous"))} aria-label="Previous report period">
        <ChevronLeft aria-hidden="true" size={18} />
      </Link>
      <div className="df-range-menu-wrap" ref={wrapRef}>
        <button
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={`Date range: ${range.label}, ${range.dayCount} calendar day${range.dayCount === 1 ? "" : "s"}. Change range`}
          className="df-range-trigger"
          onClick={() => (isOpen ? closeMenu() : openMenu())}
          ref={triggerRef}
          type="button"
        >
          <span aria-live="polite" id="report-date-range-title">{range.label}</span>
          <ChevronDown aria-hidden="true" size={15} />
        </button>
        {menu !== "closed" ? (
          <div
            aria-label="Choose a date range"
            className={`df-range-menu${menu === "closing" ? " is-closing" : ""}`}
            data-state={menu}
            onAnimationEnd={(event) => {
              if (event.animationName === "df-range-menu-out") {
                clearExitTimer();
                setMenu((current) => (current === "closing" ? "closed" : current));
              }
            }}
            onKeyDown={onMenuKeyDown}
            ref={menuRef}
            role="menu"
          >
            <button aria-label="Close date ranges" className="df-range-menu-close" onClick={() => closeMenu({ restoreFocus: true })} tabIndex={-1} type="button">
              <X aria-hidden="true" size={20} />
            </button>
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
                    closeMenu();
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
              <button className="df-rbtn df-rbtn--ghost" onClick={closeCustom} type="button">Cancel</button>
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
          onClose={closeCustom}
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
