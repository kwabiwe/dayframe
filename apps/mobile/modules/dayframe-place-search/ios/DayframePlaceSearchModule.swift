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

private struct NearbyPointOfInterestQueryRecord: Record {
  @Field var requestId: String = ""
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var radiusMeters: Double = 400
  @Field var limit: Int = 5
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

  @MainActor
  private lazy var nearbyCoordinator = NearbyPointOfInterestCoordinator(
    searcher: MapKitNearbyPointOfInterestSearcher()
  )

  @MainActor
  private lazy var probe = MapKitProbe()

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

    AsyncFunction("searchNearby") { (request: NearbyPointOfInterestQueryRecord, promise: Promise) in
      Task { @MainActor in
        do {
          // Only opaque ids, titles, address lines, kinds, distances and offsets from the visit
          // cross the bridge, with the names of the areas of interest there; the coordinate of a
          // place is returned by resolveNearby once it is picked.
          let list = try await self.nearbyCoordinator.suggestions(
            requestId: request.requestId,
            latitude: request.latitude,
            longitude: request.longitude,
            radiusMeters: request.radiusMeters,
            limit: request.limit
          )
          promise.resolve([
            "requestId": request.requestId,
            "places": list.places.map(\.dictionary),
            "areasOfInterest": list.areasOfInterest
          ])
        } catch let error as PlaceSearchCoordinatorError {
          promise.reject(PlaceSearchException(error.rawValue))
        } catch {
          promise.reject(PlaceSearchException(PlaceSearchCoordinatorError.searchUnavailable.rawValue))
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("resolveNearby") { (id: String, requestId: String, promise: Promise) in
      Task { @MainActor in
        do {
          let result = try self.nearbyCoordinator.resolve(id: id, requestId: requestId)
          promise.resolve([
            "suggestionId": id,
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
          promise.reject(PlaceSearchException(PlaceSearchCoordinatorError.staleSuggestion.rawValue))
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("cancelNearby") {
      Task { @MainActor in
        self.nearbyCoordinator.cancel()
      }
    }.runOnQueue(.main)

    // Settings › Sync help: counts and yes/no answers only (MapKitProbe never returns a name,
    // address, coordinate or Place ID). Takes a little over a minute.
    AsyncFunction("probeMapKit") { (latitude: Double, longitude: Double, promise: Promise) in
      Task { @MainActor in
        let report = await self.probe.run(latitude: latitude, longitude: longitude)
        promise.resolve(report.dictionary)
      }
    }.runOnQueue(.main)

    OnDestroy {
      Task { @MainActor in
        self.coordinator.cancel()
        self.nearbyCoordinator.cancel()
      }
    }
  }
}
