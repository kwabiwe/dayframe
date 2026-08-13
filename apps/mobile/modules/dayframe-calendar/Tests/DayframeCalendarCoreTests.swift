import XCTest
@testable import DayframeCalendarCore

final class DayframeCalendarCoreTests: XCTestCase {
  func testEmptyStateIsCentredInTimelineAtTwoThirty() throws {
    let metrics = try XCTUnwrap(DayframeCalendarEmptyStateMath.metrics(
      availableWidth: 320,
      hourLabelWidth: 68,
      hourHeight: 72
    ))

    XCTAssertEqual(metrics.center.x, 190, accuracy: 0.001)
    XCTAssertEqual(metrics.center.y, 180, accuracy: 0.001)
    XCTAssertEqual(metrics.textWidth, 228, accuracy: 0.001)
  }

  func testEmptyStateRejectsInvalidTimelineGeometry() {
    XCTAssertNil(DayframeCalendarEmptyStateMath.metrics(
      availableWidth: 68,
      hourLabelWidth: 68,
      hourHeight: 72
    ))
    XCTAssertNil(DayframeCalendarEmptyStateMath.metrics(
      availableWidth: 320,
      hourLabelWidth: 68,
      hourHeight: 0
    ))
  }

  func testHourHeightClampsAtMinimumAndMaximum() {
    XCTAssertEqual(DayframeCalendarZoomMath.clampHourHeight(12), 48)
    XCTAssertEqual(DayframeCalendarZoomMath.clampHourHeight(90), 90)
    XCTAssertEqual(DayframeCalendarZoomMath.clampHourHeight(300), 128)
  }

  func testPinchKeepsLogicalMinuteUnderStationaryMidpoint() {
    let start = DayframeCalendarPinchStart(contentOffsetY: 400, hourHeight: 72, midpointY: 220)
    let updated = DayframeCalendarZoomMath.update(
      start: start,
      absoluteScale: 1.5,
      currentMidpointY: 220,
      viewportHeight: 700
    )

    XCTAssertEqual(updated.hourHeight, 108)
    XCTAssertEqual(updated.contentOffsetY, 710, accuracy: 0.001)
  }

  func testPinchTracksMovingMidpointUsingAbsoluteScale() {
    let start = DayframeCalendarPinchStart(contentOffsetY: 400, hourHeight: 72, midpointY: 220)
    let moved = DayframeCalendarZoomMath.update(
      start: start,
      absoluteScale: 1.5,
      currentMidpointY: 250,
      viewportHeight: 700
    )
    let sameAbsoluteScale = DayframeCalendarZoomMath.update(
      start: start,
      absoluteScale: 1.5,
      currentMidpointY: 250,
      viewportHeight: 700
    )

    XCTAssertEqual(moved.contentOffsetY, 680, accuracy: 0.001)
    XCTAssertEqual(sameAbsoluteScale, moved)
  }

  func testPinchClampsTopAndBottomContentOffsets() {
    let topStart = DayframeCalendarPinchStart(contentOffsetY: 0, hourHeight: 72, midpointY: 30)
    let top = DayframeCalendarZoomMath.update(
      start: topStart,
      absoluteScale: 0.1,
      currentMidpointY: 300,
      viewportHeight: 700
    )
    XCTAssertEqual(top.contentOffsetY, 0)

    let bottomStart = DayframeCalendarPinchStart(contentOffsetY: 1_000, hourHeight: 72, midpointY: 650)
    let bottom = DayframeCalendarZoomMath.update(
      start: bottomStart,
      absoluteScale: 4,
      currentMidpointY: 20,
      viewportHeight: 700
    )
    XCTAssertEqual(bottom.hourHeight, 128)
    XCTAssertEqual(bottom.contentOffsetY, 2_372, accuracy: 0.001)
  }

  func testGestureEndDoesNotNormalizeCommittedGeometry() {
    let committed = DayframeCalendarZoomState(contentOffsetY: 642.5, hourHeight: 103.25)
    XCTAssertEqual(DayframeCalendarZoomMath.end(committed), committed)
  }

  func testNowModelAndDayUpdatesPreserveUsefulInteractionState() {
    let state = DayframeCalendarInteractionState(
      zoom: DayframeCalendarZoomState(contentOffsetY: 640, hourHeight: 96)
    )

    XCTAssertEqual(state.preservingState(for: .nowChanged, viewportHeight: 700), state)
    XCTAssertEqual(state.preservingState(for: .modelChanged, viewportHeight: 700), state)
    XCTAssertEqual(state.preservingState(for: .dayChanged, viewportHeight: 700), state)
  }

  func testCrossMidnightBlocksClipAndExposeContinuationEdges() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = try milliseconds("2026-07-11T00:00:00Z")

