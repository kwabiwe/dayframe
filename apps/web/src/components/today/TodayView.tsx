"use client";

import Link from "next/link";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveActivityIcon } from "@dayframe/shared";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { saveTimeEntryQuickEdit, TimeEntryQuickEditorModal } from "@/components/TimeEntryQuickEditor";
import { useIsHydrated } from "@/components/useHydrationSafeNow";
import { useTimelineDeleteUndo } from "@/components/useTimelineDeleteUndo";
import { blockStyle } from "@/lib/block-style";
import { prefersReducedMotion, springTransition } from "@/lib/blocks-motion";
import { dedupeDashboardEntries } from "@/lib/dashboard-intelligence";
import { timeEntryTitle } from "@/lib/display";
import { formatDuration as formatFullDuration, formatTime } from "@/lib/format";
import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";
import type { BootstrapData, CategoryRow, TimeEntryRow } from "@/lib/queries";
import {
  activityTotals,
  blockRowHeight,
  buildGoalFrame,
  formatGoalHours,
  hourPercent,
  isUnsavedEntryId,
  localDayEnd,
  localDayStart,
  pendingReviewSeconds,
  pendingReviewSpans,
  previousDays,
  ribbonHitAt,
  RIBBON_MIN_BLOCK_PX,
  staleEditError,
  todayBlocks,
  withMinimumSpan,
  type GoalCellSlice
} from "@/lib/today-view";

const ROW_EXIT_MS = 180;

/**
 * Today (Blocks parity step 12a) replaces the Dashboard at "/": the hero (covered total, goal
 * cells and the day ribbon), "Where today went", the Review card, "This week" and Today's
 * blocks with Start again / Edit / Delete (Backspace) and Delete Undo on the Blocks toast.
 *
 * Day boundaries and clock times are the browser's, so the cards render after hydration; the
 * server and the hydration pass draw the same empty frame and never disagree about time zones.
 */
