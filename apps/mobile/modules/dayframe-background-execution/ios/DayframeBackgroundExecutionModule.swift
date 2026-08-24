import ExpoModulesCore

public final class DayframeBackgroundExecutionModule: Module {
  @MainActor
  private lazy var service: DayframeBackgroundExecutionService = {
    let service = DayframeBackgroundExecutionService()
    service.onExpired = { [weak self] generation, leaseTokens in
      self?.sendEvent("onExpired", [
        "generation": generation,
        "leaseTokens": leaseTokens,
        "reason": "expired"
      ])
    }
    return service
  }()

  public func definition() -> ModuleDefinition {
    Name("DayframeBackgroundExecution")
    Events("onExpired")

    AsyncFunction("begin") { (name: String) -> String? in
      self.service.begin(name: name)
    }.runOnQueue(.main)

    AsyncFunction("end") { (leaseToken: String, _reason: String) -> Bool in
      self.service.end(leaseToken: leaseToken)
    }.runOnQueue(.main)

    AsyncFunction("endAll") { (_reason: String) -> Int in
      self.service.endAll()
    }.runOnQueue(.main)

    OnDestroy {
      Task { @MainActor in
        self.service.endAll()
      }
    }
  }
}

