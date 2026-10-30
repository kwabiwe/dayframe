"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { blockStyle } from "@/lib/block-style";
import type { CalendarHeadModel } from "@/lib/calendar-head";

/**
 * The Calendar week strip, in the one compact toolbar row (#259): choose a day, see its total under
 * its date (#256; not on phones) and its biggest activities as small bars, and the week's total alone
 * (a link to the week's report). The Week grid shows only the total (UI review E, W9).
 */
export function CalendarHead({
  disabled,
  model,
  onSelectDay,
  showDays = true,
  showSelected = true,
  showTotal = true,
  variant = "strip",
  weekReportHref
}: {
  disabled: boolean;
  model: CalendarHeadModel;
  onSelectDay: (dateKey: string) => void;
  /** False in the Week grid, whose day columns already show each date and total (UI review E). */
  showDays?: boolean;
  /** False in Week, which highlights no single day (only today's coral circle). */
  showSelected?: boolean;
  /** False where the toolbar shows the total itself (UI review round 2): the strip is then its own row. */
  showTotal?: boolean;
  /**
   * "row" (UI review round 2, owner 30 Oct 2026): the one day row over the Day and Week grids — letter and date,
   * dots, today's coral circle, each day's total in its tip, laid out in the grid's own columns (the host's CSS).
   */
  variant?: "strip" | "row";
  weekReportHref: string;
}) {
  const row = variant === "row";
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
  }, [selectedKey, showDays]); // showDays: the strip comes back when the Week grid gives way to Day or List (Codex r1 on #632).

  return (
    <div className="df-cal-week">
      {showDays ? <div aria-label="Choose a day" className="df-cal-days" ref={daysRef} role="group">
        {model.days.map((day) => (
          <button
            aria-label={day.accessibleName}
            aria-pressed={showSelected ? day.selected : undefined}
            className={`df-cal-day${day.isToday ? " is-today" : ""}${showSelected && day.selected ? " is-selected" : ""}`}
            data-tip={row ? day.tip : undefined}
            disabled={disabled}
            key={day.key}
            onClick={() => onSelectDay(day.key)}
            type="button"
          >
            <small aria-hidden="true">{day.initial}</small>
            <b aria-hidden="true" className="df-tnum">{day.dateNumber}</b>
            {row ? null : <span aria-hidden="true" className="df-cal-day-total df-tnum">{day.total}</span>}
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
      </div> : null}
      {showTotal ? (
        <Link aria-label={`${model.weekTotalLabel}. Open in Reports`} className="df-cal-weektotal df-tnum" href={weekReportHref}
          title={model.weekTotalLabel}>
          {model.weekTotal}
        </Link>
      ) : null}
    </div>
  );
}
