import Foundation

// Compile and execute the exact diagnostics core linked into the app (staging freeze, 22 Oct 2026).
var checks = 0
func check(_ condition: Bool, _ label: String) {
  precondition(condition, label)
  checks += 1
}

var ids = 0
let date = Date(timeIntervalSince1970: 1_800_000_000)
func context(_ uptime: TimeInterval, tasks: [String] = []) -> DayframeStallContext {
  DayframeStallContext(
    date: date.addingTimeInterval(uptime), jsTasks: tasks, lastJsTask: tasks.last, appBuild: "126",
    makeId: { ids += 1; return "stall-\(ids)" }
  )
}

// Nothing is watched in the background, and time there is never a stall.
var tracker = DayframeStallTracker()
check(tracker.check(uptime: 100, context: context(100)).isEmpty, "inactive: no stalls")
tracker.sentMainProbe(uptime: 100)
check(tracker.answered(.main, uptime: 200, context: context(200)) == nil, "inactive: answers record nothing")
tracker.becameActive(uptime: 100)

// Main: a probe unanswered for 3 s opens a stall timed from the probe, with the JS tasks then running.
tracker.sentMainProbe(uptime: 100)
check(tracker.check(uptime: 102.9, context: context(102.9)).isEmpty, "under the threshold: no stall")
tracker.sentMainProbe(uptime: 101.9)
var due = tracker.check(uptime: 103, context: context(103, tasks: ["bootstrap", "sync-queue"]))
check(due.count == 1 && due[0].thread == .main, "main stall opens: \(due)")
check(due[0].startedAt == date.addingTimeInterval(100), "timed from the first unanswered probe")
check(due[0].durationMs == 3000 && due[0].outcome == nil, "open, 3 s so far")
check(due[0].jsTasks == ["bootstrap", "sync-queue"] && due[0].lastJsTask == "sync-queue", "tasks recorded")
check(due[0].appBuild == "126", "build recorded")
check(tracker.check(uptime: 104, context: context(104)).isEmpty, "open stall not re-saved within 5 s")
due = tracker.check(uptime: 108, context: context(108))
check(due.count == 1 && due[0].id == "stall-1" && due[0].durationMs == 8000, "open stall re-saved after 5 s: \(due)")
let recovered = tracker.answered(.main, uptime: 109.5, context: context(109.5))
check(recovered?.id == "stall-1" && recovered?.outcome == .recovered && recovered?.durationMs == 9500, "recovered: \(String(describing: recovered))")
check(tracker.answered(.main, uptime: 110, context: context(110)) == nil, "an answer with nothing waiting returns nothing")

// A late watchdog tick is not a main stall: the probe is sent late, and main answers it at once
// (Codex r1 on #525).
check(tracker.check(uptime: 115, context: context(115)).isEmpty, "a 5 s gap between ticks with no probe waiting is nothing")
tracker.sentMainProbe(uptime: 115)
check(tracker.answered(.main, uptime: 115.01, context: context(115.01)) == nil, "a prompt answer to a late probe is nothing")

// JS has not answered yet (watchdog not installed): never reported.
check(tracker.check(uptime: 130, context: context(130)).isEmpty, "no JS stall before JS first answers")

// JS: a gap of 3 s between answers opens a stall.
_ = tracker.answered(.js, uptime: 130, context: context(130))
due = tracker.check(uptime: 133.5, context: context(133.5, tasks: ["location-replay"]))
check(due.count == 1 && due[0].thread == .js && due[0].lastJsTask == "location-replay", "JS stall: \(due)")
let jsRecovered = tracker.answered(.js, uptime: 134, context: context(134))
check(jsRecovered?.outcome == .recovered && jsRecovered?.durationMs == 4000, "JS recovered: \(String(describing: jsRecovered))")

// A JS pause that starts and ends between two checks is still recorded (Codex r1 on #525).
check(tracker.check(uptime: 134.25, context: context(134.25)).isEmpty, "fresh after the answer")
check(tracker.check(uptime: 136.75, context: context(136.75)).isEmpty, "2.75 s at the check: nothing yet")
let between = tracker.answered(.js, uptime: 137.5, context: context(137.5, tasks: ["health-wake"]))
check(between?.outcome == .recovered && between?.durationMs == 3500 && between?.jsTasks == ["health-wake"], "recorded on the late answer: \(String(describing: between))")
check(between?.startedAt == date.addingTimeInterval(134), "dated from the previous answer")

