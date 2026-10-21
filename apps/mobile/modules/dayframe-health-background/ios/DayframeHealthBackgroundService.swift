import BackgroundTasks
import Foundation
import HealthKit
import UIKit

/// Owns Dayframe's Apple Health wakes: sleep and workout observer queries with
/// background delivery, registered at every launch, and a background app
/// refresh fallback. Each wake stays open, inside one finite background window,
/// until JavaScript finishes its bounded Health pass or the wake's cap fires.
/// It never reads samples or calls Dayframe APIs; JavaScript owns capture.
///
/// Main-thread confined: every entry point hops to the main queue first.
final class DayframeHealthBackgroundService {
  static let shared = DayframeHealthBackgroundService()

  static let refreshTaskIdentifier = "com.layereight.dayframe.health-refresh"
  private static let enabledKey = "dayframe.healthBackground.enabled.v1"
  /// A wake JavaScript has not finished by now is finished here, well inside
  /// the roughly 30 seconds iOS grants a background window.
  private static let wakeCapSeconds: TimeInterval = 25
  private static let refreshIntervalSeconds: TimeInterval = 2 * 60 * 60

  /// Delivers a wake to JavaScript. Set only while JavaScript listens.
  var onWake: ((DayframeHealthWake) -> Void)?

  private let store = HKHealthStore()
  private var ledger = DayframeHealthWakeLedger()
  private var completions: [String: (Bool) -> Void] = [:]
  private var caps: [String: DispatchWorkItem] = [:]
  private var observers: [HKObserverQuery] = []
  private var refreshRegistered = false
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

  private var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

