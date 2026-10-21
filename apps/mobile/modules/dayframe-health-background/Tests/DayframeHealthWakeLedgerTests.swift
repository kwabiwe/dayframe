import XCTest
@testable import DayframeHealthBackgroundCore

final class DayframeHealthWakeLedgerTests: XCTestCase {
  private func wake(_ id: String, _ kind: String = "workout", at seconds: TimeInterval = 0) -> DayframeHealthWake {
    DayframeHealthWake(id: id, kind: kind, reason: "observer", receivedAt: Date(timeIntervalSince1970: seconds))
  }

  func testWakesBeforeListeningWaitAndAreHandedOverOnce() {
    var ledger = DayframeHealthWakeLedger()
    XCTAssertFalse(ledger.add(wake("a")).deliverNow)
    XCTAssertFalse(ledger.add(wake("b", "sleep")).deliverNow)
    XCTAssertEqual(ledger.startListening().map(\.id), ["a", "b"])
    XCTAssertEqual(ledger.startListening(), [])
    XCTAssertEqual(ledger.outstandingCount, 2)
  }

  func testListeningDeliversAtOnce() {
    var ledger = DayframeHealthWakeLedger()
    _ = ledger.startListening()
    XCTAssertTrue(ledger.add(wake("a")).deliverNow)
    XCTAssertTrue(ledger.hasOutstanding)
  }

  func testFinishIsExactlyOnce() {
    var ledger = DayframeHealthWakeLedger()
    _ = ledger.add(wake("a"))
    XCTAssertEqual(ledger.finish(id: "a")?.id, "a")
    XCTAssertNil(ledger.finish(id: "a"))
    XCTAssertFalse(ledger.hasOutstanding)
    // A finished undelivered wake is not handed to JavaScript later.
    XCTAssertEqual(ledger.startListening(), [])
  }

  func testStopListeningKeepsGivenWakesOutstanding() {
    var ledger = DayframeHealthWakeLedger()
    _ = ledger.startListening()
    _ = ledger.add(wake("a"))
    ledger.stopListening()
    XCTAssertEqual(ledger.outstandingCount, 1)
    XCTAssertFalse(ledger.add(wake("b")).deliverNow)
    XCTAssertEqual(ledger.startListening().map(\.id), ["b"])
  }

  func testUndeliveredWakesAreBounded() {
    var ledger = DayframeHealthWakeLedger()
    var overflow: [String] = []
    for index in 0..<(DayframeHealthWakeLedger.maxUndelivered + 2) {
      overflow += ledger.add(wake("w\(index)", at: TimeInterval(index))).overflow.map(\.id)
    }
    XCTAssertEqual(overflow, ["w0", "w1"])
    XCTAssertEqual(ledger.outstandingCount, DayframeHealthWakeLedger.maxUndelivered)
    XCTAssertNil(ledger.finish(id: "w0"))
  }

  func testFinishAllReturnsEveryWakeOldestFirst() {
    var ledger = DayframeHealthWakeLedger()
    _ = ledger.add(wake("late", at: 5))
    _ = ledger.add(wake("early", at: 1))
    XCTAssertEqual(ledger.finishAll().map(\.id), ["early", "late"])
    XCTAssertEqual(ledger.finishAll(), [])
    XCTAssertEqual(ledger.startListening(), [])
  }
}
