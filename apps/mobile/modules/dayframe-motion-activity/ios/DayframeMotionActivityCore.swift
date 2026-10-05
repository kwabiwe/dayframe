import Foundation

/// Pure mapping between Core Motion's values and what JavaScript receives.
/// Kept free of CoreMotion so it can be unit tested on macOS.
public enum DayframeMotionActivityCore {
  /// Core Motion keeps about seven days of activity history.
  public static let historyMs: Double = 7 * 24 * 60 * 60 * 1_000
  public static let maximumRecords = 2_000

  /// `CMAuthorizationStatus` raw values: 0 not determined, 1 restricted, 2 denied, 3 authorized.
  public static func authorizationLabel(rawValue: Int) -> String {
    switch rawValue {
    case 0: return "not_determined"
    case 1: return "restricted"
    case 2: return "denied"
    case 3: return "authorized"
    default: return "unknown"
    }
  }

  /// `CMMotionActivityConfidence` raw values: 0 low, 1 medium, 2 high.
  public static func confidenceLabel(rawValue: Int) -> String {
    switch rawValue {
    case 2: return "high"
    case 1: return "medium"
    default: return "low"
    }
  }

  public static func clampLimit(_ limit: Int) -> Int {
    max(1, min(maximumRecords, limit))
  }

  /// The window a history query may cover: never more than seven days back,
  /// never into the future, and only when it is non-empty.
  public static func queryWindow(fromMs: Double, toMs: Double, nowMs: Double) -> (fromMs: Double, toMs: Double)? {
    guard fromMs.isFinite, toMs.isFinite, nowMs.isFinite else { return nil }
    let upper = min(toMs, nowMs)
    let lower = max(fromMs, nowMs - historyMs)
    return lower < upper ? (lower, upper) : nil
  }

  /// One record for JavaScript: its start, Core Motion's flags and confidence. No position.
  public static func record(
    startMs: Double,
    stationary: Bool,
    walking: Bool,
    running: Bool,
    cycling: Bool,
    automotive: Bool,
    unknown: Bool,
    confidenceRawValue: Int
  ) -> [String: Any] {
    [
      "startMs": startMs.rounded(),
      "stationary": stationary,
      "walking": walking,
      "running": running,
      "cycling": cycling,
      "automotive": automotive,
      "unknown": unknown,
      "confidence": confidenceLabel(rawValue: confidenceRawValue)
    ]
  }

  /// Records in time order, at most `limit` of them, earliest first, so a
  /// truncated query resumes where it stopped.
  public static func ordered(_ records: [[String: Any]], limit: Int) -> [[String: Any]] {
    let sorted = records.sorted { ($0["startMs"] as? Double ?? 0) < ($1["startMs"] as? Double ?? 0) }
    return Array(sorted.prefix(clampLimit(limit)))
  }
}
