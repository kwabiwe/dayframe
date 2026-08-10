import Foundation

enum DayframeDurationDialCore {
  static let fullTurn = Double.pi * 2

  static func unwrap(previous: Double, next: Double) -> Double {
    guard previous.isFinite, next.isFinite else { return 0 }
    var delta = next - previous
    while delta > Double.pi { delta -= fullTurn }
    while delta <= -Double.pi { delta += fullTurn }
    return delta
  }

  static func minuteDelta(radians: Double) -> Int {
    guard radians.isFinite else { return 0 }
    return Int((radians / fullTurn * 60).rounded())
  }

  static func angle(timestampMilliseconds: Double, calendar: Calendar = .current) -> Double {
    let date = Date(timeIntervalSince1970: timestampMilliseconds / 1_000)
    let components = calendar.dateComponents([.minute, .second, .nanosecond], from: date)
    let seconds = Double(components.minute ?? 0) * 60 +
      Double(components.second ?? 0) +
      Double(components.nanosecond ?? 0) / 1_000_000_000
    return seconds / 3_600 * fullTurn - Double.pi / 2
  }

  static func formatDuration(milliseconds: Double) -> String {
    let seconds = max(0, min(86_400, Int(milliseconds / 1_000)))
    return String(
      format: "%02d:%02d:%02d",
      seconds / 3_600,
      (seconds % 3_600) / 60,
      seconds % 60
    )
  }

  static func strongestHaptic(from previous: Int, to next: Int) -> Int {
    guard previous != next else { return 0 }
    let lower = min(previous, next)
    let upper = max(previous, next)
    if crossesMultiple(lower: lower, upper: upper, multiple: 60) { return 3 }
    if crossesMultiple(lower: lower, upper: upper, multiple: 5) { return 2 }
    return 1
  }

  static func ownsTouch(
    x: Double,
    y: Double,
    width: Double,
    height: Double,
    includesRangeHandle: Bool
  ) -> Bool {
    guard x.isFinite, y.isFinite, width.isFinite, height.isFinite,
          width > 0, height > 0 else { return false }
    let baseRadius = min(width, height) * 0.34
    let handleOffset = includesRangeHandle ? 34.0 : 0.0
    let accessibilityRadius = baseRadius + handleOffset + 22.0
    return hypot(x - width / 2, y - height / 2) <= accessibilityRadius
  }

  private static func crossesMultiple(lower: Int, upper: Int, multiple: Int) -> Bool {
    guard multiple > 0 else { return false }
    let first = Int(ceil(Double(lower) / Double(multiple))) * multiple
    return first <= upper && first != 0
  }
}
