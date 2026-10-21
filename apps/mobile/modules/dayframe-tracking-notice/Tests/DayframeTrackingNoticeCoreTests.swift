import XCTest
@testable import DayframeTrackingNoticeCore

final class DayframeTrackingNoticeCoreTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1_800_000_000)

  func testNotifiesOnlyWhenArmedWithAlwaysAccess() {
    XCTAssertTrue(DayframeTrackingNoticeCore.shouldNotify(armed: true, alwaysAuthorized: true, lastNoticeAt: nil, now: now))
    XCTAssertFalse(DayframeTrackingNoticeCore.shouldNotify(armed: false, alwaysAuthorized: true, lastNoticeAt: nil, now: now))
    XCTAssertFalse(DayframeTrackingNoticeCore.shouldNotify(armed: true, alwaysAuthorized: false, lastNoticeAt: nil, now: now))
  }

  func testAtMostOnceInTwentyFourHours() {
    let justUnder = now.addingTimeInterval(-(DayframeTrackingNoticeCore.minimumInterval - 1))
    let exactly = now.addingTimeInterval(-DayframeTrackingNoticeCore.minimumInterval)
    XCTAssertFalse(DayframeTrackingNoticeCore.shouldNotify(armed: true, alwaysAuthorized: true, lastNoticeAt: justUnder, now: now))
    XCTAssertTrue(DayframeTrackingNoticeCore.shouldNotify(armed: true, alwaysAuthorized: true, lastNoticeAt: exactly, now: now))
  }

  func testClockMovedBackwardsDoesNotRepeat() {
    let future = now.addingTimeInterval(60 * 60)
    XCTAssertFalse(DayframeTrackingNoticeCore.shouldNotify(armed: true, alwaysAuthorized: true, lastNoticeAt: future, now: now))
  }
}
