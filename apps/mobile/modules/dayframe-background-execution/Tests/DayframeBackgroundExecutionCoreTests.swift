import XCTest
@testable import DayframeBackgroundExecutionCore

final class DayframeBackgroundExecutionCoreTests: XCTestCase {
  func testConcurrentLeasesShareOneGenerationAndLastReleaseEndsIt() throws {
    var core = DayframeBackgroundExecutionCore()

    XCTAssertEqual(core.acquire(leaseToken: "start"), 1)
    XCTAssertNil(core.acquire(leaseToken: "stop"))
    XCTAssertNil(core.release(leaseToken: "start"))

    let end = try XCTUnwrap(core.release(leaseToken: "stop"))
    XCTAssertEqual(end.generation, 1)
    XCTAssertNil(core.activeGeneration)
    XCTAssertTrue(core.leaseTokens.isEmpty)
  }

  func testDuplicateReleaseCannotEndAPlatformTaskTwice() throws {
    var core = DayframeBackgroundExecutionCore()
    XCTAssertEqual(core.acquire(leaseToken: "edit"), 1)

    XCTAssertNotNil(core.release(leaseToken: "edit"))
    XCTAssertNil(core.release(leaseToken: "edit"))
    XCTAssertNil(core.endAll())
  }

  func testExpiryConsumesEveryLeaseOnceAndIgnoresStaleGeneration() throws {
    var core = DayframeBackgroundExecutionCore()
    XCTAssertEqual(core.acquire(leaseToken: "outer"), 1)
    XCTAssertNil(core.acquire(leaseToken: "nested"))
    XCTAssertNil(core.endAll(generation: 99))

    let expired = try XCTUnwrap(core.endAll(generation: 1))
    XCTAssertEqual(expired.leaseTokens, ["nested", "outer"])
    XCTAssertNil(core.endAll(generation: 1))

    XCTAssertEqual(core.acquire(leaseToken: "new"), 2)
    XCTAssertNil(core.endAll(generation: 1))
    XCTAssertEqual(core.activeGeneration, 2)
  }

  func testInvalidPlatformBeginRollsBackItsLease() {
    var core = DayframeBackgroundExecutionCore()
    XCTAssertEqual(core.acquire(leaseToken: "start"), 1)
    XCTAssertEqual(core.beginFailed(generation: 1), ["start"])
    XCTAssertNil(core.activeGeneration)
    XCTAssertTrue(core.leaseTokens.isEmpty)
    XCTAssertEqual(core.acquire(leaseToken: "retry"), 2)
  }
}