  private static var sampleTypes: [(kind: String, type: HKSampleType)] {
    var types: [(kind: String, type: HKSampleType)] = []
    if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
      types.append((kind: "sleep", type: sleep))
    }
    types.append((kind: "workout", type: HKObjectType.workoutType()))
    return types
  }

  /// Called from `didFinishLaunching`, so the refresh handler is registered
  /// before launch ends and observers exist for a background delivery launch.
  func launch() {
    dispatchPrecondition(condition: .onQueue(.main))
    registerRefreshTask()
    guard enabled, HKHealthStore.isHealthDataAvailable() else { return }
    startObserving()
    for entry in Self.sampleTypes {
      store.enableBackgroundDelivery(for: entry.type, frequency: .immediate) { _, _ in }
    }
    scheduleRefresh()
  }

  func setEnabled(_ value: Bool, completion: @escaping (Bool) -> Void) {
    dispatchPrecondition(condition: .onQueue(.main))
    UserDefaults.standard.set(value, forKey: Self.enabledKey)
    guard value else {
      stopObserving()
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskIdentifier)
      for entry in Self.sampleTypes {
        store.disableBackgroundDelivery(for: entry.type) { _, _ in }
      }
      for wake in ledger.finishAll() { settle(wake, success: false) }
      completion(false)
      return
    }
    guard HKHealthStore.isHealthDataAvailable() else {
      completion(false)
      return
    }
    startObserving()
    scheduleRefresh()
    let group = DispatchGroup()
    var anyEnabled = false
    for entry in Self.sampleTypes {
      group.enter()
      store.enableBackgroundDelivery(for: entry.type, frequency: .immediate) { success, _ in
        DispatchQueue.main.async {
          if success { anyEnabled = true }
          group.leave()
        }
      }
    }
    group.notify(queue: .main) { completion(anyEnabled) }
  }

  /// JavaScript is ready: returns the wakes that arrived before it was.
  func startListening(onWake: @escaping (DayframeHealthWake) -> Void) -> [DayframeHealthWake] {
    dispatchPrecondition(condition: .onQueue(.main))
    self.onWake = onWake
    return ledger.startListening()
  }

  func stopListening() {
    dispatchPrecondition(condition: .onQueue(.main))
    onWake = nil
    ledger.stopListening()
  }

  @discardableResult
  func finish(id: String, success: Bool) -> Bool {
    dispatchPrecondition(condition: .onQueue(.main))
    guard let wake = ledger.finish(id: id) else { return false }
    settle(wake, success: success)
    return true
  }

  func status() -> [String: Any] {
    [
      "enabled": enabled,
      "observing": !observers.isEmpty,
      "outstandingWakes": ledger.outstandingCount,
      "refreshRegistered": refreshRegistered
    ]
  }

  // MARK: - Observers

  private func startObserving() {
    guard observers.isEmpty else { return }
    for entry in Self.sampleTypes {
      let kind = entry.kind
      // A nil predicate also reports samples written while Dayframe was not running.
      let query = HKObserverQuery(sampleType: entry.type, predicate: nil) { _, completionHandler, error in
        guard error == nil else {
          completionHandler()
          return
        }
        DispatchQueue.main.async {
          DayframeHealthBackgroundService.shared.receive(kind: kind, reason: "observer") { _ in
            completionHandler()
          }
        }
      }
      store.execute(query)
      observers.append(query)
    }
  }

  private func stopObserving() {
    for query in observers { store.stop(query) }
    observers.removeAll()
  }

  // MARK: - Background app refresh

  private func registerRefreshTask() {
    guard !refreshRegistered else { return }
    refreshRegistered = BGTaskScheduler.shared.register(
      forTaskWithIdentifier: Self.refreshTaskIdentifier,
      using: nil
    ) { task in
      DispatchQueue.main.async {
        DayframeHealthBackgroundService.shared.handleRefresh(task)
      }
    }
  }

  private func handleRefresh(_ task: BGTask) {
    guard enabled else {
      task.setTaskCompleted(success: true)
      return
    }
    scheduleRefresh()
    let id = receive(kind: "all", reason: "refresh") { success in
      task.setTaskCompleted(success: success)
    }
    task.expirationHandler = {
      DispatchQueue.main.async {
        DayframeHealthBackgroundService.shared.finish(id: id, success: false)
      }
    }
  }

  private func scheduleRefresh() {
    guard refreshRegistered else { return }
    let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskIdentifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: Self.refreshIntervalSeconds)
    // Submitting again replaces the pending request, so a recent wake pushes the fallback later.
    try? BGTaskScheduler.shared.submit(request)
  }

  // MARK: - Wakes

  @discardableResult
  private func receive(kind: String, reason: String, completion: @escaping (Bool) -> Void) -> String {
    let wake = DayframeHealthWake(id: UUID().uuidString, kind: kind, reason: reason, receivedAt: Date())
    completions[wake.id] = completion
    beginBackgroundWindowIfNeeded()
    let cap = DispatchWorkItem {
      DayframeHealthBackgroundService.shared.finish(id: wake.id, success: false)
    }
    caps[wake.id] = cap
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.wakeCapSeconds, execute: cap)
    let added = ledger.add(wake)
    for dropped in added.overflow { settle(dropped, success: false) }
    if added.deliverNow { onWake?(wake) }
    return wake.id
  }

  private func settle(_ wake: DayframeHealthWake, success: Bool) {
    caps.removeValue(forKey: wake.id)?.cancel()
    completions.removeValue(forKey: wake.id)?(success)
    if !ledger.hasOutstanding { endBackgroundWindow() }
  }

  private func beginBackgroundWindowIfNeeded() {
    guard backgroundTask == .invalid else { return }
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Dayframe Apple Health sync") {
      // UIKit calls this on the main thread and needs the task ended before it returns.
      let service = DayframeHealthBackgroundService.shared
      for wake in service.ledger.finishAll() { service.settle(wake, success: false) }
      service.endBackgroundWindow()
    }
  }

  private func endBackgroundWindow() {
    let identifier = backgroundTask
    backgroundTask = .invalid
    guard identifier != .invalid else { return }
    UIApplication.shared.endBackgroundTask(identifier)
  }
}
