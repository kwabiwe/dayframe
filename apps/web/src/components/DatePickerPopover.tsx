"use client";

import type { CSSProperties, RefObject } from "react";
import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Primitives";
import { DayframeCalendar } from "@/components/DayframeCalendar";

export function DatePickerPopover({
  anchorRef,
  ariaLabel,
  className = "",
  disabled = false,
  iconOnly = false,
  label,
  onChange,
  onOpenChange,
  open: controlledOpen,
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
  onChange: (date: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
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
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [portalPosition, setPortalPosition] = useState<CSSProperties | null>(null);
  const selected = new Date(`${value}T12:00:00`);
  const [view, setView] = useState({ year: selected.getFullYear(), month: selected.getMonth() + 1 });

  const updateOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

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
      const left = Math.min(
        Math.max(viewportLeft + margin, triggerRect.left),
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
  }, [anchorRef, effectiveOpen, portal]);

  function choose(date: string) {
    if (disabled || !date) return;
    onChange(date);
    updateOpen(false);
    (anchorRef?.current ?? triggerRef.current)?.focus();
  }

  const panel = (
    <section
      aria-hidden={!effectiveOpen}
      aria-label={panelLabel}
      className={`ui-floating-surface timeline-date-picker-panel${effectiveOpen ? " is-open" : ""}${portal ? " is-portalled" : ""}${panelClassName ? ` ${panelClassName}` : ""}`}
      id={panelId}
      inert={!effectiveOpen}
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
          <CalendarDays aria-hidden="true" size={16} />
          {iconOnly ? null : <strong aria-atomic="true" aria-live="polite">{label}</strong>}
        </button>
      ) : null}
      {portal ? (typeof document === "undefined" ? null : createPortal(panel, document.body)) : panel}
    </div>
  );
}
