export type MeasuredRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type SheetGeometryInvalidationReason =
  | "presentation"
  | "window"
  | "safe_area"
  | "dynamic_type";

export type TimeEntrySheetGeometryCache = {
  baseSheetRect: MeasuredRect | null;
  descriptionRect: MeasuredRect | null;
  presentationId: number | null;
  revision: number;
};

export type HistoricalSuggestionsOverlayGeometry = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

export type HistoricalSuggestionsOverlayGeometryInput = {
  bottomGap?: number;
  descriptionRect: MeasuredRect;
  desiredHeight: number;
  horizontalInset?: number;
  keyboardTop: number | null;
  minimumWidth?: number;
  safeAreaBottom: number;
  sheetRect: MeasuredRect;
  topBoundary?: number;
  visualGap?: number;
};

export type HistoricalSuggestionsOverlayHeightInput = {
  contentHeight: number;
  headerHeight: number;
  maxHeight: number;
};

export type TimeEntrySheetLocalGeometryInput = {
  contentOffset: { x: number; y: number };
  descriptionAnchorRect: MeasuredRect;
  descriptionSectionRect: MeasuredRect;
  rootSize: { height: number; width: number };
  scrollViewportRect: MeasuredRect;
};

export type TimeEntrySheetLocalGeometry = {
  descriptionRect: MeasuredRect;
  overlayBottomBoundary: number;
  overlayTopBoundary: number;
  sheetRect: MeasuredRect;
};

export type TimeEntrySheetVisualReadinessInput = {
  baseSheetRect: MeasuredRect | null;
  descriptionFocused: boolean;
  descriptionRect: MeasuredRect | null;
  keyboardInset: number;
  keyboardPhase: string;
  overlayContainerVisible: boolean;
  overlayContentMeasured: boolean;
  overlayGeometry: HistoricalSuggestionsOverlayGeometry | null;
  overlayRenderedHeight: number;
  sheetHeightAnimating: boolean;
  sheetRect: MeasuredRect | null;
  suggestionsExpected: boolean;
  suggestionsPhase: string;
};

export type KeyboardHeightAnimationToken = {
  presentationId: number;
  sequence: number;
};

export type TimeEntrySheetFrameToken = {
  presentationId: number;
  sequence: number;
};

export function isCurrentTimeEntrySheetFrameToken(
  token: TimeEntrySheetFrameToken,
  currentPresentationId: number,
  currentSequence: number
) {
  return token.presentationId === currentPresentationId && token.sequence === currentSequence;
}

export type KeyboardHeightAnimationCompletion = "accepted" | "cancelled" | "stale";

export function classifyKeyboardHeightAnimationCompletion({
  completionToken,
  currentPresentationId,
  currentSequence,
  currentToken,
  finished
}: {
  completionToken: KeyboardHeightAnimationToken;
  currentPresentationId: number;
  currentSequence: number;
  currentToken: KeyboardHeightAnimationToken | null;
  finished: boolean;
}): KeyboardHeightAnimationCompletion {
  if (!finished) return "cancelled";
  if (
    currentToken === null ||
    completionToken.presentationId !== currentToken.presentationId ||
    completionToken.sequence !== currentToken.sequence ||
    completionToken.presentationId !== currentPresentationId ||
    completionToken.sequence !== currentSequence
  ) {
    return "stale";
  }
  return "accepted";
}

export function createTimeEntrySheetGeometryCache(): TimeEntrySheetGeometryCache {
  return {
    baseSheetRect: null,
    descriptionRect: null,
    presentationId: null,
    revision: 0
  };
}

export function beginTimeEntrySheetGeometryPresentation(
  cache: TimeEntrySheetGeometryCache,
  presentationId: number
): TimeEntrySheetGeometryCache {
  if (!Number.isSafeInteger(presentationId) || presentationId <= 0) return cache;
  if (cache.presentationId === presentationId) return cache;
  return {
    baseSheetRect: null,
    descriptionRect: null,
    presentationId,
    revision: cache.revision + 1
  };
}

export function invalidateTimeEntrySheetGeometry(
  cache: TimeEntrySheetGeometryCache,
  presentationId: number,
  _reason: SheetGeometryInvalidationReason
): TimeEntrySheetGeometryCache {
  if (cache.presentationId !== presentationId) return cache;
  return {
    ...cache,
    baseSheetRect: null,
    descriptionRect: null,
    revision: cache.revision + 1
  };
}

export function recordTimeEntrySheetGeometry(
  cache: TimeEntrySheetGeometryCache,
  measurement: {
    baseSheetRect: MeasuredRect;
    descriptionRect: MeasuredRect;
    presentationId: number;
  }
): TimeEntrySheetGeometryCache {
  if (
    cache.presentationId !== measurement.presentationId ||
    !isMeasuredRect(measurement.baseSheetRect) ||
    !isMeasuredRect(measurement.descriptionRect)
  ) {
    return cache;
  }
  return {
    ...cache,
    baseSheetRect: measurement.baseSheetRect,
    descriptionRect: measurement.descriptionRect
  };
}

