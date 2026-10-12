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

struct NearbyPointOfInterestValue: Equatable {
  enum Source: Equatable {
    case nearby
    case contextual(anchor: String)
  }

  let name: String
  let formattedAddress: String?
  let latitude: Double
  let longitude: Double
  let distanceMeters: Int
  let relevanceIndex: Int
  let category: MKPointOfInterestCategory?
  let source: Source
  let localityNames: [String]
}

/// What crosses the bridge for one nearby place: an opaque id for the current generation, the
/// title, an address line and the rounded distance. The coordinate stays in the native registry
/// until the person picks the place (`NearbyPointOfInterestCoordinator.resolve`).
struct NearbyPointOfInterestSuggestionValue: Equatable {
  let id: String
  let requestId: String
  let title: String
  let subtitle: String?
  let distanceMeters: Int

  var dictionary: [String: Any] {
    [
      "id": id,
      "requestId": requestId,
      "title": title,
      "subtitle": subtitle as Any,
      "distanceMeters": distanceMeters
    ]
  }
}

enum PlaceSearchCoordinatorError: String, Error, Equatable {
  case searchUnavailable = "search_unavailable"
  case networkUnavailable = "network_unavailable"
  case staleSuggestion = "stale_suggestion"
  case noResolvedResult = "no_resolved_result"
  case cancelled = "cancelled"
}

