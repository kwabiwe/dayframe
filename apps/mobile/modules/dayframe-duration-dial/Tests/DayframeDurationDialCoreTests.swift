import XCTest
@testable import DayframeDurationDialCore

final class DayframeDurationDialCoreTests: XCTestCase {
  func testUnwrapsSeamInBothDirections() {
    XCTAssertEqual(
      DayframeDurationDialCore.unwrap(previous: .pi - 0.1, next: -.pi + 0.1),
      0.2,
      accuracy: 0.0001
    )
    XCTAssertEqual(
      DayframeDurationDialCore.unwrap(previous: -.pi + 0.1, next: .pi - 0.1),
      -0.2,
      accuracy: 0.0001
    )
  }

  func testMapsMultipleTurnsToWholeMinutes() {
    XCTAssertEqual(DayframeDurationDialCore.minuteDelta(radians: .pi * 2), 60)
    XCTAssertEqual(DayframeDurationDialCore.minuteDelta(radians: .pi * 4), 120)
    XCTAssertEqual(DayframeDurationDialCore.minuteDelta(radians: -.pi * 4), -120)
  }

  func testChoosesOnlyStrongestSkippedHaptic() {
    XCTAssertEqual(DayframeDurationDialCore.strongestHaptic(from: 1, to: 2), 1)
    XCTAssertEqual(DayframeDurationDialCore.strongestHaptic(from: 4, to: 8), 2)
    XCTAssertEqual(DayframeDurationDialCore.strongestHaptic(from: 58, to: 64), 3)
  }

  func testFormatsShortDurationsLikeThePrototype() {
    XCTAssertEqual(DayframeDurationDialCore.formatShortDuration(milliseconds: 0), "0m")
    XCTAssertEqual(DayframeDurationDialCore.formatShortDuration(milliseconds: 42 * 60_000 + 59_000), "42m")
    XCTAssertEqual(DayframeDurationDialCore.formatShortDuration(milliseconds: 60 * 60_000), "1h 00m")
    XCTAssertEqual(DayframeDurationDialCore.formatShortDuration(milliseconds: 65 * 60_000), "1h 05m")
    XCTAssertEqual(DayframeDurationDialCore.formatShortDuration(milliseconds: -5_000), "0m")
  }

  func testSolidArcCoversOnlyTheCurrentHour() {
    let turn = DayframeDurationDialCore.fullTurn
    XCTAssertEqual(DayframeDurationDialCore.solidArcSweep(milliseconds: 15 * 60_000), turn / 4, accuracy: 0.0001)
    XCTAssertEqual(DayframeDurationDialCore.solidArcSweep(milliseconds: 65 * 60_000), turn * 5 / 60, accuracy: 0.0001)
    XCTAssertEqual(DayframeDurationDialCore.solidArcSweep(milliseconds: 60 * 60_000), 0, accuracy: 0.0001)
    XCTAssertEqual(DayframeDurationDialCore.solidArcSweep(milliseconds: -1), 0, accuracy: 0.0001)
    XCTAssertNil(DayframeDurationDialCore.lapDetail(milliseconds: 59 * 60_000))
    XCTAssertEqual(DayframeDurationDialCore.lapDetail(milliseconds: 65 * 60_000), "1 full turn + 5 min")
    XCTAssertEqual(DayframeDurationDialCore.lapDetail(milliseconds: 120 * 60_000), "2 full turns + 0 min")
  }

  func testMeasuresTheRingInteriorAtAnOffset() {
    // A condensed dial (164 points): ring radius 55.76, inner edge 47.76.
    XCTAssertEqual(DayframeDurationDialCore.chordWidth(innerRadius: 47.76, offset: 11.5), 92.71, accuracy: 0.05)
    XCTAssertEqual(DayframeDurationDialCore.chordWidth(innerRadius: 40, offset: 0), 80, accuracy: 0.0001)
    XCTAssertEqual(DayframeDurationDialCore.chordWidth(innerRadius: 40, offset: 41), 0)
  }

  func testFormatsFullDay() {
    XCTAssertEqual(DayframeDurationDialCore.formatDuration(milliseconds: 86_400_000), "24:00:00")
  }

  func testOwnsOnlyTheCircularDialAndHandleRegion() {
    XCTAssertTrue(DayframeDurationDialCore.ownsTouch(
      x: 170,
      y: 143,
      width: 340,
      height: 286,
      includesRangeHandle: false
    ))
    XCTAssertTrue(DayframeDurationDialCore.ownsTouch(
      x: 170,
      y: 24,
      width: 340,
      height: 286,
      includesRangeHandle: false
    ))
    XCTAssertFalse(DayframeDurationDialCore.ownsTouch(
      x: 12,
      y: 12,
      width: 340,
      height: 286,
      includesRangeHandle: false
    ))
    XCTAssertTrue(DayframeDurationDialCore.ownsTouch(
      x: 170,
      y: 2,
      width: 340,
      height: 286,
      includesRangeHandle: true
    ))
    XCTAssertFalse(DayframeDurationDialCore.ownsTouch(
      x: 12,
      y: 12,
      width: 340,
      height: 286,
      includesRangeHandle: true
    ))
  }
}
