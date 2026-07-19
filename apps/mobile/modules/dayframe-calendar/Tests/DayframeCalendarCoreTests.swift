import XCTest
@testable import DayframeCalendarCore

final class DayframeCalendarCoreTests: XCTestCase {
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
        "isReview":false,"isUncategorized":false,"meta":"11:20 – Now","startedAtMs":1000,
        "startsBeforeDay":false,"stoppedAtMs":null,"tagText":"Deep work","title":"Planning"
      }]
      """
    )

    XCTAssertEqual(initial.selectedDayKey, "2026-07-19")
    XCTAssertTrue(initial.entries.isEmpty)
    XCTAssertEqual(later.selectedDayKey, "2026-07-20")
    XCTAssertEqual(later.nowMs, 2_000)
    XCTAssertEqual(later.entries.first?.entryId, "entry-1")
    XCTAssertEqual(later.entries.first?.tagText, "Deep work")
  }

  private func decodePresentation(
    selectedDayKey: String,
    nowMs: Double,
    entriesJSON: String
  ) throws -> DayframeCalendarPresentationRecord {
    let json = """
    {
      "dayEndMs":86400000,"dayStartMs":0,"emptyState":"No tracked time for this day.",
      "entries":\(entriesJSON),"modelVersion":2,"nowMs":\(nowMs),"reduceMotion":false,
      "reduceTransparency":false,"refreshing":false,"selectedDayKey":"\(selectedDayKey)",
      "selectedDayTitle":"Today","theme":{"accent":"#FF6248","accentSoft":"#33201E",
      "accentText":"#FF8A76","background":"#050914","border":"#2A3345",
      "borderStrong":"#3B465B","mode":"dark","shadow":"#000000","surface":"#151B27",
      "surfaceMuted":"#202838","surfaceRaised":"#1B2230","textPrimary":"#F7F8FB",
      "textSecondary":"#8993A7"},"todayKey":"2026-07-19","totalLabel":"0m",
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
}
