export function reportBucketAtX(x: number, width: number, count: number) {
  if (!Number.isFinite(x) || width <= 0 || count <= 0 || x < 0 || x > width)
    return null;
  return Math.min(count - 1, Math.floor(x / (width / count)));
}
export function reportTooltipLeft(
  index: number,
  count: number,
  width: number,
  calloutWidth: number,
) {
  return Math.max(
    0,
    Math.min(
      width - calloutWidth,
      ((index + 0.5) * width) / Math.max(1, count) - calloutWidth / 2,
    ),
  );
}
export function reportLabelIndices(count: number, width: number) {
  if (count <= 1) return new Set(count === 1 ? [0] : []);
  const capacity = Math.max(2, Math.min(count, Math.floor(width / 42)));
  if (count <= 7 && count <= capacity)
    return new Set(Array.from({ length: count }, (_, i) => i));
  return new Set(
    Array.from({ length: capacity }, (_, i) =>
      Math.round((i * (count - 1)) / (capacity - 1)),
    ),
  );
}
export function reportBucketLabel(
  bucket: { start: Date; end: Date },
  count: number,
) {
  const duration = +bucket.end - +bucket.start;
  if (duration <= 3_600_000)
    return String(bucket.start.getHours()).padStart(2, "0");
  if (duration > 27 * 86_400_000)
    return bucket.start.toLocaleDateString(undefined, { month: "short" });
  if (count === 7)
    return ["S", "M", "T", "W", "T", "F", "S"][bucket.start.getDay()];
  return String(bucket.start.getDate());
}
