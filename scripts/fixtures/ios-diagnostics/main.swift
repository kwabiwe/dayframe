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

// Once JS has ever answered, it is watched from the moment Dayframe returns: a JS thread stuck on
// return is caught even though it never answers (Codex r2 on #525).
check(tracker.resignedActive(uptime: 503, context: context(503)).isEmpty, "leaving with nothing overdue")
tracker.becameActive(uptime: 600)
tracker.sentMainProbe(uptime: 600)
_ = tracker.answered(.main, uptime: 600.01, context: context(600.01))
due = tracker.check(uptime: 603, context: context(603))
check(due.count == 1 && due[0].thread == .js && due[0].startedAt == date.addingTimeInterval(600), "a JS stall from the return: \(due)")
let frozenOnReturn = tracker.answered(.js, uptime: 631, context: context(631))
check(frozenOnReturn?.outcome == .recovered && frozenOnReturn?.durationMs == 31_000, "its full length when JS answers: \(String(describing: frozenOnReturn))")

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
        "exceptionType": "NSInvalidArgumentException", "exceptionName": "RCTFatalException: Unhandled JS Exception: secret task title", "className": "NSException"
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
check(cleanText.contains("\"exceptionName\":\"RCTFatalException\""), "an exception name is cut to its identifier: \(cleanText)")
check(DayframeMetricKitSummary.leadingIdentifier(": secret") == nil && DayframeMetricKitSummary.leadingIdentifier("NSRangeException") == "NSRangeException", "leading identifiers")
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
for index in 0..<5 {
  store.save(DayframeStallRecord(id: "o\(index)", thread: .js, startedAt: date.addingTimeInterval(Double(index)), durationMs: 3000, outcome: .recovered, jsTasks: [], lastJsTask: nil, appBuild: nil))
}
check(store.overview().stallCount == 5 && store.overview().stalls.count == 3, "the overview's total counts every pause (Codex r2 on #525)")
check(store.reports()[0]["payload"] != nil, "small payload kept whole")
let frame: [String: Any] = ["binaryName": String(repeating: "b", count: 200), "binaryUUID": "U", "offsetIntoBinaryTextSegment": 1, "address": 2, "sampleCount": 1]
let huge: [String: Any] = [
  "timeStampBegin": "2026-10-23 06:00:00", "timeStampEnd": "2026-10-23 07:00:00",
  "crashDiagnostics": [["callStackTree": ["callStacks": [["threadAttributed": true, "callStackRootFrames": Array(repeating: frame, count: 3000)]]], "diagnosticMetaData": [:]]]
]
check(store.saveReport(huge, receivedAt: date), "huge report saved")
let newest = store.reports()[0]
check(newest["payload"] == nil && newest["payloadOmitted"] != nil && newest["summary"] != nil, "huge payload reduced to its summary")
// The cap holds even when the summary alone would exceed it (Codex r2 on #525).
let hugeReason: [String: Any] = [
  "timeStampBegin": "2026-10-24 06:00:00", "timeStampEnd": "2026-10-24 07:00:00",
  "crashDiagnostics": Array(repeating: ["diagnosticMetaData": ["terminationReason": String(repeating: "r", count: 600_000)]], count: 3)
]
check(store.saveReport(hugeReason, receivedAt: date), "an oversized summary is still saved")
let directoryFiles = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
let largest = try directoryFiles.map { try $0.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 }.max() ?? 0
check(largest <= DayframeDiagnosticsStore.maxReportBytes, "no report file over the cap: \(largest)")

for day in 0..<20 {
  store.saveReport(["timeStampBegin": "day \(day)", "timeStampEnd": "end", "hangDiagnostics": [[:]]], receivedAt: date)
}
check(store.reports().count == DayframeDiagnosticsStore.maxReports, "keeps 12 reports")
store.clear()
check(store.stalls().isEmpty && store.reports().isEmpty, "clear removes everything")