@MainActor
protocol NearbyPointOfInterestSearching: AnyObject {
  func searchNearby(
    center: CLLocationCoordinate2D,
    radiusMeters: CLLocationDistance,
    completion: @escaping (Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void
  )
  func searchContext(
    query: String,
    center: CLLocationCoordinate2D,
    radiusMeters: CLLocationDistance,
    completion: @escaping (Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void
  )
  func cancel()
}

@MainActor
final class NearbyPointOfInterestCoordinator {
  /// The most places one search may return; callers ask for fewer.
  nonisolated static let maximumLimit = 8
  nonisolated static let defaultLimit = 3

  private let searcher: NearbyPointOfInterestSearching
  private let idFactory: () -> String
  /// Bumped on every start, cancel and teardown. A search, a callback or a published list belongs
  /// to the generation it started in, so nothing from an earlier one can publish or resolve, even
  /// when a reopened screen reuses the same request id (Codex r1 on #358).
  private var generation = 0
  private var pending: (
    generation: Int,
    continuation: CheckedContinuation<[NearbyPointOfInterestValue], Error>
  )?
  /// The published list: opaque id -> place, for `registryGeneration` only. Replaced by the next
  /// search and cleared by cancel and teardown, so an id from an older list never resolves.
  private var registryGeneration: Int?
  private var registryRequestId: String?
  private var registry: [String: NearbyPointOfInterestValue] = [:]

  init(
    searcher: NearbyPointOfInterestSearching,
    idFactory: @escaping () -> String = { String(UUID().uuidString.prefix(12)) }
  ) {
    self.searcher = searcher
    self.idFactory = idFactory
  }

  /// Searches around the centre and publishes at most `limit` places, nearest first, as opaque
  /// suggestions. Coordinates never leave this coordinator until `resolve`.
  func suggestions(
    requestId: String,
    latitude: Double,
    longitude: Double,
    radiusMeters: Double,
    limit: Int = NearbyPointOfInterestCoordinator.defaultLimit
  ) async throws -> [NearbyPointOfInterestSuggestionValue] {
    let (started, places) = try await run(
      latitude: latitude,
      longitude: longitude,
      radiusMeters: radiusMeters,
      limit: limit
    )
    // A list that finished just before a cancel or a newer start resumes here late: it must not
    // publish, whatever its request id.
    guard started == generation else {
      throw PlaceSearchCoordinatorError.cancelled
    }
    registry.removeAll(keepingCapacity: true)
    registryGeneration = started
    registryRequestId = requestId
    return places.map { place in
      let id = idFactory()
      registry[id] = place
      return NearbyPointOfInterestSuggestionValue(
        id: id,
        requestId: requestId,
        title: place.name,
        subtitle: place.formattedAddress,
        distanceMeters: place.distanceMeters
      )
    }
  }

  /// The picked place of the current list, with its coordinate. A stale or unknown id is
  /// rejected. The list stays until the next search, so another place from it can still be
  /// picked.
  func resolve(id: String, requestId: String) throws -> ResolvedPlaceSearchValue {
    guard registryGeneration == generation,
          requestId == registryRequestId,
          let place = registry[id] else {
      throw PlaceSearchCoordinatorError.staleSuggestion
    }
    return ResolvedPlaceSearchValue(
      title: place.name,
      subtitle: place.formattedAddress,
      name: place.name,
      formattedAddress: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude
    )
  }

  func search(
    requestId: String,
    latitude: Double,
    longitude: Double,
    radiusMeters: Double,
    limit: Int = NearbyPointOfInterestCoordinator.defaultLimit
  ) async throws -> [NearbyPointOfInterestValue] {
    try await run(latitude: latitude, longitude: longitude, radiusMeters: radiusMeters, limit: limit).places
  }

  private func run(
    latitude: Double,
    longitude: Double,
    radiusMeters: Double,
    limit: Int
  ) async throws -> (generation: Int, places: [NearbyPointOfInterestValue]) {
    cancel()
    generation &+= 1
    let started = generation
    let cappedLimit = min(max(limit, 1), Self.maximumLimit)
    guard latitude.isFinite,
          longitude.isFinite,
          (-90.0 ... 90.0).contains(latitude),
          (-180.0 ... 180.0).contains(longitude),
          radiusMeters.isFinite,
          radiusMeters > 0 else {
      throw PlaceSearchCoordinatorError.searchUnavailable
    }

    let places: [NearbyPointOfInterestValue] = try await withCheckedThrowingContinuation { continuation in
      pending = (started, continuation)
      searcher.searchNearby(
        center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
        radiusMeters: radiusMeters
      ) { [weak self] result in
        guard let self, self.isPending(started) else { return }
        switch result {
        case .failure(let error):
          self.finish(generation: started, result: .failure(error))
        case .success(let nearby):
          guard let context = Self.contextQuery(from: nearby) else {
            self.finish(
              generation: started,
              result: .success(Self.presented(nearby, maximumDistanceMeters: radiusMeters, limit: cappedLimit))
            )
            return
          }
          self.searcher.searchContext(
            query: context,
            center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            radiusMeters: radiusMeters
          ) { [weak self] contextResult in
            guard let self, self.isPending(started) else { return }
            let values: [NearbyPointOfInterestValue]
            switch contextResult {
            case .success(let contextual):
              values = nearby + contextual
            case .failure:
              values = nearby
            }
            self.finish(
              generation: started,
              result: .success(Self.presented(values, maximumDistanceMeters: radiusMeters, limit: cappedLimit))
            )
          }
        }
      }
    }
    return (started, places)
  }

  func cancel() {
    searcher.cancel()
    generation &+= 1
    registryGeneration = nil
    registryRequestId = nil
    registry.removeAll(keepingCapacity: false)
    guard let pending else { return }
    self.pending = nil
    pending.continuation.resume(throwing: PlaceSearchCoordinatorError.cancelled)
  }

  static func contextQuery(from values: [NearbyPointOfInterestValue]) -> String? {
    struct TokenEvidence {
      var names = Set<String>()
      var bestRelevance = Int.max
      var nearestDistance = Int.max
    }

    let localityTokens = Set(values.flatMap(\.localityNames).flatMap(tokens(in:)))
    var evidence: [String: TokenEvidence] = [:]
    for value in values {
      let nameKey = normalizedName(value.name)
      for token in Set(tokens(in: value.name)) where !genericContextTokens.contains(token) && !localityTokens.contains(token) {
        var item = evidence[token] ?? TokenEvidence()
        item.names.insert(nameKey)
        item.bestRelevance = min(item.bestRelevance, value.relevanceIndex)
        item.nearestDistance = min(item.nearestDistance, value.distanceMeters)
        evidence[token] = item
      }
    }

    return evidence
      .filter { $0.value.names.count >= 2 }
      .sorted { left, right in
        if left.value.names.count != right.value.names.count {
          return left.value.names.count > right.value.names.count
        }
        if left.value.bestRelevance != right.value.bestRelevance {
          return left.value.bestRelevance < right.value.bestRelevance
        }
        if left.value.nearestDistance != right.value.nearestDistance {
          return left.value.nearestDistance < right.value.nearestDistance
        }
        return left.key < right.key
      }
      .first?.key
  }

  /// The places to show: the `normalized` choice, nearest first (ties by name), so the list
  /// reads as "what is around this visit" rather than a ranking.
  static func presented(
    _ values: [NearbyPointOfInterestValue],
    maximumDistanceMeters: Double? = nil,
    limit: Int = defaultLimit
  ) -> [NearbyPointOfInterestValue] {
    normalized(values, maximumDistanceMeters: maximumDistanceMeters, limit: limit)
      .sorted { left, right in
        if left.distanceMeters != right.distanceMeters {
          return left.distanceMeters < right.distanceMeters
        }
        return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
      }
  }

  /// Categories that are never somewhere a person spends a visit (parking, cash machines,
  /// chargers, toilets). MapKit is asked to leave them out, and they are dropped here too.
  static let excludedCategories: [MKPointOfInterestCategory] = [
    .parking, .atm, .evCharger, .restroom
  ]

  static func normalized(
    _ values: [NearbyPointOfInterestValue],
    maximumDistanceMeters: Double? = nil,
    limit: Int = defaultLimit
  ) -> [NearbyPointOfInterestValue] {
    let cappedLimit = min(max(limit, 1), maximumLimit)
    let distanceLimit = maximumDistanceMeters.map { max(0, Int($0.rounded(.up))) }
    var bestByName: [String: NearbyPointOfInterestValue] = [:]
    for value in values {
      let key = normalizedName(value.name)
      guard !key.isEmpty,
            !(value.category.map(excludedCategories.contains) ?? false),
            value.distanceMeters >= 0,
            distanceLimit.map({ value.distanceMeters <= $0 }) ?? true else { continue }
      if let existing = bestByName[key] {
        if candidateComesBefore(value, existing) {
          bestByName[key] = value
        }
      } else {
        bestByName[key] = value
      }
    }

    let candidates = bestByName.values.sorted(by: candidateComesBefore)
    guard !candidates.isEmpty else { return [] }

    var selected: [NearbyPointOfInterestValue] = []
    var selectedNames = Set<String>()
    var selectedGroups = Set<DestinationGroup>()

    func append(_ candidate: NearbyPointOfInterestValue?) {
      guard selected.count < cappedLimit, let candidate else { return }
      let name = normalizedName(candidate.name)
      guard selectedNames.insert(name).inserted else { return }
      selected.append(candidate)
      selectedGroups.insert(destinationGroup(for: candidate))
    }

    let contextual = candidates.filter { value in
      if case .contextual = value.source { return !isUtility(value) }
      return false
    }
    if let primary = contextual.first(where: { value in
      guard case .contextual(let anchor) = value.source else { return false }
      return tokens(in: value.name).contains(anchor)
    }) {
      append(primary)
      for group in contextualGroupPreference where selected.count < cappedLimit && !selectedGroups.contains(group) {
        append(candidates.first { destinationGroup(for: $0) == group && !isUtility($0) })
      }
    }

    for candidate in candidates where selected.count < cappedLimit && !isUtility(candidate) {
      let group = destinationGroup(for: candidate)
      if !selectedGroups.contains(group) {
        append(candidate)
      }
    }
    for candidate in candidates where selected.count < cappedLimit && !isUtility(candidate) {
      append(candidate)
    }
    for candidate in candidates where selected.count < cappedLimit {
      append(candidate)
    }
    return selected
  }

  private enum DestinationGroup: Hashable {
    case dining
    case activity
    case retail
    case lodging
    case service
    case other
    case utility
  }

  private static let contextualGroupPreference: [DestinationGroup] = [
    .dining, .activity, .retail, .lodging, .service, .other
  ]

  private static let genericContextTokens: Set<String> = [
    "and", "bar", "cafe", "car", "centre", "center", "cinema", "coffee",
    "company", "food", "group", "hotel", "limited", "ltd", "mall", "market",
    "parking", "park", "restaurant", "retail", "services", "shop", "shopping",
    "station", "store", "superstore", "the", "uk"
  ]

  private func isPending(_ started: Int) -> Bool {
    generation == started && pending?.generation == started
  }

  private func finish(
    generation started: Int,
    result: Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>
  ) {
    guard isPending(started), let pending else { return }
    self.pending = nil
    pending.continuation.resume(with: result.mapError { $0 as Error })
  }

  private static func candidateComesBefore(
    _ left: NearbyPointOfInterestValue,
    _ right: NearbyPointOfInterestValue
  ) -> Bool {
    if isUtility(left) != isUtility(right) {
      return !isUtility(left)
    }
    if sourcePriority(left.source) != sourcePriority(right.source) {
      return sourcePriority(left.source) < sourcePriority(right.source)
    }
    if left.relevanceIndex != right.relevanceIndex {
      return left.relevanceIndex < right.relevanceIndex
    }
    if left.distanceMeters != right.distanceMeters {
      return left.distanceMeters < right.distanceMeters
    }
    return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
  }

  private static func sourcePriority(_ source: NearbyPointOfInterestValue.Source) -> Int {
    if case .contextual = source { return 0 }
    return 1
  }

  private static func isUtility(_ value: NearbyPointOfInterestValue) -> Bool {
    destinationGroup(for: value) == .utility
  }

  private static func destinationGroup(for value: NearbyPointOfInterestValue) -> DestinationGroup {
    guard let category = value.category else { return .other }
    if [
      .restaurant, .cafe, .bakery, .brewery, .winery
    ].contains(category) { return .dining }
    if [
      .movieTheater, .museum, .theater, .nightlife, .fitnessCenter,
      .park, .amusementPark, .aquarium, .zoo, .stadium
    ].contains(category) { return .activity }
    if [.store, .foodMarket].contains(category) { return .retail }
    if category == .hotel { return .lodging }
    if [
      .pharmacy, .bank, .laundry, .postOffice
    ].contains(category) { return .service }
    if [
      .parking, .publicTransport, .gasStation, .atm, .evCharger, .restroom, .carRental
    ].contains(category) { return .utility }
    return .other
  }

  private static func normalizedName(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
      .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
  }

  private static func tokens(in value: String) -> [String] {
    normalizedName(value)
      .components(separatedBy: CharacterSet.alphanumerics.inverted)
      .filter { $0.count >= 4 }
  }
}

@MainActor
final class MapKitNearbyPointOfInterestSearcher: NearbyPointOfInterestSearching {
  private var nearbySearch: MKLocalSearch?
  private var contextSearch: MKLocalSearch?

  func searchNearby(
    center: CLLocationCoordinate2D,
    radiusMeters: CLLocationDistance,
    completion: @escaping (Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void
  ) {
    cancel()
    let request = MKLocalPointsOfInterestRequest(center: center, radius: radiusMeters)
    request.pointOfInterestFilter = MKPointOfInterestFilter(
      excluding: NearbyPointOfInterestCoordinator.excludedCategories
    )
    let localSearch = MKLocalSearch(request: request)
    nearbySearch = localSearch
    let origin = CLLocation(latitude: center.latitude, longitude: center.longitude)
    localSearch.start { [weak self] response, error in
      guard let self, self.nearbySearch === localSearch else { return }
      self.nearbySearch = nil
      if let error {
        completion(.failure(Self.stableError(for: error)))
        return
      }
      let values = Self.values(
        from: response?.mapItems ?? [],
        origin: origin,
        source: .nearby
      )
      completion(.success(values))
    }
  }

  func searchContext(
    query: String,
    center: CLLocationCoordinate2D,
    radiusMeters: CLLocationDistance,
    completion: @escaping (Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void
  ) {
    contextSearch?.cancel()
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    request.region = MKCoordinateRegion(
      center: center,
      latitudinalMeters: radiusMeters * 2,
      longitudinalMeters: radiusMeters * 2
    )
    request.resultTypes = [.pointOfInterest]
    request.pointOfInterestFilter = MKPointOfInterestFilter(
      excluding: NearbyPointOfInterestCoordinator.excludedCategories
    )
    if #available(iOS 18.0, macOS 15.0, *) {
      request.regionPriority = .required
    }
    let localSearch = MKLocalSearch(request: request)
    contextSearch = localSearch
    let origin = CLLocation(latitude: center.latitude, longitude: center.longitude)
    localSearch.start { [weak self] response, error in
      guard let self, self.contextSearch === localSearch else { return }
      self.contextSearch = nil
      if let error {
        completion(.failure(Self.stableError(for: error)))
        return
      }
      completion(.success(Self.values(
        from: response?.mapItems ?? [],
        origin: origin,
        source: .contextual(anchor: query)
      )))
    }
  }

  func cancel() {
    nearbySearch?.cancel()
    nearbySearch = nil
    contextSearch?.cancel()
    contextSearch = nil
  }

  private static func values(
    from items: [MKMapItem],
    origin: CLLocation,
    source: NearbyPointOfInterestValue.Source
  ) -> [NearbyPointOfInterestValue] {
    items.enumerated().compactMap { index, item -> NearbyPointOfInterestValue? in
      let coordinate = item.placemark.coordinate
      guard coordinate.latitude.isFinite,
            coordinate.longitude.isFinite,
            (-90.0 ... 90.0).contains(coordinate.latitude),
            (-180.0 ... 180.0).contains(coordinate.longitude),
            let name = item.name?.trimmingCharacters(in: .whitespacesAndNewlines),
            !name.isEmpty else { return nil }
      let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
      let localityNames = [
        item.placemark.locality,
        item.placemark.subLocality,
        item.placemark.subAdministrativeArea,
        item.placemark.administrativeArea,
        item.placemark.country
      ].compactMap { $0 }
      return NearbyPointOfInterestValue(
        name: name,
        formattedAddress: item.placemark.title,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        distanceMeters: max(0, Int(origin.distance(from: location).rounded())),
        relevanceIndex: index,
        category: item.pointOfInterestCategory,
        source: source,
        localityNames: localityNames
      )
    }
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
