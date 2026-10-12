"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useState } from "react";
import { ReportDonutSegment } from "@/components/ReportDonutSegment";
import { blockStyle } from "@/lib/block-style";
import { categoryDisplay } from "@/lib/display";
import { formatDuration } from "@/lib/format";
import type { ReportBlocksModel } from "@/lib/reports-blocks";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type AllocationSlice = {
  id: string;
  categoryIds: string[];
  name: string;
  color: string | null;
  seconds: number;
  percentage: number;
  isUncategorized: boolean;
  href: string;
};

/**
 * The range in blocks beside "Where it went" (Blocks parity step 15b-2): hovering or focusing an
 * activity in the donut or its table highlights that activity's blocks (the others fade) and puts
 * its time in the donut's centre. Slices and rows stay links that filter by the activity. Every
 * date-derived value arrives computed with the report (`reportBlocksModel`).
 */
export function ReportsBlocksPanel({
  blocks,
  land,
  slices,
  totalLabel,
  totalSeconds
}: {
  blocks: ReportBlocksModel | null;
  land: { easing: string; durationMs: number };
  slices: AllocationSlice[];
  totalLabel: string;
  totalSeconds: number;
}) {
  // Ids, resolved against the current slices each render: a slice that a filter navigation took
  // away (Other splitting into its activities) simply stops being highlighted.
  const [hotId, setHotId] = useState<string | null>(null);
  const hot = slices.find((slice) => slice.id === hotId) ?? null;
  // The slice holding keyboard focus gets its own neutral ring, independent of the highlight.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // When a filter navigation brings new slices, drop ids they no longer contain, so a slice that
  // went away and later comes back (filtered out, then the filter removed) returns unhighlighted.
  const [seenSlices, setSeenSlices] = useState(slices);
  if (seenSlices !== slices) {
    setSeenSlices(slices);
    if (hotId !== null && !slices.some((slice) => slice.id === hotId)) setHotId(null);
    if (focusedId !== null && !slices.some((slice) => slice.id === focusedId)) setFocusedId(null);
  }
  const hotIds = hot ? new Set(hot.categoryIds) : null;
  const highlight = (slice: AllocationSlice) => (on: boolean) => setHotId((current) => (on ? slice.id : current === slice.id ? null : current));

  const arcs = slices.map((slice, index) => {
    const before = slices.slice(0, index).reduce((sum, previous) => sum + previous.seconds, 0);
    const fraction = totalSeconds > 0 ? slice.seconds / totalSeconds : 0;
    return { slice, dash: fraction * CIRCUMFERENCE, offset: -(before / Math.max(1, totalSeconds)) * CIRCUMFERENCE };
  });

  return (
    <div className={`df-report-panel${blocks ? "" : " is-single"}`}>
      {blocks ? (
        <section aria-labelledby="df-report-blocks-title" className="df-card df-report-blocks">
          <div className="df-card-head">
            <h2 id="df-report-blocks-title">{blocks.layout === "month" ? "The month in blocks" : "The days in blocks"}</h2>
            <span className="df-faint">
              <span className="df-hint-fine">Hover an activity to trace it</span>
              <span className="df-hint-coarse">Tap an activity to trace it</span>
            </span>
          </div>
          {blocks.layout === "week" ? (
            <ol
              className={`df-wblocks${hotIds ? " has-hot" : ""}`}
              style={{ "--df-wb-height": "230px", "--df-land": land.easing, "--df-land-ms": `${land.durationMs}ms` } as CSSProperties}
            >
              {blocks.days.map((day) => (
                <li aria-label={day.accessibleName} className={`df-wb${day.isToday ? " is-today" : ""}`} key={day.key}>
                  <span aria-hidden="true" className="df-wb-stack">
                    {day.blocks.map((block) => (
                      <span
                        className={`${block.color ? "df-block" : "df-wb-none"}${hotIds?.has(block.id) ? " is-hot" : ""}`}
                        data-key={block.id}
                        key={block.id}
                        style={{ ...(block.color ? blockStyle(block.color, block.name) : {}), height: block.height }}
                        title={`${block.name} · ${formatDuration(block.seconds)}`}
                      />
                    ))}
                  </span>
                  <span aria-hidden="true" className="df-wb-label">
                    <b>
                      <span className="df-wb-label-full">{day.label}</span>
                      <span className="df-wb-label-short">{day.shortLabel}</span>
                    </b>
                    <small className="df-tnum">{formatDuration(day.totalSeconds)}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className={`df-month${hotIds ? " has-hot" : ""}`}>
              {WEEKDAYS.map((weekday) => <span aria-hidden="true" className="df-dow" key={weekday}>{weekday}</span>)}
              {Array.from({ length: blocks.leadingBlanks }, (_, index) => <span aria-hidden="true" className="df-mday is-empty" key={`blank-${index}`} />)}
              {blocks.days.map((day) => (
                <span aria-label={day.accessibleName} className={`df-mday${day.isToday ? " is-today" : ""}`} key={day.key} role="img">
                  <em aria-hidden="true">{day.dateNumber}</em>
                  <span aria-hidden="true" className="df-mday-stack">
                    {day.blocks.map((block) => (
                      <i
                        className={`${block.color ? "df-block" : "df-wb-none"}${hotIds?.has(block.id) ? " is-hot" : ""}`}
                        data-key={block.id}
                        key={block.id}
                        style={{ ...(block.color ? blockStyle(block.color, block.name) : {}), height: block.height }}
                      />
                    ))}
                  </span>
                </span>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section aria-labelledby="df-where-title" className="df-card df-where">
        <div className="df-card-head">
          <h2 id="df-where-title">Where it went</h2>
          <span className="df-faint">{slices.length} {slices.length === 1 ? "activity" : "activities"}</span>
        </div>
        {totalSeconds > 0 ? (
          <div className="df-alloc">
            <figure className="df-donut-wrap">
              <svg aria-label="Where it went by activity" className={`df-donut${hot ? " has-hot" : ""}`} role="group" viewBox="0 0 120 120">
                <circle aria-hidden="true" className="df-donut-track" cx="60" cy="60" r={RADIUS} />
                {arcs.map(({ dash, offset, slice }) => (
                  <ReportDonutSegment
                    ariaLabel={`Filter by ${slice.name}, ${formatDuration(slice.seconds)}`}
                    className={`df-donut-seg${hot?.id === slice.id ? " is-hot" : ""}`}
                    dash={dash}
                    href={slice.href}
                    key={slice.id}
                    offset={offset}
                    onFocusChange={(focused) => setFocusedId((current) => (focused ? slice.id : current === slice.id ? null : current))}
                    onHighlight={highlight(slice)}
                    radius={RADIUS}
                    stroke={categoryDisplay(slice.name, slice.color).color}
                    totalLength={CIRCUMFERENCE}
                  />
                ))}
                {arcs.map(({ dash, offset, slice }) =>
                  slice.id === focusedId ? (
                    <circle
                      aria-hidden="true"
                      className="df-donut-focus"
                      cx="60"
                      cy="60"
                      key={`focus-${slice.id}`}
                      pathLength={CIRCUMFERENCE}
                      r={RADIUS + 11}
                      strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                      strokeDashoffset={offset}
                    />
                  ) : null
                )}
              </svg>
              <figcaption aria-live="polite" className="df-donut-center">
                <b className="df-tnum">{formatDuration(hot ? hot.seconds : totalSeconds)}</b>
                <small>{hot ? hot.name : totalLabel}</small>
              </figcaption>
            </figure>
            <ul aria-label="Time by activity" className="df-ctable">
              {slices.map((slice) => (
                <li key={slice.id}>
                  <Link
                    aria-label={`Filter by ${slice.name}, ${formatDuration(slice.seconds)}, ${slice.percentage}%`}
                    className={`df-crow${hot?.id === slice.id ? " is-hot" : ""}`}
                    href={slice.href}
                    onBlur={() => highlight(slice)(false)}
                    onFocus={() => highlight(slice)(true)}
                    onMouseEnter={() => highlight(slice)(true)}
                    onMouseLeave={() => highlight(slice)(false)}
                    style={slice.color && !slice.isUncategorized ? blockStyle(slice.color, slice.name) : undefined}
                  >
                    <i aria-hidden="true" className={slice.color && !slice.isUncategorized ? undefined : "is-none"} />
                    <b>{slice.name}</b>
                    <span className="df-tnum">{formatDuration(slice.seconds)}</span>
                    <small className="df-tnum">{slice.percentage}%</small>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="df-muted">Nothing tracked in this range. Change the range or filters, or track time to fill it.</p>
        )}
      </section>
    </div>
  );
}
