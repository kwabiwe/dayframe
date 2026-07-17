export type ReportPeriod = "day" | "week" | "month" | "custom";

export type ReportRange = {
  period: ReportPeriod;
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  label: string;
  previousStartKey: string;
  nextStartKey: string;
};

export function resolveReportRange(input: {
  period?: string | null;
  start?: string | null;
  end?: string | null;
  now?: Date;
}): ReportRange {
  const period: ReportPeriod = ["day", "week", "month", "custom"].includes(input.period ?? "")
    ? (input.period as ReportPeriod)
    : "week";
  const anchor = parseDateKey(input.start) ?? startOfLocalDay(input.now ?? new Date());
  let start = anchor;
  let end: Date;

  if (period === "week") {
    start = startOfWeek(anchor);
    end = addDays(start, 7);
  } else if (period === "month") {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  } else if (period === "custom") {
    const inclusiveEnd = parseDateKey(input.end) ?? anchor;
    if (inclusiveEnd < start) start = inclusiveEnd;
    end = addDays(inclusiveEnd < anchor ? anchor : inclusiveEnd, 1);
  } else {
    end = addDays(start, 1);
  }

  const durationDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const previousStart = period === "month"
    ? new Date(start.getFullYear(), start.getMonth() - 1, 1)
    : addDays(start, -durationDays);
  const nextStart = period === "month"
    ? new Date(start.getFullYear(), start.getMonth() + 1, 1)
    : addDays(start, durationDays);

  return {
    period,
    start,
    end,
    startKey: toDateKey(start),
    endKey: toDateKey(addDays(end, -1)),
    label: formatRangeLabel(start, end),
    previousStartKey: toDateKey(previousStart),
    nextStartKey: toDateKey(nextStart)
  };
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function parseDateKey(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatRangeLabel(start: Date, exclusiveEnd: Date) {
  const end = addDays(exclusiveEnd, -1);
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
  if (toDateKey(start) === toDateKey(end)) return formatter.format(start);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${formatter.format(end)}`;
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}
