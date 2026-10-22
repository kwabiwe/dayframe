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

/// What a new stall record is stamped with.
struct DayframeStallContext {
  var date: Date
  /// For a JS stall: every label running since JS last answered (a label can end just before JS
  /// answers again, so the current set alone would miss the work that held it).
  var jsTasks: [String]
  var lastJsTask: String?
  var appBuild: String?
  var makeId: () -> String
}

/// Detects a thread that stops answering while Dayframe is in front. Main is probed: a probe sent and
/// not answered for `threshold` is a stall, timed from the probe, so a late watchdog tick never counts
/// as main being blocked. JS answers on its own once-a-second timer: a gap of `threshold` between its
/// answers is a stall. A gap found only when the answer arrives (between two checks), or when Dayframe
/// leaves the front, is still recorded. Times are `systemUptime` seconds, so a wall clock change never
/// makes or hides a stall.
struct DayframeStallTracker {
  static let threshold: TimeInterval = 3
  /// An open stall is saved again at most this often, so a force-close keeps its length.
  static let persistInterval: TimeInterval = 5

  private(set) var active = false
  private var pendingMainProbe: TimeInterval?
  private var lastJsAnswer: TimeInterval?
  /// JS has answered at least once in this process (its watchdog is installed).
  private var jsInstalled = false
  private var open: [DayframeStallThread: DayframeStallRecord] = [:]
  private var lastPersisted: [DayframeStallThread: TimeInterval] = [:]

  /// Coming to the front starts every probe afresh: time in the background is never a stall. JS is
  /// watched from this moment once its watchdog has ever answered, so a JS thread that is stuck when
  /// Dayframe returns is caught (Codex r2 on #525); before its first answer it is not watched.
  mutating func becameActive(uptime: TimeInterval) {
    active = true
    pendingMainProbe = nil
    lastJsAnswer = jsInstalled ? uptime : nil
    open = [:]
    lastPersisted = [:]
  }

  /// Leaving the front ends every stall, open or overdue, as `left`; the caller saves what comes back.
  mutating func resignedActive(uptime: TimeInterval, context: DayframeStallContext) -> [DayframeStallRecord] {
    guard active else { return [] }
    var ended: [DayframeStallRecord] = []
    for thread in [DayframeStallThread.js, .main] {
      if let record = finish(thread, uptime: uptime, outcome: .left, context: context) {
        ended.append(record)
      }
    }
    active = false
    pendingMainProbe = nil
    lastJsAnswer = nil
    open = [:]
    lastPersisted = [:]
    return ended
  }

  /// The watchdog asked main to answer; a probe already waiting keeps its time.
  mutating func sentMainProbe(uptime: TimeInterval) {
    guard active, pendingMainProbe == nil else { return }
    pendingMainProbe = uptime
  }

  /// A thread answered. A stall on it ends as `recovered`, including one that started and ended
  /// between two checks.
  mutating func answered(
    _ thread: DayframeStallThread,
    uptime: TimeInterval,
    context: DayframeStallContext
  ) -> DayframeStallRecord? {
    guard active else { return nil }
    let record = finish(thread, uptime: uptime, outcome: .recovered, context: context)
    if thread == .main {
      pendingMainProbe = nil
    } else {
      lastJsAnswer = uptime
      jsInstalled = true
    }
    return record
  }

  /// Opens a stall for a thread silent for `threshold`, and returns new or lengthened open stalls
  /// that are due to be saved.
  mutating func check(uptime: TimeInterval, context: DayframeStallContext) -> [DayframeStallRecord] {
    guard active else { return [] }
    var due: [DayframeStallRecord] = []
    for thread in [DayframeStallThread.main, .js] {
      guard let since = silentSince(thread) else { continue }
      if var record = open[thread] {
        record.durationMs = milliseconds(uptime - since)
        open[thread] = record
        if uptime - (lastPersisted[thread] ?? 0) >= Self.persistInterval {
          lastPersisted[thread] = uptime
          due.append(record)
        }
      } else if uptime - since >= Self.threshold {
        let record = newRecord(thread, since: since, uptime: uptime, context: context)
        open[thread] = record
        lastPersisted[thread] = uptime
        due.append(record)
      }
    }
    return due
  }

