import Darwin
import Foundation

/// The only way native code may lock a file in the App Group container.
///
/// iOS kills a suspended process that still holds a file lock in a shared container (0xDEAD10CC;
/// TestFlight 124 and 125, 22 Oct 2026, while the shortcut queue's lock was held through a UserDefaults
/// change notification). So every lock here is taken inside a finite background assertion that begins
/// before the lock and ends only after it is released, waits a bounded time for another process's
/// lock, and refuses to run at all when the system grants no assertion. When the system expires the
/// assertion, a wait stops without taking the lock, and a held lock is released by the expiry itself
/// before the assertion ends; work still running then finishes unlocked (its writes are atomic file
/// replacements). Callers do only file I/O while locked; reads of atomically written files take no lock.
enum DayframeSharedFileLock {
  /// Begins a finite assertion that keeps the process from being suspended, or returns nil when the
  /// system grants none. The app installs a UIKit background task at launch; an app extension keeps the
  /// default, an expiring `ProcessInfo` activity.
  typealias AssertionProvider = (_ name: String) -> DayframeSharedFileLockAssertion?

  private static let providerLock = NSLock()
  // Guarded by providerLock.
  nonisolated(unsafe) private static var provider: AssertionProvider = defaultAssertion

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

    let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else {
      return nil
    }
    defer { close(descriptor) }
    guard acquire(descriptor, timeout: timeout, assertion: assertion) else {
      return nil
    }
    // Unlock, then let the assertion forget the descriptor, before it is closed and before the
    // assertion ends. An expiry in between unlocks the same open descriptor again, harmlessly.
    defer {
      flock(descriptor, LOCK_UN)
      assertion.unlocked()
    }
    return body()
  }

  private static func acquire(
    _ descriptor: Int32,
    timeout: TimeInterval,
    assertion: DayframeSharedFileLockAssertion
  ) -> Bool {
    let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(max(0, timeout) * 1_000_000_000)
    while true {
      switch assertion.tryLock(descriptor) {
      case .locked:
        return true
      case .expired, .failed:
        return false
      case .busy:
        guard DispatchTime.now().uptimeNanoseconds < deadline else { return false }
        usleep(10_000)
      }
    }
  }

  /// An assertion from an expiring-activity API shaped like `ProcessInfo.performExpiringActivity`: its
  /// block runs with `false` when granted (and must not return until the work ends), and again with
  /// `true` on expiry — or only with `true` when nothing is granted. Taken as a parameter so the macOS
  /// fixture can drive it; iOS passes the real API.
  static func expiringActivityAssertion(
    _ name: String,
    perform: (_ reason: String, _ block: @escaping @Sendable (_ expired: Bool) -> Void) -> Void
  ) -> DayframeSharedFileLockAssertion? {
    let finished = DispatchSemaphore(value: 0)
    let decided = DispatchSemaphore(value: 0)
    let assertion = DayframeSharedFileLockAssertion { finished.signal() }
    let grant = DayframeSharedFileLockGrant()
    perform(name) { expired in
      if expired {
        // Not granted: report it. Granted earlier: the system is taking it back.
        if grant.decide(granted: false) { decided.signal() } else { assertion.expire() }
        return
      }
      guard grant.decide(granted: true) else { return }
      decided.signal()
      finished.wait()
    }
    decided.wait()
    return grant.granted ? assertion : nil
  }

  private static func defaultAssertion(_ name: String) -> DayframeSharedFileLockAssertion? {
#if os(iOS)
    expiringActivityAssertion(name) { reason, block in
      ProcessInfo.processInfo.performExpiringActivity(withReason: reason, using: block)
    }
#else
    let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: name)
    return DayframeSharedFileLockAssertion { ProcessInfo.processInfo.endActivity(activity) }
#endif
  }
}

/// Whether an expiring activity was granted, decided by whichever of its callbacks comes first.
private final class DayframeSharedFileLockGrant: @unchecked Sendable {
  private let lock = NSLock()
  private var decision: Bool?

  var granted: Bool {
    lock.withLock { decision == true }
  }

  /// Records the first decision; false when one was already made.
  func decide(granted: Bool) -> Bool {
    lock.withLock {
      guard decision == nil else { return false }
      decision = granted
      return true
    }
  }
}

/// One granted assertion. `end()` releases it exactly once. `expire()` is the system taking it back: it
/// stops any wait for the lock, releases a held lock itself, then ends — so the platform assertion never
/// ends while the file is locked, however long the locked work runs.
final class DayframeSharedFileLockAssertion: @unchecked Sendable {
  private let lock = NSLock()
  private var expired = false
  private var ended = false
  private var lockedDescriptor: Int32?
  private let endPlatform: () -> Void

  init(end: @escaping () -> Void) {
    endPlatform = end
  }

  var isExpired: Bool {
    lock.withLock { expired }
  }

  enum Attempt {
    case locked
    case busy
    case expired
    case failed
  }

  /// One non-blocking attempt at the file lock. The attempt and the record of the locked descriptor
  /// happen under this assertion's lock, so an expiry is either before it (no lock is taken) or after
  /// it (the expiry releases the lock); never between the two (Codex r3 on #524).
  func tryLock(_ descriptor: Int32) -> Attempt {
    lock.withLock {
      guard !expired && !ended else { return .expired }
      if flock(descriptor, LOCK_EX | LOCK_NB) == 0 {
        lockedDescriptor = descriptor
        return .locked
      }
      let failure = errno
      return failure == EWOULDBLOCK || failure == EINTR ? .busy : .failed
    }
  }

  /// The caller has unlocked; the descriptor is about to be closed.
  func unlocked() {
    lock.withLock { lockedDescriptor = nil }
  }

  func expire() {
    lock.withLock {
      expired = true
      if let descriptor = lockedDescriptor {
        flock(descriptor, LOCK_UN)
        lockedDescriptor = nil
      }
    }
    end()
  }

  func end() {
    let first = lock.withLock { () -> Bool in
      defer { ended = true }
      return !ended
    }
    if first { endPlatform() }
  }
}
