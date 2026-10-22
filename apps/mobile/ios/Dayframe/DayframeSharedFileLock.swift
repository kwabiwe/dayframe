import Darwin
import Foundation

/// The only way native code may lock a file in the App Group container.
///
/// iOS kills a suspended process that still holds a file lock in a shared container (0xDEAD10CC;
/// TestFlight 124 and 125, 22 Oct 2026, while the shortcut queue's lock was held through a UserDefaults
/// change notification). So every lock here is taken inside a finite background assertion that begins
/// before the lock and ends only after it is released, waits a bounded time for another process's
/// lock, and refuses to run at all when the system grants no assertion. When the system expires the
/// assertion, a wait stops without taking the lock, and a held lock is released before the assertion
/// ends. Callers do only file I/O while the lock is held; reads of atomically written files need no lock.
enum DayframeSharedFileLock {
  /// Begins a finite assertion that keeps the process from being suspended, or returns nil when the
  /// system grants none. The app installs a UIKit background task at launch; an app extension keeps
  /// the default `ProcessInfo` activity, which does not expire.
  typealias AssertionProvider = (_ name: String) -> DayframeSharedFileLockAssertion?

  private static let providerLock = NSLock()
  // Guarded by providerLock.
  nonisolated(unsafe) private static var provider: AssertionProvider = processActivityAssertion

  static func install(_ assertionProvider: @escaping AssertionProvider) {
    providerLock.withLock { provider = assertionProvider }
  }

  static func withExclusiveLock<T>(
    at lockURL: URL,
    name: String,
    timeout: TimeInterval = 2,
    _ body: () -> T
  ) -> T? {
    let beginAssertion = providerLock.withLock { provider }
    guard let assertion = beginAssertion(name) else {
      return nil
    }
    defer { assertion.end() }
    // Held from before the wait until after the unlock, so an expiry waits for the unlock.
    guard assertion.hold() else {
      return nil
    }
    defer { assertion.releaseHold() }

    let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else {
      return nil
    }
    defer { close(descriptor) }
    guard acquire(descriptor, timeout: timeout, stop: { assertion.isExpired }) else {
      return nil
    }
    defer { flock(descriptor, LOCK_UN) }
    guard !assertion.isExpired else {
      return nil
    }
    return body()
  }

  private static func acquire(_ descriptor: Int32, timeout: TimeInterval, stop: () -> Bool) -> Bool {
    let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(max(0, timeout) * 1_000_000_000)
    while !stop() {
      if flock(descriptor, LOCK_EX | LOCK_NB) == 0 {
        return true
      }
      let failure = errno
      guard failure == EWOULDBLOCK || failure == EINTR, DispatchTime.now().uptimeNanoseconds < deadline else {
        return false
      }
      usleep(10_000)
    }
    return false
  }

  private static func processActivityAssertion(_ name: String) -> DayframeSharedFileLockAssertion? {
    let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: name)
    return DayframeSharedFileLockAssertion { ProcessInfo.processInfo.endActivity(activity) }
  }
}

/// One granted assertion. `end()` releases it exactly once; `expire()` is the system taking it back,
/// which stops any wait for the lock and lets a held lock be released first.
final class DayframeSharedFileLockAssertion: @unchecked Sendable {
  /// How long an expiry waits for a held lock to be released before ending the assertion anyway. The
  /// locked work is a small file write; UIKit allows a few seconds after the expiration handler starts.
  static let expiryGrace: TimeInterval = 1

  private let condition = NSCondition()
  private var expired = false
  private var holding = false
  private var ended = false
  private let endPlatform: () -> Void

  init(end: @escaping () -> Void) {
    endPlatform = end
  }

  var isExpired: Bool {
    condition.withLock { expired }
  }

  /// Marks the lock as about to be taken, or returns false once the assertion has expired or ended.
  func hold() -> Bool {
    condition.withLock {
      guard !expired && !ended else { return false }
      holding = true
      return true
    }
  }

  func releaseHold() {
    condition.withLock {
      holding = false
      condition.broadcast()
    }
  }

  /// The system's expiry: no new lock, a held one released first (bounded), then the assertion ends.
  func expire() {
    condition.withLock {
      expired = true
      let deadline = Date().addingTimeInterval(Self.expiryGrace)
      while holding && condition.wait(until: deadline) {}
    }
    end()
  }

  func end() {
    let first = condition.withLock { () -> Bool in
      defer { ended = true }
      return !ended
    }
    if first { endPlatform() }
  }
}