    let fromPrevious = DayframeCalendarBlockMath.metrics(
      startedAtMs: try milliseconds("2026-07-09T22:30:00Z"),
      stoppedAtMs: try milliseconds("2026-07-10T06:45:00Z"),
      nowMs: dayEnd,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      hourHeight: 72,
      calendar: calendar
    )
    XCTAssertEqual(fromPrevious?.top, 0)
    XCTAssertEqual(fromPrevious?.height, 486)
    XCTAssertEqual(fromPrevious?.startsBeforeDay, true)
    XCTAssertEqual(fromPrevious?.continuesIntoNextDay, false)

    let intoNext = DayframeCalendarBlockMath.metrics(
      startedAtMs: try milliseconds("2026-07-10T21:30:00Z"),
      stoppedAtMs: try milliseconds("2026-07-11T05:45:00Z"),
      nowMs: dayEnd,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      hourHeight: 72,
      calendar: calendar
    )
    XCTAssertEqual(intoNext?.top, 1_548)
    XCTAssertEqual(intoNext?.height, 180)
    XCTAssertEqual(intoNext?.startsBeforeDay, false)
    XCTAssertEqual(intoNext?.continuesIntoNextDay, true)
  }

  func testCompactAndTinyPresentationThresholdsStayNative() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = try milliseconds("2026-07-11T00:00:00Z")
    let tiny = DayframeCalendarBlockMath.metrics(
      startedAtMs: try milliseconds("2026-07-10T09:00:00Z"),
      stoppedAtMs: try milliseconds("2026-07-10T09:01:00Z"),
      nowMs: dayEnd,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      hourHeight: 72,
      calendar: calendar
    )

    XCTAssertEqual(tiny?.height, 4)
    XCTAssertEqual(tiny?.tiny, true)
    XCTAssertEqual(tiny?.compact, true)
    XCTAssertEqual(tiny?.showTitle, false)
    XCTAssertEqual(tiny?.showMeta, false)
  }

  func testVisualGeometryAddsOnePointGapWithoutChangingSemanticHeight() {
    let visual = DayframeCalendarBlockVisualMath.metrics(
      semanticHeight: 72,
      continuesIntoNextDay: false
    )

    XCTAssertEqual(visual.cornerRadius, 8)
    XCTAssertEqual(visual.semanticHeight, 72)
    XCTAssertEqual(visual.visualHeight, 71)
    XCTAssertEqual(visual.visualGap, 1)
  }

  func testNormalShortAndTinyBlocksShareOneNominalRadius() {
    let heights = [72.0, 18.0, DayframeCalendarConstants.minimumVisibleBlockHeight]
    let metrics = heights.map {
      DayframeCalendarBlockVisualMath.metrics(
        semanticHeight: $0,
        continuesIntoNextDay: false
      )
    }

    XCTAssertEqual(metrics.map(\.cornerRadius), [8, 8, 8])
    XCTAssertEqual(metrics.last?.visualHeight, 3)
    XCTAssertEqual(metrics.last?.visualGap, 1)
  }

  func testContinuationIntoNextDayKeepsFullVisualHeightAtDayBoundary() {
    let visual = DayframeCalendarBlockVisualMath.metrics(
      semanticHeight: 180,
      continuesIntoNextDay: true
    )

    XCTAssertEqual(visual.semanticHeight, 180)
    XCTAssertEqual(visual.visualHeight, 180)
    XCTAssertEqual(visual.visualGap, 0)
  }

  func testVisualGeometryClampsMalformedDirectHeightsSafely() {
    for height in [Double.nan, -Double.infinity, -20, 0] {
      let visual = DayframeCalendarBlockVisualMath.metrics(
        semanticHeight: height,
        continuesIntoNextDay: false
      )
      XCTAssertEqual(visual.semanticHeight, 1)
      XCTAssertEqual(visual.visualHeight, 1)
      XCTAssertEqual(visual.visualGap, 0)
    }
  }

  func testVisualGapDoesNotChangeSemanticTextThresholds() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = try milliseconds("2026-07-11T00:00:00Z")
    let semantic = try XCTUnwrap(DayframeCalendarBlockMath.metrics(
      startedAtMs: try milliseconds("2026-07-10T09:00:00Z"),
      stoppedAtMs: try milliseconds("2026-07-10T09:20:00Z"),
      nowMs: dayEnd,
      dayStartMs: dayStart,
      dayEndMs: dayEnd,
      hourHeight: 72,
      calendar: calendar
    ))
    let visual = DayframeCalendarBlockVisualMath.metrics(
      semanticHeight: semantic.height,
      continuesIntoNextDay: semantic.continuesIntoNextDay
    )

    XCTAssertEqual(semantic.height, DayframeCalendarConstants.titleMinimumHeight)
    XCTAssertTrue(semantic.showTitle)
    XCTAssertFalse(semantic.showMeta)
    XCTAssertEqual(visual.visualHeight, semantic.height - 1)
  }

  func testStableCallbackTargetsKeepSemanticIDs() {
    XCTAssertEqual(
      DayframeCalendarActionTarget(id: "entry-123", kind: .completed),
      DayframeCalendarActionTarget(id: "entry-123", kind: .completed)
    )
    XCTAssertNotEqual(
      DayframeCalendarActionTarget(id: "entry-123", kind: .completed),
      DayframeCalendarActionTarget(id: "review-123", kind: .review)
    )
  }

  func testHorizontalLayoutPreservesContainedOverlayGeometryAndHitTesting() {
    let base = DayframeCalendarHorizontalMath.metrics(
      availableWidth: 300,
      offsetFraction: 0,
      widthFraction: 1,
      semanticHeight: 120,
      overlapCount: 1,
      textDensity: "full"
    )
    let overlay = DayframeCalendarHorizontalMath.metrics(
      availableWidth: 300,
      offsetFraction: 0.14,
      widthFraction: 0.86,
      semanticHeight: 24,
      overlapCount: 1,
      textDensity: "title"
    )

    XCTAssertEqual(base.offset, 0)
    XCTAssertEqual(base.width, 300)
    XCTAssertEqual(overlay.offset, 42, accuracy: 0.001)
    XCTAssertEqual(overlay.width, 258, accuracy: 0.001)
    XCTAssertEqual(overlay.hitHeight, 24)
    XCTAssertTrue(overlay.showTitle)
    XCTAssertFalse(overlay.showMeta)
  }

  func testDenseNarrowLanesHideTextAndDoNotStealAdjacentTaps() {
    let dense = DayframeCalendarHorizontalMath.metrics(
      availableWidth: 180,
      offsetFraction: 2.0 / 3.0,
      widthFraction: 1.0 / 3.0,
      semanticHeight: 12,
      overlapCount: 2,
      textDensity: "none"
    )
    XCTAssertEqual(dense.offset, 120, accuracy: 0.001)
    XCTAssertEqual(dense.width, 60, accuracy: 0.001)
    XCTAssertEqual(dense.hitHeight, 12)
    XCTAssertFalse(dense.showTitle)
    XCTAssertFalse(dense.showMeta)
  }

  func testIsolatedShortBlocksRetainMinimumTouchHeight() {
    let isolated = DayframeCalendarHorizontalMath.metrics(
      availableWidth: 180,
      offsetFraction: 0,
      widthFraction: 1,
      semanticHeight: 8,
      overlapCount: 0,
      textDensity: "full"
    )
    XCTAssertEqual(isolated.hitHeight, 44)
  }

  func testIsolatedShortHitTargetDoesNotMoveVisibleTimeSlot() {
    let vertical = DayframeCalendarVerticalMath.metrics(
      semanticTop: 180,
      semanticHeight: 8,
      hitHeight: 44
    )
    let reconstructedVisualTop = vertical.hitCenterY
      - vertical.hitHeight / 2
      + vertical.visualOffsetWithinHitTarget

    XCTAssertEqual(vertical.hitHeight, 44)
    XCTAssertEqual(vertical.hitCenterY, 184)
    XCTAssertEqual(vertical.visualOffsetWithinHitTarget, 18)
    XCTAssertEqual(reconstructedVisualTop, 180)
  }

  func testTinyAdjacentSlotsKeepExactBoundaryAndOnePointPaintGap() {
    let first = DayframeCalendarVerticalMath.metrics(
      semanticTop: 100,
      semanticHeight: 4,
      hitHeight: 44
    )
    let second = DayframeCalendarVerticalMath.metrics(
      semanticTop: 104,
      semanticHeight: 8,
      hitHeight: 44
    )
    let firstVisual = DayframeCalendarBlockVisualMath.metrics(
      semanticHeight: 4,
      continuesIntoNextDay: false
    )
    let firstRenderedTop = first.hitCenterY
      - first.hitHeight / 2
      + first.visualOffsetWithinHitTarget
    let secondRenderedTop = second.hitCenterY
      - second.hitHeight / 2
      + second.visualOffsetWithinHitTarget

    XCTAssertEqual(firstRenderedTop, 100)
    XCTAssertEqual(secondRenderedTop, 104)
    XCTAssertEqual(firstRenderedTop + 4, secondRenderedTop)
    XCTAssertEqual(secondRenderedTop - (firstRenderedTop + firstVisual.visualHeight), 1)
  }

  func testOverlappingShortBlockKeepsSemanticHitAndVisualGeometryAligned() {
    let vertical = DayframeCalendarVerticalMath.metrics(
      semanticTop: 240,
      semanticHeight: 8,
      hitHeight: 8
    )
    let reconstructedVisualTop = vertical.hitCenterY
      - vertical.hitHeight / 2
      + vertical.visualOffsetWithinHitTarget

    XCTAssertEqual(vertical.hitHeight, 8)
    XCTAssertEqual(vertical.hitCenterY, 244)
    XCTAssertEqual(vertical.visualOffsetWithinHitTarget, 0)
    XCTAssertEqual(reconstructedVisualTop, 240)
  }

  func testVisualShrinkDoesNotDriveHitHeightMath() {
    let visual = DayframeCalendarBlockVisualMath.metrics(
      semanticHeight: 8,
      continuesIntoNextDay: false
    )
    let isolated = DayframeCalendarHorizontalMath.metrics(
      availableWidth: 180,
      offsetFraction: 0,
      widthFraction: 1,
      semanticHeight: visual.semanticHeight,
      overlapCount: 0,
      textDensity: "full"
    )
    let overlapping = DayframeCalendarHorizontalMath.metrics(
      availableWidth: 180,
      offsetFraction: 0,
      widthFraction: 0.5,
      semanticHeight: visual.semanticHeight,
      overlapCount: 1,
      textDensity: "title"
    )

    XCTAssertEqual(visual.visualHeight, 7)
    XCTAssertEqual(isolated.hitHeight, 44)
    XCTAssertEqual(overlapping.hitHeight, 8)
  }

  func testLongPressSlotFloorsToContainingQuarterHour() {
    let hourHeight = 72.0

    XCTAssertEqual(slot(minute: 0, hourHeight: hourHeight), 0)
    XCTAssertEqual(slot(minute: 600, hourHeight: hourHeight), 600)
    XCTAssertEqual(slot(minute: 607, hourHeight: hourHeight), 600)
    XCTAssertEqual(slot(minute: 614, hourHeight: hourHeight), 600)
    XCTAssertEqual(slot(minute: 615, hourHeight: hourHeight), 615)
    XCTAssertEqual(slot(minute: 629.99, hourHeight: hourHeight), 615)
  }

  func testLongPressSlotClampsBottomAndRejectsInvalidInputs() {
    XCTAssertEqual(
      DayframeCalendarLongPressMath.slot(contentY: 24 * 72, hourHeight: 72)?.startMinute,
      1_425
    )
    XCTAssertNil(DayframeCalendarLongPressMath.slot(contentY: -0.1, hourHeight: 72))
    XCTAssertNil(DayframeCalendarLongPressMath.slot(contentY: .nan, hourHeight: 72))
    XCTAssertNil(DayframeCalendarLongPressMath.slot(contentY: 100, hourHeight: .infinity))
    XCTAssertNil(DayframeCalendarLongPressMath.slot(contentY: 100, hourHeight: 0))
  }

  func testLongPressSlotIsStableAcrossZoomLevelsAndScrolledContentCoordinates() {
    for hourHeight in [
      DayframeCalendarConstants.minimumHourHeight,
      DayframeCalendarConstants.defaultHourHeight,
      DayframeCalendarConstants.maximumHourHeight
    ] {
      XCTAssertEqual(slot(minute: 607, hourHeight: hourHeight), 600)
    }

    let contentOffsetY = 9 * 72.0
    let viewportPointY = 67.0 / 60.0 * 72.0
    XCTAssertEqual(
      DayframeCalendarLongPressMath.slot(
        contentY: contentOffsetY + viewportPointY,
        hourHeight: 72
      )?.startMinute,
      600
    )
  }

  func testLongPressTimelineRejectsHourAxisAndOutsideOrInvalidLayout() {
    let valid = DayframeCalendarPoint(x: 120, y: 600)
    XCTAssertTrue(DayframeCalendarLongPressMath.pointIsInTimeline(
      point: valid,
      availableWidth: 320,
      hourLabelWidth: 68,
      hourHeight: 72
    ))
    for point in [
      DayframeCalendarPoint(x: 68, y: 600),
      DayframeCalendarPoint(x: -1, y: 600),
      DayframeCalendarPoint(x: 321, y: 600),
      DayframeCalendarPoint(x: 120, y: -1),
      DayframeCalendarPoint(x: 120, y: 24 * 72 + 0.1)
    ] {
      XCTAssertFalse(DayframeCalendarLongPressMath.pointIsInTimeline(
        point: point,
        availableWidth: 320,
        hourLabelWidth: 68,
        hourHeight: 72
      ))
    }
    XCTAssertFalse(DayframeCalendarLongPressMath.pointIsInTimeline(
      point: valid,
      availableWidth: 68,
      hourLabelWidth: 68,
      hourHeight: 72
    ))
  }

  func testLongPressHitFramesUseTallSemanticButtonGeometry() throws {
    let geometry = try XCTUnwrap(entryGeometry(
      semanticTop: 180,
      semanticHeight: 90,
      overlapCount: 0
    ))
    XCTAssertEqual(geometry.hitFrame.minY, 180)
    XCTAssertEqual(geometry.hitFrame.maxY, 270)
    XCTAssertTrue(DayframeCalendarLongPressMath.pointHitsEntry(
      point: DayframeCalendarPoint(x: 100, y: 225),
      frames: [geometry.hitFrame]
    ))
  }

  func testLongPressHitFramesProtectIsolatedShortTargetAndVisualGap() throws {
    let short = try XCTUnwrap(entryGeometry(
      semanticTop: 100,
      semanticHeight: 4,
      overlapCount: 0
    ))
    XCTAssertEqual(short.vertical.hitHeight, 44)
    XCTAssertEqual(short.hitFrame.minY, 80)
    XCTAssertEqual(short.hitFrame.maxY, 124)
    XCTAssertTrue(DayframeCalendarLongPressMath.pointHitsEntry(
      point: DayframeCalendarPoint(x: 100, y: 103.5),
      frames: [short.hitFrame]
    ))
  }

  func testLongPressHitFramesPreserveOverlapLaneOwnership() throws {
    let left = try XCTUnwrap(entryGeometry(
      semanticTop: 300,
      semanticHeight: 60,
      offsetFraction: 0,
      widthFraction: 1.0 / 3.0,
      overlapCount: 2
    ))
    let right = try XCTUnwrap(entryGeometry(
      semanticTop: 300,
      semanticHeight: 60,
      offsetFraction: 2.0 / 3.0,
      widthFraction: 1.0 / 3.0,
      overlapCount: 2
    ))
    let occupied = DayframeCalendarPoint(
      x: (left.hitFrame.minX + left.hitFrame.maxX) / 2,
      y: 330
    )
    let emptyLane = DayframeCalendarPoint(
      x: (left.hitFrame.maxX + right.hitFrame.minX) / 2,
      y: 330
    )

    XCTAssertTrue(DayframeCalendarLongPressMath.pointHitsEntry(
      point: occupied,
      frames: [left.hitFrame, right.hitFrame]
    ))
    XCTAssertFalse(DayframeCalendarLongPressMath.pointHitsEntry(
      point: emptyLane,
      frames: [left.hitFrame, right.hitFrame]
    ))
  }

  func testLongPressHitFramesCoverContainedAndContinuationEntries() throws {
    let base = try XCTUnwrap(entryGeometry(
      semanticTop: 400,
      semanticHeight: 180,
      overlapCount: 1
    ))
    let contained = try XCTUnwrap(entryGeometry(
      semanticTop: 430,
      semanticHeight: 30,
      offsetFraction: 0.14,
      widthFraction: 0.86,
      overlapCount: 1
    ))
    let continuation = try XCTUnwrap(entryGeometry(
      semanticTop: 1_680,
      semanticHeight: 48,
      overlapCount: 0
    ))

    XCTAssertTrue(DayframeCalendarLongPressMath.pointHitsEntry(
      point: DayframeCalendarPoint(x: contained.hitFrame.maxX - 1, y: 445),
      frames: [base.hitFrame, contained.hitFrame]
    ))
    XCTAssertTrue(DayframeCalendarLongPressMath.pointHitsEntry(
      point: DayframeCalendarPoint(x: 100, y: 1_727),
      frames: [continuation.hitFrame]
    ))
  }

  func testLongPressPointHitRejectsNonFinitePoint() throws {
    let geometry = try XCTUnwrap(entryGeometry(
      semanticTop: 100,
      semanticHeight: 60,
      overlapCount: 0
    ))
    XCTAssertFalse(DayframeCalendarLongPressMath.pointHitsEntry(
      point: DayframeCalendarPoint(x: .nan, y: 120),
      frames: [geometry.hitFrame]
    ))
  }

  func testCreationDragCapturesInitialGrabOffsetWithoutJumping() {
    let transition = DayframeCalendarCreationDragReducer.reduce(
      state: DayframeCalendarCreationDragState(),
      event: .began(
        dayKey: "2026-08-04",
        contentY: 607.0 / 60 * 72,
        hourHeight: 72
      )
    )

    XCTAssertEqual(transition.previewStartMinute, 600)
    XCTAssertEqual(transition.state.session?.initialStartMinute, 600)
    XCTAssertEqual(transition.state.session?.currentStartMinute, 600)
    XCTAssertEqual(transition.state.session?.grabOffsetMinutes ?? -1, 7, accuracy: 0.001)
    XCTAssertNil(transition.request)
    XCTAssertFalse(transition.shouldClearPreview)
    XCTAssertTrue(transition.shouldTriggerHaptic)
  }

  func testCreationDragMovesUpDownAndAcrossMultipleQuarterHours() throws {
    let began = DayframeCalendarCreationDragReducer.reduce(
      state: DayframeCalendarCreationDragState(),
      event: .began(
        dayKey: "2026-08-04",
        contentY: 607.0 / 60 * 72,
        hourHeight: 72
      )
    )
    let up = DayframeCalendarCreationDragReducer.reduce(
      state: began.state,
      event: .changed(contentY: 592.0 / 60 * 72, hourHeight: 72)
    )
    let down = DayframeCalendarCreationDragReducer.reduce(
      state: began.state,
      event: .changed(contentY: 622.0 / 60 * 72, hourHeight: 72)
    )
    let several = DayframeCalendarCreationDragReducer.reduce(
      state: began.state,
      event: .changed(contentY: 682.0 / 60 * 72, hourHeight: 72)
    )

    XCTAssertEqual(up.previewStartMinute, 585)
    XCTAssertEqual(down.previewStartMinute, 615)
    XCTAssertEqual(several.previewStartMinute, 675)
    XCTAssertEqual(up.state.session?.grabOffsetMinutes, began.state.session?.grabOffsetMinutes)
  }

  func testCreationDragDoesNothingAndDoesNotHapticWithinSameSlot() {
    let began = DayframeCalendarCreationDragReducer.reduce(
      state: DayframeCalendarCreationDragState(),
      event: .began(
        dayKey: "2026-08-04",
        contentY: 607.0 / 60 * 72,
        hourHeight: 72
      )
    )
    let unchanged = DayframeCalendarCreationDragReducer.reduce(
      state: began.state,
      event: .changed(contentY: 610.0 / 60 * 72, hourHeight: 72)
    )

    XCTAssertEqual(unchanged.state, began.state)
    XCTAssertNil(unchanged.previewStartMinute)
    XCTAssertFalse(unchanged.shouldTriggerHaptic)
  }

  func testCreationDragClampsAtStartAndLastQuarterHour() {
    XCTAssertEqual(
      DayframeCalendarCreationDragMath.startMinute(
        contentY: -200,
        hourHeight: 72,
        grabOffsetMinutes: 7
      ),
      0
    )
    XCTAssertEqual(
      DayframeCalendarCreationDragMath.startMinute(
        contentY: 10_000,
        hourHeight: 72,
        grabOffsetMinutes: 7
      ),
      1_425
    )
  }

  func testCreationDragIsEquivalentAtMinimumDefaultMaximumZoom() {
    for hourHeight in [
      DayframeCalendarConstants.minimumHourHeight,
      DayframeCalendarConstants.defaultHourHeight,
      DayframeCalendarConstants.maximumHourHeight
    ] {
      let offset = DayframeCalendarCreationDragMath.grabOffsetMinutes(
        contentY: 607.0 / 60 * hourHeight,
        hourHeight: hourHeight,
        startMinute: 600
      )
      XCTAssertEqual(offset ?? -1, 7, accuracy: 0.001)
      XCTAssertEqual(
        DayframeCalendarCreationDragMath.startMinute(
          contentY: 637.0 / 60 * hourHeight,
          hourHeight: hourHeight,
          grabOffsetMinutes: offset ?? 0
        ),
        630
      )
    }
  }

  func testCreationDragUsesScrolledContentCoordinatesAndRejectsInvalidInput() {
    let contentY = DayframeCalendarEdgeAutoscrollMath.contentY(
      viewportY: 67.0 / 60 * 72,
      contentOffsetY: 9 * 72
    )
    XCTAssertEqual(
      DayframeCalendarCreationDragMath.startMinute(
        contentY: contentY ?? -1,
        hourHeight: 72,
        grabOffsetMinutes: 7
      ),
      600
    )
    XCTAssertNil(DayframeCalendarCreationDragMath.startMinute(
      contentY: .nan,
      hourHeight: 72,
      grabOffsetMinutes: 0
    ))
    XCTAssertNil(DayframeCalendarCreationDragMath.startMinute(
      contentY: 100,
      hourHeight: 0,
      grabOffsetMinutes: 0
    ))
    XCTAssertNil(DayframeCalendarCreationDragMath.startMinute(
      contentY: 100,
      hourHeight: 72,
      grabOffsetMinutes: .infinity
    ))
    XCTAssertNil(DayframeCalendarEdgeAutoscrollMath.contentY(
      viewportY: .nan,
      contentOffsetY: 100
    ))
  }

  func testCreationPreviewKeepsThirtyMinutesAndClipsAcrossMidnight() throws {
    for hourHeight in [48.0, 72.0, 128.0] {
      let ordinary = try XCTUnwrap(DayframeCalendarCreationPreviewMath.geometry(
        startMinute: 600,
        hourHeight: hourHeight
      ))
      XCTAssertEqual(ordinary.top, 10 * hourHeight)
      XCTAssertEqual(ordinary.semanticHeight, 0.5 * hourHeight)
      XCTAssertEqual(ordinary.visibleHeight, ordinary.semanticHeight)
      XCTAssertFalse(ordinary.continuesIntoNextDay)
    }

    let midnight = try XCTUnwrap(DayframeCalendarCreationPreviewMath.geometry(
      startMinute: 1_425,
      hourHeight: 72
    ))
    XCTAssertEqual(midnight.top, 23.75 * 72)
    XCTAssertEqual(midnight.semanticHeight, 36)
    XCTAssertEqual(midnight.visibleHeight, 18)
    XCTAssertTrue(midnight.continuesIntoNextDay)
    XCTAssertEqual(
      DayframeCalendarBlockVisualMath.metrics(
        semanticHeight: midnight.semanticHeight,
        continuesIntoNextDay: midnight.continuesIntoNextDay
      ).visualGap,
      0
    )
  }

  func testCreationDragReducerEmitsOnlyOnceAtEndAndClearsPreview() {
    let began = DayframeCalendarCreationDragReducer.reduce(
      state: DayframeCalendarCreationDragState(),
      event: .began(
        dayKey: "2026-08-04",
        contentY: 607.0 / 60 * 72,
        hourHeight: 72
      )
    )
    let moved = DayframeCalendarCreationDragReducer.reduce(
      state: began.state,
      event: .changed(contentY: 637.0 / 60 * 72, hourHeight: 72)
    )
    let ended = DayframeCalendarCreationDragReducer.reduce(
      state: moved.state,
      event: .ended
    )
    let endedAgain = DayframeCalendarCreationDragReducer.reduce(
      state: ended.state,
      event: .ended
    )

    XCTAssertNil(began.request)
    XCTAssertNil(moved.request)
    XCTAssertEqual(
      ended.request,
      DayframeCalendarCreateRequest(dayKey: "2026-08-04", startMinute: 630)
    )
    XCTAssertTrue(ended.shouldClearPreview)
    XCTAssertNil(ended.state.session)
    XCTAssertNil(endedAgain.request)
    XCTAssertFalse(endedAgain.shouldClearPreview)
  }

  func testCreationDragReducerCancelsWithoutRequest() {
    let began = DayframeCalendarCreationDragReducer.reduce(
      state: DayframeCalendarCreationDragState(),
      event: .began(
        dayKey: "2026-08-04",
        contentY: 607.0 / 60 * 72,
        hourHeight: 72
      )
    )
    let cancelled = DayframeCalendarCreationDragReducer.reduce(
      state: began.state,
      event: .cancelled
    )

    XCTAssertNil(cancelled.request)
    XCTAssertTrue(cancelled.shouldClearPreview)
    XCTAssertNil(cancelled.state.session)
  }

  func testEdgeAutoscrollZonesDirectionDepthAndNoScrollArea() throws {
    XCTAssertEqual(
      try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.velocity(
        viewportY: 350,
        viewportHeight: 700
      )),
      0
    )
    let shallowUp = try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.velocity(
      viewportY: 39,
      viewportHeight: 700
    ))
    let deepUp = try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.velocity(
      viewportY: 0,
      viewportHeight: 700
    ))
    let shallowDown = try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.velocity(
      viewportY: 661,
      viewportHeight: 700
    ))
    let deepDown = try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.velocity(
      viewportY: 700,
      viewportHeight: 700
    ))

    XCTAssertLessThan(shallowUp, 0)
    XCTAssertLessThan(deepUp, shallowUp)
    XCTAssertGreaterThan(shallowDown, 0)
    XCTAssertGreaterThan(deepDown, shallowDown)
    XCTAssertEqual(deepUp, -DayframeCalendarConstants.edgeAutoscrollMaximumSpeed)
    XCTAssertEqual(deepDown, DayframeCalendarConstants.edgeAutoscrollMaximumSpeed)
  }

  func testEdgeAutoscrollClampsDayBoundariesAndRecalculatesSlot() throws {
    XCTAssertEqual(
      DayframeCalendarEdgeAutoscrollMath.nextContentOffset(
        currentOffset: 0,
        velocity: -420,
        deltaTime: 1,
        hourHeight: 72,
        viewportHeight: 700
      ),
      0
    )
    XCTAssertEqual(
      DayframeCalendarEdgeAutoscrollMath.nextContentOffset(
        currentOffset: 1_028,
        velocity: 420,
        deltaTime: 1,
        hourHeight: 72,
        viewportHeight: 700
      ),
      1_028
    )

    let beforeY = try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.contentY(
      viewportY: 120,
      contentOffsetY: 600
    ))
    let afterOffset = try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.nextContentOffset(
      currentOffset: 600,
      velocity: 360,
      deltaTime: 0.05,
      hourHeight: 72,
      viewportHeight: 700
    ))
    let afterY = try XCTUnwrap(DayframeCalendarEdgeAutoscrollMath.contentY(
      viewportY: 120,
      contentOffsetY: afterOffset
    ))
    XCTAssertEqual(
      DayframeCalendarCreationDragMath.startMinute(
        contentY: beforeY,
        hourHeight: 72,
        grabOffsetMinutes: 0
      ),
      600
    )
    XCTAssertEqual(
      DayframeCalendarCreationDragMath.startMinute(
        contentY: afterY,
        hourHeight: 72,
        grabOffsetMinutes: 0
      ),
      615
    )
  }

  func testSerializedModelDecodesInitialAndLaterRevisions() throws {
    let initial = try decodePresentation(
      selectedDayKey: "2026-07-19",
      nowMs: 1_000,
      entriesJSON: "[]"
    )
    let later = try decodePresentation(
      selectedDayKey: "2026-07-20",
      nowMs: 2_000,
      entriesJSON: """
      [{
        "actionId":"entry-1","actionKind":"active","accessibilityLabel":"Edit running timer: Planning",
        "color":"#FF6248","continuesIntoNextDay":false,"entryId":"entry-1","isActive":true,
        "isReview":false,"isUncategorized":false,"laneCount":2,"laneIndex":1,
        "layoutMode":"insetOverlay","meta":"11:20 – Now","offsetFraction":0.14,
        "overlapCount":1,"overlapSeconds":1800,"startedAtMs":1000,
        "startsBeforeDay":false,"stoppedAtMs":null,"tagText":"Deep work","textDensity":"title",
        "title":"Planning","widthFraction":0.86,"zIndex":2
      }]
      """
    )

    XCTAssertEqual(initial.selectedDayKey, "2026-07-19")
    XCTAssertTrue(initial.entries.isEmpty)
    XCTAssertEqual(later.selectedDayKey, "2026-07-20")
    XCTAssertEqual(later.nowMs, 2_000)
    XCTAssertEqual(later.entries.first?.entryId, "entry-1")
    XCTAssertEqual(later.entries.first?.tagText, "Deep work")
    XCTAssertEqual(later.entries.first?.layoutMode, "insetOverlay")
    XCTAssertEqual(later.entries.first?.overlapCount, 1)
  }

  private func decodePresentation(
    selectedDayKey: String,
    nowMs: Double,
    entriesJSON: String
  ) throws -> DayframeCalendarPresentationRecord {
    let json = """
    {
      "dayEndMs":86400000,"dayStartMs":0,"emptyState":"No tracked time for this day.",
      "entries":\(entriesJSON),"modelVersion":4,"nowMs":\(nowMs),"reduceMotion":false,
      "reduceTransparency":false,"refreshing":false,"selectedDayKey":"\(selectedDayKey)",
      "selectedDayTitle":"Today","theme":{"accent":"#FF6248","accentSoft":"#33201E",
      "accentText":"#FF8A76","background":"#050914","border":"#2A3345",
      "borderStrong":"#3B465B","mode":"dark","shadow":"#000000","surface":"#151B27",
      "surfaceMuted":"#202838","surfaceRaised":"#1B2230","textPrimary":"#F7F8FB",
      "textSecondary":"#8993A7","warning":"#F2BA38","warningText":"#F2BA38"},"todayKey":"2026-07-19",
      "additionalOverlapSeconds":0,"coveredLabel":"0m","coveredSeconds":0,
      "loggedLabel":"0m","loggedSeconds":0,"totalLabel":"0m",
      "totalSeconds":0,"transitionDirection":1,"weekDays":[]
    }
    """
    return try JSONDecoder().decode(
      DayframeCalendarPresentationRecord.self,
      from: try XCTUnwrap(json.data(using: .utf8))
    )
  }

  private func milliseconds(_ value: String) throws -> Double {
    let formatter = ISO8601DateFormatter()
    let date = try XCTUnwrap(formatter.date(from: value))
    return date.timeIntervalSince1970 * 1_000
  }

  private func slot(minute: Double, hourHeight: Double) -> Int? {
    DayframeCalendarLongPressMath.slot(
      contentY: minute / 60 * hourHeight,
      hourHeight: hourHeight
    )?.startMinute
  }

  private func entryGeometry(
    semanticTop: Double,
    semanticHeight: Double,
    offsetFraction: Double = 0,
    widthFraction: Double = 1,
    overlapCount: Int
  ) -> DayframeCalendarEntryGeometryMetrics? {
    DayframeCalendarEntryGeometryMath.metrics(
      availableWidth: 320,
      hourLabelWidth: 68,
      semanticTop: semanticTop,
      semanticHeight: semanticHeight,
      offsetFraction: offsetFraction,
      widthFraction: widthFraction,
      overlapCount: overlapCount,
      textDensity: "full"
    )
  }
}
