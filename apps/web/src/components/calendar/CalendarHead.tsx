"use client";

import Link from "next/link";
import { blockStyle } from "@/lib/block-style";
import type { CalendarHeadModel } from "@/lib/calendar-head";

/**
 * The Calendar page head: the month as the page heading with "9h 47m framed on Sunday" under it
 * (a link to that day's report), and the week strip — choose a day, see its biggest activities
 * as small bars, and the week's total (a link to the week's report).
 */
export function CalendarHead({
  dayReportHref,
  disabled,
  model,
  onSelectDay,
  weekReportHref
}: {
  dayReportHref: string;
  disabled: boolean;
  model: CalendarHeadModel;
  onSelectDay: (dateKey: string) => void;
  weekReportHref: string;
}) {
  return (
    <div className="df-page-head df-cal-head">
      <div>
        <h1>{model.month}</h1>
        <p>
          <Link className="df-cal-framed df-tnum" href={dayReportHref}>
            {model.framedLine}
          </Link>
        </p>
      </div>
      <div className="df-cal-week">
        <div aria-label="Choose a day" className="df-cal-days" role="group">
          {model.days.map((day) => (
            <button
              aria-label={day.accessibleName}
              aria-pressed={day.selected}
              className={`df-cal-day${day.isToday ? " is-today" : ""}`}
              disabled={disabled}
              key={day.key}
              onClick={() => onSelectDay(day.key)}
              type="button"
            >
              <small aria-hidden="true">{day.initial}</small>
              <b aria-hidden="true" className="df-tnum">{day.dateNumber}</b>
              <span aria-hidden="true" className="df-cal-day-bars">
                {day.bars.map((bar) => (
                  <i
                    className={bar.color ? "df-block" : "df-cal-day-none"}
                    key={bar.key}
                    style={bar.color ? blockStyle(bar.color, bar.name) : undefined}
                  />
                ))}
              </span>
            </button>
          ))}
        </div>
        <Link className="df-cal-weektotal df-tnum" href={weekReportHref}>
          {model.weekTotal}
        </Link>
      </div>
    </div>
  );
}
