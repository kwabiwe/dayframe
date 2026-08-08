import { describe, expect, it } from "vitest";
import {
  createHistoricalSuggestionsOverlayContinuityState,
  recordHistoricalSuggestionsOverlayContinuity,
  resolveHistoricalSuggestionsOverlayMotionAction,
  type HistoricalSuggestionsOverlayContinuitySnapshot
} from "./historicalSuggestionsOverlayContinuity";

const visible = {
  containerVisible: true,
  contentMeasured: true,
  presentationId: 41,
  renderedHeight: 112,
  targetVisible: true
} satisfies Omit<HistoricalSuggestionsOverlayContinuitySnapshot, "contentKey">;

describe("historical Suggestions overlay update continuity", () => {
  it("keeps rapid same-presentation generations continuous until the latest measurement", () => {
    let state = createHistoricalSuggestionsOverlayContinuityState();
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "one"
    });
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "six",
      contentMeasured: false
    });
    expect(state.pendingContentKey).toBe("six");
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "long",
      contentMeasured: false
    });
    expect(state.pendingContentKey).toBe("long");
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "long",
      renderedHeight: 225
    });

    expect(state.pendingContentKey).toBeNull();
    expect(state.updateVisibilityDropCount).toBe(0);
  });

  it("holds an already-visible surface through updates in normal and Reduce Motion", () => {
    for (const reduceMotion of [false, true]) {
      expect(resolveHistoricalSuggestionsOverlayMotionAction({
        contentMeasured: false,
        currentRenderedHeight: 0,
        mounted: true,
        paintableContent: true,
        reduceMotion,
        renderable: true,
        surfaceVisible: true,
        visible: true
      })).toBe("hold_visible_update");
    }
  });

  it("preserves true entrance/exit motion and Reduce Motion endpoints", () => {
    const ready = {
      contentMeasured: true,
      currentRenderedHeight: 112,
      mounted: true,
      paintableContent: true,
      renderable: true,
      surfaceVisible: false,
      visible: true
    };
    expect(resolveHistoricalSuggestionsOverlayMotionAction({
      ...ready,
      reduceMotion: false
    })).toBe("animate_open");
    expect(resolveHistoricalSuggestionsOverlayMotionAction({
      ...ready,
      reduceMotion: true
    })).toBe("show_immediately");
    expect(resolveHistoricalSuggestionsOverlayMotionAction({
      ...ready,
      reduceMotion: false,
      visible: false
    })).toBe("animate_close");
    expect(resolveHistoricalSuggestionsOverlayMotionAction({
      ...ready,
      reduceMotion: true,
      visible: false
    })).toBe("hide_immediately");
  });

  it("counts one drop per updating generation without double-counting its frames", () => {
    let state = createHistoricalSuggestionsOverlayContinuityState();
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "one"
    });
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      containerVisible: false,
      contentKey: "twelve",
      contentMeasured: false,
      renderedHeight: 0
    });
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      containerVisible: false,
      contentKey: "twelve",
      contentMeasured: false,
      renderedHeight: 0
    });
    expect(state.updateVisibilityDropCount).toBe(1);

    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "twelve",
      renderedHeight: 225
    });
    expect(state.updateVisibilityDropCount).toBe(1);
  });

  it("counts a same-content geometry drop during interactive keyboard movement", () => {
    let state = createHistoricalSuggestionsOverlayContinuityState();
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "stable"
    });
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      containerVisible: false,
      contentKey: "stable",
      renderedHeight: 0
    });
    expect(state.updateVisibilityDropCount).toBe(1);
  });

  it("does not treat true entrance, exit, or a new presentation as an update drop", () => {
    let state = createHistoricalSuggestionsOverlayContinuityState();
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      containerVisible: false,
      contentKey: "initial",
      contentMeasured: false,
      presentationId: 41,
      renderedHeight: 0,
      targetVisible: true
    });
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      contentKey: "initial"
    });
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      containerVisible: false,
      contentKey: "exit-content",
      contentMeasured: false,
      renderedHeight: 0,
      targetVisible: false
    });
    state = recordHistoricalSuggestionsOverlayContinuity(state, {
      ...visible,
      containerVisible: false,
      contentKey: "new-presentation",
      contentMeasured: false,
      presentationId: 42,
      renderedHeight: 0
    });

    expect(state.pendingContentKey).toBeNull();
    expect(state.updateVisibilityDropCount).toBe(0);
  });
});
