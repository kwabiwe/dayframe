import CoreMotion
import ExpoModulesCore

/// Reads Core Motion's activity history. It never runs in the background on
/// its own and performs no networking: JavaScript queries it from the existing
/// Location capture lane and decides what becomes evidence.
public final class DayframeMotionActivityModule: Module {
  private let manager = CMMotionActivityManager()
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "Dayframe motion activity"
    queue.maxConcurrentOperationCount = 1
    return queue
  }()

  public func definition() -> ModuleDefinition {
    Name("DayframeMotionActivity")

    Function("isAvailable") { () -> Bool in
      CMMotionActivityManager.isActivityAvailable()
    }

    Function("getAuthorizationStatus") { () -> String in
      DayframeMotionActivityCore.authorizationLabel(rawValue: CMMotionActivityManager.authorizationStatus().rawValue)
    }

    // Core Motion has no request API: the first query shows the system prompt.
    AsyncFunction("requestAuthorization") { (promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else {
        promise.resolve("unavailable")
        return
      }
      guard CMMotionActivityManager.authorizationStatus() == .notDetermined else {
        promise.resolve(DayframeMotionActivityCore.authorizationLabel(rawValue: CMMotionActivityManager.authorizationStatus().rawValue))
        return
      }
      let now = Date()
      self.manager.queryActivityStarting(from: now.addingTimeInterval(-60), to: now, to: self.queue) { _, _ in
        promise.resolve(DayframeMotionActivityCore.authorizationLabel(rawValue: CMMotionActivityManager.authorizationStatus().rawValue))
      }
    }

    AsyncFunction("queryActivities") { (fromMs: Double, toMs: Double, limit: Int, promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else {
        promise.reject("ERR_MOTION_UNAVAILABLE", "Motion activity is not available on this device.")
        return
      }
      guard CMMotionActivityManager.authorizationStatus() == .authorized else {
        promise.reject("ERR_MOTION_NOT_AUTHORIZED", "Motion & Fitness access is not allowed.")
        return
      }
      let nowMs = Date().timeIntervalSince1970 * 1_000
      guard let window = DayframeMotionActivityCore.queryWindow(fromMs: fromMs, toMs: toMs, nowMs: nowMs) else {
        promise.resolve([[String: Any]]())
        return
      }
      self.manager.queryActivityStarting(
        from: Date(timeIntervalSince1970: window.fromMs / 1_000),
        to: Date(timeIntervalSince1970: window.toMs / 1_000),
        to: self.queue
      ) { activities, error in
        if let error = error as NSError? {
          let code = error.domain == CMErrorDomain && error.code == Int(CMErrorMotionActivityNotAuthorized.rawValue)
            ? "ERR_MOTION_NOT_AUTHORIZED" : "ERR_MOTION_QUERY_FAILED"
          promise.reject(code, "Motion activity history could not be read.")
          return
        }
        let records = (activities ?? []).map { activity in
          DayframeMotionActivityCore.record(
            startMs: activity.startDate.timeIntervalSince1970 * 1_000,
            stationary: activity.stationary,
            walking: activity.walking,
            running: activity.running,
            cycling: activity.cycling,
            automotive: activity.automotive,
            unknown: activity.unknown,
            confidenceRawValue: activity.confidence.rawValue
          )
        }
        promise.resolve(DayframeMotionActivityCore.ordered(records, limit: limit))
      }
    }
  }
}
