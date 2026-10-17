"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { DayframeCalendar } from "@/components/DayframeCalendar";
import { ModalDialog } from "@/components/ui/Primitives";
import { formatLocalDate } from "@/lib/calendar-grid";
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
import {
  initialReportRangeDraft,
  nextReportRangeDraft,
  reportRangeDraftComplete,
  reportRangeDraftBounds,
  reportRangeDraftCaption,
  type ReportRangeDraft
} from "@/lib/report-range-draft";

/**
 * The Reports range subtitle (UIA-304): ‹ range › under the page title. The range itself opens a
 * menu with every preset (Today, Last 30 days…) and "Custom…", which opens a small dialog with a
 * range calendar (date-picker audit, 14 Oct 2026, as on iPhone): tap the first day, then the last
 * (either order; a third tap starts again), read the range in the caption, then Done. No days after
 * today, at most 366 days. Week and Month stay as the segmented control on the right of the head row.
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
/**
 * Set when Apply navigates to a new custom range: the page remounts this component (its key holds
 * the range), so the new instance takes focus back to the range trigger on mount.
 */
let focusTriggerAfterNavigation: string | null = null;
const rangeKey = (filters: Pick<ReportFilters, "range" | "from" | "to">) => `${filters.range}:${filters.from}:${filters.to}`;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
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
  const [draft, setDraft] = useState<ReportRangeDraft>({ start: filters.from, end: filters.to });
  const [lastTapped, setLastTapped] = useState(filters.to);
  const [today, setToday] = useState(filters.to);
  const [view, setView] = useState({ year: 0, month: 0 });
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
    const target = focusTriggerAfterNavigation;
    focusTriggerAfterNavigation = null;
    if (target !== null && target === rangeKey(filters)) triggerRef.current?.focus();
    // Mount only: the flag belongs to the navigation that created this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tab out of the menu: focus the element after the trigger (Shift+Tab: the trigger itself). */
  function tabOut(backwards: boolean) {
    const trigger = triggerRef.current;
    if (!trigger) return;
    if (backwards) {
      trigger.focus();
      return;
    }
    const order = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !menuRef.current?.contains(element) && !element.closest("[inert]")
    );
    (order[order.indexOf(trigger) + 1] ?? trigger).focus();
  }

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
    } else if (event.key === "Tab") {
      // The closing menu is inert, so focus must move now rather than fall to <body> on unmount.
      event.preventDefault();
      closeMenu();
      tabOut(event.shiftKey);
    }
  }

  function openCustom() {
    closeMenu();
    const now = formatLocalDate(new Date());
    // The range as it stands up to today, on the page of its last day (Codex r1 on #426: Done must
    // never commit a preset's future days).
    const initial = initialReportRangeDraft(filters.from, filters.to, now);
    const shown = initial.end ?? initial.start;
    setDraft(initial);
    setLastTapped(shown);
    setToday(now);
    setView({ year: Number(shown.slice(0, 4)), month: Number(shown.slice(5, 7)) });
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
            inert={menu === "closing" ? true : undefined}
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
            {/* The #391 list head (WUI-023); the menu's own name stays "Choose a date range". */}
            <div aria-hidden="true" className="df-range-menu-head" role="presentation">Date range</div>
            {REPORT_RANGE_PRESETS.map((preset) =>
              preset === "custom" ? (
                <button aria-checked={filters.range === "custom"} key={preset} onClick={openCustom} role="menuitemradio" type="button">
                  <span>{filters.range === "custom" ? "Edit dates…" : "Custom…"}</span>
                  {filters.range === "custom" ? <Check aria-hidden="true" size={16} /> : null}
                </button>
              ) : (
                <button
                  aria-checked={filters.range === preset}
                  key={preset}
                  onClick={() => {
                    // Focus goes back to the range trigger whether or not the range changes: an
                    // unchanged range keeps this instance; a new one remounts and focuses on mount.
                    const next = filtersForPreset(filters, preset);
                    focusTriggerAfterNavigation = rangeKey(next) === rangeKey(filters) ? null : rangeKey(next);
                    closeMenu({ restoreFocus: true });
                    router.push(reportsHref(next));
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  <span>{reportRangePresetLabel(preset)}</span>
                  {filters.range === preset ? <Check aria-hidden="true" size={16} /> : null}
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
              <button
                className="df-rbtn df-range-done"
                disabled={!reportRangeDraftComplete(draft, today)}
                onClick={() => {
                  if (!reportRangeDraftComplete(draft, today)) return;
                  // Focus returns to the range trigger now and, after the navigation remounts this
                  // component, on the new instance's mount.
                  const next = filtersForCustomRange(filters, draft.start, draft.end);
                  const unchanged = rangeKey(next) === rangeKey(filters);
                  closeCustom();
                  // The custom range already showing: nothing to load again.
                  if (unchanged) return;
                  focusTriggerAfterNavigation = rangeKey(next);
                  router.push(reportsHref(next));
                }}
                type="button"
              >
                Done
              </button>
            </>
          )}
          onClose={closeCustom}
          title="Custom dates"
        >
          <div className="report-range-calendar">
            <p aria-live="polite" className="report-range-caption">{reportRangeDraftCaption(draft)}</p>
            <DayframeCalendar
              {...reportRangeDraftBounds(draft, today)}
              onChange={(date) => {
                setDraft((current) => nextReportRangeDraft(current, date));
                setLastTapped(date);
              }}
              onViewChange={setView}
              range={draft}
              today={today}
              value={lastTapped}
              view={view}
            />
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}