export function calculateHistoricalSuggestionsOverlayGeometry({
  bottomGap = 8,
  descriptionRect,
  desiredHeight,
  horizontalInset = 0,
  keyboardTop,
  minimumWidth = 120,
  safeAreaBottom,
  sheetRect,
  topBoundary = 0,
  visualGap = 6
}: HistoricalSuggestionsOverlayGeometryInput): HistoricalSuggestionsOverlayGeometry {
  const safeSheetWidth = Math.max(0, finite(sheetRect.width));
  const desiredLeft = finite(descriptionRect.x) - finite(sheetRect.x);
  const availableWidth = Math.max(0, safeSheetWidth - horizontalInset * 2);
  const desiredWidth = Math.max(0, finite(descriptionRect.width));
  const width = Math.min(
    availableWidth,
    Math.max(Math.min(minimumWidth, availableWidth), desiredWidth)
  );
  const left = clamp(
    desiredLeft,
    horizontalInset,
    Math.max(horizontalInset, safeSheetWidth - horizontalInset - width)
  );
  const naturalTop = Math.max(
    0,
    finite(descriptionRect.y) - finite(sheetRect.y) +
      Math.max(0, finite(descriptionRect.height)) + visualGap
  );
  const minimumTop = clamp(
    finite(topBoundary) - finite(sheetRect.y),
    0,
    Math.max(0, finite(sheetRect.height))
  );
  const anchorIsVisibleBelowPinnedContent = naturalTop >= minimumTop;
  const top = Math.max(minimumTop, naturalTop);
  const sheetBottom = finite(sheetRect.y) + Math.max(0, finite(sheetRect.height));
  const availableBottom = Math.min(
    sheetBottom - Math.max(0, safeAreaBottom),
    keyboardTop === null ? Number.POSITIVE_INFINITY : finite(keyboardTop)
  );
  const overlayTopInWindow = finite(sheetRect.y) + top;
  const availableHeight = Math.max(0, availableBottom - overlayTopInWindow - bottomGap);

  return {
    left,
    maxHeight: anchorIsVisibleBelowPinnedContent
      ? Math.min(Math.max(0, finite(desiredHeight)), availableHeight)
      : 0,
    top,
    width
  };
}

/**
 * Resolves the Description anchor in the same local coordinate space used by
 * the absolute Suggestions overlay. Layout callbacks are transform-free, and
 * subtracting the live content offset accounts for focus-driven ScrollView
 * movement without consulting animated window coordinates.
 */
export function resolveTimeEntrySheetLocalGeometry({
  contentOffset,
  descriptionAnchorRect,
  descriptionSectionRect,
  rootSize,
  scrollViewportRect
}: TimeEntrySheetLocalGeometryInput): TimeEntrySheetLocalGeometry | null {
  const sheetRect = {
    height: Math.max(0, finite(rootSize.height)),
    width: Math.max(0, finite(rootSize.width)),
    x: 0,
    y: 0
  };
  if (
    sheetRect.height <= 0 ||
    sheetRect.width <= 0 ||
    !isMeasuredRect(scrollViewportRect) ||
    scrollViewportRect.height <= 0 ||
    scrollViewportRect.width <= 0 ||
    !isMeasuredRect(descriptionSectionRect) ||
    !isMeasuredRect(descriptionAnchorRect) ||
    descriptionAnchorRect.height <= 0 ||
    descriptionAnchorRect.width <= 0
  ) {
    return null;
  }

  const descriptionRect = {
    height: descriptionAnchorRect.height,
    width: Math.min(descriptionAnchorRect.width, sheetRect.width),
    x: finite(scrollViewportRect.x) + finite(descriptionSectionRect.x) +
      finite(descriptionAnchorRect.x) - finite(contentOffset.x),
    y: finite(scrollViewportRect.y) + finite(descriptionSectionRect.y) +
      finite(descriptionAnchorRect.y) - finite(contentOffset.y)
  };
  const overlayBottomBoundary = clamp(
    finite(scrollViewportRect.y) + Math.max(0, finite(scrollViewportRect.height)),
    0,
    sheetRect.height
  );
  const overlayTopBoundary = clamp(
    finite(scrollViewportRect.y),
    0,
    sheetRect.height
  );

  return {
    descriptionRect,
    overlayBottomBoundary,
    overlayTopBoundary,
    sheetRect
  };
}

export function timeEntrySheetVisualReadiness({
  baseSheetRect,
  descriptionFocused,
  descriptionRect,
  keyboardInset,
  keyboardPhase,
  overlayContainerVisible,
  overlayContentMeasured,
  overlayGeometry,
  overlayRenderedHeight,
  sheetHeightAnimating,
  sheetRect,
  suggestionsExpected,
  suggestionsPhase
}: TimeEntrySheetVisualReadinessInput) {
  if (
    !positiveRect(baseSheetRect) ||
    !positiveRect(sheetRect) ||
    !positiveRect(descriptionRect) ||
    !overlayGeometry
  ) {
    return false;
  }
  if (
    descriptionFocused && (
      keyboardPhase !== "visible" ||
      finite(keyboardInset) <= 0 ||
      sheetHeightAnimating
    )
  ) {
    return false;
  }
  if (suggestionsExpected) {
    return suggestionsPhase === "visible" &&
      overlayGeometry.maxHeight > 0 &&
      overlayContentMeasured &&
      overlayContainerVisible &&
      finite(overlayRenderedHeight) > 0;
  }
  return suggestionsPhase === "closed";
}

export function resolveHistoricalSuggestionsOverlayHeight({
  contentHeight,
  headerHeight,
  maxHeight
}: HistoricalSuggestionsOverlayHeightInput) {
  const availableHeight = Math.max(0, finite(maxHeight));
  const measuredHeaderHeight = Math.max(0, finite(headerHeight));
  const measuredContentHeight = Math.max(0, finite(contentHeight));
  if (measuredHeaderHeight === 0 || measuredContentHeight === 0) {
    return 0;
  }
  return Math.min(
    availableHeight,
    measuredHeaderHeight + measuredContentHeight
  );
}

export function isMeasuredRect(rect: MeasuredRect) {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

function positiveRect(rect: MeasuredRect | null): rect is MeasuredRect {
  return Boolean(rect && isMeasuredRect(rect) && rect.width > 0 && rect.height > 0);
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(finite(value), minimum), maximum);
}
