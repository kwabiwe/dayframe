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
  // Reserve at least four hour digits and grow in two-digit groups, not each tick.
  const hours = Math.max(4, ...durations.map((s) => s.split(":")[0].length));
  const digits = Math.ceil(hours / 2) * 2 + 6;
  const scale = Math.min(Math.max(1, fontScale), REPORT_TEXT_CAP.numeric);
  const gap = width < 300 ? 6 : 10;
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
  };
}
