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
  return DayframeSharedFileLockAssertion { log.append("end locked=\(isLockedElsewhere())") }
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
  return DayframeSharedFileLockAssertion { log.append("end") }
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

// Expiry while waiting for another holder: the wait stops at once, the lock is never taken, and the
// assertion ends once (Codex r1 on #524).
let other = open(lockURL.path, O_RDWR)
check(other >= 0 && flock(other, LOCK_EX) == 0, "another description holds the lock again")
var waiting: DayframeSharedFileLockAssertion?
var endedWhileWaiting = 0
DayframeSharedFileLock.install { _ in
  let assertion = DayframeSharedFileLockAssertion { endedWhileWaiting += 1 }
  waiting = assertion
  return assertion
}
DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) { waiting?.expire() }
let waitStarted = Date()
var ranAfterExpiry = false
let expiredWait: Void? = DayframeSharedFileLock.withExclusiveLock(at: lockURL, name: "test", timeout: 5) {
  ranAfterExpiry = true
}
check(expiredWait == nil && !ranAfterExpiry, "an expired wait never runs the body")
check(Date().timeIntervalSince(waitStarted) < 1, "an expiry stops the wait promptly")
Thread.sleep(forTimeInterval: 0.05)
check(endedWhileWaiting == 1, "the expired assertion ends exactly once: \(endedWhileWaiting)")
flock(other, LOCK_UN)
close(other)

// Expiry while the lock is held, even by work slower than any grace period: the expiry itself releases
// the lock, then the assertion ends; the work finishes unlocked (Codex r2 on #524).
var events: [String] = []
let eventsLock = NSLock()
func record(_ event: String) { eventsLock.withLock { events.append(event) } }
var heldAssertion: DayframeSharedFileLockAssertion?
DayframeSharedFileLock.install { _ in
  let assertion = DayframeSharedFileLockAssertion { record("end locked=\(isLockedElsewhere())") }
  heldAssertion = assertion
  return assertion
}
let expiryDone = DispatchSemaphore(value: 0)
let heldResult = DayframeSharedFileLock.withExclusiveLock(at: lockURL, name: "test") { () -> Int in
  record("body start locked=\(isLockedElsewhere())")
  DispatchQueue.global().async {
    heldAssertion?.expire()
    expiryDone.signal()
  }
  expiryDone.wait()
  Thread.sleep(forTimeInterval: 1.2)
  record("body done locked=\(isLockedElsewhere())")
  return 3
}
check(heldResult == 3, "a body already running finishes")
check(events == ["body start locked=true", "end locked=false", "body done locked=false"], "the lock is released before the assertion ends: \(events)")
check(!isLockedElsewhere(), "nothing left locked")

// Expired before the lock is taken: nothing runs and no lock is taken.
DayframeSharedFileLock.install { _ in
  let assertion = DayframeSharedFileLockAssertion {}
  assertion.expire()
  return assertion
}
var ranExpired = false
check(DayframeSharedFileLock.withExclusiveLock(at: lockURL, name: "test") { ranExpired = true } == nil, "expired before start")
check(!ranExpired && !isLockedElsewhere(), "expired before start: nothing runs, no lock")

// end() and expire() together still end the platform assertion once.
var platformEnds = 0
let twice = DayframeSharedFileLockAssertion { platformEnds += 1 }
twice.end()
twice.expire()
twice.end()
check(platformEnds == 1, "exactly-once end: \(platformEnds)")

// The extension's expiring activity: granted, then expired by the system.
final class FakeActivity: @unchecked Sendable {
  var block: (@Sendable (Bool) -> Void)?
  var returned = DispatchSemaphore(value: 0)
}
let granted = FakeActivity()
let grantedAssertion = DayframeSharedFileLock.expiringActivityAssertion("test") { _, block in
  granted.block = block
  DispatchQueue.global().async {
    block(false)
    granted.returned.signal()
  }
}
check(grantedAssertion != nil, "a granted activity gives an assertion")
check(granted.returned.wait(timeout: .now() + 0.1) == .timedOut, "the activity is held while the assertion lives")
DispatchQueue.global().async { granted.block?(true) }
check(granted.returned.wait(timeout: .now() + 2) == .success, "the system's expiry ends the activity")
check(grantedAssertion?.isExpired == true, "and expires the assertion")

// Not granted: no assertion, and the lock helper runs nothing.
let denied = DayframeSharedFileLock.expiringActivityAssertion("test") { _, block in
  DispatchQueue.global().async { block(true) }
}
check(denied == nil, "a refused activity gives no assertion")

// Granted, then ended normally: the activity's block returns.
let normal = FakeActivity()
let normalAssertion = DayframeSharedFileLock.expiringActivityAssertion("test") { _, block in
  DispatchQueue.global().async {
    block(false)
    normal.returned.signal()
  }
}
normalAssertion?.end()
check(normal.returned.wait(timeout: .now() + 2) == .success, "ending the assertion ends the activity")

// Taking the kernel lock and recording it are one step: an expiry right after finds it and releases
// it before the assertion ends; an expiry right before means no lock is taken (Codex r3 on #524).
let raceDescriptor = open(lockURL.path, O_RDWR)
var raceEnds: [Bool] = []
let racing = DayframeSharedFileLockAssertion { raceEnds.append(isLockedElsewhere()) }
check(racing.tryLock(raceDescriptor) == .locked && isLockedElsewhere(), "tryLock takes the lock")
racing.expire()
check(raceEnds == [false], "an expiry right after the lock releases it before ending: \(raceEnds)")
check(racing.tryLock(raceDescriptor) == .expired && !isLockedElsewhere(), "after expiry no lock is taken")
close(raceDescriptor)

print("Native shared file lock validation passed: \(checks) checks.")