  private func silentSince(_ thread: DayframeStallThread) -> TimeInterval? {
    thread == .main ? pendingMainProbe : lastJsAnswer
  }

  private mutating func finish(
    _ thread: DayframeStallThread,
    uptime: TimeInterval,
    outcome: DayframeStallOutcome,
    context: DayframeStallContext
  ) -> DayframeStallRecord? {
    lastPersisted[thread] = nil
    guard let since = silentSince(thread) else { return nil }
    if var record = open.removeValue(forKey: thread) {
      record.outcome = outcome
      record.durationMs = milliseconds(uptime - since)
      return record
    }
    guard uptime - since >= Self.threshold else { return nil }
    var record = newRecord(thread, since: since, uptime: uptime, context: context)
    record.outcome = outcome
    return record
  }

  private func newRecord(
    _ thread: DayframeStallThread,
    since: TimeInterval,
    uptime: TimeInterval,
    context: DayframeStallContext
  ) -> DayframeStallRecord {
    DayframeStallRecord(
      id: context.makeId(),
      thread: thread,
      startedAt: context.date.addingTimeInterval(-(uptime - since)),
      durationMs: milliseconds(uptime - since),
      outcome: nil,
      jsTasks: context.jsTasks,
      lastJsTask: context.lastJsTask,
      appBuild: context.appBuild
    )
  }

  private func milliseconds(_ seconds: TimeInterval) -> Int {
    Int((max(0, seconds) * 1000).rounded())
  }
}

/// MetricKit diagnostics, kept as an allowlist: call stacks (binary names, UUIDs, offsets, addresses,
/// sample counts) and named metadata only. Exception messages, format strings and arguments, which can
/// carry app data, and any field Apple adds later, are dropped before anything is saved (Codex r1 on
/// #525).
enum DayframeMetricKitSummary {
  static let kinds = [
    "crashDiagnostics": "crash",
    "hangDiagnostics": "hang",
    "cpuExceptionDiagnostics": "cpu",
    "diskWriteExceptionDiagnostics": "diskWrite",
    "appLaunchDiagnostics": "launch"
  ]
  private static let summaryKeys = [
    "appBuildVersion", "appVersion", "osVersion", "exceptionType", "exceptionCode", "signal",
    "terminationReason", "hangDuration", "launchDuration", "totalCPUTime", "totalSampledTime",
    "writesCaused"
  ]
  private static let metaDataKeys = Set(summaryKeys + ["deviceType", "platformArchitecture", "isTestFlightApp", "lowPowerModeEnabled"])
  /// Only the exception's type, name and class, each cut to its leading identifier, never its message,
  /// format string or arguments: React Native builds a fatal exception's name from the JS error's
  /// text ("RCTFatalException: Unhandled JS Exception: …"; Codex r2 on #525).
  private static let exceptionReasonKeys: Set<String> = ["exceptionType", "exceptionName", "className"]
  private static let frameKeys: Set<String> = [
    "binaryUUID", "binaryName", "offsetIntoBinaryTextSegment", "address", "sampleCount"
  ]

