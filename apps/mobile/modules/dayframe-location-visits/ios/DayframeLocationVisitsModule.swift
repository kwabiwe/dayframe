import ExpoModulesCore

public final class DayframeLocationVisitsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeLocationVisits")

    AsyncFunction("startMonitoring") { () async -> [String: Any] in
      await DayframeLocationVisitService.shared.startMonitoring()
      return await DayframeLocationVisitService.shared.status()
    }

    AsyncFunction("stopMonitoring") { () async -> [String: Any] in
      await DayframeLocationVisitService.shared.stopMonitoring()
      return await DayframeLocationVisitService.shared.status()
    }

    AsyncFunction("getStatus") { () async -> [String: Any] in
      return await DayframeLocationVisitService.shared.status()
    }

    AsyncFunction("drainSignals") { (limit: Int) -> [[String: Any]] in
      DayframeLocationSignalStore.shared.read(limit: max(1, min(100, limit))).map { $0.dictionary }
    }

    AsyncFunction("clearSignals") { (ids: [String]) -> Int in
      DayframeLocationSignalStore.shared.remove(ids: Set(ids.prefix(100)))
    }

    AsyncFunction("clearAllSignals") { () -> Int in
      DayframeLocationSignalStore.shared.removeAll()
    }
  }
}
