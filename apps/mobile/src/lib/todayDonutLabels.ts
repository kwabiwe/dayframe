import { polarPoint, prepareDonutArcs } from "./donutGeometry";

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
  height: number;
  anchor: { x: number; y: number };
  connector: string;
};

/** Use the chart's ordered, gap-adjusted arcs before selecting bounded labels. */
export function layoutTodayDonutLabels(input: {
  availableWidth: number;
  chartSize: number;
  candidates: readonly TodayDonutLabelCandidate[];
  measuredWidths: Readonly<Record<string, number | undefined>>;
  durationWidths?: Readonly<Record<string, number | undefined>>;
  rowHeight?: number;
  maxLabels?: number;
}): TodayDonutExternalLabel[] {
  const capacity = Math.min(input.availableWidth < 340 ? 2 : 4, input.maxLabels ?? 4);
  const width = Math.max(0, (input.availableWidth - input.chartSize) / 2 - 18);
  const height = Math.max(44, input.rowHeight ?? 44);
  const centerX = input.availableWidth / 2;
  const centerY = input.chartSize / 2;
  const arcs = new Map(prepareDonutArcs(input.candidates.map((item) => ({ id: item.id, value: item.valueMs })))
    .map((arc) => [arc.id, arc]));
  const selected = input.candidates.filter((item) => arcs.has(item.id))
    .sort((a, b) => Number(b.provisional) - Number(a.provisional) || b.valueMs - a.valueMs || a.id.localeCompare(b.id))
    .filter((item) => width > 0 && (input.durationWidths?.[item.id] ?? 0) <= width);
  const labels: TodayDonutExternalLabel[] = [];
  for (const item of selected) {
    if (labels.length >= capacity) break;
    const arc = arcs.get(item.id)!;
    const radius = input.chartSize * 84 / 184;
    const anchor = polarPoint(centerX, centerY, radius, (arc.startAngle + arc.endAngle) / 2);
    const side = anchor.x < centerX ? "left" : "right";
    const y = Math.max(0, Math.min(input.chartSize - height, anchor.y - height / 2));
    // Review sources claim slots first, then larger slices of the same state.
    // Omit competition rather
    // than displacing a label away from its source or introducing diagonal ink.
    if (Math.abs(y + height / 2 - anchor.y) > height / 2 ||
        labels.some((label) => label.side === side && Math.abs(label.y - y) < height)) continue;
    const direction = side === "left" ? -1 : 1;
    const lineY = y + height / 2;
    const perimeterX = centerX + direction * Math.sqrt(Math.max(0, radius ** 2 - (lineY - centerY) ** 2));
    const lineStart = perimeterX + direction * 6;
    const x = side === "left" ? 8 : input.availableWidth - 8 - width;
    const lineEnd = side === "left" ? x + width + 4 : x - 4;
    if ((lineEnd - lineStart) * direction <= 0) continue;
    labels.push({ ...item, side, anchor, width, height,
      x,
      y, connector: `M ${lineStart} ${lineY} L ${lineEnd} ${lineY}` });
  }
  return labels;
}
