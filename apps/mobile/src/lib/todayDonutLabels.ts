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
    .sort((a, b) => b.valueMs - a.valueMs || a.id.localeCompare(b.id))
    .filter((item) => width > 0 && (input.durationWidths?.[item.id] ?? 0) <= width)
    .slice(0, capacity);
  const labels = selected.map((item): TodayDonutExternalLabel => {
    const arc = arcs.get(item.id)!;
    const anchor = polarPoint(centerX, centerY, input.chartSize * 84 / 184, (arc.startAngle + arc.endAngle) / 2);
    const side = anchor.x < centerX ? "left" : "right";
    return { ...item, side, anchor, width, height,
      x: side === "left" ? 8 : input.availableWidth - 8 - width,
      y: Math.max(0, Math.min(input.chartSize - height, anchor.y - height / 2)), connector: "" };
  });
  for (const side of ["left", "right"] as const) {
    const group = labels.filter((label) => label.side === side).sort((a, b) => a.anchor.y - b.anchor.y);
    while (group.length * height > input.chartSize) {
      const smallest = [...group].sort((a, b) => a.valueMs - b.valueMs)[0];
      group.splice(group.indexOf(smallest), 1);
      labels.splice(labels.indexOf(smallest), 1);
    }
    for (let i = 1; i < group.length; i++) group[i].y = Math.max(group[i].y, group[i - 1].y + height);
    if (group.length) {
      group[group.length - 1].y = Math.min(group[group.length - 1].y, input.chartSize - height);
      for (let i = group.length - 2; i >= 0; i--) group[i].y = Math.min(group[i].y, group[i + 1].y - height);
    }
    for (const label of group) {
      const endX = side === "left" ? label.x + label.width + 2 : label.x - 2;
      const elbowX = centerX + (side === "left" ? -1 : 1) * (input.chartSize / 2 + 3);
      label.connector = `M ${label.anchor.x} ${label.anchor.y} L ${elbowX} ${label.y + height / 2} L ${endX} ${label.y + height / 2}`;
    }
  }
  return labels;
}
