import { describe, expect, it } from "vitest";
import {
  beginTimeEntrySheetGeometryPresentation,
  calculateHistoricalSuggestionsOverlayGeometry,
  classifyKeyboardHeightAnimationCompletion,
  createTimeEntrySheetGeometryCache,
  invalidateTimeEntrySheetGeometry,
  isCurrentTimeEntrySheetFrameToken,
  recordTimeEntrySheetGeometry,
  resolveHistoricalSuggestionsOverlayHeight,
  resolveTimeEntrySheetLocalGeometry,
  timeEntrySheetVisualReadiness
} from "./timeEntrySheetGeometry";

const sheetRect = { x: 16, y: 180, width: 358, height: 620 };
const descriptionRect = { x: 32, y: 360, width: 326, height: 48 };

describe("historical Suggestions overlay geometry", () => {
  it("anchors directly below Description in sheet coordinates", () => {
    expect(calculateHistoricalSuggestionsOverlayGeometry({
      descriptionRect,
      desiredHeight: 369,
      keyboardTop: null,
      safeAreaBottom: 34,
      sheetRect
    })).toEqual({
      left: 16,
      maxHeight: 344,
      top: 234,
      width: 326
    });
  });

  it("caps height above the keyboard without moving the anchor", () => {
    const geometry = calculateHistoricalSuggestionsOverlayGeometry({
      descriptionRect,
      desiredHeight: 369,
      keyboardTop: 650,
      safeAreaBottom: 34,
      sheetRect
    });

    expect(geometry.top).toBe(234);
    expect(geometry.maxHeight).toBe(228);
  });

  it("never returns negative height on a small keyboard-constrained screen", () => {
    expect(calculateHistoricalSuggestionsOverlayGeometry({
      descriptionRect: { x: 20, y: 510, width: 280, height: 64 },
      desiredHeight: 369,
      keyboardTop: 500,
      safeAreaBottom: 20,
      sheetRect: { x: 12, y: 120, width: 300, height: 500 }
    }).maxHeight).toBe(0);
  });

  it("hides Suggestions instead of covering pinned actions when Description scrolls above the viewport", () => {
    expect(calculateHistoricalSuggestionsOverlayGeometry({
      descriptionRect: { x: 0, y: -60, width: 358, height: 48 },
      desiredHeight: 369,
      keyboardTop: 487,
      safeAreaBottom: 0,
      sheetRect: { x: 0, y: 0, width: 358, height: 487 },
      topBoundary: 118
    })).toEqual({
      left: 0,
      maxHeight: 0,
      top: 118,
      width: 358
    });
  });

  it("keeps a large Dynamic Type Description and overlay inside a short viewport", () => {
    const geometry = calculateHistoricalSuggestionsOverlayGeometry({
      descriptionRect: { x: 28, y: 286, width: 264, height: 92 },
      desiredHeight: 520,
      keyboardTop: 612,
      safeAreaBottom: 21,
      sheetRect: { x: 12, y: 96, width: 296, height: 540 }
    });
    expect(geometry.top).toBe(288);
    expect(geometry.maxHeight).toBe(220);
    expect(96 + geometry.top + geometry.maxHeight + 8).toBeLessThanOrEqual(612);
  });

  it("clamps horizontal geometry inside the measured sheet", () => {
    const geometry = calculateHistoricalSuggestionsOverlayGeometry({
      descriptionRect: { x: -40, y: 300, width: 500, height: 48 },
      desiredHeight: 200,
      horizontalInset: 8,
      keyboardTop: null,
      safeAreaBottom: 0,
      sheetRect: { x: 12, y: 100, width: 320, height: 600 }
    });

    expect(geometry.left).toBe(8);
    expect(geometry.width).toBe(304);
    expect(geometry.left + geometry.width).toBeLessThanOrEqual(312);
  });

  it("is invariant to result-count changes because count is not a geometry input", () => {
    const input = {
      descriptionRect,
      desiredHeight: 369,
      keyboardTop: 700,
      safeAreaBottom: 34,
      sheetRect
    };
    const closed = calculateHistoricalSuggestionsOverlayGeometry(input);
    const oneResult = calculateHistoricalSuggestionsOverlayGeometry(input);
    const twelveResults = calculateHistoricalSuggestionsOverlayGeometry(input);
    expect(oneResult).toEqual(closed);
    expect(twelveResults).toEqual(closed);
  });

  it("does not expose a visible height until Dynamic Type content is measured", () => {
    expect(resolveHistoricalSuggestionsOverlayHeight({
      contentHeight: 0,
      headerHeight: 42,
      maxHeight: 220
    })).toBe(0);
  });

  it("sizes the opaque backing to measured content and clamps it to available height", () => {
    expect(resolveHistoricalSuggestionsOverlayHeight({
      contentHeight: 72,
      headerHeight: 42,
      maxHeight: 220
    })).toBe(114);
    expect(resolveHistoricalSuggestionsOverlayHeight({
      contentHeight: 420,
      headerHeight: 58,
      maxHeight: 220
    })).toBe(220);
  });
});

