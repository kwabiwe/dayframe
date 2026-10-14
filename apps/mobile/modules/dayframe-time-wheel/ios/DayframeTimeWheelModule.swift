import ExpoModulesCore

public final class DayframeTimeWheelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeTimeWheel")

    View(DayframeTimeWheelExpoView.self) {
      Events("onTimeChange")

      Prop("modelJSON") { (view, modelJSON: String) in
        view.update(modelJSON: modelJSON)
      }
    }
  }
}
