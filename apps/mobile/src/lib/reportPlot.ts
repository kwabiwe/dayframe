import type { ReportAxisLayout, ReportBucket } from "./reportsRanges";

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

export type ReportAxisLabel = {
  index: number;
  primary: string;
  secondary?: string;
  anchor: "left" | "center" | "right";
};

const dayMonth = (date: Date) =>
  `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;

const weekdayInitial = (date: Date) =>
  date.toLocaleDateString(undefined, { weekday: "narrow" });

const inclusiveEnd = (bucket: ReportBucket) => {
  const result = new Date(bucket.end);
  result.setDate(result.getDate() - 1);
  return result < bucket.start ? bucket.start : result;
};

export function reportAxisLabels(
  buckets: ReportBucket[],
  layout: ReportAxisLayout,
  plotWidth: number,
): ReportAxisLabel[] {
  if (buckets.length === 0) return [];
  if (layout === "single-day")
    return [
      {
        index: 0,
        primary: weekdayInitial(buckets[0].start),
        secondary: dayMonth(buckets[0].start),
        anchor: "center",
      },
    ];
  if (layout === "week")
    return buckets.map((bucket, index) => ({
      index,
      primary: weekdayInitial(bucket.start),
      secondary: dayMonth(bucket.start),
      anchor: "center" as const,
    }));
  if (layout === "year") {
    const cadence = plotWidth >= 210 ? [0, 2, 4, 6, 8, 10] : [0, 3, 6, 9];
    return cadence
      .filter((index) => index < buckets.length)
      .map((index) => ({
        index,
        primary: buckets[index].start.toLocaleDateString(undefined, {
          month: "short",
        }),
        anchor: "center" as const,
      }));
  }
  if (buckets.length === 1)
    return [
      {
        index: 0,
        primary: dayMonth(buckets[0].start),
        anchor: "center",
      },
    ];
  return [
    { index: 0, primary: dayMonth(buckets[0].start), anchor: "left" },
    {
      index: buckets.length - 1,
      primary: dayMonth(inclusiveEnd(buckets.at(-1)!)),
      anchor: "right",
    },
  ];
}
