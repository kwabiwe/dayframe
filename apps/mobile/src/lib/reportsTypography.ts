/** Dense Reports roles only; do not apply these caps to app-wide Text defaults. */
export const REPORT_TEXT_CAP = {
  heading: 1.5,
  control: 1.3,
  name: 1.35,
  numeric: 1.2,
  centre: 1.2,
  calendar: 1.25,
  small: 1.2,
} as const;

export function reportNumericColumns(
  width: number,
  fontScale: number,
  durations: string[],
) {
  // Stable within the actual hour-digit capacity; native samples replace these
  // provisional widths after layout. No speculative four-digit reservation.
  const hours = Math.max(2, ...durations.map((s) => s.split(":")[0].length));
  const digits = hours + 6;
  const scale = Math.min(Math.max(1, fontScale), REPORT_TEXT_CAP.numeric);
  const gap = 6;
  const usable = width - 10 - gap * 3 - 36; // dot, gaps, minimum name space
  const fontSize = Math.max(
    12,
    Math.min(14, usable / ((digits + 4) * 0.72 * scale)),
  );
  const cell = fontSize * scale * 0.72; // conservative SF tabular + Bold Text allowance
  return {
    fontSize,
    gap,
    percentWidth: Math.ceil(4 * cell),
    durationWidth: Math.ceil(digits * cell),
    durationSample: `${"8".repeat(hours)}:88:88`,
  };
}

/**
 * Columns for the Blocks activity rows, which show compact durations ("12h 30m", "45m"): the sample
 * is the widest compact form at the actual hour-digit capacity, measured natively after layout.
 */
export function reportCompactNumericColumns(
  width: number,
  fontScale: number,
  durations: string[],
) {
  const hours = Math.max(1, ...durations.map((s) => /^(\d+)h/.exec(s)?.[1].length ?? 1));
  const sample = `${"8".repeat(hours)}h 88m`;
  const scale = Math.min(Math.max(1, fontScale), REPORT_TEXT_CAP.numeric);
  const gap = 10;
  const usable = width - 14 - gap * 3 - 72; // swatch, gaps, minimum name space
  const fontSize = Math.max(12, Math.min(14, usable / ((sample.length + 4) * 0.72 * scale)));
  const cell = fontSize * scale * 0.72;
  return {
    fontSize,
    gap,
    percentWidth: Math.ceil(4 * cell),
    durationWidth: Math.ceil(sample.length * cell),
    durationSample: sample,
  };
}
