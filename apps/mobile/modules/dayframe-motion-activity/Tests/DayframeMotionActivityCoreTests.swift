import XCTest
@testable import DayframeMotionActivityCore

final class DayframeMotionActivityCoreTests: XCTestCase {
  func testAuthorizationAndConfidenceLabels() {
    XCTAssertEqual(DayframeMotionActivityCore.authorizationLabel(rawValue: 0), "not_determined")
    XCTAssertEqual(DayframeMotionActivityCore.authorizationLabel(rawValue: 1), "restricted")
    XCTAssertEqual(DayframeMotionActivityCore.authorizationLabel(rawValue: 2), "denied")
    XCTAssertEqual(DayframeMotionActivityCore.authorizationLabel(rawValue: 3), "authorized")
    XCTAssertEqual(DayframeMotionActivityCore.authorizationLabel(rawValue: 9), "unknown")
    XCTAssertEqual(DayframeMotionActivityCore.confidenceLabel(rawValue: 0), "low")
    XCTAssertEqual(DayframeMotionActivityCore.confidenceLabel(rawValue: 1), "medium")
    XCTAssertEqual(DayframeMotionActivityCore.confidenceLabel(rawValue: 2), "high")
  }

  func testQueryWindowNeverReachesPastSevenDaysOrIntoTheFuture() throws {
    let now = 1_000_000_000_000.0
    let window = try XCTUnwrap(DayframeMotionActivityCore.queryWindow(fromMs: 0, toMs: now + 60_000, nowMs: now))
    XCTAssertEqual(window.fromMs, now - DayframeMotionActivityCore.historyMs)
    XCTAssertEqual(window.toMs, now)
    XCTAssertNil(DayframeMotionActivityCore.queryWindow(fromMs: now, toMs: now, nowMs: now))
    XCTAssertNil(DayframeMotionActivityCore.queryWindow(fromMs: .nan, toMs: now, nowMs: now))
  }

  func testRecordsCarryFlagsAndConfidenceButNoPosition() {
    let record = DayframeMotionActivityCore.record(
      startMs: 1_234.4, stationary: true, walking: false, running: false, cycling: false,
      automotive: true, unknown: false, confidenceRawValue: 2)
    XCTAssertEqual(record["startMs"] as? Double, 1_234)
    XCTAssertEqual(record["automotive"] as? Bool, true)
    XCTAssertEqual(record["confidence"] as? String, "high")
    XCTAssertEqual(Set(record.keys), ["startMs", "stationary", "walking", "running", "cycling", "automotive", "unknown", "confidence"])
  }

  func testOrderedKeepsTheEarliestRecordsWithinTheLimit() {
    let records = [3.0, 1.0, 2.0].map { ["startMs": $0] as [String: Any] }
    let ordered = DayframeMotionActivityCore.ordered(records, limit: 2)
    XCTAssertEqual(ordered.compactMap { $0["startMs"] as? Double }, [1, 2])
    XCTAssertEqual(DayframeMotionActivityCore.clampLimit(0), 1)
    XCTAssertEqual(DayframeMotionActivityCore.clampLimit(1_000_000), DayframeMotionActivityCore.maximumRecords)
  }
}