// Leaving the front ends an open stall as `left`, and also one overdue but not yet checked.
due = tracker.check(uptime: 141, context: context(141))
check(due.count == 1 && due[0].thread == .js, "JS stall open before leaving")
tracker.sentMainProbe(uptime: 141)
let left = tracker.resignedActive(uptime: 145, context: context(145))
check(left.count == 2 && left.allSatisfy { $0.outcome == .left }, "both end as left: \(left)")
check(left.first { $0.thread == .js }?.durationMs == 7500, "JS left with its full length")
check(left.first { $0.thread == .main }?.durationMs == 4000, "an overdue main probe is recorded when leaving")
check(tracker.check(uptime: 200, context: context(200)).isEmpty, "inactive again: nothing")
check(tracker.answered(.js, uptime: 200, context: context(200)) == nil, "answers in the background record nothing")

// Coming back starts afresh: the background gap is not a stall.
tracker.becameActive(uptime: 500)
check(tracker.check(uptime: 501, context: context(501)).isEmpty, "fresh after becoming active")
check(tracker.answered(.js, uptime: 502, context: context(502)) == nil, "the first JS answer after becoming active is never a stall")

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
// Only allowlisted fields survive: no exception message, format string, arguments or unknown keys.
let leaky: [String: Any] = [
  "timeStampBegin": "2026-10-22 08:00:00", "timeStampEnd": "2026-10-22 09:00:00", "newApplePayloadField": "x",
  "crashDiagnostics": [[
    "unknownDiagnosticField": "secret",
    "diagnosticMetaData": [
      "exceptionType": 1, "appBuildVersion": "126", "someFutureKey": "secret",
      "objectiveCexceptionReason": [
        "composedMessage": "secret entry title", "formatString": "%@", "arguments": ["secret"],
        "exceptionType": "NSInvalidArgumentException", "exceptionName": "NSInvalidArgumentException", "className": "NSException"
      ]
    ],
    "callStackTree": ["callStackPerThread": true, "callStacks": [[
      "threadAttributed": true,
      "callStackRootFrames": [["binaryName": "Dayframe", "binaryUUID": "U", "offsetIntoBinaryTextSegment": 10, "address": 11, "sampleCount": 1, "label": "secret",
        "subFrames": [["binaryName": "UIKitCore", "address": 12, "extra": "secret"]]]]
    ]]]
  ]]
]
let clean = DayframeMetricKitSummary.sanitize(leaky)
let cleanText = String(data: try JSONSerialization.data(withJSONObject: clean, options: [.sortedKeys]), encoding: .utf8)!
check(!cleanText.contains("secret") && !cleanText.contains("%@") && !cleanText.contains("newApplePayloadField"), "sanitized: \(cleanText)")
check(cleanText.contains("NSInvalidArgumentException") && cleanText.contains("UIKitCore") && cleanText.contains("\"offsetIntoBinaryTextSegment\":10"), "stack and exception type kept: \(cleanText)")
check(store.saveReport(leaky, receivedAt: date), "leaky report saved")
let savedText = String(data: try JSONSerialization.data(withJSONObject: store.reports(), options: [.sortedKeys]), encoding: .utf8)!
check(!savedText.contains("secret"), "nothing unsanitized is saved")
store.clear()

// Different payloads that share a window and counts are both kept (Codex r1 on #525).
var otherHang = payload
otherHang["hangDiagnostics"] = [["diagnosticMetaData": ["hangDuration": "9 sec"], "callStackTree": ["callStacks": []]]]
check(DayframeMetricKitSummary.identity(payload) != DayframeMetricKitSummary.identity(otherHang), "distinct payloads, distinct identities")
check(store.saveReport(otherHang, receivedAt: date), "other hang saved")

check(store.saveReport(payload, receivedAt: date), "report saved")
check(store.saveReport(payload, receivedAt: date.addingTimeInterval(60)), "duplicate accepted")
check(store.reports().count == 2, "duplicate stored once, distinct payload kept")
check(store.overview().reportCount == 2 && store.overview().stalls.count <= 3, "overview counts without payloads")
check(store.reports()[0]["payload"] != nil, "small payload kept whole")
let frame: [String: Any] = ["binaryName": String(repeating: "b", count: 200), "binaryUUID": "U", "offsetIntoBinaryTextSegment": 1, "address": 2, "sampleCount": 1]
let huge: [String: Any] = [
  "timeStampBegin": "2026-10-23 06:00:00", "timeStampEnd": "2026-10-23 07:00:00",
  "crashDiagnostics": [["callStackTree": ["callStacks": [["threadAttributed": true, "callStackRootFrames": Array(repeating: frame, count: 3000)]]], "diagnosticMetaData": [:]]]
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
