import Darwin
import Foundation

/// The only way native code may lock a file in the App Group container.
///
/// iOS kills a suspended process that still holds a file lock in a shared container (0xDEAD10CC;
/// TestFlight 124, 22 Oct 2026, while the shortcut queue's lock was held through a UserDefaults
/// change notification). So every lock here is taken inside a finite background assertion that begins
/// before the lock and ends only after it is released, waits a bounded time for another process's
/// lock, and refuses to run at all when the system grants no assertion. Callers do only file I/O while
/// the lock is held; reads of atomically written files need no lock.
enum DayframeSharedFileLock {
  /// Begins a finite assertion that keeps the process from being suspended and returns the closure that
  /// ends it, or nil when the system grants none. The app installs a UIKit background task at launch;
  /// an app extension keeps the default `ProcessInfo` activity.
  typealias AssertionProvider = (_ name: String) -> (() -> Void)?

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
    guard let endAssertion = beginAssertion(name) else {
      return nil
    }
    defer { endAssertion() }

    let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else {
      return nil
    }
    defer { close(descriptor) }
    guard acquire(descriptor, timeout: timeout) else {
      return nil
    }
    defer { flock(descriptor, LOCK_UN) }
    return body()
  }

  private static func acquire(_ descriptor: Int32, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(max(0, timeout))
    while true {
      if flock(descriptor, LOCK_EX | LOCK_NB) == 0 {
        return true
      }
      let failure = errno
      guard failure == EWOULDBLOCK || failure == EINTR, Date() < deadline else {
        return false
      }
      usleep(10_000)
    }
  }

  private static func processActivityAssertion(_ name: String) -> (() -> Void)? {
    let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: name)
    return { ProcessInfo.processInfo.endActivity(activity) }
  }
}
