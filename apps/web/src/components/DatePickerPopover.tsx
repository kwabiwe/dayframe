"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Primitives";
import { DayframeCalendar } from "@/components/DayframeCalendar";

export function DatePickerPopover({
  disabled = false,
  label,
  onChange,
  today,
  value
}: {
  disabled?: boolean;
  label: string;
  onChange: (date: string) => void;
  today: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = new Date(`${value}T12:00:00`);
  const [view, setView] = useState({ year: selected.getFullYear(), month: selected.getMonth() + 1 });

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function choose(date: string) {
    if (!date) return;
    onChange(date);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="timeline-date-picker" ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="timeline-period-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <CalendarDays aria-hidden="true" size={16} />
        <strong aria-atomic="true" aria-live="polite">{label}</strong>
      </button>
      <section
        aria-hidden={!open}
        aria-label="Choose date"
        className={`ui-floating-surface timeline-date-picker-panel${open ? " is-open" : ""}`}
        id={panelId}
        inert={!open}
        role="dialog"
      >
        <Button compact onClick={() => choose(today)} disabled={disabled}>
          Today
        </Button>
        <DayframeCalendar onChange={choose} onViewChange={setView} value={value} view={view} />
      </section>
    </div>
  );
}
