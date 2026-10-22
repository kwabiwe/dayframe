import Darwin
import Foundation

// Compile and execute the exact shared-file lock linked into both native targets (TestFlight 124
// 0xDEAD10CC): the lock is only ever held inside a background assertion.
var checks = 0
func check(_ condition: Bool, _ label: String) {
  precondition(condition, label)
  checks += 1
}

let directory = FileManager.default.temporaryDirectory
  .appendingPathComponent("dayframe-shared-file-lock-\(UUID().uuidString)", isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
let lockURL = directory.appendingPathComponent("queue.lock", isDirectory: false)

var log: [String] = []
func isLockedElsewhere() -> Bool {
  let probe = open(lockURL.path, O_RDWR)
  guard probe >= 0 else { return false }
  defer { close(probe) }
  if flock(probe, LOCK_EX | LOCK_NB) == 0 {
    flock(probe, LOCK_UN)
    return false
  }
  return true
}
DayframeSharedFileLock.install { name in
  log.append("begin \(name)")
  return { log.append("end locked=\(isLockedElsewhere())") }
}

// The assertion begins before the lock and ends after its release; the body runs once, locked.
let value = DayframeSharedFileLock.withExclusiveLock(at: lockURL, name: "test") { () -> Int in
  log.append("body locked=\(isLockedElsewhere())")
  return 7
}
check(value == 7, "body result is returned")
check(log == ["begin test", "body locked=true", "end locked=false"], "assertion wraps the lock: \(log)")

// No assertion granted: the lock is never taken and the body never runs.
log = []
DayframeSharedFileLock.install { _ in
  log.append("denied")
  return nil
}
var ranWithoutAssertion = false
check(
  DayframeSharedFileLock.withExclusiveLock(at: lockURL, name: "test") { ranWithoutAssertion = true } == nil,
  "denied assertion returns nil"
)
check(!ranWithoutAssertion && !isLockedElsewhere(), "denied assertion runs nothing and takes no lock")

// Another holder: the wait is bounded, the body never runs, and the assertion still ends.
log = []
DayframeSharedFileLock.install { name in
  log.append("begin \(name)")
  return { log.append("end") }
}
let holder = open(lockURL.path, O_RDWR)
check(holder >= 0 && flock(holder, LOCK_EX) == 0, "another description holds the lock")
let started = Date()
var ranWhileHeld = false
let contended: Void? = DayframeSharedFileLock.withExclusiveLock(at: lockURL, name: "test", timeout: 0.2) {
  ranWhileHeld = true
}
let waited = Date().timeIntervalSince(started)
check(contended == nil && !ranWhileHeld, "a held lock is not stolen")
check(waited >= 0.2 && waited < 1.5, "the wait is bounded: \(waited)")
check(log == ["begin test", "end"], "the assertion ends after a timed-out wait: \(log)")

// Released by the other holder within the timeout: the body runs.
log = []
DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) {
  flock(holder, LOCK_UN)
  close(holder)
}
check(
  DayframeSharedFileLock.withExclusiveLock(at: lockURL, name: "test", timeout: 2) { true } == true,
  "a lock released within the timeout is taken"
)

// An unopenable lock path still ends the assertion.
log = []
let missing = directory.appendingPathComponent("missing/queue.lock", isDirectory: false)
check(DayframeSharedFileLock.withExclusiveLock(at: missing, name: "test") { true } == nil, "open failure")
check(log == ["begin test", "end"], "the assertion ends after an open failure: \(log)")

print("Native shared file lock validation passed: \(checks) checks.")
