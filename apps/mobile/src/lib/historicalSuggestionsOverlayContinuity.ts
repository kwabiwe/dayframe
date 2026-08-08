export type HistoricalSuggestionsOverlayContinuityState = {
  lastContainerVisible: boolean;
  lastContentKey: string | null;
  lastPresentationId: number | null;
  lastRenderedHeight: number;
  lastTargetVisible: boolean;
  pendingContentKey: string | null;
  pendingDropRecorded: boolean;
  updateVisibilityDropCount: number;
};

export type HistoricalSuggestionsOverlayContinuitySnapshot = {
  containerVisible: boolean;
  contentKey: string;
  contentMeasured: boolean;
  presentationId: number;
  renderedHeight: number;
  targetVisible: boolean;
};

export type HistoricalSuggestionsOverlayMotionAction =
  | "mount"
  | "hold_visible_update"
  | "await_measurement"
  | "stay_hidden"
  | "show_immediately"
  | "hide_immediately"
  | "animate_open"
  | "animate_close";

export function createHistoricalSuggestionsOverlayContinuityState():
HistoricalSuggestionsOverlayContinuityState {
  return {
    lastContainerVisible: false,
    lastContentKey: null,
    lastPresentationId: null,
    lastRenderedHeight: 0,
    lastTargetVisible: false,
    pendingContentKey: null,
    pendingDropRecorded: false,
    updateVisibilityDropCount: 0
  };
}

/**
 * Records whether a same-presentation result generation ever drops a surface
 * that was already fully visible. Presentation changes and intentional exits
 * are not updates and therefore cannot increment the cumulative guardrail.
 */
export function recordHistoricalSuggestionsOverlayContinuity(
  state: HistoricalSuggestionsOverlayContinuityState,
  snapshot: HistoricalSuggestionsOverlayContinuitySnapshot
): HistoricalSuggestionsOverlayContinuityState {
  const samePresentation = state.lastPresentationId === snapshot.presentationId;
  const contentChanged = samePresentation &&
    state.lastContentKey !== null &&
    state.lastContentKey !== snapshot.contentKey;
  const startedVisibleUpdate = Boolean(
    contentChanged &&
    snapshot.targetVisible &&
    state.lastTargetVisible &&
    state.lastContainerVisible &&
    state.lastRenderedHeight > 0
  );

  let pendingContentKey = samePresentation ? state.pendingContentKey : null;
  let pendingDropRecorded = samePresentation ? state.pendingDropRecorded : false;
  let updateVisibilityDropCount = state.updateVisibilityDropCount;

  if (!snapshot.targetVisible) {
    pendingContentKey = null;
    pendingDropRecorded = false;
  } else if (startedVisibleUpdate) {
    pendingContentKey = snapshot.contentKey;
    pendingDropRecorded = false;
  }

  if (pendingContentKey === snapshot.contentKey) {
    const continuityDropped = !snapshot.containerVisible || snapshot.renderedHeight <= 0;
    if (continuityDropped && !pendingDropRecorded) {
      updateVisibilityDropCount += 1;
      pendingDropRecorded = true;
    }
    if (snapshot.contentMeasured) {
      pendingContentKey = null;
      pendingDropRecorded = false;
    }
  }

  const visibleSurfaceDropped = Boolean(
    samePresentation &&
    snapshot.targetVisible &&
    state.lastTargetVisible &&
    state.lastContainerVisible &&
    state.lastRenderedHeight > 0 &&
    (!snapshot.containerVisible || snapshot.renderedHeight <= 0)
  );
  if (visibleSurfaceDropped && !pendingDropRecorded) {
    updateVisibilityDropCount += 1;
    pendingDropRecorded = true;
  } else if (snapshot.containerVisible && snapshot.renderedHeight > 0 && pendingContentKey === null) {
    pendingDropRecorded = false;
  }

  return {
    lastContainerVisible: snapshot.containerVisible,
    lastContentKey: snapshot.contentKey,
    lastPresentationId: snapshot.presentationId,
    lastRenderedHeight: snapshot.renderedHeight,
    lastTargetVisible: snapshot.targetVisible,
    pendingContentKey,
    pendingDropRecorded,
    updateVisibilityDropCount
  };
}

export function resolveHistoricalSuggestionsOverlayMotionAction({
  contentMeasured,
  currentRenderedHeight,
  mounted,
  paintableContent,
  reduceMotion,
  renderable,
  surfaceVisible,
  visible
}: {
  contentMeasured: boolean;
  currentRenderedHeight: number;
  mounted: boolean;
  paintableContent: boolean;
  reduceMotion: boolean;
  renderable: boolean;
  surfaceVisible: boolean;
  visible: boolean;
}): HistoricalSuggestionsOverlayMotionAction {
  if (visible && !mounted) return "mount";
  if (visible && surfaceVisible && renderable && paintableContent) {
    return "hold_visible_update";
  }
  if (visible && (!renderable || !contentMeasured || currentRenderedHeight <= 0)) {
    return "await_measurement";
  }
  if (!visible && !mounted) return "stay_hidden";
  if (reduceMotion) return visible ? "show_immediately" : "hide_immediately";
  return visible ? "animate_open" : "animate_close";
}