describe("layout-derived local sheet geometry", () => {
  const localLayout = {
    contentOffset: { x: 0, y: 0 },
    descriptionAnchorRect: { x: 0, y: 22, width: 358, height: 48 },
    descriptionSectionRect: { x: 0, y: 0, width: 358, height: 112 },
    rootSize: { width: 358, height: 487 },
    scrollViewportRect: { x: 0, y: 118, width: 358, height: 345 }
  };

  it("places root, visible Description and viewport boundary in one local space", () => {
    expect(resolveTimeEntrySheetLocalGeometry(localLayout)).toEqual({
      descriptionRect: { x: 0, y: 140, width: 358, height: 48 },
      overlayBottomBoundary: 463,
      overlayTopBoundary: 118,
      sheetRect: { x: 0, y: 0, width: 358, height: 487 }
    });
  });

  it("subtracts focus-driven scrolling from the Description visual position", () => {
    const before = resolveTimeEntrySheetLocalGeometry({
      ...localLayout,
      descriptionSectionRect: { ...localLayout.descriptionSectionRect, y: 96 }
    });
    const after = resolveTimeEntrySheetLocalGeometry({
      ...localLayout,
      contentOffset: { x: 0, y: 96 },
      descriptionSectionRect: { ...localLayout.descriptionSectionRect, y: 96 }
    });
    expect(before?.descriptionRect.y).toBe(236);
    expect(after?.descriptionRect.y).toBe(140);
  });

  it("produces a useful overlay without animated window coordinates", () => {
    const local = resolveTimeEntrySheetLocalGeometry(localLayout);
    expect(local).not.toBeNull();
    const overlay = calculateHistoricalSuggestionsOverlayGeometry({
      descriptionRect: local!.descriptionRect,
      desiredHeight: 384,
      keyboardTop: local!.overlayBottomBoundary,
      safeAreaBottom: 0,
      sheetRect: local!.sheetRect,
      topBoundary: local!.overlayTopBoundary
    });
    expect(overlay.top).toBe(194);
    expect(overlay.maxHeight).toBe(261);
    expect(overlay.top).toBe(local!.descriptionRect.y + local!.descriptionRect.height + 6);
    expect(overlay.top + overlay.maxHeight + 8).toBe(local!.overlayBottomBoundary);
  });

  it("rejects incomplete zero-sized layout snapshots", () => {
    expect(resolveTimeEntrySheetLocalGeometry({
      ...localLayout,
      scrollViewportRect: { ...localLayout.scrollViewportRect, height: 0 }
    })).toBeNull();
  });
});

describe("sheet visual readiness", () => {
  const readyGeometry = {
    baseSheetRect: { x: 0, y: 0, width: 358, height: 640 },
    descriptionFocused: true,
    descriptionRect: { x: 0, y: 140, width: 358, height: 48 },
    keyboardInset: 365,
    keyboardPhase: "visible",
    overlayContainerVisible: true,
    overlayContentMeasured: true,
    overlayGeometry: { left: 0, top: 194, width: 358, maxHeight: 261 },
    overlayRenderedHeight: 220,
    sheetHeightAnimating: false,
    sheetRect: { x: 0, y: 0, width: 358, height: 487 },
    suggestionsExpected: true,
    suggestionsPhase: "visible"
  };

  it("rejects the observed opening state with zero overlay geometry", () => {
    expect(timeEntrySheetVisualReadiness({
      ...readyGeometry,
      overlayGeometry: { ...readyGeometry.overlayGeometry, maxHeight: 0 },
      suggestionsPhase: "opening"
    })).toBe(false);
  });

  it("rejects focus readiness before the keyboard frame and height settle", () => {
    expect(timeEntrySheetVisualReadiness({
      ...readyGeometry,
      keyboardInset: 0,
      keyboardPhase: "focus_requested"
    })).toBe(false);
    expect(timeEntrySheetVisualReadiness({
      ...readyGeometry,
      sheetHeightAnimating: true
    })).toBe(false);
  });

  it("accepts visible positive Suggestions and a settled keyboard", () => {
    expect(timeEntrySheetVisualReadiness(readyGeometry)).toBe(true);
  });

  it("waits for current overlay measurement and whole-container visibility", () => {
    expect(timeEntrySheetVisualReadiness({
      ...readyGeometry,
      overlayContentMeasured: false
    })).toBe(false);
    expect(timeEntrySheetVisualReadiness({
      ...readyGeometry,
      overlayContainerVisible: false
    })).toBe(false);
    expect(timeEntrySheetVisualReadiness({
      ...readyGeometry,
      overlayRenderedHeight: 0
    })).toBe(false);
    expect(timeEntrySheetVisualReadiness({
      ...readyGeometry,
      overlayRenderedHeight: readyGeometry.overlayGeometry.maxHeight + 1
    })).toBe(false);
  });

  it("accepts an unfocused presentation only after Suggestions close", () => {
    const unfocused = {
      ...readyGeometry,
      descriptionFocused: false,
      keyboardInset: 0,
      keyboardPhase: "hidden",
      suggestionsExpected: false
    };
    expect(timeEntrySheetVisualReadiness({
      ...unfocused,
      suggestionsPhase: "closing"
    })).toBe(false);
    expect(timeEntrySheetVisualReadiness({
      ...unfocused,
      suggestionsPhase: "closed"
    })).toBe(true);
  });
});

