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

    AsyncFunction("begin") { (name: String) async -> String? in
      await MainActor.run {
        self.service.begin(name: name)
      }
    }

    AsyncFunction("end") { (leaseToken: String, _reason: String) async -> Bool in
      await MainActor.run {
        self.service.end(leaseToken: leaseToken)
      }
    }

    AsyncFunction("endAll") { (_reason: String) async -> Int in
      await MainActor.run {
        self.service.endAll()
      }
    }

    OnDestroy {
      Task { @MainActor in
        self.service.endAll()
      }
    }
  }
}
