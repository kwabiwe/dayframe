import type { ReportSummaryRequest } from "@dayframe/shared";

export type ReportPreset = "today" | "week" | "month" | "year";
export type ReportWindow = { start: Date; end: Date };
export type ReportRangeChoice = ReportPreset | { start: string; end: string };
export type ReportBucket = ReportWindow & {
  key: string;
  label: string;
  fullLabel: string;
};
export type ReportRange = ReportWindow & {
  title: string;
  buckets: ReportBucket[];
  request: ReportSummaryRequest;
};

export function startOfLocalDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
export function addLocalDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
export function startOfLocalWeek(date: Date) {
  const result = startOfLocalDay(date);
  result.setDate(
    result.getDate() + (result.getDay() === 0 ? -6 : 1 - result.getDay()),
  );
  return result;
}
export function formatLocalDateKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function parseLocalDate(key: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(+match[1], +match[2] - 1, +match[3]);
  return formatLocalDateKey(date) === key ? date : null;
}
export function calendarDayCount(start: Date, endInclusive: Date) {
  return (
    Math.round(
      (Date.UTC(
        endInclusive.getFullYear(),
        endInclusive.getMonth(),
        endInclusive.getDate(),
      ) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        86_400_000,
    ) + 1
  );
}
export function validateCustomRange(
  first: string,
  second: string,
  now: number,
) {
  const start = first <= second ? first : second;
  const end = first <= second ? second : first;
  const left = parseLocalDate(start);
  const right = parseLocalDate(end);
  if (!left || !right)
    return { error: "Choose a valid start and end date." } as const;
  if (end > formatLocalDateKey(new Date(now)))
    return { error: "Future dates are not available." } as const;
  if (calendarDayCount(left, right) > 366)
    return { error: "Choose a range of 366 days or fewer." } as const;
  return { value: { start, end } } as const;
}

export function buildReportRange(
  choice: ReportRangeChoice,
  nowMs: number,
): ReportRange {
  const today = startOfLocalDay(new Date(nowMs));
  let start = today;
  let end = addLocalDays(start, 1);
  let title = "Today";
  if (choice === "week") {
    start = startOfLocalWeek(today);
    end = addLocalDays(start, 7);
    title = "This week";
  }
  if (choice === "month") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    title = start.toLocaleDateString(undefined, { month: "long" });
  }
  if (choice === "year") {
    start = new Date(today.getFullYear(), 0, 1);
    end = new Date(today.getFullYear() + 1, 0, 1);
    title = String(today.getFullYear());
  }
  if (typeof choice !== "string") {
    const validated = validateCustomRange(choice.start, choice.end, nowMs);
    if (!validated.value) throw new Error(validated.error);
    start = parseLocalDate(validated.value.start)!;
    end = addLocalDays(parseLocalDate(validated.value.end)!, 1);
    title = `${shortDate(start)} – ${shortDate(addLocalDays(end, -1))}`;
  }
  const days = calendarDayCount(start, addLocalDays(end, -1));
  const unit =
    choice === "year"
      ? "month"
      : days === 1
        ? "hour"
        : days <= 31
          ? "day"
          : days <= 180
            ? "week"
            : "month";
  const buckets: ReportBucket[] = [];
  let cursor = start;
  while (cursor < end) {
    const next =
      unit === "hour"
        ? new Date(cursor.getTime() + 3_600_000)
        : unit === "day"
          ? addLocalDays(cursor, 1)
          : unit === "week"
            ? addLocalDays(startOfLocalWeek(cursor), 7)
            : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const stop = new Date(Math.min(next.getTime(), end.getTime()));
    const label =
      unit === "hour"
        ? String(cursor.getHours()).padStart(2, "0")
        : unit === "month"
          ? cursor.toLocaleDateString(undefined, { month: "short" })
          : choice === "week"
            ? cursor.toLocaleDateString(undefined, { weekday: "short" })
            : String(cursor.getDate());
    const fullLabel =
      unit === "hour"
        ? `${shortDate(cursor)}, ${cursor.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`
        : unit === "week"
          ? `${shortDate(cursor)} – ${shortDate(addLocalDays(stop, -1))}`
          : unit === "month"
            ? cursor.toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })
            : shortDate(cursor);
    buckets.push({
      key: cursor.toISOString(),
      start: cursor,
      end: stop,
      label,
      fullLabel,
    });
    cursor = stop;
  }
  buckets.forEach((b, index) => {
    const show =
      unit === "hour"
        ? b.start.getHours() % 6 === 0
        : choice === "week"
          ? true
          : choice === "month"
            ? [1, 8, 15, 22, days].includes(b.start.getDate())
            : choice === "year"
              ? index % 3 === 0
              : index === 0 ||
                index === buckets.length - 1 ||
                index % Math.max(1, Math.ceil(buckets.length / 4)) === 0;
    if (!show) b.label = "";
  });
  return {
    start,
    end,
    title,
    buckets,
    request: {
      start: start.toISOString(),
      end: end.toISOString(),
      buckets: buckets.map((b) => ({
        key: b.key,
        start: b.start.toISOString(),
        end: b.end.toISOString(),
      })),
    },
  };
}
function shortDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
