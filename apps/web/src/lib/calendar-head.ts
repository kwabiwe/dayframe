import { formatDuration } from "@/lib/format";
import { activityTotals, type TodayEntry } from "@/lib/today-view";
import { toTimelineDateKey } from "@/lib/timeline-view";

/** One day in the Calendar head's week strip. */
export type CalendarHeadDay = {
  key: string;
  initial: string;
  dateNumber: number;
  selected: boolean;
  isToday: boolean;
  /** Up to three activities with the most time that day, largest first. */
  bars: Array<{ key: string; color: string | null; name: string }>;
  /** #256: the day's total under its date ("3h 12m"); "–" for none, and before hydration. */
  total: string;
  accessibleName: string;
  /** The day row's hover tip (UI review round 2): "Mon 26 · 7h 5m", or "Mon 26" with nothing framed or before hydration. */
  tip: string;
};

export type CalendarHeadModel = {
  month: string;
  days: CalendarHeadDay[];
  /** The week's total alone ("45h 18m"); `weekTotalLabel` names it ("Week total 45h 18m, this week"). */
  weekTotal: string;
  weekTotalLabel: string;
};

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const DAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const WEEK_OF = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const WEEKDAY_SHORT = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/**
 * The Calendar week strip (Trello: Calendar page improvements, owner-approved): each day carries its
 * total under its date (#256) and small bars of its biggest activities, then the week's total. The
 * month is the page's (visually hidden) heading; the period label beside the strip shows the date.
 * Since #259 (owner, 27 Oct 2026) the strip sits in the one compact toolbar row and the chosen day's
 * "framed" line is gone (its total is under its date).
 */
export function calendarHeadModel({
  entries,
  hydrated = true,
  nowMs,
  selectedDay,
  todayKeyHint = null,
  weekDays,
  weekLoggedSeconds
}: {
  entries: readonly TodayEntry[];
  /**
   * Whether the browser has hydrated. "Today" and which day an entry falls on depend on the
   * browser's time zone, which the server render can't know, so the per-day bars and every total
   * wait for hydration (both renders agree); until then the totals read "–".
   */
  hydrated?: boolean;
  nowMs: number;
  selectedDay: Date;
  /**
   * Before hydration, today's date key as the server worked it out in the viewer's zone (the
   * `dayframe_tz` cookie), so the today mark and "this week" need not change once the browser
   * takes over. Null marks no day as today.
   */
  todayKeyHint?: string | null;
  weekDays: readonly Date[];
  weekLoggedSeconds: number;
}): CalendarHeadModel {
  const selectedKey = toTimelineDateKey(selectedDay);
  const todayKey = hydrated ? toTimelineDateKey(new Date(nowMs)) : todayKeyHint;
  // A total depends on where the browser's days start, so the server render shows a dash.
  const total = (seconds: number) => (hydrated ? formatDuration(seconds) : "–");
  return {
    month: MONTH.format(selectedDay),
    days: weekDays.map((day, index) => {
      const key = toTimelineDateKey(day);
      const end = index + 1 < weekDays.length ? weekDays[index + 1] : new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      // Which day an entry falls on depends on the browser's time zone too, so the bars and the
      // per-day totals also wait for hydration.
      const totals = hydrated ? activityTotals(entries, day.getTime(), end.getTime(), nowMs) : [];
      const seconds = totals.reduce((sum, total) => sum + total.seconds, 0);
      return {
        key,
        initial: WEEKDAY_LONG.format(day).slice(0, 1),
        dateNumber: day.getDate(),
        selected: key === selectedKey,
        isToday: key === todayKey,
        bars: totals.slice(0, 3).map((total) => ({ key: total.key, color: total.color, name: total.name })),
        total: hydrated && seconds > 0 ? formatDuration(seconds) : "–",
        accessibleName: hydrated
          ? `${DAY_LONG.format(day)}, ${seconds > 0 ? `${formatDuration(seconds)} framed` : "nothing framed"}`
          : DAY_LONG.format(day),
        tip: `${WEEKDAY_SHORT.format(day)} ${day.getDate()}${hydrated && seconds > 0 ? ` · ${formatDuration(seconds)}` : ""}`
      };
    }),
    // UI review W9 (owner 29 Oct 2026): the toolbar shows only the total; which week it is lives in its name.
    weekTotal: total(weekLoggedSeconds),
    weekTotalLabel: weekDays.some((day) => toTimelineDateKey(day) === todayKey)
      ? `Week total ${total(weekLoggedSeconds)}, this week`
      : `Week total ${total(weekLoggedSeconds)}, the week of ${WEEK_OF.format(weekDays[0] ?? selectedDay)}`
  };
}
