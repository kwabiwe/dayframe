const shortBlockMinutes = 15;
const minimumClickableBlockHeight = 18;

export const resizeDragThresholdPx = 6;

export type TimeBlockDensity = {
  isTiny: boolean;
  isShort: boolean;
  showTitle: boolean;
  showContext: boolean;
  showDuration: boolean;
};

export function minimumTimeBlockHeight(pixelsPerHour: number) {
  return Math.max(minimumClickableBlockHeight, (shortBlockMinutes / 60) * pixelsPerHour);
}

export function getTimeBlockDensity({
  durationSeconds,
  height
}: {
  durationSeconds: number;
  height: number;
}): TimeBlockDensity {
  const durationMinutes = durationSeconds / 60;
  const isTiny = durationMinutes < 10 || height < 24;
  const isShort = durationMinutes < 16 || height < 38;

  return {
    isTiny,
    isShort,
    showTitle: !isTiny && height >= 24,
    showContext: !isShort && height >= 44,
    showDuration: !isShort && height >= 40
  };
}

export function timeBlockDensityClassNames(density: TimeBlockDensity) {
  return [
    density.isTiny ? "is-tiny" : "",
    density.isShort ? "is-short" : "",
    density.showTitle ? "" : "has-no-text"
  ];
}
