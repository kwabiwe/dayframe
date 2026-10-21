import Foundation

/// The one decision made while iOS ends Dayframe: post the tracking-stopped
/// notice or not. Pure so it can be tested without UIKit.
public enum DayframeTrackingNoticeCore {
  /// "At most once a day": a rolling 24 hours since the last notice.
  public static let minimumInterval: TimeInterval = 24 * 60 * 60

  /// - Parameters:
  ///   - armed: JavaScript's latest word: the switch is on, notifications are
  ///     allowed, and this account's location tracking is on with Always access.
  ///   - alwaysAuthorized: Location is Always right now (read at termination).
  ///   - lastNoticeAt: when the previous notice was posted, if ever.
  public static func shouldNotify(
    armed: Bool,
    alwaysAuthorized: Bool,
    lastNoticeAt: Date?,
    now: Date
  ) -> Bool {
    guard armed, alwaysAuthorized else { return false }
    guard let lastNoticeAt else { return true }
    // A clock moved backwards counts as recent, never as a reason to repeat.
    let elapsed = now.timeIntervalSince(lastNoticeAt)
    return elapsed >= minimumInterval
  }
}
