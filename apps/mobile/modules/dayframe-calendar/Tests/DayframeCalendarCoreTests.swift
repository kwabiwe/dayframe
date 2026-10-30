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

  func testZoomButtonsStepByOnePointFourAndStopAtTheBounds() {
    XCTAssertEqual(DayframeCalendarZoomMath.buttonTarget(hourHeight: 72, direction: 1), 100.8, accuracy: 0.001)
    XCTAssertEqual(DayframeCalendarZoomMath.buttonTarget(hourHeight: 72, direction: -1), 72 / 1.4, accuracy: 0.001)
    XCTAssertEqual(DayframeCalendarZoomMath.buttonTarget(hourHeight: 120, direction: 1), 128)
    XCTAssertEqual(DayframeCalendarZoomMath.buttonTarget(hourHeight: 50, direction: -1), 48)
  }

  func testZoomButtonFramesEaseToTheTargetAroundTheViewportCentre() {
    let start = DayframeCalendarPinchStart(contentOffsetY: 400, hourHeight: 72, midpointY: 350)
    let first = DayframeCalendarZoomMath.buttonFrame(start: start, targetHourHeight: 100.8, progress: 0, viewportHeight: 700)
    let middle = DayframeCalendarZoomMath.buttonFrame(start: start, targetHourHeight: 100.8, progress: 0.5, viewportHeight: 700)
    let last = DayframeCalendarZoomMath.buttonFrame(start: start, targetHourHeight: 100.8, progress: 1, viewportHeight: 700)
    let overshoot = DayframeCalendarZoomMath.buttonFrame(start: start, targetHourHeight: 100.8, progress: 1.4, viewportHeight: 700)

    XCTAssertEqual(first.hourHeight, 72, accuracy: 0.001)
    XCTAssertEqual(first.contentOffsetY, 400, accuracy: 0.001)
    // Ease-out cubic: 87.5% of the way at half time.
    XCTAssertEqual(middle.hourHeight, 72 + 28.8 * 0.875, accuracy: 0.001)
    XCTAssertEqual(last.hourHeight, 100.8, accuracy: 0.001)
    XCTAssertEqual(overshoot, last)
    // The minute under the viewport centre stays under it.
    let centreMinute = (400.0 + 350.0) / 72.0 * 60.0
    XCTAssertEqual((last.contentOffsetY + 350) / 100.8 * 60, centreMinute, accuracy: 0.001)
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

  /// The Review lane reserves each suggestion's target as reviewTargetEnvelope in
  /// nativeCalendarPresentation.ts computes it; these are the same boundary cases (Codex r9 on #317).
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

    // Dense-day rules: one 18-point label line at least, the gap included (the mock-up's MIN_H).
    XCTAssertEqual(tiny?.height, 18)
    let label = DayframeCalendarDenseLabelMath.label(height: 16, width: 200)
    XCTAssertTrue(label.compact)
    XCTAssertEqual(label.detailLinesAvailable, 0)
    XCTAssertEqual(label.titleLines(detailCount: 3), 1)
  }

  func testVisualGeometryAddsTwoPointGapWithoutChangingSemanticHeight() {
    let visual = DayframeCalendarBlockVisualMath.metrics(
      semanticHeight: 72,
      continuesIntoNextDay: false
    )

    XCTAssertEqual(visual.cornerRadius, 5)
    XCTAssertEqual(visual.semanticHeight, 72)
    XCTAssertEqual(visual.visualHeight, 70)
    XCTAssertEqual(visual.visualGap, 2)
  }

  func testNormalShortAndTinyBlocksShareOneNominalRadius() {
    let heights = [72.0, 18.0, 4.0]
    let metrics = heights.map {
      DayframeCalendarBlockVisualMath.metrics(
        semanticHeight: $0,
        continuesIntoNextDay: false
      )
    }

    XCTAssertEqual(metrics.map(\.cornerRadius), [5, 5, 5])
    XCTAssertEqual(metrics.last?.visualHeight, 2)
    XCTAssertEqual(metrics.last?.visualGap, 2)
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

    XCTAssertEqual(semantic.height, 24)
    XCTAssertEqual(visual.visualHeight, semantic.height - 2)
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
    // Width allows words; whether the detail line shows is the block height's call (location v4 C6).
    XCTAssertTrue(overlay.showTitle)
    XCTAssertTrue(overlay.showMeta)
  }

  func testNarrowColumnsShowColourOnlyAndDoNotStealAdjacentTaps() {
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
    // 60 points wide keeps words; under 22 shows its colour only (dense-day rules).
    XCTAssertTrue(dense.showTitle)
    let narrow = DayframeCalendarHorizontalMath.metrics(
      availableWidth: 100,
      offsetFraction: 0,
      widthFraction: 0.21,
      semanticHeight: 40,
      overlapCount: 2,
      textDensity: "full"
    )
    XCTAssertFalse(narrow.showTitle)
    XCTAssertFalse(narrow.showMeta)
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

  func testMidnightHitTargetsStayInsideTheTimeline() {
    // 00:00–00:01 at 48 pt/hour: centred, the target would start 21 pt above the timeline.
    let top = DayframeCalendarVerticalMath.metrics(semanticTop: 0, semanticHeight: 0.8, hitHeight: 44, timelineHeight: 24 * 48)
    XCTAssertEqual(top.hitCenterY - top.hitHeight / 2, 0)
    XCTAssertEqual(top.visualOffsetWithinHitTarget, 0)
    // 23:59–24:00: the target ends at the bottom of the timeline, the block still at its time.
    let bottom = DayframeCalendarVerticalMath.metrics(semanticTop: 24 * 48 - 0.8, semanticHeight: 0.8, hitHeight: 44, timelineHeight: 24 * 48)
    XCTAssertEqual(bottom.hitCenterY + bottom.hitHeight / 2, 24 * 48, accuracy: 0.0001)
    XCTAssertEqual(bottom.hitCenterY - bottom.hitHeight / 2 + bottom.visualOffsetWithinHitTarget, 24 * 48 - 0.8, accuracy: 0.0001)
  }

  func testTinyAdjacentSlotsKeepExactBoundaryAndTwoPointPaintGap() {
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
    XCTAssertEqual(secondRenderedTop - (firstRenderedTop + firstVisual.visualHeight), 2)
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

    XCTAssertEqual(visual.visualHeight, 6)
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

  func testBracketRailMovesEveryLaneRightAndKeepsLanesApart() throws {
    // Location v3 PR 14b: a day with a named pattern's bracket keeps a 12-point rail left of its
    // blocks; render and long-press hit geometry share it, so the rail is empty time.
    let inset = DayframeCalendarConstants.bracketRailWidth
    let geometry = { (offsetFraction: Double, widthFraction: Double, leadingInset: Double) in
      DayframeCalendarEntryGeometryMath.metrics(
        availableWidth: 320,
        hourLabelWidth: 68,
        semanticTop: 300,
        semanticHeight: 60,
        offsetFraction: offsetFraction,
        widthFraction: widthFraction,
        overlapCount: 1,
        textDensity: "full",
        leadingInset: leadingInset
      )
    }
    let plain = try XCTUnwrap(geometry(0, 1, 0))
    let full = try XCTUnwrap(geometry(0, 1, inset))
    XCTAssertEqual(full.hitFrame.minX, plain.hitFrame.minX + inset, accuracy: 0.001)
    XCTAssertEqual(full.hitFrame.maxX, plain.hitFrame.maxX, accuracy: 0.001)

    let left = try XCTUnwrap(geometry(0, 0.5, inset))
    let right = try XCTUnwrap(geometry(0.5, 0.5, inset))
    XCTAssertEqual(left.hitFrame.maxX, right.hitFrame.minX, accuracy: 0.001)
    XCTAssertEqual(right.hitFrame.maxX, plain.hitFrame.maxX, accuracy: 0.001)

    let rail = DayframeCalendarPoint(x: 68 + 8 + inset / 2, y: 330)
    XCTAssertFalse(DayframeCalendarLongPressMath.pointHitsEntry(point: rail, frames: [left.hitFrame, right.hitFrame]))
    XCTAssertNil(geometry(0, 1, .nan))
  }

  func testBracketSpansAShortFinalPartAtItsMinimumHeight() throws {
    // Location v3 PR 14b (Codex r1 on #511): a one-minute last part is drawn one label line tall, past
    // the trip's own end; the bracket follows the part, at every zoom.
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = try milliseconds("2026-07-11T00:00:00Z")
    let parts: [(startedAtMs: Double, stoppedAtMs: Double?)] = [
      (try milliseconds("2026-07-10T09:00:00Z"), try milliseconds("2026-07-10T09:30:00Z")),
      (try milliseconds("2026-07-10T09:30:00Z"), try milliseconds("2026-07-10T09:59:00Z")),
      (try milliseconds("2026-07-10T09:59:00Z"), try milliseconds("2026-07-10T10:00:00Z"))
    ]
    for hourHeight in [48.0, 72, 128] {
      let span = try XCTUnwrap(DayframeCalendarBracketMath.span(
        parts: parts, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: hourHeight, calendar: calendar
      ))
      let last = try XCTUnwrap(DayframeCalendarBlockMath.metrics(
        startedAtMs: parts[2].startedAtMs, stoppedAtMs: parts[2].stoppedAtMs, nowMs: dayEnd,
        dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: hourHeight, calendar: calendar
      ))
      XCTAssertEqual(span.top, 9 * hourHeight, accuracy: 0.001)
      XCTAssertEqual(span.top + span.height, last.top + last.height, accuracy: 0.001)
      XCTAssertGreaterThan(span.top + span.height, 10 * hourHeight)
    }
    XCTAssertEqual(try XCTUnwrap(DayframeCalendarBracketMath.span(
      parts: parts, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 48, calendar: calendar
    )).height, 59.0 / 60 * 48 + DayframeCalendarConstants.labelLineMinimumHeight, accuracy: 0.001)
    XCTAssertNil(DayframeCalendarBracketMath.span(
      parts: [], nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 48, calendar: calendar
    ))
  }

  func testBracketSpansItsPartsWhereAClockChangeDrawsThem() throws {
    // London's fall-back day (25 Oct 2026, 25 hours): a trip 01:40 BST → 01:20 GMT. Measured as one
    // block it would be a sliver at 01:40; its parts are drawn from 01:10 to just past 01:50.
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Europe/London"))
    let dayStart = try milliseconds("2026-10-24T23:00:00Z")
    let dayEnd = try milliseconds("2026-10-26T00:00:00Z")
    let parts: [(startedAtMs: Double, stoppedAtMs: Double?)] = [
      (try milliseconds("2026-10-25T00:40:00Z"), try milliseconds("2026-10-25T00:50:00Z")),
      (try milliseconds("2026-10-25T00:50:00Z"), try milliseconds("2026-10-25T01:10:00Z")),
      (try milliseconds("2026-10-25T01:10:00Z"), try milliseconds("2026-10-25T01:20:00Z"))
    ]
    let hourHeight = 72.0
    let span = try XCTUnwrap(DayframeCalendarBracketMath.span(
      parts: parts, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: hourHeight, calendar: calendar
    ))
    let drawn = try parts.map { part in
      try XCTUnwrap(DayframeCalendarBlockMath.metrics(
        startedAtMs: part.startedAtMs, stoppedAtMs: part.stoppedAtMs, nowMs: dayEnd,
        dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: hourHeight, calendar: calendar
      ))
    }
    // 01:10 GMT is the earliest drawn top; the folded middle part is 4 points at 01:50.
    XCTAssertEqual(span.top, 70.0 / 60 * hourHeight, accuracy: 0.001)
    XCTAssertEqual(span.top + span.height, 110.0 / 60 * hourHeight + DayframeCalendarConstants.labelLineMinimumHeight, accuracy: 0.001)
    for block in drawn {
      XCTAssertLessThanOrEqual(span.top, block.top + 0.001)
      XCTAssertGreaterThanOrEqual(span.top + span.height, block.top + block.height - 0.001)
    }
    let whole = try XCTUnwrap(DayframeCalendarBlockMath.metrics(
      startedAtMs: parts[0].startedAtMs, stoppedAtMs: parts[2].stoppedAtMs, nowMs: dayEnd,
      dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: hourHeight, calendar: calendar
    ))
    XCTAssertNotEqual(whole.top, span.top, accuracy: 0.001)
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

  func testBlockAskingDecodesTolerantly() throws {
    // Location v4 design §7: a block's own "?" (the amber dot). An older model has no key: no dot.
    let entry = """
      {"actionId":"e1","actionKind":"completed","accessibilityLabel":"Open time block: Team sync, Needs a look",
       "color":"#FF6248","continuesIntoNextDay":false,"entryId":"e1","isActive":false,"isReview":false,
       "isUncategorized":false,"laneCount":1,"laneIndex":0,"layoutMode":"full","meta":"","offsetFraction":0,
       "overlapCount":0,"overlapSeconds":0,"startedAtMs":1000,"startsBeforeDay":false,"stoppedAtMs":2000,
       "textColor":"#0B1020","textDensity":"full","title":"Team sync","warningOverlapCount":0,"widthFraction":1,"zIndex":0%@}
      """
    let asking = try decodePresentation(selectedDayKey: "2026-07-20", nowMs: 2_000,
      entriesJSON: "[\(entry.replacingOccurrences(of: "%@", with: ",\"asking\":true"))]")
    let older = try decodePresentation(selectedDayKey: "2026-07-20", nowMs: 2_000,
      entriesJSON: "[\(entry.replacingOccurrences(of: "%@", with: ""))]")
    XCTAssertEqual(asking.entries.first?.asking, true)
    XCTAssertNil(older.entries.first?.asking)
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
        "startsBeforeDay":false,"stoppedAtMs":null,"tagText":"Deep work","textColor":"#0B1020","textDensity":"title",
        "title":"Planning","warningOverlapCount":1,"widthFraction":0.86,"zIndex":2
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
    XCTAssertEqual(later.entries.first?.textColor, "#0B1020")
    XCTAssertEqual(later.monthTitle, "July")
    // Card C item 1: the framed line is gone; an older bundle's extra "framedLabel" still decodes.
    XCTAssertFalse(later.hapticsEnabled)
    XCTAssertEqual(later.theme.textMuted, "#707B91")
    XCTAssertNil(later.clockFormat)
    let twelveHour = try decodePresentation(selectedDayKey: "2026-07-20", nowMs: 2_000, entriesJSON: "[]", clockFormat: "12h")
    XCTAssertEqual(twelveHour.clockFormat, "12h")
    // Named patterns (location v3 PR 14b): an older bundle sends no brackets.
    XCTAssertNil(later.brackets)
    let bracketed = try decodePresentation(
      selectedDayKey: "2026-07-20",
      nowMs: 2_000,
      entriesJSON: "[]",
      bracketsJSON: #"[{"key":"named:trip-1","memberIds":["there","back"],"name":"School run","startedAtMs":1000,"stoppedAtMs":2000}]"#
    )
    XCTAssertEqual(bracketed.brackets?.first?.name, "School run")
    XCTAssertEqual(bracketed.brackets?.first?.stoppedAtMs, 2_000)
    XCTAssertEqual(bracketed.brackets?.first?.memberIds, ["there", "back"])
  }

  func testClockTextMatchesTheSharedFormatters() {
    XCTAssertEqual(DayframeClockText.time(hour: 9, minute: 5, clockFormat: "24h"), "09:05")
    XCTAssertEqual(DayframeClockText.time(hour: 0, minute: 0, clockFormat: "12h"), "12:00 AM")
    XCTAssertEqual(DayframeClockText.time(hour: 12, minute: 30, clockFormat: "12h"), "12:30 PM")
    XCTAssertEqual(DayframeClockText.time(hour: 21, minute: 7, clockFormat: "12h"), "9:07 PM")
    XCTAssertEqual(DayframeClockText.hour(8, clockFormat: "24h"), "08:00")
    XCTAssertEqual(DayframeClockText.hour(0, clockFormat: "12h"), "12 AM")
    XCTAssertEqual(DayframeClockText.hour(12, clockFormat: "12h"), "12 PM")
    XCTAssertEqual(DayframeClockText.hour(18, clockFormat: "12h"), "6 PM")
  }

  func testNowPillHidesAnHourLabelOnlyWhereItCoversIt() {
    // #255: an 18-point pill and 8-point digits, centred on their own y, overlap within 13 points.
    XCTAssertTrue(DayframeCalendarNowPillMath.coversHourLabel(nowY: 357, labelCenterY: 360, labelGlyphHeight: 8))
    XCTAssertTrue(DayframeCalendarNowPillMath.coversHourLabel(nowY: 347.5, labelCenterY: 360, labelGlyphHeight: 8))
    XCTAssertFalse(DayframeCalendarNowPillMath.coversHourLabel(nowY: 347, labelCenterY: 360, labelGlyphHeight: 8))
    XCTAssertFalse(DayframeCalendarNowPillMath.coversHourLabel(nowY: 374, labelCenterY: 360, labelGlyphHeight: 8))
    // Larger text has taller digits, so the pill covers them from further away.
    XCTAssertTrue(DayframeCalendarNowPillMath.coversHourLabel(nowY: 345, labelCenterY: 360, labelGlyphHeight: 14))
    XCTAssertFalse(DayframeCalendarNowPillMath.coversHourLabel(nowY: .nan, labelCenterY: 360, labelGlyphHeight: 8))
  }

  private func decodePresentation(
    selectedDayKey: String,
    nowMs: Double,
    entriesJSON: String,
    clockFormat: String? = nil,
    bracketsJSON: String? = nil
  ) throws -> DayframeCalendarPresentationRecord {
    let clockField = clockFormat.map { "\"clockFormat\":\"\($0)\"," } ?? ""
    let bracketsField = bracketsJSON.map { "\"brackets\":\($0)," } ?? ""
    let json = """
    {
      \(clockField)\(bracketsField)"dayEndMs":86400000,"dayStartMs":0,"emptyState":"No tracked time for this day.",
      "entries":\(entriesJSON),"framedLabel":"Nothing framed on Sunday","hapticsEnabled":false,
      "modelVersion":4,"monthTitle":"July","nowMs":\(nowMs),"reduceMotion":false,
      "reduceTransparency":false,"refreshing":false,"selectedDayKey":"\(selectedDayKey)",
      "selectedDayTitle":"Today","theme":{"accent":"#FF6248","accentSoft":"#33201E",
      "accentText":"#FF8A76","background":"#050914","border":"#2A3345",
      "borderStrong":"#3B465B","mode":"dark","onAccent":"#050914","shadow":"#000000","surface":"#151B27",
      "surfaceMuted":"#202838","surfaceRaised":"#1B2230","textMuted":"#707B91","textPrimary":"#F7F8FB",
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

  // MARK: Calendar titles at every zoom (location v4 C6)

  private func drawn(_ blocks: [(String, Double, Double)], hourHeight: Double, minimum: Double) -> [DayframeCalendarDrawnBlock] {
    blocks.map { id, start, end in
      let top = (start - 360) / 60 * hourHeight
      return DayframeCalendarDrawnBlock(id: id, top: top, bottom: top + max(minimum, (end - start) / 60 * hourHeight))
    }
  }

  func testColumnsMatchTheSharedRuleOnTheMockupThursday() {
    let minute = { (hour: Double, minute: Double) in hour * 60 + minute }
    let thursday: [(String, Double, Double)] = [
      ("school-run", minute(8, 36), minute(8, 47)),
      ("getting-around-am", minute(8, 47), minute(10, 39)),
      ("quarterly-plan", minute(10, 45), minute(12, 30)),
      ("call-with-sam", minute(11, 30), minute(11, 45)),
      ("coffee", minute(12, 30), minute(12, 34)),
      ("team-sync", minute(13, 30), minute(14, 40)),
      ("getting-around-pm", minute(14, 40), minute(16, 26))
    ]
    let layout = Dictionary(uniqueKeysWithValues: DayframeCalendarColumnMath.layout(drawn(thursday, hourHeight: 48, minimum: 15)).map { ($0.id, $0) })
    XCTAssertEqual(layout["school-run"]?.columnIndex, 0)
    XCTAssertEqual(layout["school-run"]?.columnCount, 2)
    XCTAssertEqual(layout["getting-around-am"]?.columnIndex, 1)
    XCTAssertEqual(layout["call-with-sam"]?.columnIndex, 1)
    XCTAssertEqual(layout["quarterly-plan"]?.columnCount, 2)
    XCTAssertEqual(layout["coffee"]?.columnCount, 1)
    XCTAssertEqual(layout["team-sync"]?.columnCount, 1)
    XCTAssertEqual(layout["getting-around-pm"]?.widthFraction, 1)
  }

  func testZoomingInCanFreeAColumn() {
    let blocks: [(String, Double, Double)] = [("a", 540, 545), ("b", 550, 600)]
    XCTAssertEqual(DayframeCalendarColumnMath.layout(drawn(blocks, hourHeight: 48, minimum: 15)).map(\.columnCount), [2, 2])
    XCTAssertEqual(DayframeCalendarColumnMath.layout(drawn(blocks, hourHeight: 128, minimum: 15)).map(\.columnCount), [1, 1])
  }

  func testColumnsReuseFreedColumnsAndKeepTouchingBlocksApart() {
    let layout = Dictionary(uniqueKeysWithValues: DayframeCalendarColumnMath.layout([
      DayframeCalendarDrawnBlock(id: "long", top: 0, bottom: 300),
      DayframeCalendarDrawnBlock(id: "first", top: 10, bottom: 60),
      DayframeCalendarDrawnBlock(id: "second", top: 80, bottom: 120),
      DayframeCalendarDrawnBlock(id: "third", top: 100, bottom: 140),
      DayframeCalendarDrawnBlock(id: "after", top: 300.4, bottom: 320)
    ]).map { ($0.id, $0) })
    XCTAssertEqual(layout["first"]?.columnIndex, 1)
    XCTAssertEqual(layout["second"]?.columnIndex, 1)
    XCTAssertEqual(layout["third"]?.columnIndex, 2)
    XCTAssertEqual(layout["third"]?.columnCount, 3)
    XCTAssertEqual(layout["after"]?.columnCount, 1)
    XCTAssertEqual(layout["after"]?.zIndex, 0)
  }

  func testDayLayoutPutsBlocksAndSuggestionsInOneSetOfColumnsAndGrowsTheMinimumWithText() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = try milliseconds("2026-07-11T00:00:00Z")
    let at = { (hhmm: String) in try self.milliseconds("2026-07-10T\(hhmm):00Z") }
    let entries = [
      DayframeCalendarLayoutInput(id: "a", startedAtMs: try at("09:00"), stoppedAtMs: try at("09:04"), columnGroup: "logged", regionOffsetFraction: 0, regionWidthFraction: 1, fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0),
      DayframeCalendarLayoutInput(id: "b", startedAtMs: try at("09:20"), stoppedAtMs: try at("10:00"), columnGroup: "logged", regionOffsetFraction: 0, regionWidthFraction: 1, fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0),
      DayframeCalendarLayoutInput(id: "r", startedAtMs: try at("09:00"), stoppedAtMs: try at("09:30"), columnGroup: "review", regionOffsetFraction: 0, regionWidthFraction: 1, fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0),
      DayframeCalendarLayoutInput(id: "old", startedAtMs: try at("12:00"), stoppedAtMs: try at("13:00"), columnGroup: nil, regionOffsetFraction: 0, regionWidthFraction: 1, fallbackOffsetFraction: 0.25, fallbackWidthFraction: 0.5, fallbackZIndex: 3)
    ]
    let layout = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 48, calendar: calendar)
    // One 18-point line at least (the gap included): at 48 pt/h A reaches B (09:20), and the
    // suggestion runs to 09:30, so the three sit side by side, the suggestion in the blocks' columns.
    XCTAssertEqual(layout["a"]?.block.height, 18)
    XCTAssertEqual(layout["a"]?.offsetFraction ?? -1, 0, accuracy: 1e-9)
    XCTAssertEqual(layout["a"]?.widthFraction ?? -1, 1.0 / 3.0, accuracy: 1e-9)
    XCTAssertEqual(layout["r"]?.offsetFraction ?? -1, 1.0 / 3.0, accuracy: 1e-9)
    XCTAssertEqual(layout["b"]?.offsetFraction ?? -1, 2.0 / 3.0, accuracy: 1e-9)
    XCTAssertEqual(layout["b"]?.widthFraction ?? -1, 1.0 / 3.0, accuracy: 1e-9)
    // A model from an older bundle keeps React's fractions.
    XCTAssertEqual(layout["old"]?.offsetFraction, 0.25)
    XCTAssertEqual(layout["old"]?.zIndex, 3)
    // Larger text: a taller line, capped at 1.3 times.
    let large = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 48, textScale: 2, calendar: calendar)
    XCTAssertEqual(large["a"]?.block.height ?? 0, 23.4, accuracy: 1e-9)
    // Zoomed in, A's label ends before B: B takes A's freed column, beside the suggestion.
    let close = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 128, calendar: calendar)
    XCTAssertEqual(close["a"]?.columnCount, 2)
    XCTAssertEqual(close["b"]?.widthFraction ?? -1, 0.5, accuracy: 1e-9)
  }

  func testSixtyBlocksAtTheMostZoomedOutLayOutWithinFourMilliseconds() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = dayStart + 86_400_000
    let entries = (0..<60).map { (index: Int) -> DayframeCalendarLayoutInput in
      let start: Double = dayStart + Double(index * 13) * 60_000
      let minutes: Double = Double(5 + (index % 7) * 9)
      let isReview: Bool = index % 9 == 0
      return DayframeCalendarLayoutInput(
        id: "b\(index)",
        startedAtMs: start,
        stoppedAtMs: start + minutes * 60_000,
        columnGroup: isReview ? "review" : "logged",
        regionOffsetFraction: isReview ? 0.56 : 0,
        regionWidthFraction: isReview ? 0.44 : 1,
        fallbackOffsetFraction: 0,
        fallbackWidthFraction: 1,
        fallbackZIndex: 0
      )
    }
    _ = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 48, calendar: calendar)
    let runs = 50
    let started = Date()
    for _ in 0..<runs {
      _ = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 48, calendar: calendar)
    }
    let perLayoutMs = Date().timeIntervalSince(started) * 1000 / Double(runs)
    XCTAssertLessThan(perLayoutMs, 4, "60 blocks at 48 pt/h took \(perLayoutMs) ms")
  }

  func testARunningBlockGrowingPastItsNeighbourKeepsItsColumn() {
    func columns(_ runningBottom: Double) -> [String: Int] {
      Dictionary(uniqueKeysWithValues: DayframeCalendarColumnMath.layout([
        DayframeCalendarDrawnBlock(id: "done", top: 576, bottom: 608),
        DayframeCalendarDrawnBlock(id: "running", top: 576, bottom: runningBottom)
      ]).map { ($0.id, $0.columnIndex) })
    }
    XCTAssertEqual(columns(597), columns(610))
  }

  func testCoincidentBlocksStayLinear() {
    let blocks = (0..<4000).map { DayframeCalendarDrawnBlock(id: "c\($0)", top: 0, bottom: 20) }
    let started = Date()
    let layout = DayframeCalendarColumnMath.layout(blocks)
    XCTAssertLessThan(Date().timeIntervalSince(started), 0.5)
    XCTAssertEqual(Set(layout.map(\.columnIndex)).count, 4000)
  }

  // MARK: Native taps after location v4 C6 (Codex r1 on #548)

  private func tapsResolve(_ entries: [DayframeCalendarLayoutInput], overlapCounts: [String: Int] = [:], file: StaticString = #filePath, line: UInt = #line) throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = dayStart + 86_400_000
    for textScale in [0.8, 1.0, 1.3] {
      for hourHeight in [48.0, 72, 128] {
        let layout = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: hourHeight, textScale: textScale, calendar: calendar)
        let frames: [(id: String, z: Int, centre: DayframeCalendarPoint, frame: DayframeCalendarHitFrame)] = entries.compactMap { entry in
          guard let placed = layout[entry.id], let geometry = DayframeCalendarEntryGeometryMath.metrics(
            availableWidth: 375, hourLabelWidth: 68, semanticTop: placed.block.top, semanticHeight: placed.block.height,
            offsetFraction: placed.offsetFraction, widthFraction: placed.widthFraction,
            overlapCount: (overlapCounts[entry.id] ?? 0) + (placed.sharesTarget ? 1 : 0), textDensity: "full",
            timelineHeight: 24 * hourHeight
          ) else { return nil }
          let centre = DayframeCalendarPoint(x: (geometry.hitFrame.minX + geometry.hitFrame.maxX) / 2, y: placed.block.top + placed.block.height / 2)
          return (entry.id, placed.zIndex, centre, geometry.hitFrame)
        }
        for target in frames {
          // The topmost frame under the painted centre (higher z wins; later draws win ties).
          let hit = frames.enumerated().filter { $0.element.frame.contains(target.centre) }
            .max { ($0.element.z, $0.offset) < ($1.element.z, $1.offset) }?.element.id
          XCTAssertEqual(hit, target.id, "tap on \(target.id) at \(hourHeight) pt/h, text ×\(textScale)", file: file, line: line)
        }
      }
    }
  }

  private func input(_ id: String, _ start: String, _ stop: String, group: String, region: (Double, Double) = (0, 1)) throws -> DayframeCalendarLayoutInput {
    DayframeCalendarLayoutInput(
      id: id, startedAtMs: try milliseconds("2026-07-10T\(start):00Z"), stoppedAtMs: try milliseconds("2026-07-10T\(stop):00Z"),
      columnGroup: group, regionOffsetFraction: region.0, regionWidthFraction: region.1,
      fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0
    )
  }

  func testShortLoggedBlocksNeverTakeEachOthersTaps() throws {
    try tapsResolve([
      try input("a", "09:00", "09:01", group: "logged"),
      try input("b", "09:10", "09:11", group: "logged"),
      try input("c", "09:30", "09:31", group: "logged")
    ])
  }

  func testSuggestionsBesideEachOtherKeepTheirOwnTapsAtEveryZoom() throws {
    let whole = (0.0, 1.0)
    let entries = [
      try input("r1", "09:00", "09:01", group: "review", region: whole),
      try input("r2", "09:10", "09:11", group: "review", region: whole),
      try input("b", "09:05", "09:40", group: "logged", region: whole)
    ]
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let layout = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayStart + 86_400_000, dayStartMs: dayStart, dayEndMs: dayStart + 86_400_000, hourHeight: 48, calendar: calendar)
    // Dense-day rules: suggestions share the blocks' columns, side by side where what is drawn collides.
    XCTAssertGreaterThan(layout["r1"]?.columnCount ?? 0, 1)
    XCTAssertNotEqual(layout["r1"]?.offsetFraction, layout["b"]?.offsetFraction)
    try tapsResolve(entries)
  }

  // MARK: Codex r2 on #548

  func testAnOlderBundlesModelKeepsItsOwnGeometryAndTaps() throws {
    func legacy(_ id: String, _ start: String, _ stop: String) throws -> DayframeCalendarLayoutInput {
      DayframeCalendarLayoutInput(
        id: id, startedAtMs: try milliseconds("2026-07-10T\(start):00Z"), stoppedAtMs: try milliseconds("2026-07-10T\(stop):00Z"),
        columnGroup: nil, regionOffsetFraction: 0, regionWidthFraction: 1,
        fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0
      )
    }
    try tapsResolve([try legacy("a", "09:00", "09:01"), try legacy("b", "09:08", "09:09")])
  }

  func testFiveHundredCoincidentBlocksLayOutQuickly() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let entries = (0..<500).map { (index: Int) -> DayframeCalendarLayoutInput in
      DayframeCalendarLayoutInput(
        id: "c\(index)", startedAtMs: dayStart + 9 * 3_600_000, stoppedAtMs: dayStart + 9 * 3_600_000 + 60_000,
        columnGroup: "logged", regionOffsetFraction: 0, regionWidthFraction: 1,
        fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0
      )
    }
    let started = Date()
    _ = DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayStart + 86_400_000, dayStartMs: dayStart, dayEndMs: dayStart + 86_400_000, hourHeight: 48, calendar: calendar)
    XCTAssertLessThan(Date().timeIntervalSince(started), 0.25)
    // Calendar v3's hybrid overlap: the same crowd, and a staircase of 500 long blocks one every 2.83
    // minutes, so about 60 groups each nest inside the one before (deeper than the lane is wide).
    let staircase = (0..<500).map { (index: Int) -> DayframeCalendarLayoutInput in
      DayframeCalendarLayoutInput(
        id: "s\(index)", startedAtMs: dayStart + Double(index) * 170_000, stoppedAtMs: dayStart + 86_000_000,
        columnGroup: "logged", regionOffsetFraction: 0, regionWidthFraction: 1,
        fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0
      )
    }
    for crowd in [entries, staircase] {
      let hybridStarted = Date()
      let laidOut = DayframeCalendarDayLayout.layout(entries: crowd, nowMs: dayStart + 86_400_000, dayStartMs: dayStart, dayEndMs: dayStart + 86_400_000, hourHeight: 48, laneWidth: 300, calendar: calendar)
      XCTAssertLessThan(Date().timeIntervalSince(hybridStarted), 0.25)
      XCTAssertEqual(laidOut.count, 500)
      for entry in laidOut.values {
        XCTAssertLessThanOrEqual(entry.offsetFraction + entry.widthFraction, 1 + 1e-9)
      }
    }
  }

  func testDenseLabelLinesNeverOutgrowTheDrawnBlock() {
    for scale in [0.8, 1.0, 1.3] {
      for width in [21.0, 40, 89, 90, 119, 120, 300] {
        for height in stride(from: 16.0, through: 140, by: 0.5) {
          let label = DayframeCalendarDenseLabelMath.label(height: height, width: width, textScale: scale)
          if label.sliver {
            XCTAssertEqual(label.titleLines(detailCount: 0), 0)
            continue
          }
          XCTAssertEqual(label.compact, height < 34 * max(1, scale) || width < 90)
          XCTAssertEqual(label.detailLinesAvailable > 0, !label.compact && width >= 120 && height - 2 >= label.titleLineHeight + label.detailLineHeight)
          for wanted in 0...3 {
            let titleLines = label.titleLines(detailCount: wanted)
            let details = label.detailLines(titleLines: titleLines, detailCount: wanted)
            XCTAssertLessThanOrEqual(details, wanted)
            // The title wins: at least one line in every block drawn at least the minimum height.
            if height >= DayframeCalendarDayLayout.labelMinimumHeight(textScale: scale) - DayframeCalendarConstants.blockVisualGap {
              XCTAssertGreaterThanOrEqual(titleLines, 1)
            }
            // The top padding stays; only the one title line of the shortest blocks may reach into the
            // bottom 2 points (calendar-v3-mockup clips it there), never an extra line.
            let used = Double(titleLines) * label.titleLineHeight + Double(details) * label.detailLineHeight + label.verticalPadding
            XCTAssertLessThanOrEqual(used, max(height, label.titleLineHeight + label.verticalPadding) + 0.001, "\(height) × \(width) at ×\(scale)")
          }
        }
      }
    }
    XCTAssertTrue(DayframeCalendarDenseLabelMath.label(height: 40, width: 21).sliver)
    // An older bundle's 2-point block: no line fits, so colour only (Codex r1 on #580).
    XCTAssertEqual(DayframeCalendarDenseLabelMath.label(height: 2, width: 200).titleLines(detailCount: 0), 0)
    // What is painted at the minimum (the gap taken off) still holds one compact line at every size.
    for scale in [0.8, 1.0, 1.3] {
      let painted = DayframeCalendarDayLayout.labelMinimumHeight(textScale: scale) - DayframeCalendarConstants.blockVisualGap
      XCTAssertEqual(DayframeCalendarDenseLabelMath.label(height: painted, width: 200, textScale: scale).titleLines(detailCount: 0), 1, "×\(scale)")
    }
    XCTAssertFalse(DayframeCalendarDenseLabelMath.label(height: 40, width: 22).sliver)
  }

  func testTitlesFitAsWholeWordsWithAnEllipsisOnlyAfterAWholeWord() {
    let measure = { (text: String) in Double(text.count) * 10 }
    func fit(_ title: String, lines: Int, width: Double) -> [String] {
      DayframeCalendarTitleFit.lines(words: title.split(separator: " ").map(String.init), maxLines: lines, width: width, measure: measure)
    }
    XCTAssertEqual(fit("Reply to Sam", lines: 1, width: 200), ["Reply to Sam"])
    XCTAssertEqual(fit("Reply to Sam", lines: 2, width: 80), ["Reply to", "Sam"])
    XCTAssertEqual(fit("Reply to Sam", lines: 1, width: 90), ["Reply to\u{2026}"])
    XCTAssertEqual(fit("Expense receipts", lines: 1, width: 80), ["Expense\u{2026}"])
    // No room for the ellipsis beside the one whole word: the word alone.
    XCTAssertEqual(fit("Expense receipts", lines: 1, width: 70), ["Expense"])
    // A word wider than a whole line is never shown in part: it and every word after it go.
    XCTAssertEqual(fit("Plan Supercalifragilistic review", lines: 3, width: 60), ["Plan\u{2026}"])
    XCTAssertEqual(fit("Supercalifragilistic", lines: 2, width: 60), [])
    XCTAssertEqual(fit("Anything", lines: 0, width: 200), [])
    for line in fit("Customer workshop with the whole team", lines: 2, width: 100) {
      XCTAssertLessThanOrEqual(measure(line), 100)
    }
  }

  func testColumnsSpreadRightWhileTheNextColumnIsFree() {
    // Coffee and Quarterly plan collide; Design review and Supplier call collide with Quarterly plan
    // only lower down, so Coffee keeps one column and Inbox spreads over both free columns.
    let blocks = [
      DayframeCalendarDrawnBlock(id: "a-coffee", top: 0, bottom: 18),
      DayframeCalendarDrawnBlock(id: "b-plan", top: 5, bottom: 200),
      DayframeCalendarDrawnBlock(id: "c-review", top: 60, bottom: 90),
      DayframeCalendarDrawnBlock(id: "d-supplier", top: 65, bottom: 85),
      DayframeCalendarDrawnBlock(id: "e-inbox", top: 100, bottom: 130)
    ]
    let columns = Dictionary(uniqueKeysWithValues: DayframeCalendarColumnMath.layout(blocks, expandRight: true).map { ($0.id, $0) })
    XCTAssertEqual(columns["b-plan"]?.columnIndex, 1)
    XCTAssertEqual(columns["c-review"]?.columnIndex, 0)
    XCTAssertEqual(columns["d-supplier"]?.columnIndex, 2)
    XCTAssertEqual(columns["e-inbox"]?.columnIndex, 0)
    XCTAssertEqual(columns["e-inbox"]?.spanCount, 1)
    XCTAssertEqual(columns["a-coffee"]?.spanCount, 1)
    XCTAssertEqual(columns["d-supplier"]?.spanCount, 1)
    // Without spreading, every block keeps one column.
    XCTAssertTrue(DayframeCalendarColumnMath.layout(blocks).allSatisfy { $0.spanCount == 1 })
    // A block alone at the end of a cluster spreads over the free columns to its right.
    let spread = DayframeCalendarColumnMath.layout([
      DayframeCalendarDrawnBlock(id: "a", top: 0, bottom: 100),
      DayframeCalendarDrawnBlock(id: "b", top: 10, bottom: 30),
      DayframeCalendarDrawnBlock(id: "c", top: 12, bottom: 30),
      DayframeCalendarDrawnBlock(id: "d", top: 40, bottom: 60)
    ], expandRight: true)
    let d = spread.first { $0.id == "d" }
    XCTAssertEqual(d?.columnIndex, 1)
    XCTAssertEqual(d?.spanCount, 2)
    XCTAssertEqual(d?.widthFraction ?? 0, 2.0 / 3.0, accuracy: 1e-9)
  }

  func testSuggestionsShareTheBlocksColumnsAndMomentsLeaveTheLayout() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    func input(_ id: String, _ startMinute: Double, _ minutes: Double, group: String, moment: Bool = false) -> DayframeCalendarLayoutInput {
      DayframeCalendarLayoutInput(
        id: id, startedAtMs: dayStart + startMinute * 60_000, stoppedAtMs: dayStart + (startMinute + minutes) * 60_000,
        columnGroup: group, isMoment: moment, regionOffsetFraction: 0, regionWidthFraction: 1,
        fallbackOffsetFraction: 0, fallbackWidthFraction: 1, fallbackZIndex: 0
      )
    }
    let layout = DayframeCalendarDayLayout.layout(
      entries: [
        input("lunch", 720, 40, group: "logged"),
        input("unknown", 730, 25, group: "review"),
        input("tick", 760, 0.5, group: "logged", moment: true)
      ],
      nowMs: dayStart + 86_400_000, dayStartMs: dayStart, dayEndMs: dayStart + 86_400_000, hourHeight: 72, calendar: calendar
    )
    XCTAssertEqual(layout["lunch"]?.offsetFraction, 0)
    XCTAssertEqual(layout["lunch"]?.widthFraction, 0.5)
    XCTAssertEqual(layout["unknown"]?.offsetFraction, 0.5)
    XCTAssertEqual(layout["unknown"]?.widthFraction, 0.5)
    XCTAssertNil(layout["tick"])
  }

  // Codex r1 and r2 on #610: every Places lane item gets a full 44 × 44-point target, centred on it.
  func testPlacesLaneItemsGetA44PointTargetCentredOnThem() {
    let frames = DayframeCalendarPlacesLaneMath.hitFrames(
      spans: [DayframeCalendarBracketSpan(top: 300, height: 4), DayframeCalendarBracketSpan(top: 600, height: 120)],
      hourLabelWidth: 68,
      timelineHeight: 24 * 72
    )
    XCTAssertEqual(frames[0], DayframeCalendarHitFrame(minX: 76, maxX: 122, minY: 280, maxY: 324))
    // A tall item keeps its own span.
    XCTAssertEqual(frames[1], DayframeCalendarHitFrame(minX: 76, maxX: 122, minY: 600, maxY: 720))
    XCTAssertGreaterThanOrEqual(DayframeCalendarPlacesLaneMath.itemWidth, 44)
    XCTAssertEqual(DayframeCalendarPlacesLaneMath.width, 52)
  }

  func testPlacesLaneTargetsStayInsideTheDay() {
    let edge = DayframeCalendarPlacesLaneMath.hitFrames(
      spans: [DayframeCalendarBracketSpan(top: 0, height: 4), DayframeCalendarBracketSpan(top: 1724, height: 4)],
      hourLabelWidth: 68,
      timelineHeight: 1728
    )
    XCTAssertEqual(edge[0].minY, 0)
    XCTAssertEqual(edge[0].maxY, 44)
    XCTAssertEqual(edge[1].minY, 1684)
    XCTAssertEqual(edge[1].maxY, 1728)
  }

  func testCloseLaneItemsKeepFull44PointTargetsAndATouchGoesToTheNearest() {
    // Two 10-point items 12 points apart.
    let spans = [DayframeCalendarBracketSpan(top: 500, height: 10), DayframeCalendarBracketSpan(top: 522, height: 10)]
    let frames = DayframeCalendarPlacesLaneMath.hitFrames(spans: spans, hourLabelWidth: 68, timelineHeight: 1728)
    for frame in frames {
      XCTAssertEqual(frame.maxY - frame.minY, 44, accuracy: 0.001)
      XCTAssertGreaterThanOrEqual(frame.maxX - frame.minX, 44)
    }
    // Centres at 505 and 527: a touch goes to the nearer, wherever the two targets overlap.
    let hit = { (y: Double) in DayframeCalendarPlacesLaneMath.hitIndex(point: DayframeCalendarPoint(x: 90, y: y), spans: spans, frames: frames) }
    XCTAssertEqual(hit(490), 0)
    XCTAssertEqual(hit(515), 0)
    XCTAssertEqual(hit(517), 1)
    XCTAssertEqual(hit(545), 1)
    XCTAssertNil(hit(560))
    XCTAssertNil(DayframeCalendarPlacesLaneMath.hitIndex(point: DayframeCalendarPoint(x: 140, y: 505), spans: spans, frames: frames))
    // A long press over either is over an item (the coordinator passes these frames with the blocks').
    XCTAssertTrue(DayframeCalendarLongPressMath.pointHitsEntry(point: DayframeCalendarPoint(x: 90, y: 540), frames: frames))
  }

  // Codex r1 on #610: a trip across midnight shows only this day's legs, placed by the day-clipped span.
  func testLegStripClipsATripAcrossMidnightToTheDayItIsDrawnOn() {
    let hour = 3_600_000.0
    let midnight = 24 * hour
    let legs = [(startedAtMs: midnight - hour, stoppedAtMs: midnight - hour / 2), (startedAtMs: midnight - hour / 2, stoppedAtMs: midnight + hour)]
    // The first day (23:00–24:00 drawn): the first leg fills the top half, the second the bottom half.
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    let before = DayframeCalendarLegStripMath.segments(legs: legs, startedAtMs: midnight - hour, stoppedAtMs: midnight + hour,
      dayStartMs: 0, dayEndMs: midnight, height: 104, calendar: utc)
    XCTAssertEqual(before.map(\.index), [0, 1])
    XCTAssertEqual(before[0].top, 2, accuracy: 0.001)
    XCTAssertEqual(before[0].height, 49, accuracy: 0.001)
    XCTAssertEqual(before[1].top, 52, accuracy: 0.001)
    XCTAssertEqual(before[1].height, 49, accuracy: 0.001)
    // The next day (00:00–01:00 drawn): only the second leg, over the whole strip.
    let after = DayframeCalendarLegStripMath.segments(legs: legs, startedAtMs: midnight - hour, stoppedAtMs: midnight + hour,
      dayStartMs: midnight, dayEndMs: 2 * midnight, height: 104, calendar: utc)
    XCTAssertEqual(after.map(\.index), [1])
    XCTAssertEqual(after[0].top, 2, accuracy: 0.001)
    XCTAssertEqual(after[0].height, 99, accuracy: 0.001)
    // Nothing on a day the block doesn't reach.
    XCTAssertTrue(DayframeCalendarLegStripMath.segments(legs: legs, startedAtMs: midnight - hour, stoppedAtMs: midnight + hour,
      dayStartMs: 2 * midnight, dayEndMs: 3 * midnight, height: 104, calendar: utc).isEmpty)
  }

  // Codex r2 on #610: across the UK clocks going back (25 Oct 2026), legs follow the block's wall-clock geometry.
  func testLegStripUsesTheBlocksWallClockGeometryAcrossTheClockChange() throws {
    var london = Calendar(identifier: .gregorian)
    london.timeZone = TimeZone(identifier: "Europe/London")!
    let iso = ISO8601DateFormatter()
    func ms(_ text: String) -> Double { iso.date(from: text)!.timeIntervalSince1970 * 1000 }
    let day = ms("2026-10-24T23:00:00Z"), end = ms("2026-10-26T00:00:00Z")
    // 00:30 BST to 03:30 GMT: three wall-clock hours (four elapsed); the boundary at 02:30 GMT is two of them.
    let start = ms("2026-10-24T23:30:00Z"), boundary = ms("2026-10-25T02:30:00Z"), stop = ms("2026-10-25T03:30:00Z")
    let block = try XCTUnwrap(DayframeCalendarBlockMath.metrics(startedAtMs: start, stoppedAtMs: stop, nowMs: stop, dayStartMs: day, dayEndMs: end,
      hourHeight: 72, calendar: london))
    let leg = try XCTUnwrap(DayframeCalendarBlockMath.metrics(startedAtMs: start, stoppedAtMs: boundary, nowMs: stop, dayStartMs: day, dayEndMs: end,
      hourHeight: 72, calendar: london))
    let segments = DayframeCalendarLegStripMath.segments(legs: [(startedAtMs: start, stoppedAtMs: boundary), (startedAtMs: boundary, stoppedAtMs: stop)],
      startedAtMs: start, stoppedAtMs: stop, dayStartMs: day, dayEndMs: end, height: block.height, calendar: london)
    XCTAssertEqual(block.height, 216, accuracy: 0.001)
    XCTAssertEqual(segments[1].top, 2 + (leg.height / block.height) * (block.height - 4), accuracy: 0.001)
    XCTAssertEqual(segments[1].top, 143.333, accuracy: 0.001)
    XCTAssertEqual(segments[0].top, 2, accuracy: 0.001)
  }

  func testMomentsSitAtTheGutterEdgeWithA44PointTargetInsideTheDay() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let top = try XCTUnwrap(DayframeCalendarMomentMath.top(
      startedAtMs: dayStart + 600 * 60_000, stoppedAtMs: dayStart + 600 * 60_000 + 30_000,
      dayStartMs: dayStart, dayEndMs: dayStart + 86_400_000, hourHeight: 72, calendar: calendar
    ))
    XCTAssertEqual(top, 720, accuracy: 1e-9)
    let frame = DayframeCalendarMomentMath.hitFrame(top: top, hourLabelWidth: 68, timelineHeight: 1_728)
    XCTAssertEqual(frame.maxX, 76)
    XCTAssertEqual(frame.maxX - frame.minX, 44)
    XCTAssertEqual(frame.maxY - frame.minY, 44)
    // Across midnight: at the top of its second day, its target still inside the day.
    let midnight = try XCTUnwrap(DayframeCalendarMomentMath.top(
      startedAtMs: dayStart - 20_000, stoppedAtMs: dayStart + 20_000,
      dayStartMs: dayStart, dayEndMs: dayStart + 86_400_000, hourHeight: 72, calendar: calendar
    ))
    XCTAssertEqual(midnight, 0)
    XCTAssertEqual(DayframeCalendarMomentMath.hitFrame(top: midnight, hourLabelWidth: 68, timelineHeight: 1_728).minY, 0)
  }

  func testNearbyMomentsSplitTheirTargetsSoATapOpensTheNearest() {
    for hourHeight in [48.0, 72, 128] {
      // 10:00 and 10:10, and two at 12:00 together.
      let tops = [10 * hourHeight, (10 + 10.0 / 60) * hourHeight, 12 * hourHeight, 12 * hourHeight]
      let frames = DayframeCalendarMomentMath.hitFrames(tops: tops, hourLabelWidth: 68, timelineHeight: 24 * hourHeight)
      for (index, top) in tops.enumerated() {
        let point = DayframeCalendarPoint(x: 60, y: top)
        let hits = frames.indices.filter { frames[$0].contains(point) }
        XCTAssertTrue(hits.contains(index) || tops.filter({ $0 == top }).count > 1, "moment \(index) at \(hourHeight)")
        // Never more than the two sharing a tick.
        XCTAssertLessThanOrEqual(hits.count, 2)
      }
      // Separate ticks never share a target point.
      XCTAssertLessThanOrEqual(frames[0].maxY, frames[1].minY)
      XCTAssertEqual(frames[0].maxY, (tops[0] + tops[1]) / 2, accuracy: 1e-9)
      // Two at the same time share their group's target in equal slices, each with its own area.
      XCTAssertEqual(frames[2].maxY, frames[3].minY, accuracy: 1e-9)
      XCTAssertGreaterThan(frames[2].maxY - frames[2].minY, 0)
      XCTAssertEqual(frames[2].maxY - frames[2].minY, frames[3].maxY - frames[3].minY, accuracy: 1e-9)
      // At the day's edges and in threes, every moment still has a target of its own (Codex r2 on #580).
      for edgeTops in [[0.0, 0.0], [24 * hourHeight, 24 * hourHeight], [9 * hourHeight, 9 * hourHeight, 9 * hourHeight], [0.0, 0.2, 30]] {
        let edgeFrames = DayframeCalendarMomentMath.hitFrames(tops: edgeTops, hourLabelWidth: 68, timelineHeight: 24 * hourHeight)
        for frame in edgeFrames {
          XCTAssertGreaterThan(frame.maxY - frame.minY, 1, "\(edgeTops) at \(hourHeight)")
          XCTAssertGreaterThanOrEqual(frame.minY, 0)
          XCTAssertLessThanOrEqual(frame.maxY, 24 * hourHeight)
        }
        // No two targets overlap.
        for (a, left) in edgeFrames.enumerated() {
          for right in edgeFrames[(a + 1)...] {
            XCTAssertTrue(left.maxY <= right.minY + 1e-9 || right.maxY <= left.minY + 1e-9, "\(edgeTops)")
          }
        }
      }
      // A lone moment keeps its whole 44 points.
      let lone = DayframeCalendarMomentMath.hitFrames(tops: [5 * hourHeight], hourLabelWidth: 68, timelineHeight: 24 * hourHeight)[0]
      XCTAssertEqual(lone.maxY - lone.minY, 44)
    }
  }

  // Calendar v3: Apple's hybrid overlap, on calendar-v3-mockup's synthetic Friday at 72 pt/h.
  func testHybridOverlapPutsCloseStartsSideBySideAndNestsLaterStartsIndentedOnTop() {
    let hourHeight = 72.0, laneWidth = 324.0
    func block(_ id: String, _ start: String, _ end: String) -> DayframeCalendarHybridBlock {
      func minutes(_ text: String) -> Double {
        let parts = text.split(separator: ":").compactMap { Double($0) }
        return parts[0] * 60 + parts[1]
      }
      let top = minutes(start) / 60 * hourHeight
      return DayframeCalendarHybridBlock(id: id, top: top, bottom: max(minutes(end) / 60 * hourHeight, top + 18))
    }
    let day = [
      block("overnight", "01:00", "09:00"), block("gym", "05:00", "06:30"), block("walk", "06:30", "07:00"),
      block("prep", "07:00", "08:00"), block("plan", "09:00", "10:20"), block("sync", "09:00", "09:45"),
      block("inbox", "09:00", "09:05"), block("reply", "09:02", "09:06"), block("coffee", "09:05", "09:10"),
      block("party", "11:00", "13:30"), block("unknown", "11:00", "11:20"), block("parcel", "13:20", "13:40"),
      block("games", "18:00", "19:00"), block("bedtime", "18:45", "19:05"), block("shift", "20:00", "23:55"),
      block("stretch", "20:00", "20:40"), block("journal", "20:00", "20:20"), block("f1", "22:00", "22:45")
    ]
    let placed = Dictionary(uniqueKeysWithValues: DayframeCalendarHybridMath.layout(
      day, laneWidth: laneWidth, closeDistance: 20.0 / 60 * hourHeight
    ).map { ($0.id, $0) })

    // A long block alone takes the lane; blocks starting inside it nest 14 pt in, drawn on top.
    XCTAssertEqual(placed["overnight"]?.x, 0)
    XCTAssertEqual(placed["overnight"]?.width, laneWidth)
    for id in ["gym", "walk", "prep"] {
      XCTAssertEqual(placed[id]?.depth, 1, id)
      XCTAssertEqual(placed[id]?.x, 14, id)
      XCTAssertEqual(placed[id]?.width, laneWidth - 14, id)
    }
    // Five starts within 20 minutes share five equal columns.
    let nine = ["plan", "sync", "inbox", "reply", "coffee"].compactMap { placed[$0] }
    XCTAssertEqual(nine.map(\.columnCount), [5, 5, 5, 5, 5])
    XCTAssertEqual(nine.map(\.columnIndex), [0, 1, 2, 3, 4])
    XCTAssertEqual(nine.map(\.depth), [0, 0, 0, 0, 0])
    // Starts together sit beside each other; a later start nests in the latest-starting block running.
    XCTAssertEqual(placed["unknown"]?.columnIndex, 1)
    XCTAssertEqual(placed["parcel"]?.depth, 1)
    XCTAssertEqual(placed["parcel"]?.x, placed["party"]!.x + 14)
    XCTAssertEqual(placed["bedtime"]?.depth, 1)
    XCTAssertEqual(placed["bedtime"]?.x, 14)
    // F1 nests inside the evening shift and stops short of nothing: Stretch and Journal have ended.
    XCTAssertEqual(placed["f1"]?.depth, 1)
    XCTAssertEqual(placed["f1"]!.x + placed["f1"]!.width, laneWidth, accuracy: 0.001)
    XCTAssertEqual(placed["shift"]?.columnCount, 3)
  }

  func testHybridOverlapStopsANestedGroupShortOfABlockStillRunningToItsRight() {
    let placed = Dictionary(uniqueKeysWithValues: DayframeCalendarHybridMath.layout([
      DayframeCalendarHybridBlock(id: "a", top: 0, bottom: 200),
      DayframeCalendarHybridBlock(id: "b", top: 0, bottom: 200),
      DayframeCalendarHybridBlock(id: "nested", top: 100, bottom: 150)
    ], laneWidth: 300, closeDistance: 24).map { ($0.id, $0) })
    XCTAssertEqual(placed["a"]?.width, 150)
    // Nested in a (tied starts: the first placed), 14 in from its left edge, and stopping 2 points
    // short of b, which is still running to its right.
    XCTAssertEqual(placed["nested"]?.depth, 1)
    XCTAssertEqual(placed["nested"]?.x, 14)
    XCTAssertEqual(placed["nested"]!.x + placed["nested"]!.width, 148, accuracy: 0.001)
    // Nested in a narrow column at the lane's edge: never narrower than 40 points, never past the lane.
    let edge = DayframeCalendarHybridMath.layout([
      DayframeCalendarHybridBlock(id: "wide", top: 0, bottom: 300),
      DayframeCalendarHybridBlock(id: "one", top: 50, bottom: 300),
      DayframeCalendarHybridBlock(id: "two", top: 100, bottom: 300),
      DayframeCalendarHybridBlock(id: "three", top: 150, bottom: 300)
    ], laneWidth: 60, closeDistance: 24)
    for placement in edge {
      XCTAssertGreaterThanOrEqual(placement.width, min(40, 60 - placement.x) - 0.001, placement.id)
      XCTAssertLessThanOrEqual(placement.x + placement.width, 60 + 0.001, placement.id)
    }
  }

  // Codex r5 on #580: a short nested block keeps its own target (its parent contains it), side-by-side
  // blocks keep a painted 2-point gap, and depth always outranks columns in drawing order.
  func testHybridDayLayoutKeepsNestedTargetsGapsAndDepthOrder() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let dayStart = try milliseconds("2026-07-10T00:00:00Z")
    let dayEnd = dayStart + 86_400_000
    func layout(_ entries: [DayframeCalendarLayoutInput]) -> [String: DayframeCalendarLaidOutEntry] {
      DayframeCalendarDayLayout.layout(entries: entries, nowMs: dayEnd, dayStartMs: dayStart, dayEndMs: dayEnd, hourHeight: 72, laneWidth: 300, calendar: calendar)
    }
    let nestedShort = layout([try input("parent", "09:00", "12:00", group: "logged"), try input("child", "10:00", "10:02", group: "logged")])
    XCTAssertTrue(nestedShort["child"]!.sharesTarget)
    XCTAssertTrue(nestedShort["child"]!.nested)
    XCTAssertFalse(nestedShort["parent"]!.nested)
    XCTAssertGreaterThan(nestedShort["child"]!.zIndex, nestedShort["parent"]!.zIndex)

    let pair = layout([try input("a", "09:00", "10:00", group: "logged"), try input("b", "09:00", "10:00", group: "logged")])
    let left = pair.values.min { $0.offsetFraction < $1.offsetFraction }!
    let right = pair.values.max { $0.offsetFraction < $1.offsetFraction }!
    XCTAssertEqual((right.offsetFraction - (left.offsetFraction + left.widthFraction)) * 300, 2, accuracy: 0.001)

    // 103 coincident blocks, then one nested in them: the nested one draws above every one of them.
    var crowd = try (0..<103).map { try input("c\($0)", "09:00", "12:00", group: "logged") }
    crowd.append(try input("late", "10:00", "11:00", group: "logged"))
    let crowded = layout(crowd)
    let late = crowded["late"]!
    for (id, entry) in crowded where id != "late" {
      XCTAssertLessThan(entry.zIndex, late.zIndex, id)
    }
    XCTAssertLessThan(late.zIndex, DayframeCalendarDayLayout.momentZIndex)
  }

  // The Today pill on today (scroll to now).

  func testScrollToNowPutsNowAThirdDownTheViewport() {
    // 15:00 at 72 points an hour is 1080; a third of a 600-point viewport is 200.
    XCTAssertEqual(
      DayframeCalendarScrollToNowMath.contentOffset(minuteOfDay: 900, hourHeight: 72, viewportHeight: 600),
      880,
      accuracy: 0.001
    )
    // It follows the zoom.
    XCTAssertEqual(
      DayframeCalendarScrollToNowMath.contentOffset(minuteOfDay: 900, hourHeight: 100, viewportHeight: 600),
      1300,
      accuracy: 0.001
    )
  }

  func testScrollToNowStaysInsideTheTimeline() {
    XCTAssertEqual(DayframeCalendarScrollToNowMath.contentOffset(minuteOfDay: 10, hourHeight: 72, viewportHeight: 600), 0)
    let maximum = DayframeCalendarZoomMath.maximumContentOffset(hourHeight: 72, viewportHeight: 600)
    XCTAssertEqual(DayframeCalendarScrollToNowMath.contentOffset(minuteOfDay: 1439, hourHeight: 72, viewportHeight: 600), maximum)
    XCTAssertEqual(DayframeCalendarScrollToNowMath.contentOffset(minuteOfDay: .nan, hourHeight: 72, viewportHeight: 600), 0)
    XCTAssertEqual(DayframeCalendarScrollToNowMath.contentOffset(minuteOfDay: .infinity, hourHeight: 72, viewportHeight: 600), 0)
    XCTAssertEqual(DayframeCalendarScrollToNowMath.contentOffset(minuteOfDay: 720, hourHeight: 72, viewportHeight: 5_000), 0)
  }

  func testScrollToNowReadsTheMinuteInTheCalendarsZone() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Europe/London"))
    // 2026-10-22 16:05:30 UTC is 17:05:30 in London (BST).
    let milliseconds = 1792685130000.0
    XCTAssertEqual(DayframeCalendarScrollToNowMath.minuteOfDay(milliseconds: milliseconds, calendar: calendar), 1025.5, accuracy: 0.001)
    XCTAssertEqual(DayframeCalendarScrollToNowMath.minuteOfDay(milliseconds: .nan, calendar: calendar), 0)
  }

  func testScrollToNowActsOnlyOnTodayWithNoFingerOnTheTimeline() {
    let can = { (selected: String, today: String, viewport: Double, finger: Bool) in
      DayframeCalendarScrollToNowMath.canScroll(
        selectedDayKey: selected,
        todayKey: today,
        viewportHeight: viewport,
        fingerOnTimeline: finger
      )
    }
    XCTAssertTrue(can("2026-10-30", "2026-10-30", 600, false))
    XCTAssertFalse(can("2026-10-29", "2026-10-30", 600, false))
    XCTAssertFalse(can("2026-10-30", "2026-10-30", 600, true))
    XCTAssertFalse(can("2026-10-30", "2026-10-30", 0, false))
    XCTAssertFalse(can("", "", 600, false))
  }

  func testScrollToNowRequestIsOptionalInTheModel() throws {
    // An older bundle's model has no such key.
    let olderData = try JSONEncoder().encode(DayframeCalendarPresentationRecord())
    XCTAssertFalse(String(decoding: olderData, as: UTF8.self).contains("scrollToNowRequest"))
    let older = try JSONDecoder().decode(DayframeCalendarPresentationRecord.self, from: olderData)
    XCTAssertNil(older.scrollToNowRequest)

    var next = DayframeCalendarPresentationRecord()
    next.scrollToNowRequest = 3
    let current = try JSONDecoder().decode(
      DayframeCalendarPresentationRecord.self,
      from: JSONEncoder().encode(next)
    )
    XCTAssertEqual(current.scrollToNowRequest, 3)
  }
}
