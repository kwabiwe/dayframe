import Foundation
import MetricKit
import React
import UIKit

/// Saves MetricKit hang and crash diagnostics and its daily energy metrics (location v4 step 3), and records any stretch of 3 s or more in which the
/// main or JS thread stops answering while Dayframe is in front (`DayframeDiagnosticsCore`). Nothing
/// leaves the iPhone until the person shares Sync help's support details.
final class DayframeDiagnosticsService: NSObject, MXMetricManagerSubscriber {
  static let shared = DayframeDiagnosticsService()

  /// Owns the watchdog's fields below and runs the React Native module's methods. Only cheap work
  /// runs here, so a JS answer is never timed late because this queue was busy (Codex r2 on #525).
  let queue = DispatchQueue(label: "com.layereight.dayframe.diagnostics", qos: .utility)
  /// Owns `store`: every file read and write, and MetricKit's payloads.
  private let ioQueue = DispatchQueue(label: "com.layereight.dayframe.diagnostics.io", qos: .utility)
  /// Samples a stalled main thread. Naming frames can wait on dyld's lock, so it never runs on `queue`.
  private let samplerQueue = DispatchQueue(label: "com.layereight.dayframe.diagnostics.sampler", qos: .utility)
  /// Main's thread port and stack range, read on main at launch.
  private var mainThread: thread_act_t = 0
  private var mainStack = DayframeThreadSampler.Stack(low: 0, high: 0)
  private let appBinary = DayframeThreadSampler.mainBinaryUUID()

  private var tracker = DayframeStallTracker()
  private var store: DayframeDiagnosticsStore?
  private var timer: DispatchSourceTimer?
  private var jsTasks: [String] = []
  private var lastJsTask: String?
  /// Every label running at some point since JS last answered.
  private var jsTasksSinceAnswer: Set<String> = []
  private var started = false
  private let appBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String

  /// Called on the main thread at launch, before React Native starts.
  func start() {
    guard !started else { return }
    started = true
    let mainThread = DayframeThreadSampler.currentThread()
    let mainStack = DayframeThreadSampler.currentStack()
    queue.async {
      self.mainThread = mainThread
      self.mainStack = mainStack
    }
    let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent("DayframeDiagnostics", isDirectory: true)
    MXMetricManager.shared.add(self)
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
    let activeNow = UIApplication.shared.applicationState == .active
    if activeNow { queue.async { self.setActive(true) } }
    ioQueue.async {
      self.store = directory.map { DayframeDiagnosticsStore(directory: $0) }
      // Read off the main thread, after launch work (Codex r1 on #525).
      self.ingest(MXMetricManager.shared.pastDiagnosticPayloads)
      self.ingestMetrics(MXMetricManager.shared.pastPayloads)
    }
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    ioQueue.async { self.ingest(payloads) }
  }

  /// iOS delivers about one a day: location accuracy time, background time and CPU (counts only).
  func didReceive(_ payloads: [MXMetricPayload]) {
    ioQueue.async { self.ingestMetrics(payloads) }
  }

  // MARK: React Native (called on `queue`)

  func jsAnswered() {
    _ = tracker.answered(.js, uptime: ProcessInfo.processInfo.systemUptime, context: context(for: .js)).map(save)
    jsTasksSinceAnswer = Set(jsTasks)
  }

  func setJsTasks(_ tasks: [String], last: String?) {
    jsTasks = Array(tasks.prefix(8))
    lastJsTask = last
    jsTasksSinceAnswer.formUnion(jsTasks)
  }

  /// Sync help's line: the last few pauses and the totals, without payloads.
  func overview(_ completion: @escaping ([String: Any]) -> Void) {
    ioQueue.async {
      let overview = self.store?.overview() ?? (stalls: [], stallCount: 0, reportCount: 0)
      completion([
        "stalls": overview.stalls.compactMap(Self.dictionary),
        "stallCount": overview.stallCount,
        "reports": [],
        "reportCount": overview.reportCount,
        "energy": DayframeEnergySummary(self.store?.energyDays() ?? [])?.dictionary ?? NSNull()
      ])
    }
  }

  func snapshot(_ completion: @escaping ([String: Any]) -> Void) {
    ioQueue.async {
      let stalls = self.store?.stalls() ?? []
      let reports = self.store?.reports() ?? []
      let energyDays = self.store?.energyDays() ?? []
      completion([
        "stalls": stalls.compactMap(Self.dictionary),
        "stallCount": stalls.count,
        "reports": reports,
        "reportCount": reports.count,
        "energy": DayframeEnergySummary(energyDays)?.dictionary ?? NSNull(),
        "energyDays": energyDays.compactMap(Self.dictionary)
      ])
    }
  }

  func clear(_ completion: @escaping () -> Void) {
    ioQueue.async {
      self.store?.clear()
      completion()
    }
  }

  // MARK: Private (on `queue`, file work handed to `ioQueue`)

  @objc private func didBecomeActive() {
    queue.async { self.setActive(true) }
  }

  @objc private func willResignActive() {
    queue.async { self.setActive(false) }
  }

