import ExpoModulesCore

public final class DayframeHealthBackgroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeHealthBackground")
    Events("onWake")

    AsyncFunction("setEnabled") { (enabled: Bool, promise: Promise) in
      DayframeHealthBackgroundService.shared.setEnabled(enabled) { promise.resolve($0) }
    }.runOnQueue(.main)

    // Listening and draining happen in one main-queue step, so a wake is either
    // returned here or sent as an event, never both and never neither.
    AsyncFunction("startListening") { () -> [[String: Any]] in
      DayframeHealthBackgroundService.shared.startListening { [weak self] wake in
        self?.sendEvent("onWake", wake.dictionary)
      }.map(\.dictionary)
    }.runOnQueue(.main)

    AsyncFunction("complete") { (id: String, success: Bool) -> Bool in
      DayframeHealthBackgroundService.shared.finish(id: id, success: success)
    }.runOnQueue(.main)

    AsyncFunction("getStatus") { () -> [String: Any] in
      DayframeHealthBackgroundService.shared.status()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        DayframeHealthBackgroundService.shared.stopListening()
      }
    }
  }
}
