export type DonutArc = {
  id: string;
  startAngle: number;
  endAngle: number;
};

export function donutTransitionTargets(
  previous: readonly DonutArc[],
  desired: readonly { id: string; value: number }[],
) {
  const current = prepareDonutArcs(desired);
  const ids = new Set(current.map((arc) => arc.id));
  return [
    ...current,
    ...previous
      .filter((arc) => !ids.has(arc.id))
      .map((arc) => ({ ...arc, endAngle: arc.startAngle })),
  ];
}
export function canRemoveDonutVisual(
  completedGeneration: number,
  generation: number,
  id: string,
  desiredIds: readonly string[],
) {
  return completedGeneration === generation && !desiredIds.includes(id);
}

export function prepareDonutArcs(
  segments: readonly { id: string; value: number }[],
): DonutArc[] {
  const drawable = segments.filter(
    (segment) =>
      segment.id && Number.isFinite(segment.value) && segment.value > 0,
  );
  const total = drawable.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return [];
  let cursor = 0;
  return drawable.map((segment, index) => {
    const startAngle = cursor;
    const fullSweep =
      index === drawable.length - 1
        ? 360 - cursor
        : (segment.value / total) * 360;
    cursor += fullSweep;
    const gap =
      drawable.length > 1 && fullSweep > 8 ? Math.min(2, fullSweep * 0.12) : 0;
    return {
      id: segment.id,
      startAngle,
      endAngle: Math.max(startAngle, cursor - gap),
    };
  });
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  "worklet";
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

export function donutSlicePath(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  "worklet";
  const sweep = Math.max(0, Math.min(360, endAngle - startAngle));
  if (
    sweep <= 0 ||
    outerRadius <= 0 ||
    innerRadius < 0 ||
    innerRadius >= outerRadius
  )
    return "";
  if (sweep >= 359.999) {
    const middleAngle = startAngle + 180;
    const outerStart = polarPoint(centerX, centerY, outerRadius, startAngle);
    const outerMiddle = polarPoint(centerX, centerY, outerRadius, middleAngle);
    const innerStart = polarPoint(centerX, centerY, innerRadius, startAngle);
    const innerMiddle = polarPoint(centerX, centerY, innerRadius, middleAngle);
    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerMiddle.x} ${outerMiddle.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerStart.x} ${outerStart.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerMiddle.x} ${innerMiddle.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerStart.x} ${innerStart.y}`,
      "Z",
    ].join(" ");
  }
  const safeEnd = startAngle + sweep;
  const outerStart = polarPoint(centerX, centerY, outerRadius, startAngle);
  const outerEnd = polarPoint(centerX, centerY, outerRadius, safeEnd);
  const innerEnd = polarPoint(centerX, centerY, innerRadius, safeEnd);
  const innerStart = polarPoint(centerX, centerY, innerRadius, startAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}
