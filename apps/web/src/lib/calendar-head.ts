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
  accessibleName: string;
};

export type CalendarHeadModel = {
  month: string;
  /**
   * Calendar v3 (owner, 24 Oct 2026): one short line under the week strip, "8h 41m framed"; empty
   * (hidden) on a day with nothing framed. The strip and the month already show the date.
   */
  framedLine: string;
  /** The same line for assistive tech, with the full date: "8 hours 41 minutes framed on Friday 23 October". */
  framedLabel: string;
  days: CalendarHeadDay[];
  weekTotal: string;
};

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const DAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const WEEK_OF = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** "8 hours 41 minutes", "1 hour", "5 minutes" for assistive tech. */
function spokenDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "",
    rest ? `${rest} minute${rest === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return parts.join(" ") || "0 minutes";
}

/**
 * The Calendar page head (Trello: Calendar page improvements, owner-approved): the month as the
 * page heading and a week strip whose days carry small bars of their biggest activities and the
 * week's total, then (Calendar v3) one short "8h 41m framed" line for the chosen day under the strip.
 * Matches the iPhone Calendar head.
 */
export function calendarHeadModel({
  dayLoggedSeconds,
  entries,
  hydrated = true,
  nowMs,
  selectedDay,
  todayKeyHint = null,
  weekDays,
  weekLoggedSeconds
}: {
  dayLoggedSeconds: number;
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
    framedLine: hydrated && Math.round(dayLoggedSeconds / 60) <= 0 ? "" : `${total(dayLoggedSeconds)} framed`,
    framedLabel: hydrated
      ? `${Math.round(dayLoggedSeconds / 60) > 0 ? spokenDuration(dayLoggedSeconds) : "Nothing"} framed on ${DAY_LONG.format(selectedDay)}`
      : `Framed on ${DAY_LONG.format(selectedDay)}`,
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
        accessibleName: hydrated
          ? `${DAY_LONG.format(day)}, ${seconds > 0 ? `${formatDuration(seconds)} framed` : "nothing framed"}`
          : DAY_LONG.format(day)
      };
    }),
    weekTotal: weekDays.some((day) => toTimelineDateKey(day) === todayKey)
      ? `${total(weekLoggedSeconds)} this week`
      : `${total(weekLoggedSeconds)} in the week of ${WEEK_OF.format(weekDays[0] ?? selectedDay)}`
  };
}