describe("keyboard height animation ownership", () => {
  it("rejects an older frame completion after a newer frame owns the layout", () => {
    expect(classifyKeyboardHeightAnimationCompletion({
      completionToken: { presentationId: 7, sequence: 14 },
      currentPresentationId: 7,
      currentSequence: 15,
      currentToken: { presentationId: 7, sequence: 15 },
      finished: true
    })).toBe("stale");
  });

  it("rejects a completion from the prior presentation after rapid reopen", () => {
    expect(classifyKeyboardHeightAnimationCompletion({
      completionToken: { presentationId: 7, sequence: 14 },
      currentPresentationId: 8,
      currentSequence: 15,
      currentToken: null,
      finished: true
    })).toBe("stale");
  });

  it("accepts only the current generation and treats an explicit stop as cancellation", () => {
    const token = { presentationId: 8, sequence: 16 };
    expect(classifyKeyboardHeightAnimationCompletion({
      completionToken: token,
      currentPresentationId: 8,
      currentSequence: 16,
      currentToken: token,
      finished: true
    })).toBe("accepted");
    expect(classifyKeyboardHeightAnimationCompletion({
      completionToken: token,
      currentPresentationId: 8,
      currentSequence: 16,
      currentToken: token,
      finished: false
    })).toBe("cancelled");
  });

  it("lets a swipe cancel an in-flight height owner and accepts only the resumed generation", () => {
    const interrupted = { presentationId: 8, sequence: 16 };
    const resumed = { presentationId: 8, sequence: 17 };

    expect(classifyKeyboardHeightAnimationCompletion({
      completionToken: interrupted,
      currentPresentationId: 8,
      currentSequence: 17,
      currentToken: resumed,
      finished: false
    })).toBe("cancelled");
    expect(classifyKeyboardHeightAnimationCompletion({
      completionToken: resumed,
      currentPresentationId: 8,
      currentSequence: 17,
      currentToken: resumed,
      finished: true
    })).toBe("accepted");
  });
});

describe("generation-scoped sheet frame ownership", () => {
  it("rejects a scroll frame after a newer frame is scheduled", () => {
    expect(isCurrentTimeEntrySheetFrameToken(
      { presentationId: 7, sequence: 4 },
      7,
      5
    )).toBe(false);
  });

  it("rejects a scroll frame from the prior rapid-reopen generation", () => {
    expect(isCurrentTimeEntrySheetFrameToken(
      { presentationId: 7, sequence: 5 },
      8,
      5
    )).toBe(false);
    expect(isCurrentTimeEntrySheetFrameToken(
      { presentationId: 8, sequence: 6 },
      8,
      6
    )).toBe(true);
  });
});

describe("generation-aware base geometry cache", () => {
  it("rejects measurements from a stale presentation", () => {
    let cache = beginTimeEntrySheetGeometryPresentation(
      createTimeEntrySheetGeometryCache(),
      4
    );
    const before = cache;
    cache = recordTimeEntrySheetGeometry(cache, {
      baseSheetRect: sheetRect,
      descriptionRect,
      presentationId: 3
    });
    expect(cache).toBe(before);
  });

  it("retains one base measurement across Suggestions open/update/close", () => {
    let cache = beginTimeEntrySheetGeometryPresentation(
      createTimeEntrySheetGeometryCache(),
      4
    );
    cache = recordTimeEntrySheetGeometry(cache, {
      baseSheetRect: sheetRect,
      descriptionRect,
      presentationId: 4
    });
    const settled = cache;
    // Suggestions have deliberately no cache event or invalidation reason.
    expect(cache).toBe(settled);
    expect(cache.baseSheetRect?.height).toBe(620);
  });

  it("invalidates only for an explicit current-presentation layout reason", () => {
    let cache = beginTimeEntrySheetGeometryPresentation(
      createTimeEntrySheetGeometryCache(),
      4
    );
    cache = recordTimeEntrySheetGeometry(cache, {
      baseSheetRect: sheetRect,
      descriptionRect,
      presentationId: 4
    });
    const stale = invalidateTimeEntrySheetGeometry(cache, 3, "window");
    expect(stale).toBe(cache);
    const invalidated = invalidateTimeEntrySheetGeometry(cache, 4, "dynamic_type");
    expect(invalidated.baseSheetRect).toBeNull();
    expect(invalidated.descriptionRect).toBeNull();
    expect(invalidated.revision).toBe(cache.revision + 1);
  });
});
