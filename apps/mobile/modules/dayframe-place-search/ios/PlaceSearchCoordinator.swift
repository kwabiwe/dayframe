import Foundation
import MapKit

struct PlaceSearchBiasValue: Equatable {
  let latitude: Double
  let longitude: Double
  let latitudeDelta: Double
  let longitudeDelta: Double

  var region: MKCoordinateRegion {
    MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
    )
  }
}

struct PlaceSearchCompletionValue {
  let title: String
  let subtitle: String?
  let payload: AnyObject
}

struct PlaceSearchSuggestionValue: Equatable {
  let id: String
  let requestId: String
  let title: String
  let subtitle: String?

  var dictionary: [String: Any] {
    [
      "id": id,
      "requestId": requestId,
      "title": title,
      "subtitle": subtitle as Any
    ]
  }
}

struct ResolvedPlaceSearchValue: Equatable {
  let title: String
  let subtitle: String?
  let name: String?
  let formattedAddress: String?
  let latitude: Double
  let longitude: Double
}

enum PlaceSearchCoordinatorError: String, Error, Equatable {
  case searchUnavailable = "search_unavailable"
  case networkUnavailable = "network_unavailable"
  case staleSuggestion = "stale_suggestion"
  case noResolvedResult = "no_resolved_result"
  case cancelled = "cancelled"
}

@MainActor
protocol PlaceSearchCompletionSourcing: AnyObject {
  var onSuggestions: ((String, [PlaceSearchCompletionValue]) -> Void)? { get set }
  var onError: ((String, PlaceSearchCoordinatorError) -> Void)? { get set }
  func setQuery(requestId: String, query: String, bias: PlaceSearchBiasValue?)
  func cancel()
}

@MainActor
protocol PlaceSearchResultResolving: AnyObject {
  func resolve(
    completion: PlaceSearchCompletionValue,
    bias: PlaceSearchBiasValue?,
    completionHandler: @escaping (Result<ResolvedPlaceSearchValue, PlaceSearchCoordinatorError>) -> Void
  )
  func cancel()
}

@MainActor
final class PlaceSearchCoordinator {
  private struct RegistryEntry {
    let requestId: String
    let completion: PlaceSearchCompletionValue
  }

  private let source: PlaceSearchCompletionSourcing
  private let resolver: PlaceSearchResultResolving
  private let idFactory: () -> String
  private var activeRequestId: String?
  private var activeBias: PlaceSearchBiasValue?
  private var registry: [String: RegistryEntry] = [:]
  private var pendingResolution: (
    token: String,
    continuation: CheckedContinuation<ResolvedPlaceSearchValue, Error>
  )?

  var onSuggestionsChanged: ((String, [PlaceSearchSuggestionValue]) -> Void)?
  var onSearchError: ((String, PlaceSearchCoordinatorError) -> Void)?

  init(
    source: PlaceSearchCompletionSourcing,
    resolver: PlaceSearchResultResolving,
    idFactory: @escaping () -> String = { String(UUID().uuidString.prefix(12)) }
  ) {
    self.source = source
    self.resolver = resolver
    self.idFactory = idFactory

    source.onSuggestions = { [weak self] requestId, completions in
      self?.receive(requestId: requestId, completions: completions)
    }
    source.onError = { [weak self] requestId, error in
      self?.receive(requestId: requestId, error: error)
    }
  }

  func setQuery(requestId: String, query: String, bias: PlaceSearchBiasValue?) {
    cancelPendingResolution(with: .cancelled)
    resolver.cancel()
    registry.removeAll(keepingCapacity: true)
    activeRequestId = requestId
    activeBias = bias

    let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard normalizedQuery.count >= 2 else {
      source.cancel()
      onSuggestionsChanged?(requestId, [])
      return
    }

    source.setQuery(requestId: requestId, query: normalizedQuery, bias: bias)
  }

  func cancel() {
    source.cancel()
    resolver.cancel()
    cancelPendingResolution(with: .cancelled)
    activeRequestId = nil
    activeBias = nil
    registry.removeAll(keepingCapacity: false)
  }

  func resolve(suggestionId: String, requestId: String) async throws -> ResolvedPlaceSearchValue {
    guard requestId == activeRequestId,
          let entry = registry[suggestionId],
          entry.requestId == requestId else {
      throw PlaceSearchCoordinatorError.staleSuggestion
    }

    cancelPendingResolution(with: .cancelled)
    resolver.cancel()

    return try await withCheckedThrowingContinuation { continuation in
      let token = UUID().uuidString
      pendingResolution = (token, continuation)
      resolver.resolve(completion: entry.completion, bias: activeBias) { [weak self] result in
        guard let self else { return }
        guard self.pendingResolution?.token == token else { return }
        self.pendingResolution = nil
        self.registry.removeAll(keepingCapacity: false)
        self.activeRequestId = nil
        self.activeBias = nil
        continuation.resume(with: result.mapError { $0 as Error })
      }
    }
  }

