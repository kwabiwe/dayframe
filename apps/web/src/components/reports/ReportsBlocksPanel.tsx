"use client";

import Link from "next/link";
import type { CSSProperties, KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { ReportDonutSegment } from "@/components/ReportDonutSegment";
import { AccessibleBreakdownTable } from "@/components/ReportsOverview";
import type { ReportBreakdownRow } from "@/lib/report-service";
import { blockStyle } from "@/lib/block-style";
import { categoryDisplay } from "@/lib/display";
import { formatDuration } from "@/lib/format";
import { donutArcs, type ReportBlocksDay, type ReportBlocksModel } from "@/lib/reports-blocks";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const blockKey = (day: ReportBlocksDay, blockId: string) => `${day.key}|${blockId}`;

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
 * activity anywhere — its donut slice, its row, or any of its blocks in the day columns or month
 * grid (staging feedback I1) — traces it: its blocks and slice stay, every other block and slice
 * fades, its row is marked and its time is in the donut's centre. Slices and rows stay links that
 * filter by the activity; blocks are one tab stop (arrow keys move between them) and only trace.
 * Every date-derived value arrives computed with the report (`reportBlocksModel`).
 */
export function ReportsBlocksPanel({
  blocks,
  exactRows = [],
  land,
  slices,
  totalLabel,
  totalSeconds
}: {
  blocks: ReportBlocksModel | null;
  /** Every activity's exact time, shown as a disclosure under the donut (UIA-303). */
  exactRows?: ReportBreakdownRow[];
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
  // A block traces the slice holding its activity (Other for an activity folded into it).
  const sliceByActivity = new Map(slices.flatMap((slice) => slice.categoryIds.map((id) => [id, slice] as const)));
  const traceBlock = (blockId: string, on: boolean) => {
    const slice = sliceByActivity.get(blockId);
    if (slice) highlight(slice)(on);
  };

  // The blocks are one tab stop: the last block focused (else the first) takes Tab, and arrow keys
  // move between days (left/right) and within a day's stack (up/down), Home/End to the ends.
  const blocksRef = useRef<HTMLElement | null>(null);
  const [rovingKey, setRovingKey] = useState<string | null>(null);
  const blockKeys = blocks ? blocks.days.flatMap((day) => day.blocks.map((block) => blockKey(day, block.id))) : [];
  const tabKey = rovingKey !== null && blockKeys.includes(rovingKey) ? rovingKey : blockKeys[0] ?? null;
  const moveFocus = (event: KeyboardEvent<HTMLElement>, day: ReportBlocksDay, index: number) => {
    if (!blocks) return;
    const days = blocks.days.filter((entry) => entry.blocks.length > 0);
    const at = days.findIndex((entry) => entry.key === day.key);
    let target: string | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // Stacks grow upwards (column-reverse): up is the next block in the day.
      const next = day.blocks[index + (event.key === "ArrowUp" ? 1 : -1)];
      target = next ? blockKey(day, next.id) : null;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const other = days[at + (event.key === "ArrowRight" ? 1 : -1)];
      if (other) {
        const same = other.blocks.find((block) => block.id === day.blocks[index]?.id);
        target = blockKey(other, (same ?? other.blocks[Math.min(index, other.blocks.length - 1)]).id);
      }
    } else if (event.key === "Home" || event.key === "End") {
      target = (event.key === "Home" ? blockKeys[0] : blockKeys[blockKeys.length - 1]) ?? null;
    } else return;
    event.preventDefault();
    if (!target) return;
    setRovingKey(target);
    const blocksInView = blocksRef.current?.querySelectorAll<HTMLElement>("[data-block-key]") ?? [];
    [...blocksInView].find((element) => element.dataset.blockKey === target)?.focus();
  };
  const traceProps = (day: ReportBlocksDay, block: ReportBlocksDay["blocks"][number], index: number) => {
    const key = blockKey(day, block.id);
    return {
      "aria-describedby": "df-report-blocks-hint",
      "aria-label": `${block.name}, ${formatDuration(block.seconds)}, ${day.label}`,
      className: `df-tblock ${block.color ? "df-block" : "df-wb-none"}${hotIds?.has(block.id) ? " is-hot" : ""}`,
      "data-block-key": key,
      "data-key": block.id,
      onBlur: () => traceBlock(block.id, false),
      // Safari and touch screens do not focus a button on click: the click traces it too.
      onClick: () => traceBlock(block.id, true),
      onFocus: () => {
        setRovingKey(key);
        traceBlock(block.id, true);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => moveFocus(event, day, index),
      onMouseEnter: () => traceBlock(block.id, true),
      onMouseLeave: () => traceBlock(block.id, false),
      style: { ...(block.color ? blockStyle(block.color, block.name) : {}), height: block.height },
      tabIndex: key === tabKey ? 0 : -1,
      type: "button" as const
    };
  };

  const arcs = donutArcs(slices.map((slice) => slice.seconds), totalSeconds, CIRCUMFERENCE).map((arc, index) => ({ ...arc, slice: slices[index] }));

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
            <span className="sr-only" id="df-report-blocks-hint">
              Focus a block to trace its activity in Where it went; arrow keys move between blocks.
            </span>
          </div>
          {blocks.layout === "week" ? (
            <ol
              className={`df-wblocks${hotIds ? " has-hot" : ""}`}
              ref={(node) => {
                blocksRef.current = node;
              }}
              style={{ "--df-wb-height": "230px", "--df-land": land.easing, "--df-land-ms": `${land.durationMs}ms` } as CSSProperties}
            >
              {blocks.days.map((day) => (
                <li aria-label={day.accessibleName} className={`df-wb${day.isToday ? " is-today" : ""}`} key={day.key}>
                  <span className="df-wb-stack">
                    {day.blocks.map((block, index) => (
                      <button key={block.id} title={`${block.name} · ${formatDuration(block.seconds)}`} {...traceProps(day, block, index)} />
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
            <div
              className={`df-month${hotIds ? " has-hot" : ""}`}
              ref={(node) => {
                blocksRef.current = node;
              }}
            >
              {WEEKDAYS.map((weekday) => <span aria-hidden="true" className="df-dow" key={weekday}>{weekday}</span>)}
              {Array.from({ length: blocks.leadingBlanks }, (_, index) => <span aria-hidden="true" className="df-mday is-empty" key={`blank-${index}`} />)}
              {blocks.days.map((day) => (
                <span aria-label={day.accessibleName} className={`df-mday${day.isToday ? " is-today" : ""}`} key={day.key} role="group">
                  <em aria-hidden="true">{day.dateNumber}</em>
                  <span className="df-mday-stack">
                    {day.blocks.map((block, index) => (
                      <button key={block.id} {...traceProps(day, block, index)} />
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
        <AccessibleBreakdownTable
          caption="Exact time by activity; overlapping blocks count in each activity, the same rule as the total"
          rows={exactRows}
          summary="Exact time by activity"
          totalSeconds={totalSeconds}
        />
      </section>
    </div>
  );
}
