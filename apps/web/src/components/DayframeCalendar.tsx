"use client";

import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addCalendarDays, buildCalendarGrid, CALENDAR_WEEKDAY_LABELS } from "@/lib/calendar-grid";

/**
 * The web month grid (date-picker audit, 14 Oct 2026): Monday-first, six weeks, today marked in
 * coral text, days before `min` or after `max` dimmed and not choosable, and one tab stop with the
 * arrow keys moving through the days (←/→ a day, ↑/↓ a week, Page Up/Down a month, Home/End the
 * week's Monday/Sunday; Enter or Space chooses). Moving past the month turns the page.
 *
 * With `range` (the Reports custom range) the grid draws the range instead of one chosen day:
 * round first and last days on a continuous band, every day in it pressed. The caller owns which
 * taps make the range; `value` then names the day last tapped, which keeps the tab stop.
 */
export function DayframeCalendar({
  max,
  min,
  onChange,
  range,
  today,
  value,
  view,
  onViewChange
}: {
  /** The last choosable day (`YYYY-MM-DD`), inclusive. */
  max?: string | null;
  /** The first choosable day (`YYYY-MM-DD`), inclusive. */
  min?: string | null;
  onChange: (date: string) => void;
  /** A range to draw (inclusive `YYYY-MM-DD` days); `end` null while the last day is awaited. */
  range?: { start: string; end: string | null } | null;
  /** The viewer's today (`YYYY-MM-DD`), marked in the grid. */
  today?: string | null;
  value: string;
  view: { year: number; month: number };
  onViewChange: (view: { year: number; month: number }) => void;
}) {
  const days = buildCalendarGrid(view.year, view.month);
  const monthKey = `${view.year}-${String(view.month).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })
    .format(new Date(view.year, view.month - 1, 1));
  const outside = (date: string) => Boolean((min && date < min) || (max && date > max));
  // The day that holds the grid's one tab stop: the chosen day when it is on this page, otherwise
  // today, otherwise the month's first choosable day.
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const focusAfterRender = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const onPage = (date: string | null | undefined) => Boolean(date && days.some((day) => day.date === date));
  const tabStop = onPage(activeDate) ? activeDate!
    : onPage(value) ? value
      : onPage(today) && today!.startsWith(monthKey) ? today!
        : days.find((day) => day.inCurrentMonth && !outside(day.date))?.date ?? days.find((day) => day.inCurrentMonth)!.date;
  const canGoBack = !min || addCalendarDays(`${monthKey}-01`, -1) >= min;
  const canGoForward = !max || `${nextMonthKey(view, 1)}-01` <= max;

  // A key move focuses its day once it is drawn (the page may have turned), then forgets it.
  useEffect(() => {
    const date = focusAfterRender.current;
    if (!date) return;
    focusAfterRender.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
  }, [activeDate, view.year, view.month]);

  // A new chosen day (picked here or set from outside) takes the tab stop back from an old key move.
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setActiveDate(null);
  }

  function changeMonth(delta: number) {
    const next = new Date(view.year, view.month - 1 + delta, 1);
    onViewChange({ year: next.getFullYear(), month: next.getMonth() + 1 });
  }

  function showMonthOf(date: string) {
    const [year, month] = date.split("-").map(Number);
    if (year !== view.year || month !== view.month) onViewChange({ year, month });
  }

  function choose(date: string) {
    if (outside(date)) return;
    onChange(date);
    showMonthOf(date);
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, from: string) {
    const target = keyTarget(event.key, from);
    if (!target) return;
    event.preventDefault();
    // Home on a Monday, End on a Sunday: nothing to move, and no focus request left waiting to
    // pull focus back on a later render (Codex r1 on #422).
    if (target === from) return;
    setActiveDate(target);
    focusAfterRender.current = target;
    if (!onPage(target) || !target.startsWith(monthKey)) showMonthOf(target);
  }

  return (
    <div className="dayframe-calendar">
      <header>
        <button aria-label="Previous month" disabled={!canGoBack} onClick={() => changeMonth(-1)} type="button">
          <ChevronLeft aria-hidden="true" size={17} />
        </button>
        <strong aria-live="polite">{monthLabel}</strong>
        <button aria-label="Next month" disabled={!canGoForward} onClick={() => changeMonth(1)} type="button">
          <ChevronRight aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="dayframe-calendar-weekdays" aria-hidden="true">
        {CALENDAR_WEEKDAY_LABELS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
      </div>
      <div className="dayframe-calendar-grid" ref={gridRef}>
        {days.map((day) => {
          const unavailable = outside(day.date);
          const isToday = day.date === today;
          const rangeEnd = range ? range.end ?? range.start : null;
          const isRangeStart = range ? day.date === range.start : false;
          const isRangeEnd = range ? day.date === rangeEnd : false;
          const inRange = range ? day.date >= range.start && day.date <= rangeEnd! : false;
          const fullLabel = new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(new Date(`${day.date}T12:00:00`));
          return (
            <button
              aria-current={isToday ? "date" : undefined}
              aria-disabled={unavailable || undefined}
              aria-label={isRangeStart && isRangeEnd && range?.end ? `${fullLabel}, first and last day`
                : isRangeStart ? `${fullLabel}, first day`
                  : isRangeEnd ? `${fullLabel}, last day` : fullLabel}
              aria-pressed={range ? inRange : value === day.date}
              className={[
                day.inCurrentMonth ? "" : "is-adjacent-month",
                isToday ? "is-today" : "",
                unavailable ? "is-unavailable" : "",
                inRange ? "is-in-range" : "",
                isRangeStart && rangeEnd !== range?.start ? "is-range-start" : "",
                isRangeEnd && rangeEnd !== range?.start ? "is-range-end" : "",
                isRangeStart && rangeEnd === range?.start ? "is-range-single" : ""
              ].filter(Boolean).join(" ") || undefined}
              data-date={day.date}
              key={day.date}
              onClick={() => choose(day.date)}
              onFocus={() => setActiveDate(day.date)}
              onKeyDown={(event) => moveFocus(event, day.date)}
              tabIndex={day.date === tabStop ? 0 : -1}
              type="button"
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function nextMonthKey(view: { year: number; month: number }, delta: number) {
  const next = new Date(view.year, view.month - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

/** The day a navigation key moves to from `from`, or null for any other key. */
export function keyTarget(key: string, from: string): string | null {
  const weekday = (new Date(`${from}T12:00:00`).getDay() + 6) % 7;
  switch (key) {
    case "ArrowLeft": return addCalendarDays(from, -1);
    case "ArrowRight": return addCalendarDays(from, 1);
    case "ArrowUp": return addCalendarDays(from, -7);
    case "ArrowDown": return addCalendarDays(from, 7);
    case "Home": return addCalendarDays(from, -weekday);
    case "End": return addCalendarDays(from, 6 - weekday);
    case "PageUp": return addCalendarMonths(from, -1);
    case "PageDown": return addCalendarMonths(from, 1);
    default: return null;
  }
}

/** The same day of the month `delta` months away, clamped to that month's last day. */
function addCalendarMonths(date: string, delta: number) {
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(year, month - 1 + delta + 1, 0).getDate();
  const next = new Date(year, month - 1 + delta, Math.min(day, lastDay), 12);
  return [next.getFullYear(), String(next.getMonth() + 1).padStart(2, "0"), String(next.getDate()).padStart(2, "0")].join("-");
}
