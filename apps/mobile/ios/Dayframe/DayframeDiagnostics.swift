import Foundation
import MetricKit
import React
import UIKit

/// Saves MetricKit hang and crash diagnostics, and records any stretch of 3 s or more in which the
/// main or JS thread stops answering while Dayframe is in front (`DayframeDiagnosticsCore`). Nothing
/// leaves the iPhone until the person shares Sync help's support details.
final class DayframeDiagnosticsService: NSObject, MXMetricManagerSubscriber {
  static let shared = DayframeDiagnosticsService()

  /// Owns every field below; the React Native module runs its methods here too.
  let queue = DispatchQueue(label: "com.layereight.dayframe.diagnostics", qos: .utility)

  private var tracker = DayframeStallTracker()
  private var store: DayframeDiagnosticsStore?
  private var timer: DispatchSourceTimer?
  private var jsTasks: [String] = []
  private var lastJsTask: String?
  private var started = false
  private let appBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String

  /// Called on the main thread at launch, before React Native starts.
  func start() {
    guard !started else { return }
    started = true
    let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent("DayframeDiagnostics", isDirectory: true)
    let past = MXMetricManager.shared.pastDiagnosticPayloads
    MXMetricManager.shared.add(self)
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
    let activeNow = UIApplication.shared.applicationState == .active
    queue.async {
      self.store = directory.map { DayframeDiagnosticsStore(directory: $0) }
      self.ingest(past)
      if activeNow { self.setActive(true) }
    }
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    queue.async { self.ingest(payloads) }
  }

  // MARK: React Native (called on `queue`)

  func jsAnswered() {
    _ = tracker.answered(.js, uptime: ProcessInfo.processInfo.systemUptime).map(save)
  }

  func setJsTasks(_ tasks: [String], last: String?) {
    jsTasks = Array(tasks.prefix(8))
    lastJsTask = last
  }

  func snapshot() -> [String: Any] {
    let stalls = (store?.stalls() ?? []).compactMap { record -> [String: Any]? in
      guard
        let data = try? Self.encoder.encode(record),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        return nil
      }
      return object
    }
    return ["stalls": stalls, "reports": store?.reports() ?? []]
  }

  func clear() {
    store?.clear()
  }

  // MARK: Private (on `queue`)

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
      tracker.resignedActive(uptime: uptime).forEach(save)
    }
  }

  /// Once a second in front: ask the main thread to answer, and look for silent threads.
  private func probe() {
    DispatchQueue.main.async { [weak self] in
      let uptime = ProcessInfo.processInfo.systemUptime
      self?.queue.async {
        guard let self else { return }
        _ = self.tracker.answered(.main, uptime: uptime).map(self.save)
      }
    }
    tracker.check(
      uptime: ProcessInfo.processInfo.systemUptime,
      date: Date(),
      jsTasks: jsTasks,
      lastJsTask: lastJsTask,
      appBuild: appBuild,
      makeId: { UUID().uuidString }
    ).forEach(save)
  }

  private func save(_ record: DayframeStallRecord) {
    store?.save(record)
  }

  private func ingest(_ payloads: [MXDiagnosticPayload]) {
    let receivedAt = Date()
    for payload in payloads {
      guard let object = try? JSONSerialization.jsonObject(with: payload.jsonRepresentation()) as? [String: Any] else {
        continue
      }
      store?.saveReport(object, receivedAt: receivedAt)
    }
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

  @objc(snapshot:rejecter:)
  func snapshot(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(DayframeDiagnosticsService.shared.snapshot())
  }

  @objc(clear:rejecter:)
  func clear(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DayframeDiagnosticsService.shared.clear()
    resolve(nil)
  }
}
