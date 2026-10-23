import Foundation

struct DayframeLocationSignal: Codable, Sendable {
  let id: String
  let kind: String
  let occurredAt: String
  let endedAt: String?
  let latitude: Double?
  let longitude: Double?
  let horizontalAccuracyMeters: Double?
  let metadata: [String: String]
  /// Significant-change fixes only. Optional so earlier queued records still decode.
  var speedMetersPerSecond: Double? = nil

  var dictionary: [String: Any] {
    var result: [String: Any] = [
      "id": id,
      "kind": kind,
      "occurredAt": occurredAt,
      "metadata": metadata
    ]
    result["endedAt"] = endedAt ?? NSNull()
    result["latitude"] = latitude ?? NSNull()
    result["longitude"] = longitude ?? NSNull()
    result["horizontalAccuracyMeters"] = horizontalAccuracyMeters ?? NSNull()
    result["speedMetersPerSecond"] = speedMetersPerSecond ?? NSNull()
    return result
  }
}

/// The durable native signal journal: one JSON record per line in the app's own container (not an
/// App Group, so no other process opens it and no shared-file lock applies). Every file operation
/// runs on `queue`. CoreLocation callbacks append without waiting for it, and an append writes one
/// line at the end of the file instead of rewriting the journal; pruning and compaction happen when
/// JavaScript drains or acknowledges records, which runs off the main thread (stability audit
/// 22 Oct 2026, iphone-native-3).
final class DayframeLocationSignalStore: @unchecked Sendable {
  static let shared = DayframeLocationSignalStore()

  private let queue: DispatchQueue
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()
  private let maximumCount: Int?
  private let retentionSeconds: TimeInterval
  private let now: () -> Date
  private let fileURL: URL?
  // Queue-owned: the journal's records in file order, read from disk once.
  private var storageErrorCode: String?
  private var cached: [DayframeLocationSignal]?
  private var cachedIds: Set<String> = []