export function TodayView({ initialData }: { initialData: BootstrapData; renderedAt: string }) {
  const data = useRuntimePageData(initialData);
  const hydrated = useIsHydrated();
  const {
    clearTimerError,
    createCategory,
    isTimerBusy,
    refresh,
    shellData,
    startEntryAgain,
    updateActiveEntryFromCalendar
  } = useAppShellRuntime();

  const allEntries = useMemo(
    () => dedupeDashboardEntries(
      data.historyEntries,
      data.entries,
      data.dayEntries,
      data.weekEntries,
      [data.activeEntry]
    ) as TimeEntryRow[],
    [data.activeEntry, data.dayEntries, data.entries, data.historyEntries, data.weekEntries]
  );
  const hasLive = allEntries.some((entry) => !entry.stoppedAt);
  // The editor keeps the callbacks it opened with, so its save reads the newest data from here.
  const latestRef = useRef({ allEntries, activeId: data.activeEntry?.id ?? null });
  useEffect(() => {
    latestRef.current = { allEntries, activeId: data.activeEntry?.id ?? null };
  }, [allEntries, data.activeEntry]);
  const nowMs = useTodayClock(hydrated, hasLive);

  const entryIds = useMemo(() => new Set(allEntries.map((entry) => entry.id)), [allEntries]);
  const refreshData = useCallback(async () => {
    await refresh();
  }, [refresh]);
  const { error: deleteError, hiddenEntryIds, pendingNotice, requestDelete, undoPendingDelete } = useTimelineDeleteUndo({
    entryIds,
    onSynced: refreshData
  });
  const entries = useMemo(
    () => allEntries.filter((entry) => !hiddenEntryIds.has(entry.id)),
    [allEntries, hiddenEntryIds]
  );

  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [toastEntry, setToastEntry] = useState<TimeEntryRow | null>(null);
  const leaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const timers = leaveTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const categoriesById = useMemo(
    () => new Map(data.categories.map((category) => [category.id, category])),
    [data.categories]
  );

  const deleteEntry = useCallback((entry: TimeEntryRow, focusNextId: string | null) => {
    if (!entry.stoppedAt || leaveTimersRef.current.has(entry.id)) return;
    setActionError(null);
    const commit = () => {
      leaveTimersRef.current.delete(entry.id);
      setLeavingIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
      setToastEntry(entry);
      requestDelete({ entries: [entry], label: `“${timeEntryTitle(entry)}” deleted` });
      if (focusNextId) window.requestAnimationFrame(() => rowRefs.current.get(focusNextId)?.focus());
    };
    if (prefersReducedMotion()) {
      commit();
      return;
    }
    setLeavingIds((current) => new Set(current).add(entry.id));
    leaveTimersRef.current.set(entry.id, setTimeout(commit, ROW_EXIT_MS));
  }, [requestDelete]);

  const startAgain = useCallback(async (entry: TimeEntryRow) => {
    if (startingId || isTimerBusy) {
      return { ok: false, error: "A timer update is already in progress." } as const;
    }
    setStartingId(entry.id);
    setActionError(null);
    try {
      const outcome = await startEntryAgain(entry);
      if (!outcome.ok) clearTimerError();
      return outcome;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unable to start this block." } as const;
    } finally {
      setStartingId(null);
    }
  }, [clearTimerError, isTimerBusy, startEntryAgain, startingId]);

  // ⌘Z / Ctrl+Z takes back the pending delete while its toast is up.
  useEffect(() => {
    if (!pendingNotice || pendingNotice.isExiting) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (isTypingTarget(event.target) || hasOpenDialog()) return;
      event.preventDefault();
      undoPendingDelete();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingNotice, undoPendingDelete]);

  if (!hydrated || nowMs === null) {
    return <TodayFrame />;
  }

  const dayStart = localDayStart(nowMs);
  const dayEnd = localDayEnd(dayStart);
  const goal = buildGoalFrame({ entries, goalMinutes: data.user.dailyGoalMinutes, nowMs });
  const blocks = todayBlocks(entries, dayStart, nowMs);
  const totals = activityTotals(entries, dayStart, dayEnd, nowMs);
  const pending = pendingReviewSpans(data.reviewItems, dayStart, dayEnd, nowMs);
  const week = previousDays(entries, nowMs);
  const reviewCount = data.stats.reviewCount;

  return (
    <div className="df-today">
      <h1 className="sr-only">Today</h1>
      <section className="df-card df-today-hero" aria-labelledby="df-today-total">
        <div className="df-today-hero-top">
          <div>
            <p className="df-eyebrow">{formatHeroDate(nowMs)}</p>
            <p className="df-today-total" id="df-today-total">
              <span className="sr-only">Framed today: </span>
              {formatDuration(goal.totalSeconds)}
            </p>
            <p className="df-today-sub">
              framed today · {goal.percent}% of your {formatGoalHours(goal.goalMinutes)} goal
            </p>
          </div>
          <GoalCells cells={goal.cells} />
        </div>
        <TodayRibbon
          blocks={blocks}
          dayEnd={dayEnd}
          dayStart={dayStart}
          nowMs={nowMs}
          onSelect={(entry) => {
            if (!isUnsavedEntryId(entry.id)) setEditingEntry(entry);
          }}
          pending={pending}
        />
      </section>

      <section className="df-card df-today-went" aria-labelledby="df-today-went-title">
        <div className="df-card-head">
          <h2 id="df-today-went-title">Where today went</h2>
          <span className="df-faint">{totals.length} {totals.length === 1 ? "activity" : "activities"}</span>
        </div>
        {totals.length ? (
          <WhereTodayWent totals={totals.slice(0, 5)} />
        ) : (
          <p className="df-muted">Nothing tracked yet.</p>
        )}
      </section>

      <section className="df-card df-today-review" aria-labelledby="df-today-review-title">
        <div className="df-card-head">
          <h2 id="df-today-review-title">Review</h2>
          <span className="df-faint">From Location and Apple Health</span>
        </div>
        {reviewCount > 0 ? (
          <div className="df-review-teaser">
            <div className="df-review-stack" aria-hidden="true">
              {data.reviewItems.slice(0, 3).map((item) => (
                <span
                  className={item.suggestedCategoryId ? "df-block" : "df-review-stack-none"}
                  key={item.id}
                  style={item.suggestedCategoryId ? blockStyle(item.categoryColor, item.categoryName ?? "") : undefined}
                />
              ))}
            </div>
            <div>
              <b>{reviewCount} {reviewCount === 1 ? "moment" : "moments"} waiting</b>
              <p>{reviewTeaserDetail(pendingReviewSeconds(data.reviewItems))}</p>
              <Link className="df-pill-action" href="/review">Review now</Link>
            </div>
          </div>
        ) : (
          <p className="df-muted">All caught up. New suggestions from Location and Apple Health appear here.</p>
        )}
      </section>

      <section className="df-card df-today-week" aria-labelledby="df-today-week-title">
        <div className="df-card-head">
          <h2 id="df-today-week-title">This week</h2>
          <span className="df-faint">Open a day</span>
        </div>
        <div className="df-mini-week">
          {week.map((day) => (
            <Link
              aria-label={`${formatWeekdayLong(day.dayStartMs)}, ${formatDuration(day.totalSeconds)} framed. Open in Calendar.`}
              className="df-mw-row"
              href={`/timeline?view=calendar&scope=day&date=${day.dateKey}`}
              key={day.dateKey}
            >
              <b>{formatWeekdayShort(day.dayStartMs)}</b>
              <span className="df-mw-track" aria-hidden="true">
                {day.segments.map((segment) => (
                  <span
                    className={segment.color ? "df-block" : "df-mw-none"}
                    key={segment.key}
                    style={{
                      ...(segment.color ? blockStyle(segment.color, segment.name) : {}),
                      left: `${segment.left}%`,
                      width: `max(2px, ${segment.width}%)`
                    }}
                  />
                ))}
              </span>
              <span className="df-tnum">{formatShortDuration(day.totalSeconds)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="df-card df-today-blocks" aria-labelledby="df-today-blocks-title">
        <div className="df-card-head">
          <h2 id="df-today-blocks-title">Today&apos;s blocks</h2>
          <span className="df-faint">
            {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
            <span className="df-today-blocks-hint"> · hover a row for actions</span>
          </span>
        </div>
        {actionError || deleteError ? (
          <p className="swiss-inline-error" role="alert">{actionError ?? deleteError}</p>
        ) : null}
        {blocks.length ? (
          <ul className="df-rows">
            {blocks.map(({ entry }, index) => {
              const category = entry.categoryId ? categoriesById.get(entry.categoryId) ?? null : null;
              const nextId = blocks[index + 1]?.entry.id ?? blocks[index - 1]?.entry.id ?? null;
              return (
                <TodayBlockRow
                  category={category}
                  durationMs={(entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs) - Date.parse(entry.startedAt)}
                  entry={entry}
                  isLeaving={leavingIds.has(entry.id)}
                  isStarting={startingId === entry.id}
                  key={entry.id}
                  onDelete={() => deleteEntry(entry, nextId)}
                  onEdit={() => {
                    // A Start that has not reached the server yet has a temporary ID; it can be
                    // edited once it is saved (from the command bar meanwhile).
                    if (!isUnsavedEntryId(entry.id)) setEditingEntry(entry);
                  }}
                  onStartAgain={async () => {
                    const outcome = await startAgain(entry);
                    if (!outcome.ok) setActionError(outcome.error);
                  }}
                  registerMain={(element) => {
                    if (element) rowRefs.current.set(entry.id, element);
                    else rowRefs.current.delete(entry.id);
                  }}
                  startDisabled={Boolean(startingId) || isTimerBusy}
                />
              );
            })}
          </ul>
        ) : (
          <p className="df-muted">No blocks yet. Start one above or press Space.</p>
        )}
      </section>

      {pendingNotice ? (
        <BlocksToast
          actionLabel="Undo"
          exiting={pendingNotice.isExiting}
          key={pendingNotice.token}
          message={pendingNotice.label}
          onAction={undoPendingDelete}
          swatchStyle={toastEntry?.categoryId ? blockStyle(toastEntry.categoryColor, toastEntry.categoryName ?? "") : undefined}
        />
      ) : null}

      {editingEntry ? (
        <TimeEntryQuickEditorModal
          capturedNow={new Date(nowMs)}
          categories={data.categories}
          entry={editingEntry}
          isTimerBusy={isTimerBusy}
          onClose={() => setEditingEntry(null)}
          onCreateCategory={createCategory}
          onDelete={editingEntry.stoppedAt ? () => {
            const entry = editingEntry;
            setEditingEntry(null);
            deleteEntry(entry, null);
          } : undefined}
          onSave={async (plan) => {
            // The running-block path patches whatever is running now, so only use it while the
            // block this editor opened is still the one running (it may have stopped or been
            // switched on another device since).
            const stale = staleEditError(editingEntry, latestRef.current.allEntries, latestRef.current.activeId);
            if (stale) return { ok: false, error: stale };
            const outcome = editingEntry.stoppedAt
              ? await saveTimeEntryQuickEdit(editingEntry.id, plan)
              : await updateActiveEntryFromCalendar({ plan });
            if (outcome.ok) await refreshData();
            return outcome;
          }}
          onStartAgain={editingEntry.stoppedAt ? () => startAgain(editingEntry) : undefined}
          peerEntries={entries}
          taskSuggestions={shellData?.taskSuggestions ?? []}
          tags={data.tags}
        />
      ) : null}
    </div>
  );
}

/** The browser clock, ticking each second while a block records and each 20 s otherwise. */
function useTodayClock(hydrated: boolean, hasLive: boolean) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const interval = window.setInterval(tick, hasLive ? 1_000 : 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasLive, hydrated]);
  return nowMs;
}

function TodayFrame() {
  return (
    <div className="df-today" aria-busy="true">
      <h1 className="sr-only">Today</h1>
      <section className="df-card df-today-hero df-today-placeholder" />
      <section className="df-card df-today-went df-today-placeholder" />
      <section className="df-card df-today-review df-today-placeholder" />
      <section className="df-card df-today-week df-today-placeholder" />
      <section className="df-card df-today-blocks df-today-placeholder" />
    </div>
  );
}

function GoalCells({ cells }: { cells: GoalCellSlice[][] }) {
  return (
    <div className="df-goal-cells" style={{ "--cells": cells.length } as CSSProperties} aria-hidden="true">
      {cells.map((slices, index) => (
        <span className="df-goal-cell" key={index}>
          {slices.map((slice) => (
            <span
              className={`${slice.color ? "df-block" : "df-goal-none"}${slice.live ? " is-live" : ""}`}
              key={slice.key}
              style={{ ...(slice.color ? blockStyle(slice.color, slice.name) : {}), width: `${slice.fraction * 100}%` }}
            />
          ))}
        </span>
      ))}
    </div>
  );
}

type RibbonBlock = { entry: TimeEntryRow; clip: { fromMs: number; toMs: number } };

function TodayRibbon({
  blocks,
  dayEnd,
  dayStart,
  nowMs,
  onSelect,
  pending
}: {
  blocks: RibbonBlock[];
  dayEnd: number;
  dayStart: number;
  nowMs: number;
  onSelect: (entry: TimeEntryRow) => void;
  pending: ReturnType<typeof pendingReviewSpans>;
}) {
  const span = dayEnd - dayStart;
  const pct = (ms: number) => ((ms - dayStart) / span) * 100;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{ x: number; atMs: number; width: number } | null>(null);

  // Hit-test what is drawn: a block is at least 3 px wide however short its time.
  const hitAt = (atMs: number, width: number) => {
    const minimumMs = (RIBBON_MIN_BLOCK_PX / width) * span;
    return ribbonHitAt(
      atMs,
      withMinimumSpan(blocks.map(({ entry, clip }) => ({ id: entry.id, startedMs: Date.parse(entry.startedAt), ...clip })), minimumMs),
      withMinimumSpan(pending, minimumMs)
    );
  };
  const hitFor = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const atMs = dayStart + (x / rect.width) * span;
    return { x, atMs, width: rect.width, hit: hitAt(atMs, rect.width) };
  };
  const hover = tip ? hitAt(tip.atMs, tip.width) : null;
  const hotId = hover && hover.kind !== "gap" ? hover.id : null;
  const tipEntry = hover?.kind === "entry" ? blocks.find((block) => block.entry.id === hover.id) ?? null : null;
  const tipPending = hover?.kind === "pending" ? pending.find((item) => item.id === hover.id) ?? null : null;

  return (
    <div className="df-ribbon">
      <div
        aria-hidden="true"
        className="df-ribbon-track"
        onPointerLeave={() => setTip(null)}
        onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.pointerType === "touch") return;
          const result = hitFor(event.clientX);
          if (result) setTip({ x: result.x, atMs: result.atMs, width: result.width });
        }}
        onClick={(event) => {
          const result = hitFor(event.clientX);
          if (result?.hit.kind !== "entry") return;
          const id = result.hit.id;
          const block = blocks.find((item) => item.entry.id === id);
          if (block) onSelect(block.entry);
        }}
        ref={trackRef}
      >
        {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <i className={`df-ribbon-tick${hour % 6 ? "" : " is-major"}`} key={hour} style={{ left: `${hourPercent(dayStart, dayEnd, hour)}%` }} />
        ))}
        {pending.map((item) => (
          <span
            className={`df-ribbon-block is-pending${item.color ? " df-block" : ""}${hotId === item.id ? " is-hot" : ""}`}
            key={`pending:${item.id}`}
            style={{
              ...(item.color ? blockStyle(item.color, item.name) : {}),
              left: `${pct(item.fromMs)}%`,
              width: `max(3px, ${pct(item.toMs) - pct(item.fromMs)}%)`
            }}
          />
        ))}
        {[...blocks].reverse().map(({ entry, clip }) => (
          <span
            className={`df-ribbon-block${entry.categoryId ? " df-block" : " is-none"}${entry.stoppedAt ? "" : " is-live"}${hotId === entry.id ? " is-hot" : ""}`}
            key={entry.id}
            style={{
              ...(entry.categoryId ? blockStyle(entry.categoryColor, entry.categoryName ?? "") : {}),
              left: `${pct(clip.fromMs)}%`,
              width: `max(3px, ${pct(clip.toMs) - pct(clip.fromMs)}%)`
            }}
          />
        ))}
        {nowMs >= dayStart && nowMs < dayEnd ? <span className="df-ribbon-now" style={{ left: `${pct(nowMs)}%` }} /> : null}
      </div>
      <div className="df-ribbon-hours" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((hour) => (
          <span key={hour} style={{ left: `${hourPercent(dayStart, dayEnd, hour)}%` }}>{String(hour).padStart(2, "0")}:00</span>
        ))}
      </div>
      {tip ? (
        <RibbonTip
          atMs={tip.atMs}
          entry={tipEntry}
          nowMs={nowMs}
          pending={tipPending}
          trackWidth={tip.width}
          x={tip.x}
        />
      ) : null}
    </div>
  );
}