  private func setActive(_ active: Bool) {
    let uptime = ProcessInfo.processInfo.systemUptime
    if active {
      tracker.becameActive(uptime: uptime)
      guard timer == nil else { return }
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(250))
      timer.setEventHandler { [weak self] in self?.probe() }
      timer.resume()
      self.timer = timer
    } else {
      timer?.cancel()
      timer = nil
      tracker.resignedActive(uptime: uptime, context: context(for: .js)).forEach(save)
    }
  }

  /// Once a second in front: ask the main thread to answer, and look for silent threads.
  /// Once a second in front: look for silent threads, then ask main to answer. A main stall is timed
  /// from an unanswered probe, so a late tick here never counts against main.
  private func probe() {
    let uptime = ProcessInfo.processInfo.systemUptime
    tracker.check(uptime: uptime, context: context(for: .js)).forEach(save)
    if let reservation = tracker.reserveMainSample(uptime: uptime) { sampleMain(reservation) }
    tracker.sentMainProbe(uptime: uptime)
    DispatchQueue.main.async { [weak self] in
      let answeredAt = ProcessInfo.processInfo.systemUptime
      self?.queue.async {
        guard let self else { return }
        _ = self.tracker.answered(.main, uptime: answeredAt, context: self.context(for: .main)).map(self.save)
      }
    }
  }

  /// Where main is during an open stall: captured here at once (the C copy takes microseconds and no
  /// locks), named on `samplerQueue` (dladdr can wait on dyld's lock), then attached to the stall it was
  /// reserved for, timed from the capture (Codex r1 on #577).
  private func sampleMain(_ reservation: (stallId: String, atMs: Int)) {
    let addresses = DayframeThreadSampler.capture(mainThread, stack: mainStack)
    samplerQueue.async { [weak self] in
      let named = DayframeThreadSampler.describe(addresses)
      self?.queue.async {
        guard let self else { return }
        _ = self.tracker.attachMainSample(
          stallId: reservation.stallId, atMs: reservation.atMs, frames: named.frames, images: named.images
        ).map(self.save)
      }
    }
  }

  private func context(for thread: DayframeStallThread) -> DayframeStallContext {
    DayframeStallContext(
      date: Date(),
      jsTasks: thread == .js ? jsTasksSinceAnswer.sorted() : jsTasks,
      lastJsTask: lastJsTask,
      appBuild: appBuild,
      appBinary: appBinary,
      makeId: { UUID().uuidString }
    )
  }

  private static func dictionary<Record: Encodable>(_ record: Record) -> [String: Any]? {
    guard
      let data = try? encoder.encode(record),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return nil
    }
    return object
  }

  private func save(_ record: DayframeStallRecord) {
    ioQueue.async { self.store?.save(record) }
  }

  /// On `ioQueue`.
  private func ingest(_ payloads: [MXDiagnosticPayload]) {
    let receivedAt = Date()
    for payload in payloads {
      guard let object = try? JSONSerialization.jsonObject(with: payload.jsonRepresentation()) as? [String: Any] else {
        continue
      }
      store?.saveReport(object, receivedAt: receivedAt)
    }
  }

  /// On `ioQueue`.
  private func ingestMetrics(_ payloads: [MXMetricPayload]) {
    for payload in payloads { store?.saveEnergyDay(Self.energyDay(payload)) }
  }

  private static func energyDay(_ payload: MXMetricPayload) -> DayframeEnergyDay {
    let seconds = { (value: Measurement<UnitDuration>?) -> Double in value?.converted(to: .seconds).value ?? 0 }
    let location = payload.locationActivityMetrics
    let time = payload.applicationTimeMetrics
    return DayframeEnergyDay(
      begin: payload.timeStampBegin,
      end: payload.timeStampEnd,
      appVersion: payload.latestApplicationVersion,
      bestAccuracySeconds: seconds(location?.cumulativeBestAccuracyTime) + seconds(location?.cumulativeBestAccuracyForNavigationTime),
      tenMetresSeconds: seconds(location?.cumulativeNearestTenMetersAccuracyTime),
      hundredMetresSeconds: seconds(location?.cumulativeHundredMetersAccuracyTime),
      kilometreSeconds: seconds(location?.cumulativeKilometerAccuracyTime),
      threeKilometresSeconds: seconds(location?.cumulativeThreeKilometersAccuracyTime),
      foregroundSeconds: seconds(time?.cumulativeForegroundTime),
      backgroundSeconds: seconds(time?.cumulativeBackgroundTime),
      backgroundLocationSeconds: seconds(time?.cumulativeBackgroundLocationTime),
      cpuSeconds: seconds(payload.cpuMetrics?.cumulativeCPUTime)
    )
  }

  private static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }()
}

@objc(DayframeDiagnosticsModule)
final class DayframeDiagnosticsModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  /// Its own queue, so a busy shared module queue never looks like a silent JS thread.
  @objc var methodQueue: DispatchQueue { DayframeDiagnosticsService.shared.queue }

  @objc func jsAnswered() {
    DayframeDiagnosticsService.shared.jsAnswered()
  }

  @objc(setJsTasks:last:)
  func setJsTasks(_ tasks: [String], last: String?) {
    DayframeDiagnosticsService.shared.setJsTasks(tasks, last: last)
  }

  @objc(overview:rejecter:)
  func overview(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DayframeDiagnosticsService.shared.overview { resolve($0) }
  }

  @objc(snapshot:rejecter:)
  func snapshot(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DayframeDiagnosticsService.shared.snapshot { resolve($0) }
  }

  @objc(clear:rejecter:)
  func clear(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DayframeDiagnosticsService.shared.clear { resolve(nil) }
  }
}
