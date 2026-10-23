/**
 * Fixed-point formatting that rounds an exact binary half to even, as Python's format() does, so the
 * report reads the same as the design's prototype on the same run. toFixed already rounds the exact
 * binary value correctly except at a true tie, where it rounds up; a tie is found on the value's
 * exact decimal expansion (every double used here has one well within 100 places), never on a
 * product that floating point could round onto a half.
 */
export function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return String(value);
  const exact = Math.abs(value).toFixed(100);
  const point = exact.indexOf(".");
  const tail = exact.slice(point + 1 + digits);
  if (tail[0] === "5" && /^0*$/.test(tail.slice(1))) {
    const kept = exact.slice(0, point + 1 + digits).replace(/\.$/, "");
    const lastDigit = Number(kept[kept.length - 1]);
    if (lastDigit % 2 === 0) return `${value < 0 && Number(kept) !== 0 ? "-" : ""}${kept}`;
  }
  return value.toFixed(digits);
}
