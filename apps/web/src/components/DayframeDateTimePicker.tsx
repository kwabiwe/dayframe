"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

function parseLocal(value: string) {
  const [date = "", time = "09:00"] = value.split("T");
  const [year, month] = date.split("-").map(Number);
  return { date, time: time.slice(0, 5), year, month };
}

function monthDays(year: number, month: number) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const count = new Date(year, month, 0).getDate();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: count }, (_, index) => index + 1)
  ];
}

export function DayframeDateTimePicker({
  defaultValue,
  id,
  name,
  required
}: {
  defaultValue: string;
  id: string;
  name: string;
  required?: boolean;
}) {
  const initial = useMemo(() => parseLocal(defaultValue), [defaultValue]);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ year: initial.year, month: initial.month });
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = parseLocal(value);
  const days = monthDays(view.year, view.month);
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })
    .format(new Date(view.year, view.month - 1, 1));
  const displayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

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

  function chooseDay(day: number) {
    const date = `${view.year}-${String(view.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setValue(`${date}T${current.time}`);
  }

  function changeMonth(delta: number) {
    const next = new Date(view.year, view.month - 1 + delta, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() + 1 });
  }

  return (
    <div className="dayframe-date-time" ref={rootRef}>
      <input name={name} type="hidden" value={value} />
      <button
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
        <span>{displayLabel}</span>
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
        <header>
          <button aria-label="Previous month" onClick={() => changeMonth(-1)} type="button">
            <ChevronLeft aria-hidden="true" size={17} />
          </button>
          <strong>{monthLabel}</strong>
          <button aria-label="Next month" onClick={() => changeMonth(1)} type="button">
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </header>
        <div className="dayframe-calendar-weekdays" aria-hidden="true">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day.slice(0, 1)}</span>)}
        </div>
        <div className="dayframe-calendar-grid">
          {days.map((day, index) => day ? (
            <button
              aria-pressed={current.date === `${view.year}-${String(view.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`}
              key={day}
              onClick={() => chooseDay(day)}
              type="button"
            >
              {day}
            </button>
          ) : <span key={`blank-${index}`} />)}
        </div>
        <div className="dayframe-time-row">
          <Clock3 aria-hidden="true" size={17} />
          <span>Time</span>
          <div>
            <select
              aria-label="Hour"
              onChange={(event) => setValue(`${current.date}T${event.target.value}:${current.time.slice(3, 5)}`)}
              value={current.time.slice(0, 2)}
            >
              {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"))
                .map((hour) => <option key={hour} value={hour}>{hour}</option>)}
            </select>
            <span aria-hidden="true">:</span>
            <select
              aria-label="Minute"
              onChange={(event) => setValue(`${current.date}T${current.time.slice(0, 2)}:${event.target.value}`)}
              value={current.time.slice(3, 5)}
            >
              {Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0"))
                .map((minute) => <option key={minute} value={minute}>{minute}</option>)}
            </select>
          </div>
        </div>
        <button className="dayframe-date-time-done" onClick={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }} type="button">Done</button>
      </section>
    </div>
  );
}