// Daily energy metrics (location v4 step 3): counts only, one record per day, newest 30 kept.
func energyDay(_ index: Int, best: Double, backgroundLocation: Double = 600) -> DayframeEnergyDay {
  DayframeEnergyDay(
    begin: date.addingTimeInterval(Double(index) * 86_400), end: date.addingTimeInterval(Double(index + 1) * 86_400),
    appVersion: "0.1.0", bestAccuracySeconds: best, tenMetresSeconds: 60, hundredMetresSeconds: 120,
    kilometreSeconds: 30, threeKilometresSeconds: 0, foregroundSeconds: 1800, backgroundSeconds: 7200,
    backgroundLocationSeconds: backgroundLocation, cpuSeconds: 90
  )
}
check(DayframeEnergySummary([]) == nil, "no summary without days")
check(store.saveEnergyDay(energyDay(0, best: 300)), "saves a day")
check(store.saveEnergyDay(energyDay(0, best: 600)), "a re-delivered day replaces it")
check(store.energyDays().count == 1 && store.energyDays()[0].bestAccuracySeconds == 600, "one record per day")
for index in 1..<40 { store.saveEnergyDay(energyDay(index, best: index % 5 == 0 ? 1500 : 300)) }
check(store.energyDays().count == DayframeDiagnosticsStore.maxEnergyDays, "keeps 30 days")
check(store.energyDays().first?.begin == date.addingTimeInterval(10 * 86_400), "drops the oldest")
let energy = DayframeEnergySummary(store.energyDays())
check(energy?.days == 7, "averages the newest 7 days")
// Days 33–39: day 35 is over the 20-minute best-accuracy budget.
check(energy?.daysOverBudget == 1, "one day over budget: \(String(describing: energy))")
check(abs((energy?.bestAccuracySecondsPerDay ?? 0) - (6 * 300 + 1500) / 7) < 0.001, "best-accuracy average")
check((energy?.dictionary["bestAccuracyBudgetSeconds"] as? Double) == 1200, "budget reported")
store.clear()
check(store.energyDays().isEmpty, "clear removes energy days")

// Main stalls carry stack samples (staging QA 24 Oct 2026: six main pauses, none with a stack).
var sampled = DayframeStallTracker()
sampled.becameActive(uptime: 0)
sampled.sentMainProbe(uptime: 0)
check(!sampled.mainSampleDue(uptime: 1), "no sample before a stall opens")
var sampleContext = context(3)
sampleContext.appBinary = "BINARY-UUID"
_ = sampled.check(uptime: 3, context: sampleContext)
check(sampled.mainSampleDue(uptime: 3), "a sample as the stall opens")
check(!sampled.mainSampleDue(uptime: 4), "then not within 10 s")
var withSample = sampled.attachMainSample(frames: ["Dayframe+0x10", "CoreLocation+0x20"], images: ["Dayframe": "A"], uptime: 3.2)
check(withSample?.mainSamples == [DayframeStackSample(atMs: 3200, frames: ["Dayframe+0x10", "CoreLocation+0x20"])], "sample attached: \(String(describing: withSample))")
check(withSample?.appBinary == "BINARY-UUID" && withSample?.images == ["Dayframe": "A"], "binary and images recorded")
for second in stride(from: 13.0, through: 63.0, by: 10) where sampled.mainSampleDue(uptime: second) {
  withSample = sampled.attachMainSample(frames: ["Dayframe+0x\(Int(second))"], images: ["Dayframe": "B"], uptime: second)
}
check(withSample?.mainSamples?.count == DayframeStallTracker.maxSamples, "at most 4 samples: \(String(describing: withSample?.mainSamples))")
check(withSample?.images == ["Dayframe": "A"], "the first UUID for an image is kept")
check(sampled.attachMainSample(frames: ["late"], images: [:], uptime: 70) == nil, "no fifth sample")
let ended = sampled.answered(.main, uptime: 80, context: context(80))
check(ended?.outcome == .recovered && ended?.mainSamples?.count == 4, "samples kept when main recovers")
check(sampled.attachMainSample(frames: ["after"], images: [:], uptime: 81) == nil, "no sample once main answered")
sampled.sentMainProbe(uptime: 90)
_ = sampled.check(uptime: 93, context: context(93))
check(sampled.mainSampleDue(uptime: 93), "a new stall is sampled afresh")
let roundTrip = try JSONDecoder().decode(DayframeStallRecord.self, from: JSONEncoder().encode(ended!))
check(roundTrip == ended, "samples survive encoding")
let oldRecord = #"{"id":"x","thread":"main","startedAt":0,"durationMs":3000,"jsTasks":[]}"#
check((try? JSONDecoder().decode(DayframeStallRecord.self, from: Data(oldRecord.utf8)))?.mainSamples == nil, "records saved before samples still load")

