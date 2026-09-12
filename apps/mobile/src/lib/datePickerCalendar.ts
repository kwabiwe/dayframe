import {
  addLocalDays,
  formatLocalDateKey,
  parseLocalDate,
  startOfLocalWeek,
} from "./reportsRanges";
export function datePickerCells(
  monthKey: string,
  start: string | null,
  end: string | null,
  today: string,
  maxDate?: string | null,
) {
  const month = parseLocalDate(`${monthKey.slice(0, 7)}-01`)!;
  const first = startOfLocalWeek(month);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addLocalDays(first, index),
      key = formatLocalDateKey(date);
    const selected = Boolean(start && end && key >= start && key <= end);
    const endpoint = selected && (key === start || key === end);
    return {
      date,
      key,
      selected,
      endpoint,
      today: key === today,
      disabled: Boolean(maxDate && key > maxDate),
      inMonth: date.getMonth() === month.getMonth(),
      band:
        selected && start !== end
          ? key === start
            ? "start"
            : key === end
              ? "end"
              : "middle"
          : "none",
      meaning: selected
        ? start === end
          ? "Selected date"
          : key === start
            ? "Range start"
            : key === end
              ? "Range end"
              : "In selected range"
        : "",
      column: index % 7,
    };
  });
}
