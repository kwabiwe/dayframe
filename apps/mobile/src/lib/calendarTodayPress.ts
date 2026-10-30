/**
 * The Calendar header's Today pill. Swift only says it was pressed; React knows the day, the layout and the time.
 * From another day it goes to today; on today it scrolls to now in the layout showing.
 */
export type CalendarTodayPressAction = "go-to-today" | "scroll-grid-to-now" | "scroll-list-to-now";

export function calendarTodayPressAction({ layout, selectedDayKey, todayKey }: {
  layout: "grid" | "list";
  selectedDayKey: string;
  todayKey: string;
}): CalendarTodayPressAction {
  if (selectedDayKey !== todayKey) return "go-to-today";
  return layout === "list" ? "scroll-list-to-now" : "scroll-grid-to-now";
}

/**
 * The List's row for now: the last row to have started, in a list that runs oldest first. Before the day's first
 * row, that first row. An empty day has none.
 */
export function nowRowKey(rows: ReadonlyArray<{ key: string; atMs: number }>, nowMs: number) {
  let found = rows[0]?.key ?? null;
  for (const row of rows) if (row.atMs <= nowMs) found = row.key;
  return found;
}
