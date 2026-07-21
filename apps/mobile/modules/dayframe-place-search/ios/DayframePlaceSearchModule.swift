import ExpoModulesCore

private struct PlaceSearchBiasRecord: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var latitudeDelta: Double = 0.45
  @Field var longitudeDelta: Double = 0.55

  var value: PlaceSearchBiasValue {
    PlaceSearchBiasValue(
      latitude: latitude,
      longitude: longitude,
      latitudeDelta: latitudeDelta,
      longitudeDelta: longitudeDelta
    )
  }
}

private struct PlaceSearchQueryRecord: Record {
  @Field var requestId: String = ""
  @Field var query: String = ""
  @Field var bias: PlaceSearchBiasRecord?
}

private final class PlaceSearchException: GenericException<String>, @unchecked Sendable {
  override var code: String { param }
  override var reason: String { "Place search could not complete." }
}

public final class DayframePlaceSearchModule: Module {
  @MainActor
  private lazy var coordinator: PlaceSearchCoordinator = {
    let coordinator = PlaceSearchCoordinator(
      source: MapKitCompletionSource(),
      resolver: MapKitResultResolver()
    )
    coordinator.onSuggestionsChanged = { [weak self] requestId, suggestions in
      self?.sendEvent("onSuggestionsChanged", [
        "requestId": requestId,
        "suggestions": suggestions.map(\.dictionary)
      ])
    }
    coordinator.onSearchError = { [weak self] requestId, error in
      self?.sendEvent("onSearchError", [
        "requestId": requestId,
        "code": error.rawValue
      ])
    }
    return coordinator
  }()

  public func definition() -> ModuleDefinition {
    Name("DayframePlaceSearch")
    Events("onSuggestionsChanged", "onSearchError")

    AsyncFunction("setQuery") { (request: PlaceSearchQueryRecord) in
      Task { @MainActor in
        self.coordinator.setQuery(
          requestId: request.requestId,
          query: request.query,
          bias: request.bias?.value
        )
      }
    }.runOnQueue(.main)

    AsyncFunction("cancel") {
      Task { @MainActor in
        self.coordinator.cancel()
      }
    }.runOnQueue(.main)

    AsyncFunction("resolveSuggestion") { (suggestionId: String, requestId: String, promise: Promise) in
      Task { @MainActor in
        do {
          let result = try await self.coordinator.resolve(
            suggestionId: suggestionId,
            requestId: requestId
          )
          promise.resolve([
            "suggestionId": suggestionId,
            "title": result.title,
            "subtitle": result.subtitle as Any,
            "name": result.name as Any,
            "formattedAddress": result.formattedAddress as Any,
            "latitude": result.latitude,
            "longitude": result.longitude
          ])
        } catch let error as PlaceSearchCoordinatorError {
          promise.reject(PlaceSearchException(error.rawValue))
        } catch {
          promise.reject(PlaceSearchException(PlaceSearchCoordinatorError.searchUnavailable.rawValue))
        }
      }
    }.runOnQueue(.main)

    OnDestroy {
      Task { @MainActor in
        self.coordinator.cancel()
      }
    }
  }
}
