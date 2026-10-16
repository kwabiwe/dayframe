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

  /// "0m", "42m", "1h 00m", "1h 05m": the dial centre's duration, as the Blocks prototype's `fmtDur`.
  static func formatShortDuration(milliseconds: Double) -> String {
    let minutes = max(0, min(1_440, Int(milliseconds / 60_000)))
    let hours = minutes / 60
    let rest = minutes % 60
    return hours == 0 ? "\(rest)m" : String(format: "%dh %02dm", hours, rest)
  }

  /// The solid arc's sweep in radians: the part of the current hour. Whole hours already passed
  /// show as the faint lap underneath, so an exact hour has no solid arc (as in the prototype).
  static func solidArcSweep(milliseconds: Double) -> Double {
    let duration = max(0, milliseconds)
    return duration.truncatingRemainder(dividingBy: 3_600_000) / 3_600_000 * fullTurn
  }

  /// "1 full turn + 5 min" once a block passes an hour (the prototype's dial subtitle), else nil.
  static func lapDetail(milliseconds: Double) -> String? {
    let minutes = max(0, Int(milliseconds / 60_000))
    let laps = minutes / 60
    guard laps > 0 else { return nil }
    return "\(laps) full turn\(laps == 1 ? "" : "s") + \(minutes % 60) min"
  }

  /// The width inside a ring of `innerRadius` along a horizontal line `offset` from its centre.
  static func chordWidth(innerRadius: Double, offset: Double) -> Double {
    let squared = innerRadius * innerRadius - offset * offset
    return squared > 0 ? 2 * squared.squareRoot() : 0
  }

  static func strongestHaptic(from previous: Int, to next: Int) -> Int {
    guard previous != next else { return 0 }
    let lower = min(previous, next)
    let upper = max(previous, next)
    if crossesMultiple(lower: lower, upper: upper, multiple: 60) { return 3 }
    if crossesMultiple(lower: lower, upper: upper, multiple: 5) { return 2 }
    return 1
  }

  /// How far outside the ring a stopped block's range handle orbits.
  static let rangeHandleOffset = 34.0
  /// Half the range handle's 13-point dot.
  static let rangeHandleHalfSize = 6.5

  /// The smallest ring that still fits the centre duration and its subtitle legibly.
  static let minimumLegibleRadius = 40.0

  /// Whether a stopped block's range handle can orbit inside the view without shrinking the ring
  /// below `minimumLegibleRadius`. On the shortest (condensed) dial it cannot: there the handle is
  /// not drawn or touchable, and "Move time window" stays available to VoiceOver.
  static func rangeHandleFits(width: Double, height: Double) -> Bool {
    let side = min(width, height)
    return side / 2 - rangeHandleOffset - rangeHandleHalfSize >= min(side * 0.34, minimumLegibleRadius)
  }

  /// The ring's radius: 34 % of the dial's shorter side. A stopped block's range handle orbits
  /// outside the ring, so where it is shown the ring shrinks just enough to keep that handle inside
  /// the view (a short dial at large text would otherwise clip it and lose its touches).
  static func baseRadius(width: Double, height: Double, includesRangeHandle: Bool) -> Double {
    let side = min(width, height)
    let natural = side * 0.34
    guard includesRangeHandle, rangeHandleFits(width: width, height: height) else { return natural }
    return min(natural, side / 2 - rangeHandleOffset - rangeHandleHalfSize)
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
    let baseRadius = baseRadius(width: width, height: height, includesRangeHandle: includesRangeHandle)
    let handleOffset = includesRangeHandle ? rangeHandleOffset : 0.0
    let accessibilityRadius = baseRadius + handleOffset + 22.0
    return hypot(x - width / 2, y - height / 2) <= accessibilityRadius
  }

  private static func crossesMultiple(lower: Int, upper: Int, multiple: Int) -> Bool {
    guard multiple > 0 else { return false }
    let first = Int(ceil(Double(lower) / Double(multiple))) * multiple
    return first <= upper && first != 0
  }

  // MARK: Clock detail (PRD D18)

  private static func formatter(_ pattern: String) -> DateFormatter {
    let formatter = DateFormatter()
    // A fixed locale, so iOS's own 12/24-hour override never rewrites Dayframe's chosen pattern.
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = pattern
    return formatter
  }

  private static let twentyFourHour = formatter("HH:mm")
  private static let twelveHour = formatter("h:mm a")
  private static let twelveHourBare = formatter("h:mm")
  private static let meridiem = formatter("a")

  /// One clock time as the shared `formatClockTime` writes it: "21:30" or "9:30 PM".
  static func clock(milliseconds: Double, clockFormat: String?, timeZone: TimeZone = .current) -> String {
    let date = Date(timeIntervalSince1970: milliseconds / 1_000)
    let formatter = clockFormat == "12h" ? twelveHour : twentyFourHour
    formatter.timeZone = timeZone
    return formatter.string(from: date)
  }

  /**
   The dial's clock subtitle, longest first, so the drawing can take the first that fits inside the
   ring: "since 9:30 PM" / "9:30 PM–10:35 PM", then in 12-hour mode the shared meridiem once
   ("9:30–10:35 PM") and finally the bare times ("since 9:30", "9:30–10:35"), which are never
   longer than the 24-hour text that always fitted before (Codex r1 on #447).
   */
  static func clockDetailCandidates(
    startMs: Double,
    endMs: Double,
    running: Bool,
    clockFormat: String?,
    timeZone: TimeZone = .current
  ) -> [String] {
    let start = clock(milliseconds: startMs, clockFormat: clockFormat, timeZone: timeZone)
    let end = clock(milliseconds: endMs, clockFormat: clockFormat, timeZone: timeZone)
    guard clockFormat == "12h" else { return [running ? "since \(start)" : "\(start)–\(end)"] }
    twelveHourBare.timeZone = timeZone
    meridiem.timeZone = timeZone
    let startDate = Date(timeIntervalSince1970: startMs / 1_000)
    let endDate = Date(timeIntervalSince1970: endMs / 1_000)
    let bareStart = twelveHourBare.string(from: startDate)
    let bareEnd = twelveHourBare.string(from: endDate)
    if running { return ["since \(start)", "since \(bareStart)"] }
    var candidates = ["\(start)–\(end)"]
    if meridiem.string(from: startDate) == meridiem.string(from: endDate) {
      candidates.append("\(bareStart)–\(end)")
    }
    candidates.append("\(bareStart)–\(bareEnd)")
    return candidates
  }
}
