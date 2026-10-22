import Foundation

/// Freeze and crash evidence kept on this iPhone until the person shares it from Sync help (staging
/// freeze, 22 Oct 2026: no hang report, no requests, nothing to diagnose). Foundation only, so
/// `scripts/fixtures/ios-diagnostics` compiles and runs it on macOS.

/// Which thread stopped answering.
enum DayframeStallThread: String, Codable {
  case js
  case main
}

/// How a stall ended, or nil while it is still going.
enum DayframeStallOutcome: String, Codable {
  /// The thread answered again.
  case recovered
  /// Dayframe left the foreground first (the app switcher, a force-close, the Lock Screen).
  case left
}

struct DayframeStallRecord: Codable, Equatable {
  var id: String
  var thread: DayframeStallThread
  /// When the thread last answered before the stall.
  var startedAt: Date
  var durationMs: Int
  var outcome: DayframeStallOutcome?
  /// The labelled JS tasks running when the stall began (fixed labels, never data).
  var jsTasks: [String]
  var lastJsTask: String?
  var appBuild: String?
}

/// Detects a thread that stops answering its once-a-second probe while Dayframe is in front. Times
/// are `systemUptime` seconds, so a wall clock change never makes or hides a stall.
struct DayframeStallTracker {
  static let threshold: TimeInterval = 3
  /// An open stall is saved again at most this often, so a force-close keeps its length.
  static let persistInterval: TimeInterval = 5

  private(set) var active = false
  private var lastAnswer: [DayframeStallThread: TimeInterval] = [:]
  private var open: [DayframeStallThread: DayframeStallRecord] = [:]
  private var lastPersisted: [DayframeStallThread: TimeInterval] = [:]
  /// JS answers only once its watchdog is installed; until then it is never reported.
  private var jsSeen = false

  /// Coming to the front starts every probe afresh: time in the background is never a stall.
  mutating func becameActive(uptime: TimeInterval) {
    active = true
    lastAnswer = [.main: uptime, .js: uptime]
    open = [:]
    lastPersisted = [:]
  }

  /// Leaving the front ends every open stall as `left`; the caller saves what comes back.
  mutating func resignedActive(uptime: TimeInterval) -> [DayframeStallRecord] {
    active = false
    let ended = open.values.map { record -> DayframeStallRecord in
      var record = record
      record.outcome = .left
      record.durationMs = durationMs(record.thread, uptime: uptime)
      return record
    }
    open = [:]
    lastPersisted = [:]
    return ended.sorted { $0.thread.rawValue < $1.thread.rawValue }
  }

  /// A probe answered; an open stall on that thread ends as `recovered`.
  mutating func answered(_ thread: DayframeStallThread, uptime: TimeInterval) -> DayframeStallRecord? {
    if thread == .js { jsSeen = true }
    guard active else { return nil }
    defer { lastAnswer[thread] = uptime }
    guard var record = open.removeValue(forKey: thread) else { return nil }
    lastPersisted[thread] = nil
    record.outcome = .recovered
    record.durationMs = durationMs(thread, uptime: uptime)
    return record
  }

  /// Opens a stall for a thread silent for `threshold`, and returns new or lengthened open stalls
  /// that are due to be saved.
  mutating func check(
    uptime: TimeInterval,
    date: Date,
    jsTasks: [String],
    lastJsTask: String?,
    appBuild: String?,
    makeId: () -> String
  ) -> [DayframeStallRecord] {
    guard active else { return [] }
    var due: [DayframeStallRecord] = []
    for thread in [DayframeStallThread.main, .js] {
      if thread == .js && !jsSeen { continue }
      guard let last = lastAnswer[thread] else { continue }
      let silent = uptime - last
      if var record = open[thread] {
        record.durationMs = durationMs(thread, uptime: uptime)
        open[thread] = record
        if uptime - (lastPersisted[thread] ?? 0) >= Self.persistInterval {
          lastPersisted[thread] = uptime
          due.append(record)
        }
      } else if silent >= Self.threshold {
        let record = DayframeStallRecord(
          id: makeId(),
          thread: thread,
          startedAt: date.addingTimeInterval(-silent),
          durationMs: Int((silent * 1000).rounded()),
          outcome: nil,
          jsTasks: jsTasks,
          lastJsTask: lastJsTask,
          appBuild: appBuild
        )
        open[thread] = record
        lastPersisted[thread] = uptime
        due.append(record)
      }
    }
    return due
  }

  private func durationMs(_ thread: DayframeStallThread, uptime: TimeInterval) -> Int {
    Int((max(0, uptime - (lastAnswer[thread] ?? uptime)) * 1000).rounded())
  }
}

/// MetricKit diagnostics reduced to what support needs at a glance. The full payload (call stacks of
/// binary images and offsets, no user data) is kept alongside, capped in size.
enum DayframeMetricKitSummary {
  static let kinds = [
    "crashDiagnostics": "crash",
    "hangDiagnostics": "hang",
    "cpuExceptionDiagnostics": "cpu",
    "diskWriteExceptionDiagnostics": "diskWrite",
    "appLaunchDiagnostics": "launch"
  ]
  private static let metaDataKeys = [
    "appBuildVersion", "appVersion", "osVersion", "exceptionType", "exceptionCode", "signal",
    "terminationReason", "hangDuration", "launchDuration", "totalCPUTime", "totalSampledTime",
    "writesCaused"
  ]

