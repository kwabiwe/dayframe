import Foundation

/// The one decision made while iOS ends Dayframe: post the tracking-stopped
/// notice or not. Pure so it can be tested without UIKit.
public enum DayframeTrackingNoticeCore {
  /// "At most once a day": a rolling 24 hours since the last notice.
  public static let minimumInterval: TimeInterval = 24 * 60 * 60

  /// - Parameters:
  ///   - armed: JavaScript's latest word: the switch is on, notifications are
  ///     allowed, and this account's location tracking is on with Always access.
  ///     Nothing is re-read at termination: iOS kills an app whose main thread
  ///     is still busy after 5 s, and a CoreLocation read waits on locationd
  ///     (staging iPhone, 23 Oct 2026: 0x8BADF00D while `CLLocationManager()`
  ///     waited at a serious thermal state).
  ///   - lastNoticeAt: when the previous notice was posted, if ever.
  public static func shouldNotify(
    armed: Bool,
    lastNoticeAt: Date?,
    now: Date
  ) -> Bool {
    guard armed else { return false }
    guard let lastNoticeAt else { return true }
    // A clock moved backwards counts as recent, never as a reason to repeat.
    let elapsed = now.timeIntervalSince(lastNoticeAt)
    return elapsed >= minimumInterval
  }
}
