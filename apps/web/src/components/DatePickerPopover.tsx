"use client";

import type { CSSProperties } from "react";
import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Primitives";
import { DayframeCalendar } from "@/components/DayframeCalendar";

export function DatePickerPopover({
  ariaLabel,
  className = "",
  disabled = false,
  label,
  onChange,
  onOpenChange,
  panelClassName = "",
  panelLabel = "Choose date",
  portal = false,
  today,
  triggerClassName = "",
  value
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (date: string) => void;
  onOpenChange?: (open: boolean) => void;
  panelClassName?: string;
  panelLabel?: string;
  portal?: boolean;
  today: string;
  triggerClassName?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [portalPosition, setPortalPosition] = useState<CSSProperties | null>(null);
  const selected = new Date(`${value}T12:00:00`);
  const [view, setView] = useState({ year: selected.getFullYear(), month: selected.getMonth() + 1 });

  const updateOpen = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !panelRef.current?.contains(event.target as Node)
      ) updateOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updateOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, updateOpen]);

  useLayoutEffect(() => {
    if (!open || !portal) return undefined;
    function updatePosition() {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const margin = 12;
      const gap = 6;
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - margin * 2);
      const height = panelRect.height;
      const left = Math.min(
        Math.max(margin, triggerRect.left),
        Math.max(margin, window.innerWidth - width - margin)
      );
      const below = triggerRect.bottom + gap;
      const top = below + height <= window.innerHeight - margin
        ? below
        : Math.max(margin, triggerRect.top - height - gap);
      setPortalPosition({ left, top, width });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, portal]);

  function choose(date: string) {
    if (!date) return;
    onChange(date);
    updateOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const panel = (
    <section
      aria-hidden={!open}
      aria-label={panelLabel}
      className={`ui-floating-surface timeline-date-picker-panel${open ? " is-open" : ""}${portal ? " is-portalled" : ""}${panelClassName ? ` ${panelClassName}` : ""}`}
      id={panelId}
      inert={!open}
      ref={panelRef}
      role="dialog"
      style={portal ? { ...portalPosition, visibility: portalPosition ? "visible" : "hidden" } : undefined}
    >
      <Button compact onClick={() => choose(today)} disabled={disabled}>
        Today
      </Button>
      <DayframeCalendar onChange={choose} onViewChange={setView} value={value} view={view} />
    </section>
  );

  return (
    <div className={`timeline-date-picker${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        aria-label={ariaLabel}
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`timeline-period-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        disabled={disabled}
        onClick={() => updateOpen(!open)}
        ref={triggerRef}
        type="button"
      >
        <CalendarDays aria-hidden="true" size={16} />
        <strong aria-atomic="true" aria-live="polite">{label}</strong>
      </button>
      {portal ? (typeof document === "undefined" ? null : createPortal(panel, document.body)) : panel}
    </div>
  );
}
