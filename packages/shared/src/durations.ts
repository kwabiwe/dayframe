/**
 * The one way Dayframe writes a duration (UIA-042 / UIA-207): "6h 25m", "6h", "35m", "<1m" for
 * a positive amount under a minute and "0m" for nothing — the format for iPhone and web totals, rows,
 * reports and Review. Only a live running clock ("0:04:09") and the duration dial's readout keep
 * their clock form. Whole minutes are rounded down, as the clocks do.
 */
export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