function RibbonTip({
  atMs,
  entry,
  nowMs,
  pending,
  trackWidth,
  x
}: {
  atMs: number;
  entry: RibbonBlock | null;
  nowMs: number;
  pending: ReturnType<typeof pendingReviewSpans>[number] | null;
  trackWidth: number;
  x: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [left, setLeft] = useState(x);
  useEffect(() => {
    const width = ref.current?.offsetWidth ?? 0;
    setLeft(Math.min(Math.max(x - width / 2, 0), Math.max(0, trackWidth - width)));
  }, [trackWidth, x, entry?.entry.id, pending?.id]);

  let title: string;
  let detail: string;
  if (entry) {
    title = timeEntryTitle(entry.entry);
    const end = entry.entry.stoppedAt ? formatTime(entry.entry.stoppedAt) : "now";
    const stopped = entry.entry.stoppedAt ? Date.parse(entry.entry.stoppedAt) : nowMs;
    detail = `${formatTime(entry.entry.startedAt)}–${end} · ${formatDuration((stopped - Date.parse(entry.entry.startedAt)) / 1000)}`;
  } else if (pending) {
    title = pending.title;
    detail = `${formatTime(new Date(pending.fromMs))}–${formatTime(new Date(pending.toMs))} · needs review`;
  } else {
    title = formatTime(new Date(atMs));
    detail = "Untracked";
  }
  return (
    <div aria-hidden="true" className="df-ribbon-tip" ref={ref} style={{ left }}>
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

function WhereTodayWent({ totals }: { totals: ReturnType<typeof activityTotals> }) {
  const max = Math.max(1, ...totals.map((total) => total.seconds));
  const land = springTransition("land");
  return (
    <ul className="df-bars" style={{ "--df-land": land.easing, "--df-land-ms": `${land.durationMs}ms` } as CSSProperties}>
      {totals.map((total, index) => (
        <li
          className="df-bar-row"
          key={total.key}
          style={{ ...(total.color ? blockStyle(total.color, total.name) : {}), "--df-bar-delay": `${index * 40}ms` } as CSSProperties}
        >
          <b>{total.name}</b>
          <span className="df-bar-track" aria-hidden="true">
            <span
              className={`df-bar-fill${total.categoryId ? "" : " is-none"}`}
              style={{ width: `${(total.seconds / max) * 100}%` }}
            />
          </span>
          <span className="df-tnum">{formatDuration(total.seconds)}</span>
        </li>
      ))}
    </ul>
  );
}

function TodayBlockRow({
  category,
  durationMs,
  entry,
  isLeaving,
  isStarting,
  onDelete,
  onEdit,
  onStartAgain,
  registerMain,
  startDisabled
}: {
  category: CategoryRow | null;
  durationMs: number;
  entry: TimeEntryRow;
  isLeaving: boolean;
  isStarting: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onStartAgain: () => void;
  registerMain: (element: HTMLButtonElement | null) => void;
  startDisabled: boolean;
}) {
  const title = timeEntryTitle(entry);
  const live = !entry.stoppedAt;
  const activity = entry.categoryId ? entry.categoryName?.trim() || "No activity" : "No activity";
  const tags = entry.tagNames.map((tag) => `#${tag}`).join(" ");
  const start = formatTime(entry.startedAt);
  const end = entry.stoppedAt ? formatTime(entry.stoppedAt) : "now";
  // A row is the whole block: its times and duration include any part before midnight.
  const elapsedSeconds = durationMs / 1000;
  const glyph = resolveActivityIcon({ icon: category?.icon ?? null, name: entry.categoryName }).glyph;

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if ((event.key === "Backspace" || event.key === "Delete") && !live) {
      event.preventDefault();
      onDelete();
    }
  }

  return (
    <li className={`df-erow${live ? " is-live" : ""}${isLeaving ? " is-leaving" : ""}`}>
      <button
        aria-label={`${title}, ${activity}, ${start} to ${live ? "now" : end}, ${spokenDuration(elapsedSeconds)}. Edit${live ? "" : "; Delete or Backspace deletes"}.`}
        className="df-erow-main"
        onClick={onEdit}
        onKeyDown={onKeyDown}
        ref={registerMain}
        type="button"
      >
        <span
          className={`df-erow-block${entry.categoryId ? " df-block" : ""}`}
          style={{
            ...(entry.categoryId ? blockStyle(entry.categoryColor, entry.categoryName ?? "") : {}),
            height: blockRowHeight(durationMs)
          }}
        >
          <DayframeIcon glyph={entry.categoryId ? glyph : "tag"} size={16} />
        </span>
        <span className="df-erow-text">
          <b>{title}</b>
          <span>{activity}{tags ? ` · ${tags}` : ""}</span>
        </span>
        <span className="df-erow-when">{start}–{end}</span>
        <span className="df-erow-dur">{formatDuration(elapsedSeconds)}</span>
      </button>
      <span className="df-erow-acts">
        {!live ? (
          <button
            aria-label={`Start ${title} again`}
            className="df-icon-action"
            disabled={startDisabled || isLeaving}
            onClick={onStartAgain}
            type="button"
          >
            <DayframeIcon glyph="rotate-ccw" size={16} />
          </button>
        ) : null}
        <button
          aria-label={`Edit ${title}`}
          className="df-icon-action"
          disabled={isLeaving || isUnsavedEntryId(entry.id)}
          onClick={onEdit}
          type="button"
        >
          <DayframeIcon glyph="pencil" size={16} />
        </button>
        {!live ? (
          <button
            aria-label={`Delete ${title}`}
            className="df-icon-action"
            disabled={isLeaving || isStarting}
            onClick={onDelete}
            type="button"
          >
            <DayframeIcon glyph="trash-2" size={16} />
          </button>
        ) : null}
      </span>
    </li>
  );
}

function reviewTeaserDetail(seconds: number) {
  return seconds > 0
    ? `${formatDuration(seconds)} Dayframe noticed but didn't log.`
    : "Dayframe noticed something it didn't log.";
}

function formatHeroDate(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(ms));
}

function formatWeekdayShort(ms: number) {
  const date = new Date(ms);
  return `${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date)} ${date.getDate()}`;
}

function formatWeekdayLong(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(ms));
}

function formatShortDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Durations as Dayframe writes them, with "<1m" for a block shorter than a minute. */
function formatDuration(seconds: number) {
  return seconds > 0 && seconds < 60 ? "<1m" : formatFullDuration(seconds);
}

function spokenDuration(seconds: number) {
  return seconds > 0 && seconds < 60 ? "under a minute" : formatFullDuration(seconds);
}
