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
