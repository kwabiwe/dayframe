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
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits.slice(0, 1)}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
