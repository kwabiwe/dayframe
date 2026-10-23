import Foundation

// Compile and execute the exact native Location signal journal linked into the app. A CoreLocation
// callback must not wait for the journal or rewrite it in full: the TestFlight 125 report showed the
// main thread blocked in this service (stability audit 22 Oct 2026, finding 11 / iphone-native-3).
var checks = 0
func check(_ condition: Bool, _ label: String) {
  precondition(condition, label)
  checks += 1
}

let directory = FileManager.default.temporaryDirectory
  .appendingPathComponent("dayframe-location-signals-\(UUID().uuidString)", isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
var files = 0
func journalURL() -> URL {
  files += 1
  return directory.appendingPathComponent("signals-\(files).json")
}

let base = Date(timeIntervalSince1970: 1_800_000_000)
func signal(_ id: String, at date: Date = base) -> DayframeLocationSignal {
  // Synthetic fixture: no real place, coordinate or timeline.
  DayframeLocationSignal(
    id: id, kind: "significant_change", occurredAt: DayframeSignalTime.milliseconds(date),
    endedAt: nil, latitude: nil, longitude: nil, horizontalAccuracyMeters: nil, metadata: [:]
  )
}
func inode(_ url: URL) -> UInt64? {
  (try? FileManager.default.attributesOfItem(atPath: url.path))?[.systemFileNumber] as? UInt64
}
func bytes(_ url: URL) -> Data { (try? Data(contentsOf: url)) ?? Data() }

// Appends add one line at the end of the same file; earlier bytes are never rewritten.
do {
  let url = journalURL()
  let store = DayframeLocationSignalStore(fileURL: url, now: { base })
  store.append(signal("first"))
  check(store.count() == 1, "first record stored")
  let firstInode = inode(url)
  var previous = bytes(url)
  for index in 0..<2_000 {
    store.append(signal("record-\(index)"))
  }
  check(store.count() == 2_001, "every append is kept")
  check(inode(url) == firstInode, "appends never replace the journal file")
  let after = bytes(url)
  check(after.starts(with: previous), "earlier records keep their bytes")
  previous = after
  store.append(signal("record-0"))
  check(store.count() == 2_001 && bytes(url) == previous, "a duplicate callback writes nothing")
  check(store.read(limit: 3).map(\.id) == ["first", "record-0", "record-1"], "records keep their order")
  check(store.lastErrorCode() == nil, "no storage error")
}

// A record cut short by an interrupted write is skipped; records on either side survive.
do {
  let url = journalURL()
  try Data((String(data: try JSONEncoder().encode(signal("complete")), encoding: .utf8)! + "\n{\"id\":\"partial").utf8)
    .write(to: url)
  let store = DayframeLocationSignalStore(fileURL: url, now: { base })
  store.append(signal("after-recovery"))
  check(store.read(limit: 100).map(\.id) == ["complete", "after-recovery"], "partial record skipped")
  let restored = DayframeLocationSignalStore(fileURL: url, now: { base })
  check(restored.read(limit: 100).map(\.id) == ["complete", "after-recovery"], "journal survives recreation")
}

// A journal that cannot be read yet (protected data before the first unlock) is read again later,
// never cached as empty, so its records are not hidden or compacted away.
do {
  let url = journalURL()
  let writer = DayframeLocationSignalStore(fileURL: url, now: { base })
  writer.append(signal("before-restart"))
  check(writer.count() == 1, "record written before the restart")
  try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: url.path)
  let store = DayframeLocationSignalStore(fileURL: url, now: { base })
  check(store.count() == 0, "an unreadable journal reads as empty")
  store.append(signal("while-locked"))
  check(store.lastErrorCode() == "storage_write_failed", "a locked journal reports the failed write")
  try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
  store.append(signal("after-unlock"))
  check(store.read(limit: 100).map(\.id) == ["before-restart", "after-unlock"], "records written before the lock reappear")
}

// Retention still prunes: on read, and on append once the oldest record has expired.
do {
  let url = journalURL()
  var clock = base
  let store = DayframeLocationSignalStore(fileURL: url, retentionSeconds: 60, now: { clock })
  store.append(signal("old"))
  check(store.count() == 1, "fresh record kept")
  clock = base.addingTimeInterval(120)
  store.append(signal("new", at: clock))
  check(store.read(limit: 100).map(\.id) == ["new"], "expired record pruned")
  check(DayframeLocationSignalStore(fileURL: url, retentionSeconds: 60, now: { clock }).read(limit: 100).map(\.id) == ["new"],
        "pruned record gone from disk")
  check(store.remove(ids: ["new"]) == 1 && store.read(limit: 100).isEmpty, "acknowledged records removed")
  store.append(signal("later", at: clock))
  check(store.removeAll() == 1 && bytes(url).isEmpty, "remove all empties the journal")
}

// A CoreLocation callback never waits for the store: append returns while the store's queue is busy
// (JavaScript draining the journal), and the record is still there afterwards.
do {
  let url = journalURL()
  let queue = DispatchQueue(label: "fixture.location-signals")
  let store = DayframeLocationSignalStore(fileURL: url, now: { base }, queue: queue)
  let busy = DispatchSemaphore(value: 0)
  queue.async { busy.wait() }
  let returned = DispatchSemaphore(value: 0)
  Thread.detachNewThread {
    store.append(signal("while-draining"))
    returned.signal()
  }
  check(returned.wait(timeout: .now() + 2) == .success, "append does not wait for a busy store")
  busy.signal()
  let fields = store.statusFields()
  check(fields.pendingCount == 1 && fields.errorCode == nil, "status fields count the queued record")
}

print("ios location signal store: \(checks) checks passed")