  init(
    fileURL: URL? = nil,
    maximumCount: Int? = nil,
    retentionSeconds: TimeInterval = 7 * 24 * 60 * 60,
    now: @escaping () -> Date = Date.init,
    queue: DispatchQueue = DispatchQueue(label: "com.dayframe.location-signals", qos: .utility)
  ) {
    self.maximumCount = maximumCount
    self.retentionSeconds = retentionSeconds
    self.now = now
    self.queue = queue
    if let fileURL {
      self.fileURL = fileURL
      return
    }
    do {
      let manager = FileManager.default
      let support = try manager.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let directory = support.appendingPathComponent("DayframeLocation", isDirectory: true)
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      try (directory as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
      self.fileURL = directory.appendingPathComponent("signals.json")
    } catch {
      self.fileURL = nil
      self.storageErrorCode = "storage_directory_unavailable"
    }
  }

  /// Never waits for the store: the record is written on the store's serial queue, so a later
  /// read, count or remove still sees it.
  func append(_ signal: DayframeLocationSignal) {
    queue.async { self.appendUnlocked(signal) }
  }

  func read(limit: Int) -> [DayframeLocationSignal] {
    queue.sync { Array(compactedUnlocked().prefix(limit)) }
  }

  func count() -> Int {
    queue.sync { compactedUnlocked().count }
  }

  func lastErrorCode() -> String? {
    queue.sync { storageErrorCode }
  }

  /// The pending count and storage error together, for the status call. Waits for the store queue,
  /// so it must not run on the main thread.
  func statusFields() -> (pendingCount: Int, errorCode: String?) {
    queue.sync { (compactedUnlocked().count, storageErrorCode) }
  }

  @discardableResult
  func remove(ids: Set<String>) -> Int {
    queue.sync {
      let existing = prune(loadedUnlocked())
      let retained = existing.filter { !ids.contains($0.id) }
      persistUnlocked(retained)
      return existing.count - retained.count
    }
  }

  @discardableResult
  func removeAll() -> Int {
    queue.sync {
      let count = loadedUnlocked().count
      persistUnlocked([])
      return count
    }
  }

  private func appendUnlocked(_ signal: DayframeLocationSignal) {
    if expiredOldestRecordUnlocked() {
      persistUnlocked(prune(loadedUnlocked()))
    }
    guard !cachedIds.contains(signal.id), let fileURL else { return }
    guard let record = try? encoder.encode(signal) else { return }
    // Each record starts a new line, so a record cut short by an earlier interrupted write stays
    // on its own line and is skipped when read, never joined to this one.
    var line = Data("\n".utf8)
    line.append(record)
    do {
      if FileManager.default.fileExists(atPath: fileURL.path) {
        let handle = try FileHandle(forWritingTo: fileURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
      } else {
        try line.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try (fileURL as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
      }
      cached?.append(signal)
      cachedIds.insert(signal.id)
      storageErrorCode = nil
    } catch {
      storageErrorCode = "storage_write_failed"
      return
    }
    if let maximumCount, let count = cached?.count, count > maximumCount {
      persistUnlocked(prune(loadedUnlocked()))
    }
  }

  /// Compaction on append is rare: only when the oldest record has expired.
  private func expiredOldestRecordUnlocked() -> Bool {
    guard let first = loadedUnlocked().first else { return false }
    return !isRetained(first)
  }

  private func loadedUnlocked() -> [DayframeLocationSignal] {
    if let cached { return cached }
    guard let fileURL else { return [] }
    var loaded: [DayframeLocationSignal] = []
    if FileManager.default.fileExists(atPath: fileURL.path) {
      // A journal that exists but cannot be read yet (protected data before the first unlock after a
      // restart) is not cached as empty: the next call reads it again, so its records are never hidden.
      guard let data = try? Data(contentsOf: fileURL),
            let text = String(data: data, encoding: .utf8) else { return [] }
      loaded = text.split(separator: "\n").compactMap { line in
        try? decoder.decode(DayframeLocationSignal.self, from: Data(line.utf8))
      }
    }
    cached = loaded
    cachedIds = Set(loaded.map(\.id))
    return loaded
  }

  private func persistUnlocked(_ signals: [DayframeLocationSignal]) {
    guard let fileURL else { return }
    let records = signals.compactMap { signal in
      (try? encoder.encode(signal)).flatMap { String(data: $0, encoding: .utf8) }
    }
    guard let data = records.joined(separator: "\n").data(using: .utf8) else { return }
    do {
      try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      try (fileURL as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
      cached = signals
      cachedIds = Set(signals.map(\.id))
      storageErrorCode = nil
    } catch {
      storageErrorCode = "storage_write_failed"
    }
  }

  private func compactedUnlocked() -> [DayframeLocationSignal] {
    let existing = loadedUnlocked()
    let retained = prune(existing)
    if retained.count != existing.count {
      persistUnlocked(retained)
    }
    return retained
  }

  private func isRetained(_ signal: DayframeLocationSignal) -> Bool {
    let cutoff = now().addingTimeInterval(-retentionSeconds)
    return DayframeSignalTime.parse(signal.occurredAt).map { $0 >= cutoff } ?? false
  }

  private func prune(_ signals: [DayframeLocationSignal]) -> [DayframeLocationSignal] {
    let retained = signals.filter(isRetained)
    guard let maximumCount else { return retained }
    return Array(retained.suffix(maximumCount))
  }
}

/// Signal timestamps. Visits keep whole seconds (their two callbacks pair on the
/// exact arrival text); significant-change fixes and callback times keep milliseconds.
enum DayframeSignalTime {
  // Reused because retention parses every journal record. ISO8601DateFormatter
  // is thread-safe, and these are never mutated after creation.
  nonisolated(unsafe) private static let wholeSeconds = ISO8601DateFormatter()
  nonisolated(unsafe) private static let fractionalSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  static func seconds(_ date: Date) -> String {
    wholeSeconds.string(from: date)
  }

  static func milliseconds(_ date: Date) -> String {
    fractionalSeconds.string(from: date)
  }

  static func parse(_ text: String) -> Date? {
    fractionalSeconds.date(from: text) ?? wholeSeconds.date(from: text)
  }
}
