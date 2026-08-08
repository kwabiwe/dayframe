import ExpoModulesCore

public final class DayframeDurationDialModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeDurationDial")

    View(DayframeDurationDialExpoView.self) {
      Events("onInteraction")

      Prop("modelJSON") { (view, modelJSON: String) in
        view.update(modelJSON: modelJSON)
      }
    }
  }
}
