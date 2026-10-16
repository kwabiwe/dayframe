import ExpoModulesCore

public final class DayframeTimeWheelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeTimeWheel")

    // The iPhone's own 12/24-hour choice (Settings › General › Date & Time › 24-Hour Time), which
    // Dayframe's "System" time format follows (PRD D18). The "j" template is the locale's preferred
    // hour; a format with "a" (AM/PM) is 12-hour.
    Function("systemUses24HourClock") { () -> Bool in
      let format = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: Locale.current) ?? ""
      return !format.contains("a")
    }

    View(DayframeTimeWheelExpoView.self) {
      Events("onTimeChange")

      Prop("modelJSON") { (view, modelJSON: String) in
        view.update(modelJSON: modelJSON)
      }
    }
  }
}
