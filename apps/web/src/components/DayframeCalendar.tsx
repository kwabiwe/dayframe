"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildCalendarGrid } from "@/lib/calendar-grid";

export function DayframeCalendar({
  onChange,
  value,
  view,
  onViewChange
}: {
  onChange: (date: string) => void;
  value: string;
  view: { year: number; month: number };
  onViewChange: (view: { year: number; month: number }) => void;
}) {
  const days = buildCalendarGrid(view.year, view.month);
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })
    .format(new Date(view.year, view.month - 1, 1));

  function changeMonth(delta: number) {
    const next = new Date(view.year, view.month - 1 + delta, 1);
    onViewChange({ year: next.getFullYear(), month: next.getMonth() + 1 });
  }

  function choose(date: string) {
    const selected = new Date(`${date}T12:00:00`);
    onChange(date);
    if (selected.getFullYear() !== view.year || selected.getMonth() + 1 !== view.month) {
      onViewChange({ year: selected.getFullYear(), month: selected.getMonth() + 1 });
    }
  }

  return (
    <div className="dayframe-calendar">
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
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
      </div>
      <div className="dayframe-calendar-grid">
        {days.map((day) => (
          <button
            aria-label={new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(new Date(`${day.date}T12:00:00`))}
            aria-pressed={value === day.date}
            className={day.inCurrentMonth ? undefined : "is-adjacent-month"}
            key={day.date}
            onClick={() => choose(day.date)}
            type="button"
          >
            {day.day}
          </button>
        ))}
      </div>
    </div>
  );
}
