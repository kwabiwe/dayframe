export type HistoryRowLayout = "inline" | "stacked";

export function historyRowLayout(input: {
  availableWidth: number;
  countBadgeWidth?: number;
  dotWidth?: number;
  gap?: number;
  minimumTitleWidth?: number;
  durationWidth: number;
  replayWidth?: number;
  padding?: number;
}): HistoryRowLayout {
  const {
    availableWidth,
    countBadgeWidth = 0,
    dotWidth = 9,
    gap = 10,
    minimumTitleWidth = 96,
    durationWidth,
    replayWidth = 44,
    padding = 0,
  } = input;
  const main = countBadgeWidth + dotWidth + gap * (countBadgeWidth ? 2 : 1) + minimumTitleWidth;
  const needed = padding + main + durationWidth + replayWidth + gap;
  return availableWidth >= needed ? "inline" : "stacked";
}

export type SummaryLayout = "inline" | "stacked";

export function summaryLayout(input: {
  availableWidth: number;
  labelWidth: number;
  valueWidth: number;
  gap?: number;
  safetyMargin?: number;
  padding?: number;
}): SummaryLayout {
  return input.availableWidth >= input.labelWidth + input.valueWidth +
    (input.gap ?? 12) + (input.padding ?? 0) + (input.safetyMargin ?? 6)
    ? "inline"
    : "stacked";
}