  private func receive(requestId: String, completions: [PlaceSearchCompletionValue]) {
    guard requestId == activeRequestId else { return }

    registry.removeAll(keepingCapacity: true)
    let suggestions = completions.prefix(12).map { completion in
      let id = idFactory()
      registry[id] = RegistryEntry(requestId: requestId, completion: completion)
      return PlaceSearchSuggestionValue(
        id: id,
        requestId: requestId,
        title: completion.title,
        subtitle: completion.subtitle
      )
    }
    onSuggestionsChanged?(requestId, suggestions)
  }

  private func receive(requestId: String, error: PlaceSearchCoordinatorError) {
    guard requestId == activeRequestId else { return }
    registry.removeAll(keepingCapacity: false)
    onSearchError?(requestId, error)
  }

  private func cancelPendingResolution(with error: PlaceSearchCoordinatorError) {
    guard let pending = pendingResolution else { return }
    pendingResolution = nil
    pending.continuation.resume(throwing: error)
  }
}

@MainActor
private final class MapKitCompletionPayload: NSObject {
  let completion: MKLocalSearchCompletion

  init(completion: MKLocalSearchCompletion) {
    self.completion = completion
  }
}

@MainActor
final class MapKitCompletionSource: NSObject, PlaceSearchCompletionSourcing, @preconcurrency MKLocalSearchCompleterDelegate {
  var onSuggestions: ((String, [PlaceSearchCompletionValue]) -> Void)?
  var onError: ((String, PlaceSearchCoordinatorError) -> Void)?

  private let completer: MKLocalSearchCompleter
  private var activeRequestId: String?

  override init() {
    completer = MKLocalSearchCompleter()
    super.init()
    completer.delegate = self
    completer.resultTypes = [.address, .pointOfInterest]
    if #available(iOS 18.0, macOS 15.0, *) {
      completer.regionPriority = .default
    }
  }

  func setQuery(requestId: String, query: String, bias: PlaceSearchBiasValue?) {
    activeRequestId = requestId
    if let bias {
      completer.region = bias.region
    }
    completer.queryFragment = query
  }

  func cancel() {
    activeRequestId = nil
    completer.cancel()
    completer.queryFragment = ""
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    guard let requestId = activeRequestId else { return }
    let values = completer.results.map { completion in
      PlaceSearchCompletionValue(
        title: completion.title,
        subtitle: completion.subtitle.isEmpty ? nil : completion.subtitle,
        payload: MapKitCompletionPayload(completion: completion)
      )
    }
    onSuggestions?(requestId, values)
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    guard let requestId = activeRequestId else { return }
    onError?(requestId, Self.stableError(for: error))
  }

  private static func stableError(for error: Error) -> PlaceSearchCoordinatorError {
    let code = (error as NSError).code
    if code == NSURLErrorNotConnectedToInternet ||
      code == NSURLErrorNetworkConnectionLost ||
      code == NSURLErrorTimedOut {
      return .networkUnavailable
    }
    return .searchUnavailable
  }
}

@MainActor
final class MapKitResultResolver: PlaceSearchResultResolving {
  private var search: MKLocalSearch?

  func resolve(
    completion: PlaceSearchCompletionValue,
    bias: PlaceSearchBiasValue?,
    completionHandler: @escaping (Result<ResolvedPlaceSearchValue, PlaceSearchCoordinatorError>) -> Void
  ) {
    guard let payload = completion.payload as? MapKitCompletionPayload else {
      completionHandler(.failure(.staleSuggestion))
      return
    }

    let request = MKLocalSearch.Request(completion: payload.completion)
    request.resultTypes = [.address, .pointOfInterest]
    if let bias {
      request.region = bias.region
    }
    if #available(iOS 18.0, macOS 15.0, *) {
      request.regionPriority = .default
    }

    let localSearch = MKLocalSearch(request: request)
    search = localSearch
    localSearch.start { [weak self] response, error in
      guard let self, self.search === localSearch else { return }
      self.search = nil

      if let error {
        completionHandler(.failure(Self.stableError(for: error)))
        return
      }

      // MapKit orders results for the selected completion. Use the first item
      // with a finite, valid coordinate so resolution stays deterministic.
      guard let item = response?.mapItems.first(where: { item in
        let coordinate = item.placemark.coordinate
        return coordinate.latitude.isFinite &&
          coordinate.longitude.isFinite &&
          (-90.0 ... 90.0).contains(coordinate.latitude) &&
          (-180.0 ... 180.0).contains(coordinate.longitude)
      }) else {
        completionHandler(.failure(.noResolvedResult))
        return
      }

      let coordinate = item.placemark.coordinate
      completionHandler(.success(ResolvedPlaceSearchValue(
        title: completion.title,
        subtitle: completion.subtitle,
        name: item.name,
        formattedAddress: item.placemark.title,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude
      )))
    }
  }

  func cancel() {
    search?.cancel()
    search = nil
  }

  private static func stableError(for error: Error) -> PlaceSearchCoordinatorError {
    let code = (error as NSError).code
    if code == NSURLErrorNotConnectedToInternet ||
      code == NSURLErrorNetworkConnectionLost ||
      code == NSURLErrorTimedOut {
      return .networkUnavailable
    }
    return .searchUnavailable
  }
}