  static func summarize(_ payload: [String: Any]) -> [[String: Any]] {
    let begin = payload["timeStampBegin"] as? String
    let end = payload["timeStampEnd"] as? String
    return kinds.keys.sorted().flatMap { key -> [[String: Any]] in
      guard let diagnostics = payload[key] as? [[String: Any]] else { return [] }
      return diagnostics.map { diagnostic in
        var summary: [String: Any] = ["kind": kinds[key] ?? key]
        if let begin { summary["timeStampBegin"] = begin }
        if let end { summary["timeStampEnd"] = end }
        let metaData = diagnostic["diagnosticMetaData"] as? [String: Any] ?? [:]
        for name in metaDataKeys {
          if let value = metaData[name], value is String || value is NSNumber {
            summary[name] = value
          }
        }
        return summary
      }
    }
  }

  /// The same payload can be delivered more than once (live, then again in past payloads).
  static func identity(_ payload: [String: Any]) -> String {
    let counts = kinds.keys.sorted().map { "\($0)=\((payload[$0] as? [Any])?.count ?? 0)" }
    let key = ([payload["timeStampBegin"] as? String ?? "", payload["timeStampEnd"] as? String ?? ""] + counts)
      .joined(separator: "|")
    var hash: UInt64 = 0xcbf29ce484222325
    for byte in key.utf8 {
      hash ^= UInt64(byte)
      hash = hash &* 0x100000001b3
    }
    return String(hash, radix: 16)
  }
}

/// Saved in the app's own Application Support (never the App Group, never backed up), bounded.
struct DayframeDiagnosticsStore {
  static let maxStalls = 40
  static let maxReports = 12
  static let maxReportBytes = 400_000

  let directory: URL

  private var stallsURL: URL { directory.appendingPathComponent("stalls-v1.json", isDirectory: false) }

  func stalls() -> [DayframeStallRecord] {
    guard
      let data = try? Data(contentsOf: stallsURL),
      let records = try? Self.decoder.decode([DayframeStallRecord].self, from: data)
    else {
      return []
    }
    return records
  }

  @discardableResult
  func save(_ record: DayframeStallRecord) -> Bool {
    var records = stalls().filter { $0.id != record.id }
    records.append(record)
    records.sort { $0.startedAt < $1.startedAt }
    return write(Array(records.suffix(Self.maxStalls)), to: stallsURL)
  }

  /// Saves one MetricKit payload once. Over the size cap its call stacks are dropped and only the
  /// summary is kept.
  @discardableResult
  func saveReport(_ payload: [String: Any], receivedAt: Date) -> Bool {
    guard prepareDirectory() else { return false }
    let url = directory.appendingPathComponent(
      "metrickit-\(DayframeMetricKitSummary.identity(payload)).json",
      isDirectory: false
    )
    if FileManager.default.fileExists(atPath: url.path) { return true }
    var report: [String: Any] = [
      "receivedAt": ISO8601DateFormatter().string(from: receivedAt),
      "summary": DayframeMetricKitSummary.summarize(payload),
      "payload": payload
    ]
    var data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
    if (data?.count ?? Int.max) > Self.maxReportBytes {
      report["payload"] = nil
      report["payloadOmitted"] = "over \(Self.maxReportBytes) bytes"
      data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
    }
    guard let data, (try? data.write(to: url, options: .atomic)) != nil else { return false }
    pruneReports()
    return true
  }

  /// Newest first.
  func reports() -> [[String: Any]] {
    reportURLs().reversed().compactMap { url in
      guard
        let data = try? Data(contentsOf: url),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        return nil
      }
      return object
    }
  }

  func clear() {
    try? FileManager.default.removeItem(at: stallsURL)
    for url in reportURLs() { try? FileManager.default.removeItem(at: url) }
  }

  /// Oldest first, by when they were saved.
  private func reportURLs() -> [URL] {
    let urls = (try? FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: [.creationDateKey]
    )) ?? []
    return urls
      .filter { $0.lastPathComponent.hasPrefix("metrickit-") && $0.pathExtension == "json" }
      .sorted { left, right in
        let leftDate = (try? left.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
        let rightDate = (try? right.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
        return leftDate == rightDate ? left.lastPathComponent < right.lastPathComponent : leftDate < rightDate
      }
  }

  private func pruneReports() {
    let urls = reportURLs()
    for url in urls.dropLast(Self.maxReports) { try? FileManager.default.removeItem(at: url) }
  }

  private func write(_ records: [DayframeStallRecord], to url: URL) -> Bool {
    guard prepareDirectory(), let data = try? Self.encoder.encode(records) else { return false }
    return (try? data.write(to: url, options: .atomic)) != nil
  }

  private func prepareDirectory() -> Bool {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      var url = directory
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? url.setResourceValues(values)
      return true
    } catch {
      return false
    }
  }

  private static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }()

  private static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }()
}
