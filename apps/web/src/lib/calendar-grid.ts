export type CalendarGridDay = {
  date: string;
  day: number;
  inCurrentMonth: boolean;
};

export function buildCalendarGrid(year: number, month: number): CalendarGridDay[] {
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: formatLocalDate(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1
    };
  });
}

export function formatLocalDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function parseTimeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (!digits) return null;

  const padded = digits.length <= 2
    ? `${digits.padStart(2, "0")}00`
    : digits.padStart(4, "0");
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2, 4));
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function maskTimeInput(raw: string) {
  if (raw.includes(":")) {
    const [hours = "", minutes = ""] = raw.replace(/[^\d:]/g, "").split(":", 2);
    return `${hours.slice(0, 2)}:${minutes.slice(0, 2)}`;
  }
  // Keep compact digits intact while the user is typing. Inserting the colon
  // after the third digit changes the controlled input's caret position, so a
  // fourth digit can be inserted into the minutes and then truncated. The
  // owning editor normalises complete values (for example 1025 -> 10:25) and
  // blur handles valid three-digit shorthand (725 -> 07:25).
  return raw.replace(/\D/g, "").slice(0, 4);
}
