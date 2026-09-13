export type TodayDonutLabelCandidate = {
  id: string;
  title: string;
  valueMs: number;
  provisional: boolean;
};

export type TodayDonutExternalLabel = TodayDonutLabelCandidate & {
  side: "left" | "right";
  x: number;
  y: number;
  width: number;
};

/**
 * Picks the largest exact slices and gives each a non-overlapping bounded
 * label slot. Real text measurements are supplied by the component; no
 * string-length estimate decides whether a label fits.
 */
export function layoutTodayDonutLabels(input: {
  availableWidth: number;
  chartSize: number;
  candidates: readonly TodayDonutLabelCandidate[];
  measuredWidths: Readonly<Record<string, number | undefined>>;
  maxLabels?: number;
}): TodayDonutExternalLabel[] {
  const capacity = input.availableWidth < 340 ? 2 : Math.min(4, input.maxLabels ?? 4);
  const labels = input.candidates
    .filter((candidate) => candidate.valueMs > 0)
    .sort((left, right) => right.valueMs - left.valueMs || left.id.localeCompare(right.id))
    .slice(0, capacity);
  const horizontalPadding = 8;
  const gap = 10;
  const half = Math.max(0, (input.availableWidth - input.chartSize) / 2);
  const maxSlot = Math.max(0, half - gap - horizontalPadding);
  const rowHeight = 34;
  const chartTop = 4;
  const slots = Math.max(1, labels.length);

  return labels.map((candidate, index) => {
    const side: "left" | "right" = index % 2 === 0 ? "left" : "right";
    const measured = input.measuredWidths[candidate.id];
    const width = Number.isFinite(measured) ? Math.min(maxSlot, Math.max(0, measured!)) : 0;
    const y = chartTop + Math.max(0, Math.min(
      input.chartSize - rowHeight,
      Math.round(((index + 0.5) / slots) * (input.chartSize - rowHeight))
    ));
    return {
      ...candidate,
      side,
      width,
      x: side === "left" ? horizontalPadding : Math.max(horizontalPadding, input.availableWidth - horizontalPadding - width),
      y
    };
  });
}
