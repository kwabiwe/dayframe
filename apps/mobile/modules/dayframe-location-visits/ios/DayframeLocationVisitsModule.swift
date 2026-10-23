import ExpoModulesCore

public final class DayframeLocationVisitsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeLocationVisits")

    AsyncFunction("startMonitoring") { () async -> [String: Any] in
      await DayframeLocationVisitService.shared.startMonitoring()
      return await Self.status()
    }

    AsyncFunction("stopMonitoring") { () async -> [String: Any] in
      await DayframeLocationVisitService.shared.stopMonitoring()
      return await Self.status()
    }

    AsyncFunction("getStatus") { () async -> [String: Any] in
      return await Self.status()
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

  /// The service's main-actor fields plus the journal's, which wait for the store's queue and so
  /// are read here, off the main thread (Expo runs these closures off the main actor).
  private static func status() async -> [String: Any] {
    var status = await DayframeLocationVisitService.shared.status()
    let store = DayframeLocationSignalStore.shared.statusFields()
    status["pendingSignalCount"] = store.pendingCount
    status["nativeStoreErrorCode"] = store.errorCode ?? NSNull()
    return status
  }
}
