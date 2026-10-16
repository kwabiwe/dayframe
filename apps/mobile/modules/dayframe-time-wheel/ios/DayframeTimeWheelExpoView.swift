import ExpoModulesCore
import UIKit

/// What React asks the wheel to show (owner decision A11b, 12 Oct 2026). React owns the draft:
/// the wheel is a native UIDatePicker in wheel style that reports the instant the user picks.
private struct DayframeTimeWheelRecord: Decodable {
  /// "12h" adds the AM/PM column (PRD D18); anything else, or none, keeps 24-hour columns.
  let clockFormat: String?
  let colorScheme: String
  let maximumMs: Double?
  let minimumMs: Double?
  let minuteInterval: Int
  let modelVersion: Int
  let presentationId: Int
  let revision: Int
  let valueMs: Double
}

/// One inline `UIDatePicker` (`.time`, `.wheels`, in the device's 12/24-hour Dayframe format). Its own selection haptics and momentum
/// are the platform's. VoiceOver gets no wheel: the time card itself is adjustable instead, so the
/// picker is hidden from accessibility. A change from React (the dial moving the start) re-aims the
/// wheel without echoing back; only the user's own spins are reported.
final class DayframeTimeWheelExpoView: ExpoView {
  let onTimeChange = EventDispatcher()

  private let picker = UIDatePicker()
  private var record: DayframeTimeWheelRecord?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    picker.datePickerMode = .time
    picker.preferredDatePickerStyle = .wheels
    picker.locale = Self.locale(clockFormat: nil)
    picker.accessibilityElementsHidden = true
    accessibilityElementsHidden = true
    picker.addTarget(self, action: #selector(valueChanged), for: .valueChanged)
    addSubview(picker)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
  }

  func update(modelJSON: String) {
    guard
      let data = modelJSON.data(using: .utf8),
      let next = try? JSONDecoder().decode(DayframeTimeWheelRecord.self, from: data),
      next.modelVersion == 1
    else { return }
    let previous = record
    record = next

    overrideUserInterfaceStyle = next.colorScheme == "dark" ? .dark : .light
    // Dayframe's own time format, not the locale's: explicit hour cycles keep the columns matching
    // every other time in the app whatever the iOS language and 24-Hour Time setting say.
    let locale = Self.locale(clockFormat: next.clockFormat)
    if picker.locale?.identifier != locale.identifier { picker.locale = locale }
    // The interval first, so setting the date never rounds a time React asked for exactly.
    let interval = next.minuteInterval == 5 ? 5 : 1
    if picker.minuteInterval != interval { picker.minuteInterval = interval }
    picker.minimumDate = next.minimumMs.map { Date(timeIntervalSince1970: $0 / 1000) }
    picker.maximumDate = next.maximumMs.map { Date(timeIntervalSince1970: $0 / 1000) }

    let value = Date(timeIntervalSince1970: next.valueMs / 1000)
    let isNewPresentation = previous?.presentationId != next.presentationId
    // Only a new presentation or an outside change (a new revision) moves the columns. React's echo
    // of the user's own spin carries the same revision and is ignored, so a render that lands after
    // a second spin never pulls the wheel back to the first one.
    if isNewPresentation || previous?.revision != next.revision {
      // An outside change re-aims the columns; a new presentation lands without motion.
      picker.setDate(value, animated: !isNewPresentation && !UIAccessibility.isReduceMotionEnabled)
    }
    // UIKit clamps to the bounds (and rounds to the minute step) without a valueChanged event, and a
    // stale echo may differ from what the wheel shows; say so, so React never keeps a time the wheel
    // isn't showing.
    if abs(picker.date.timeIntervalSince1970 * 1000 - next.valueMs) >= 1 {
      report(reason: "normalized")
    }
  }

  private static func locale(clockFormat: String?) -> Locale {
    clockFormat == "12h" ? Locale(identifier: "en_US@hours=h12") : Locale(identifier: "en_GB@hours=h23")
  }

  @objc private func valueChanged() {
    report(reason: "user")
  }

  private func report(reason: String) {
    guard let record else { return }
    onTimeChange([
      "presentationId": record.presentationId,
      "reason": reason,
      "revision": record.revision,
      "valueMs": picker.date.timeIntervalSince1970 * 1000
    ])
  }
}