// A real sample: a thread parked in a known function is found there, named by image and offset.
@inline(never) func parkedInKnownFunction(_ semaphore: DispatchSemaphore, _ ready: DispatchSemaphore) {
  ready.signal()
  semaphore.wait()
}
final class ThreadBox: @unchecked Sendable { var port: thread_act_t = 0 }
let park = DispatchSemaphore(value: 0)
let ready = DispatchSemaphore(value: 0)
let box = ThreadBox()
let parked = Thread {
  box.port = DayframeThreadSampler.currentThread()
  parkedInKnownFunction(park, ready)
}
parked.start()
ready.wait()
Thread.sleep(forTimeInterval: 0.05)
let sample = DayframeThreadSampler.sample(box.port)
park.signal()
if ProcessInfo.processInfo.environment["DAYFRAME_PRINT_SAMPLE"] != nil { print(sample.frames.joined(separator: "\n")) }
let executable = (CommandLine.arguments[0] as NSString).lastPathComponent
check(sample.frames.count >= 4, "frames read: \(sample.frames)")
check(sample.frames.contains { $0.hasPrefix("libsystem_kernel.dylib+0x") }, "innermost frames are in the kernel wait: \(sample.frames)")
check(sample.frames.contains { $0.hasPrefix("\(executable)+0x") }, "the fixture's own frames are named: \(sample.frames)")
check(sample.images[executable] == DayframeThreadSampler.mainBinaryUUID() && sample.images[executable] != "?", "binary UUID recorded: \(sample.images)")
check(DayframeThreadSampler.sample(DayframeThreadSampler.currentThread()).frames.isEmpty, "never samples the calling thread")
check(DayframeThreadSampler.sample(0).frames.isEmpty, "no port, no sample")
check(DayframeThreadSampler.describe([1]).frames == ["?"], "an unknown address is kept as ?")

// Any other MetricKit diagnostics list is kept through the same allowlist, not saved empty.
let newKind: [String: Any] = [
  "timeStampBegin": "2026-10-23 14:10:43", "timeStampEnd": "2026-10-23 14:10:43",
  "appTerminationDiagnostics": [[
    "diagnosticMetaData": ["appBuildVersion": "1", "secretField": "secret"],
    "callStackTree": ["callStacks": [["threadAttributed": true, "callStackRootFrames": [["binaryName": "Dayframe", "offsetIntoBinaryTextSegment": 16, "label": "secret"]]]]]
  ]],
  "notDiagnostics": "secret",
  "weird key Diagnostics": [["diagnosticMetaData": ["appBuildVersion": "1"]]]
]
let newKindClean = DayframeMetricKitSummary.sanitize(newKind)
let newKindText = String(data: try JSONSerialization.data(withJSONObject: newKindClean, options: [.sortedKeys]), encoding: .utf8)!
check(newKindClean["appTerminationDiagnostics"] != nil && newKindText.contains("Dayframe"), "a new kind keeps its call stacks: \(newKindText)")
check(!newKindText.contains("secret") && newKindClean["weird key Diagnostics"] == nil, "and only allowlisted fields: \(newKindText)")
check(DayframeMetricKitSummary.summarize(newKindClean).first?["kind"] as? String == "appTerminationDiagnostics", "summarised by its key")

print("Native diagnostics validation passed: \(checks) checks.")
