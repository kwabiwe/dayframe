import ExpoModulesCore

public final class DayframeCalendarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeCalendar")

    View(DayframeCalendarExpoView.self) {
      Events(
        "onChangeDay",
        "onChangeWeek",
        "onOpenActiveTimer",
        "onOpenCompletedEntry",
        "onOpenReviewItem",
        "onRequestRefresh",
        "onSelectDay"
      )

      Prop("modelJSON") { (view, modelJSON: String) in
        view.update(modelJSON: modelJSON)
      }
    }
  }
}
