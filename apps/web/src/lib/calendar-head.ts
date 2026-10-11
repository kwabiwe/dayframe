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
  framedLine: string;
  days: CalendarHeadDay[];
  weekTotal: string;
};

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const DAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

/**
 * The Calendar page head (Trello: Calendar page improvements, owner-approved): the month as the
 * page heading, "9h 47m framed on Sunday" for the chosen day, and a week strip whose days carry
 * small bars of their biggest activities and the week's total. Matches the iPhone Calendar head.
 */
export function calendarHeadModel({
  dayLoggedSeconds,
  entries,
  nowMs,
  selectedDay,
  weekDays,
  weekLoggedSeconds
}: {
  dayLoggedSeconds: number;
  entries: readonly TodayEntry[];
  nowMs: number;
  selectedDay: Date;
  weekDays: readonly Date[];
  weekLoggedSeconds: number;
}): CalendarHeadModel {
  const selectedKey = toTimelineDateKey(selectedDay);
  const todayKey = toTimelineDateKey(new Date(nowMs));
  return {
    month: MONTH.format(selectedDay),
    framedLine: `${formatDuration(dayLoggedSeconds)} framed on ${WEEKDAY_LONG.format(selectedDay)}`,
    days: weekDays.map((day, index) => {
      const key = toTimelineDateKey(day);
      const end = index + 1 < weekDays.length ? weekDays[index + 1] : new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      const totals = activityTotals(entries, day.getTime(), end.getTime(), nowMs);
      const seconds = totals.reduce((sum, total) => sum + total.seconds, 0);
      return {
        key,
        initial: WEEKDAY_LONG.format(day).slice(0, 1),
        dateNumber: day.getDate(),
        selected: key === selectedKey,
        isToday: key === todayKey,
        bars: totals.slice(0, 3).map((total) => ({ key: total.key, color: total.color, name: total.name })),
        accessibleName: `${DAY_LONG.format(day)}, ${seconds > 0 ? `${formatDuration(seconds)} framed` : "nothing framed"}`
      };
    }),
    weekTotal: `${formatDuration(weekLoggedSeconds)} this week`
  };
}
