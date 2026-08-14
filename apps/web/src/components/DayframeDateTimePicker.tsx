"use client";

import { CalendarDays, Clock3 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DayframeCalendar } from "@/components/DayframeCalendar";
import { maskTimeInput, parseTimeInput } from "@/lib/calendar-grid";

function parseLocal(value: string) {
  const [date = "", time = "09:00"] = value.split("T");
  const [year, month] = date.split("-").map(Number);
  return { date, time: time.slice(0, 5), year, month };
}

export function DayframeDateTimePicker({
  compact = false,
  dayOffset = 0,
  defaultValue,
  id,
  label,
  name,
  onChange,
  required
}: {
  compact?: boolean;
  dayOffset?: number;
  defaultValue: string;
  id: string;
  label?: string;
  name: string;
  onChange?: (value: string) => void;
  required?: boolean;
}) {
  const initial = useMemo(() => parseLocal(defaultValue), [defaultValue]);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ year: initial.year, month: initial.month });
  const [timeDraft, setTimeDraft] = useState(initial.time);
  const [timeError, setTimeError] = useState("");
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = parseLocal(value);
  const displayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
  const dayOffsetLabel = dayOffset === 1
    ? "one day after Start"
    : dayOffset > 1
      ? `${dayOffset} days after Start`
      : null;

  useEffect(() => {
    if (!open) return undefined;
    function closeOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  function chooseDay(date: string) {
    const nextValue = `${date}T${current.time}`;
    setValue(nextValue);
    onChange?.(nextValue);
  }

  function commitTime() {
    const normalized = parseTimeInput(timeDraft);
    if (!normalized) {
      setTimeError("Enter a valid time from 00:00 to 23:59.");
      return false;
    }
    const nextValue = `${current.date}T${normalized}`;
    setValue(nextValue);
    onChange?.(nextValue);
    setTimeDraft(normalized);
    setTimeError("");
    return true;
  }

  return (
    <div className={`dayframe-date-time${compact ? " is-compact" : ""}`} ref={rootRef}>
      <input name={name} type="hidden" value={value} />
      <button
        aria-label={compact
          ? `${label ? `${label} date and time` : "Choose date and time"}, currently ${displayLabel}${dayOffsetLabel ? `, ${dayOffsetLabel}` : ""}`
          : undefined}
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="dayframe-date-time-trigger"
        data-required={required || undefined}
        id={id}
        onClick={() => setOpen((shown) => !shown)}
        ref={triggerRef}
        type="button"
      >
        <span className={compact ? "dayframe-date-time-compact-value" : undefined}>
          {compact ? current.time : displayLabel}
        </span>
        {dayOffset > 0 ? (
          <span aria-hidden="true" className="dayframe-date-time-day-offset">+{dayOffset}</span>
        ) : null}
        <CalendarDays aria-hidden="true" size={17} />
      </button>
      <section
        aria-hidden={!open}
        aria-label="Choose date and time"
        className={`ui-floating-surface dayframe-date-time-panel${open ? " is-open" : ""}`}
        id={panelId}
        inert={!open}
        role="dialog"
      >
        <DayframeCalendar onChange={chooseDay} onViewChange={setView} value={current.date} view={view} />
        <div className="dayframe-time-row">
          <Clock3 aria-hidden="true" size={17} />
          <label htmlFor={`${id}-time`}>Time</label>
          <input
            aria-describedby={timeError ? `${id}-time-error` : undefined}
            aria-invalid={Boolean(timeError)}
            id={`${id}-time`}
            inputMode="numeric"
            onBlur={commitTime}
            onChange={(event) => {
              setTimeDraft(maskTimeInput(event.target.value));
              setTimeError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitTime();
              }
            }}
            placeholder="HH:MM"
            value={timeDraft}
          />
        </div>
        {timeError ? <p className="dayframe-time-error" id={`${id}-time-error`} role="alert">{timeError}</p> : null}
        <button className="dayframe-date-time-done" onClick={() => {
          if (!commitTime()) return;
          setOpen(false);
          triggerRef.current?.focus();
        }} type="button">Done</button>
      </section>
    </div>
  );
}
