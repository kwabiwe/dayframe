import Foundation

// Compile and execute the exact diagnostics core linked into the app (staging freeze, 22 Oct 2026).
var checks = 0
func check(_ condition: Bool, _ label: String) {
  precondition(condition, label)
  checks += 1
}

var ids = 0
func makeId() -> String {
  ids += 1
  return "stall-\(ids)"
}
let date = Date(timeIntervalSince1970: 1_800_000_000)
func check(_ tracker: inout DayframeStallTracker, at uptime: TimeInterval, tasks: [String] = []) -> [DayframeStallRecord] {
  tracker.check(
    uptime: uptime, date: date.addingTimeInterval(uptime), jsTasks: tasks, lastJsTask: tasks.last,
    appBuild: "126", makeId: makeId
  )
}

// Nothing is watched in the background, and time there is never a stall.
var tracker = DayframeStallTracker()
check(check(&tracker, at: 100).isEmpty, "inactive: no stalls")
tracker.becameActive(uptime: 100)
check(check(&tracker, at: 102.9).isEmpty, "under the threshold: no stall")

// Main silent for 3 s opens a stall dated from its last answer, with the JS tasks then running.
var due = check(&tracker, at: 103, tasks: ["bootstrap", "sync-queue"])
check(due.count == 1 && due[0].thread == .main, "main stall opens: \(due)")
check(due[0].startedAt == date.addingTimeInterval(100), "dated from the last answer")
check(due[0].durationMs == 3000 && due[0].outcome == nil, "open, 3 s so far")
check(due[0].jsTasks == ["bootstrap", "sync-queue"] && due[0].lastJsTask == "sync-queue", "tasks recorded")
check(due[0].appBuild == "126", "build recorded")

// JS has never answered (watchdog not installed yet): no JS stall however long.
check(check(&tracker, at: 104).isEmpty, "open stall not re-saved within 5 s")
due = check(&tracker, at: 108)
check(due.count == 1 && due[0].id == "stall-1" && due[0].durationMs == 8000, "open stall re-saved after 5 s: \(due)")

// Main answers: the stall ends as recovered with its full length.
let recovered = tracker.answered(.main, uptime: 109.5)
check(recovered?.id == "stall-1" && recovered?.outcome == .recovered && recovered?.durationMs == 9500, "recovered: \(String(describing: recovered))")
check(tracker.answered(.main, uptime: 110) == nil, "an answer with no open stall returns nothing")

// JS answers once, then goes silent while main keeps answering: a JS stall.
_ = tracker.answered(.js, uptime: 110)
_ = tracker.answered(.main, uptime: 113)
due = check(&tracker, at: 113.5, tasks: ["location-foreground"])
check(due.count == 1 && due[0].thread == .js && due[0].lastJsTask == "location-foreground", "JS stall: \(due)")

// Leaving the front ends the open stall as `left` (a force-close passes through here).
let left = tracker.resignedActive(uptime: 120)
check(left.count == 1 && left[0].outcome == .left && left[0].durationMs == 10_000, "left: \(left)")
check(check(&tracker, at: 200).isEmpty, "inactive again: nothing")
check(tracker.answered(.js, uptime: 200) == nil, "answers in the background record nothing")

// Coming back starts afresh: the background gap is not a stall.
tracker.becameActive(uptime: 500)
check(check(&tracker, at: 501).isEmpty, "fresh after becoming active")

// Store: bounded, private, survives a restart, an open stall is replaced by its later save.
let directory = FileManager.default.temporaryDirectory
  .appendingPathComponent("dayframe-diagnostics-\(UUID().uuidString)", isDirectory: true)
defer { try? FileManager.default.removeItem(at: directory) }
let store = DayframeDiagnosticsStore(directory: directory)
var open = DayframeStallRecord(
  id: "a", thread: .js, startedAt: date, durationMs: 3000, outcome: nil, jsTasks: [], lastJsTask: nil, appBuild: nil
)
check(store.save(open), "saves")
open.durationMs = 60_000
open.outcome = .left
check(store.save(open), "saves again")
check(DayframeDiagnosticsStore(directory: directory).stalls() == [open], "one record, latest state, after a restart")
for index in 0..<50 {
  store.save(DayframeStallRecord(
    id: "s\(index)", thread: .main, startedAt: date.addingTimeInterval(Double(index + 1)), durationMs: 3000,
    outcome: .recovered, jsTasks: [], lastJsTask: nil, appBuild: nil
  ))
}
let kept = store.stalls()
check(kept.count == DayframeDiagnosticsStore.maxStalls && kept.last?.id == "s49" && !kept.contains(open), "keeps the newest 40")
let excluded = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
check(excluded == true, "excluded from backup")

// MetricKit: summary of known fields only, deduplicated, capped.
let payload: [String: Any] = [
  "timeStampBegin": "2026-10-22 06:00:00",
  "timeStampEnd": "2026-10-22 07:00:00",
  "hangDiagnostics": [[
    "callStackTree": ["callStacks": []],
    "diagnosticMetaData": ["hangDuration": "42 sec", "appBuildVersion": "126", "osVersion": "iPhone OS 27.2"]
  ]],
  "crashDiagnostics": [[
    "callStackTree": ["callStacks": []],
    "diagnosticMetaData": [
      "exceptionType": 10, "signal": 9, "terminationReason": "Namespace RUNNINGBOARD, Code 0xdead10cc",
      "appBuildVersion": "126", "regionFormat": "GB"
    ]
  ]]
]
let summary = DayframeMetricKitSummary.summarize(payload)
check(summary.count == 2, "one summary per diagnostic: \(summary)")
check(summary.contains { $0["kind"] as? String == "hang" && $0["hangDuration"] as? String == "42 sec" }, "hang summarised")
check(summary.contains {
  $0["kind"] as? String == "crash" && ($0["terminationReason"] as? String)?.contains("dead10cc") == true
    && $0["regionFormat"] == nil
}, "crash summarised without other metadata")
check(store.saveReport(payload, receivedAt: date), "report saved")
check(store.saveReport(payload, receivedAt: date.addingTimeInterval(60)), "duplicate accepted")
check(store.reports().count == 1, "duplicate stored once")
check(store.reports()[0]["payload"] != nil, "small payload kept whole")
let huge: [String: Any] = [
  "timeStampBegin": "2026-10-23 06:00:00", "timeStampEnd": "2026-10-23 07:00:00",
  "crashDiagnostics": [["callStackTree": ["frames": String(repeating: "x", count: 500_000)], "diagnosticMetaData": [:]]]
]
check(store.saveReport(huge, receivedAt: date), "huge report saved")
let newest = store.reports()[0]
check(newest["payload"] == nil && newest["payloadOmitted"] != nil && newest["summary"] != nil, "huge payload reduced to its summary")
for day in 0..<20 {
  store.saveReport(["timeStampBegin": "day \(day)", "timeStampEnd": "end", "hangDiagnostics": [[:]]], receivedAt: date)
}
check(store.reports().count == DayframeDiagnosticsStore.maxReports, "keeps 12 reports")
store.clear()
check(store.stalls().isEmpty && store.reports().isEmpty, "clear removes everything")

print("Native diagnostics validation passed: \(checks) checks.")
