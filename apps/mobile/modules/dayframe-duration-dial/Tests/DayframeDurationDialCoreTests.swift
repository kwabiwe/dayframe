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
}
