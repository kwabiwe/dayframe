import CoreLocation
import Foundation
import UserNotifications

/// Posts one calm local notice when iOS ends Dayframe while location tracking
/// is on. iOS calls `applicationWillTerminate` when the person closes Dayframe
/// from the app switcher while it is running (continuous location keeps it
/// running in the background), so the notice is added from there, before the
/// process exits. A suspended app gets no callback; when iOS itself ends
/// Dayframe, location relaunches it and tracking resumes, so no notice is due.
/// JavaScript keeps `armed` current; nothing here reads location or account data.
final class DayframeTrackingNoticeService {
  static let shared = DayframeTrackingNoticeService()

  static let notificationIdentifier = "dayframe-tracking-stopped"
  static let body = "Dayframe isn't tracking locations — open it to resume"
  private static let armedKey = "dayframe.trackingNotice.armed.v1"
  private static let lastNoticeKey = "dayframe.trackingNotice.lastNoticeAt.v1"
  private static let lastTerminationKey = "dayframe.trackingNotice.lastTerminationAt.v1"
  /// The process exits soon after `applicationWillTerminate` returns; wait at
  /// most this long for the notification centre to accept the request.
  private static let addTimeoutSeconds: TimeInterval = 2

  private let defaults = UserDefaults.standard

  func setArmed(_ armed: Bool) {
    defaults.set(armed, forKey: Self.armedKey)
  }

  /// Any new process means Dayframe runs again: the notice no longer applies.
  func clearNotice() {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [Self.notificationIdentifier])
    center.removeDeliveredNotifications(withIdentifiers: [Self.notificationIdentifier])
  }

  func applicationWillTerminate() {
    let now = Date()
    defaults.set(now.timeIntervalSince1970, forKey: Self.lastTerminationKey)
    let alwaysAuthorized = CLLocationManager().authorizationStatus == .authorizedAlways
    guard DayframeTrackingNoticeCore.shouldNotify(
      armed: defaults.bool(forKey: Self.armedKey),
      alwaysAuthorized: alwaysAuthorized,
      lastNoticeAt: storedDate(Self.lastNoticeKey),
      now: now
    ) else { return }

    let content = UNMutableNotificationContent()
    content.body = Self.body
    content.userInfo = ["kind": "tracking-stopped"]
    // Calm: no sound, and never a time-sensitive break-through.
    content.interruptionLevel = .active
    let request = UNNotificationRequest(identifier: Self.notificationIdentifier, content: content, trigger: nil)

    let outcome = AddOutcome()
    UNUserNotificationCenter.current().add(request) { error in
      outcome.finish(succeeded: error == nil)
    }
    // Without notification permission the add fails, and the daily allowance stays unused.
    if outcome.wait(seconds: Self.addTimeoutSeconds) {
      defaults.set(now.timeIntervalSince1970, forKey: Self.lastNoticeKey)
    }
  }

  func status() -> [String: Any] {
    var status: [String: Any] = ["armed": defaults.bool(forKey: Self.armedKey)]
    if let date = storedDate(Self.lastNoticeKey) { status["lastNoticeAt"] = date.timeIntervalSince1970 * 1000 }
    if let date = storedDate(Self.lastTerminationKey) { status["lastTerminationAt"] = date.timeIntervalSince1970 * 1000 }
    return status
  }

  private func storedDate(_ key: String) -> Date? {
    let seconds = defaults.double(forKey: key)
    return seconds > 0 ? Date(timeIntervalSince1970: seconds) : nil
  }
}

/// Hands the notification centre's answer back to the terminating main thread.
private final class AddOutcome: @unchecked Sendable {
  private let lock = NSLock()
  private let done = DispatchSemaphore(value: 0)
  private var succeeded = false

  func finish(succeeded: Bool) {
    lock.lock()
    self.succeeded = succeeded
    lock.unlock()
    done.signal()
  }

  /// True only when the request was accepted within the time allowed.
  func wait(seconds: TimeInterval) -> Bool {
    guard done.wait(timeout: .now() + seconds) == .success else { return false }
    lock.lock()
    defer { lock.unlock() }
    return succeeded
  }
}
