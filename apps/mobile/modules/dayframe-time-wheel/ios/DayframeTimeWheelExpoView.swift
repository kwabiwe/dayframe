import ExpoModulesCore
import UIKit

/// What React asks the wheel to show (owner decision A11b, 12 Oct 2026). React owns the draft:
/// the wheel is a native UIDatePicker in wheel style that reports the instant the user picks.
private struct DayframeTimeWheelRecord: Decodable {
  let colorScheme: String
  let maximumMs: Double?
  let minimumMs: Double?
  let minuteInterval: Int
  let modelVersion: Int
  let presentationId: Int
  let revision: Int
  let valueMs: Double
}

/// One inline `UIDatePicker` (`.time`, `.wheels`, 24-hour). Its own selection haptics and momentum
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
    // Dayframe shows times as 24-hour HH:MM everywhere.
    picker.locale = Locale(identifier: "en_GB")
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
    // The interval first, so setting the date never rounds a time React asked for exactly.
    let interval = next.minuteInterval == 5 ? 5 : 1
    if picker.minuteInterval != interval { picker.minuteInterval = interval }
    picker.minimumDate = next.minimumMs.map { Date(timeIntervalSince1970: $0 / 1000) }
    picker.maximumDate = next.maximumMs.map { Date(timeIntervalSince1970: $0 / 1000) }

    let value = Date(timeIntervalSince1970: next.valueMs / 1000)
    let isNewPresentation = previous?.presentationId != next.presentationId
    if isNewPresentation || previous?.revision != next.revision || picker.date != value {
      // An outside change re-aims the columns; a new presentation lands without motion.
      picker.setDate(value, animated: !isNewPresentation && !UIAccessibility.isReduceMotionEnabled)
    }
  }

  @objc private func valueChanged() {
    guard let record else { return }
    onTimeChange([
      "presentationId": record.presentationId,
      "revision": record.revision,
      "valueMs": picker.date.timeIntervalSince1970 * 1000
    ])
  }
}
