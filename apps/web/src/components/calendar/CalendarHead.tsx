"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { blockStyle } from "@/lib/block-style";
import type { CalendarHeadModel } from "@/lib/calendar-head";

/**
 * The Calendar page head: the month as the page heading and the week strip — choose a day, see its
 * biggest activities as small bars, and the week's total (a link to the week's report) — with, under
 * the strip (Calendar v3), "8h 41m framed" for the chosen day (a link to that day's report).
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
  const daysRef = useRef<HTMLDivElement | null>(null);
  const selectedKey = model.days.find((day) => day.selected)?.key;
  // On the narrowest phones the strip scrolls sideways; keep the chosen day in view (inside the strip
  // only, never scrolling the page).
  useEffect(() => {
    const strip = daysRef.current;
    const chosen = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !chosen || strip.scrollWidth <= strip.clientWidth) return;
    const stripRect = strip.getBoundingClientRect();
    const chosenRect = chosen.getBoundingClientRect();
    if (chosenRect.right > stripRect.right) strip.scrollLeft += chosenRect.right - stripRect.right;
    else if (chosenRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - chosenRect.left;
  }, [selectedKey]);

  return (
    <div className="df-page-head df-cal-head">
      <div>
        <h1>{model.month}</h1>
      </div>
      <div className="df-cal-week">
        <div aria-label="Choose a day" className="df-cal-days" ref={daysRef} role="group">
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
        {/* Calendar v3: one short secondary line under the strip, hidden on an empty day. */}
        {model.framedLine ? (
          <p className="df-cal-framed-line">
            <Link aria-label={model.framedLabel} className="df-cal-framed df-tnum" href={dayReportHref}>
              {model.framedLine}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
