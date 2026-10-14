"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Primitives";
import { DayframeCalendar } from "@/components/DayframeCalendar";
import { addCalendarDays } from "@/lib/calendar-grid";

/** Phone width: the picker becomes a bottom sheet (date-picker audit D6, 14 Oct 2026). */
const PHONE_SHEET_QUERY = "(max-width: 560px)";

function subscribeToPhoneWidth(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(PHONE_SHEET_QUERY);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }
  media.addListener?.(onChange);
  return () => media.removeListener?.(onChange);
}

function getPhoneWidth() {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_SHEET_QUERY).matches;
}

function getServerPhoneWidth() {
  return false;
}

function subscribeToClientEnvironment() {
  return () => undefined;
}

function getClientPortalTarget() {
  return document.body;
}

function getServerPortalTarget() {
  return null;
}

export function DatePickerPopover({
  anchorRef,
  ariaLabel,
  className = "",
  disabled = false,
  iconOnly = false,
  label,
  max,
  min,
  onChange,
  onOpenChange,
  open: controlledOpen,
  panelId: controlledPanelId,
  portalAlign = "start",
  panelClassName = "",
  panelLabel = "Choose date",
  portal = false,
  showTrigger = true,
  today,
  triggerClassName = "",
  value
}: {
  anchorRef?: RefObject<HTMLElement | null>;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  label: string;
  /** The last choosable day, inclusive (finished blocks: today, owner decision D2). */
  max?: string | null;
  /** The first choosable day, inclusive. */
  min?: string | null;
  onChange: (date: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  panelId?: string;
  portalAlign?: "center" | "start";
  panelClassName?: string;
  panelLabel?: string;
  portal?: boolean;
  showTrigger?: boolean;
  today: string;
  triggerClassName?: string;
  value: string;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const effectiveOpen = open && !disabled;
  const generatedPanelId = useId();
  const panelId = controlledPanelId ?? generatedPanelId;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const clientPortalTarget = useSyncExternalStore(
    subscribeToClientEnvironment,
    getClientPortalTarget,
    getServerPortalTarget
  );
  const portalTarget = portal ? clientPortalTarget : null;
  // At phone width a day tap only changes this draft; Done saves it and ✕ leaves it (D1/D6).
  const phone = useSyncExternalStore(subscribeToPhoneWidth, getPhoneWidth, getServerPhoneWidth);
  const [draft, setDraft] = useState(value);
  const [scrimZ, setScrimZ] = useState<number | null>(null);
  const [portalPosition, setPortalPosition] = useState<CSSProperties | null>(null);
  const selected = new Date(`${value}T12:00:00`);
  const [view, setView] = useState({ year: selected.getFullYear(), month: selected.getMonth() + 1 });

  const updateOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  // Each opening starts the draft from the current value.
  const [draftSeed, setDraftSeed] = useState({ open: false, value });
  if (draftSeed.open !== effectiveOpen || (!effectiveOpen && draftSeed.value !== value)) {
    setDraftSeed({ open: effectiveOpen, value });
    if (effectiveOpen) setDraft(value);
  }

  useEffect(() => {
    if (!disabled || !open) return undefined;
    const timeout = window.setTimeout(() => updateOpen(false), 0);
    return () => window.clearTimeout(timeout);
  }, [disabled, open, updateOpen]);

  useEffect(() => {
    if (!effectiveOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !panelRef.current?.contains(event.target as Node) &&
        !anchorRef?.current?.contains(event.target as Node)
      ) updateOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updateOpen(false);
      (anchorRef?.current ?? triggerRef.current)?.focus();
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [anchorRef, effectiveOpen, updateOpen]);

  useLayoutEffect(() => {
    if (!effectiveOpen || !portal) return undefined;
    function updatePosition() {
      const trigger = anchorRef?.current ?? triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const margin = 12;
      const gap = 6;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const width = Math.min(280, viewportWidth - margin * 2);
      const height = panelRect.height;
      const preferredLeft = portalAlign === "center"
        ? triggerRect.left + (triggerRect.width - width) / 2
        : triggerRect.left;
      const left = Math.min(
        Math.max(viewportLeft + margin, preferredLeft),
        Math.max(viewportLeft + margin, viewportLeft + viewportWidth - width - margin)
      );
      const below = triggerRect.bottom + gap;
      const top = below + height <= viewportTop + viewportHeight - margin
        ? below
        : Math.max(viewportTop + margin, triggerRect.top - height - gap);
      setPortalPosition({ left, top, width });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [anchorRef, effectiveOpen, portal, portalAlign]);

  // The scrim sits just under this panel, whichever layer the panel is on (90, 120 or 140).
  useLayoutEffect(() => {
    if (!phone || !effectiveOpen || !panelRef.current) return;
    const z = Number.parseInt(getComputedStyle(panelRef.current).zIndex, 10);
    setScrimZ(Number.isFinite(z) ? z - 1 : null);
  }, [effectiveOpen, phone]);

  function choose(date: string) {
    if (disabled || !date) return;
    onChange(date);
    updateOpen(false);
    (anchorRef?.current ?? triggerRef.current)?.focus();
  }

  // The phone sheet takes focus (the grid's tab stop) and keeps Tab inside it while open.
  useEffect(() => {
    if (!phone || !effectiveOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('.dayframe-calendar-grid button[tabindex="0"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [effectiveOpen, phone]);

  function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (!phone || event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), [tabindex="0"]'
    ));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function dismiss() {
    updateOpen(false);
    (anchorRef?.current ?? triggerRef.current)?.focus();
  }

  const outside = (date: string) => Boolean((max && date > max) || (min && date < min));
  const yesterday = addCalendarDays(today, -1);

  const panel = (
    <section
      aria-hidden={!effectiveOpen}
      aria-label={panelLabel}
      className={`ui-floating-surface timeline-date-picker-panel${effectiveOpen ? " is-open" : ""}${portal ? " is-portalled" : ""}${phone ? " is-sheet" : ""}${panelClassName ? ` ${panelClassName}` : ""}`}
      id={panelId}
      inert={!effectiveOpen}
      onKeyDown={trapTab}
      ref={panelRef}
      role="dialog"
      style={portal && !phone ? { ...portalPosition, visibility: portalPosition ? "visible" : "hidden" } : undefined}
    >
      {phone ? (
        <>
          <span aria-hidden="true" className="date-sheet-grabber" />
          <header className="date-sheet-head">
            <strong>{panelLabel}</strong>
            <IconButton className="date-sheet-close" label="Close" onClick={dismiss}>
              <X aria-hidden="true" size={18} />
            </IconButton>
          </header>
          <div className="date-sheet-segments" role="group" aria-label="Quick picks">
            {[{ date: today, label: "Today" }, { date: yesterday, label: "Yesterday" }].map((pick) => (
              <button
                aria-pressed={draft === pick.date}
                disabled={disabled || outside(pick.date)}
                key={pick.label}
                onClick={() => {
                  setDraft(pick.date);
                  const [year, month] = pick.date.split("-").map(Number);
                  setView({ year, month });
                }}
                type="button"
              >
                {pick.label}
              </button>
            ))}
          </div>
          <DayframeCalendar max={max} min={min} onChange={setDraft} onViewChange={setView} today={today} value={draft} view={view} />
          <button className="date-sheet-done" disabled={disabled || outside(draft)} onClick={() => choose(draft)} type="button">
            Done
          </button>
        </>
      ) : (
        <>
          <Button compact onClick={() => choose(today)} disabled={disabled || outside(today)}>
            Today
          </Button>
          <DayframeCalendar max={max} min={min} onChange={choose} onViewChange={setView} today={today} value={value} view={view} />
        </>
      )}
    </section>
  );
  // Phone width: a scrim behind the sheet (a press on it is a press outside, which closes it).
  // Its own press handler (a non-portalled scrim is inside the picker, so the outside-press listener
  // ignores it), and the quick editor's nested-surface marker so a press here never reaches the
  // editor's own outside-press dismissal (Codex r1 on #423).
  const scrim = phone && effectiveOpen
    ? (
      <div
        aria-hidden="true"
        className={`date-sheet-scrim${portal ? " time-entry-quick-editor-nested-surface" : ""}`}
        onMouseDown={(event) => {
          event.preventDefault();
          dismiss();
        }}
        style={scrimZ === null ? undefined : { zIndex: scrimZ }}
      />
    )
    : null;

  return (
    <div className={`timeline-date-picker${className ? ` ${className}` : ""}`} ref={rootRef}>
      {showTrigger ? (
        <button
          aria-label={ariaLabel ?? (iconOnly ? `Choose date, currently ${label}` : undefined)}
          aria-controls={panelId}
          aria-expanded={effectiveOpen}
          aria-haspopup="dialog"
          className={`timeline-period-trigger${iconOnly ? " is-icon-only" : ""}${triggerClassName ? ` ${triggerClassName}` : ""}`}
          disabled={disabled}
          onClick={() => updateOpen(!open)}
          ref={triggerRef}
          title={iconOnly ? (ariaLabel ?? `Choose date, currently ${label}`) : undefined}
          type="button"
        >
          <DayframeIcon glyph="calendar-days" size={16}/>
          {iconOnly ? null : <strong aria-atomic="true" aria-live="polite">{label}</strong>}
        </button>
      ) : null}
      {portal ? (portalTarget ? createPortal(<>{scrim}{panel}</>, portalTarget) : null) : <>{scrim}{panel}</>}
    </div>
  );
}