  /// The payload reduced to the allowlist; every report is saved and shared only in this form.
  static func sanitize(_ payload: [String: Any]) -> [String: Any] {
    var clean: [String: Any] = [:]
    for key in ["timeStampBegin", "timeStampEnd"] {
      if let value = payload[key] as? String { clean[key] = value }
    }
    for key in kinds.keys {
      guard let diagnostics = payload[key] as? [[String: Any]] else { continue }
      clean[key] = diagnostics.map { diagnostic -> [String: Any] in
        var item: [String: Any] = [:]
        if let metaData = diagnostic["diagnosticMetaData"] as? [String: Any] {
          item["diagnosticMetaData"] = sanitizeMetaData(metaData)
        }
        if let tree = diagnostic["callStackTree"] as? [String: Any] {
          item["callStackTree"] = sanitizeTree(tree)
        }
        return item
      }
    }
    return clean
  }

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
        for name in summaryKeys {
          if let text = metaData[name] as? String {
            summary[name] = String(text.prefix(200))
          } else if let number = metaData[name] as? NSNumber {
            summary[name] = number
          }
        }
        return summary
      }
    }
  }

  /// The same payload can be delivered more than once (live, then again in past payloads); distinct
  /// payloads that share a window and counts are still distinct. FNV-1a over the canonical JSON.
  static func identity(_ payload: [String: Any]) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: sanitize(payload), options: [.sortedKeys])) ?? Data()
    var hash: UInt64 = 0xcbf29ce484222325
    for byte in data {
      hash ^= UInt64(byte)
      hash = hash &* 0x100000001b3
    }
    return String(hash, radix: 16)
  }

  private static func sanitizeMetaData(_ metaData: [String: Any]) -> [String: Any] {
    var clean: [String: Any] = [:]
    for (key, value) in metaData where metaDataKeys.contains(key) && isScalar(value) {
      clean[key] = value
    }
    if let reason = metaData["objectiveCexceptionReason"] as? [String: Any] {
      var names: [String: Any] = [:]
      for key in exceptionReasonKeys {
        if let value = reason[key] as? String, let identifier = leadingIdentifier(value) { names[key] = identifier }
      }
      clean["objectiveCexceptionReason"] = names
    }
    return clean
  }

  private static func sanitizeTree(_ tree: [String: Any]) -> [String: Any] {
    var clean: [String: Any] = [:]
    if let perThread = tree["callStackPerThread"], isScalar(perThread) { clean["callStackPerThread"] = perThread }
    if let stacks = tree["callStacks"] as? [[String: Any]] {
      clean["callStacks"] = stacks.map { stack -> [String: Any] in
        var item: [String: Any] = [:]
        if let attributed = stack["threadAttributed"], isScalar(attributed) { item["threadAttributed"] = attributed }
        if let frames = stack["callStackRootFrames"] as? [[String: Any]] { item["callStackRootFrames"] = frames.map(sanitizeFrame) }
        return item
      }
    }
    return clean
  }

  private static func sanitizeFrame(_ frame: [String: Any]) -> [String: Any] {
    var clean = frame.filter { frameKeys.contains($0.key) && isScalar($0.value) }
    if let subFrames = frame["subFrames"] as? [[String: Any]] { clean["subFrames"] = subFrames.map(sanitizeFrame) }
    return clean
  }

  /// "RCTFatalException: Unhandled JS Exception: …" → "RCTFatalException"; nil when it starts with
  /// anything but an identifier.
  static func leadingIdentifier(_ value: String) -> String? {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_."))
    let scalars = value.unicodeScalars.prefix { $0.isASCII && allowed.contains($0) }.prefix(80)
    guard let first = scalars.first, CharacterSet.letters.union(CharacterSet(charactersIn: "_")).contains(first) else {
      return nil
    }
    return String(String.UnicodeScalarView(scalars))
  }

  private static func isScalar(_ value: Any) -> Bool {
    value is String || value is NSNumber
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
    let clean = DayframeMetricKitSummary.sanitize(payload)
    var report: [String: Any] = [
      "receivedAt": ISO8601DateFormatter().string(from: receivedAt),
      "summary": DayframeMetricKitSummary.summarize(clean),
      "payload": clean
    ]
    var data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
    if (data?.count ?? Int.max) > Self.maxReportBytes {
      report["payload"] = nil
      report["payloadOmitted"] = "over \(Self.maxReportBytes) bytes"
      report["summary"] = Array((report["summary"] as? [[String: Any]] ?? []).prefix(20))
      data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
    }
    // The summary's strings are bounded, but the cap is checked again whatever it holds (Codex r2).
    if (data?.count ?? Int.max) > Self.maxReportBytes {
      report["summary"] = []
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

  /// For Sync help's line: no payloads, so nothing large crosses to JS on every visit.
  func overview() -> (stalls: [DayframeStallRecord], stallCount: Int, reportCount: Int) {
    let all = stalls()
    return (Array(all.suffix(3)), all.count, reportURLs().count)
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
