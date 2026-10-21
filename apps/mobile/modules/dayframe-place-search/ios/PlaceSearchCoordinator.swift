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
    /// Found by searching for the name of an area of interest the stay lies in.
    case area(name: String)

    var key: String {
      switch self {
      case .nearby: return "nearby"
      case .contextual: return "contextual"
      case .area: return "area"
      }
    }
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
  /// Where the place lies from the search centre, in whole metres east and north. Relative only:
  /// the venue ranker compares places with each other (a pharmacy inside a supermarket).
  var offsetEastMeters: Int? = nil
  var offsetNorthMeters: Int? = nil

  func withSource(_ source: Source) -> NearbyPointOfInterestValue {
    NearbyPointOfInterestValue(
      name: name, formattedAddress: formattedAddress, latitude: latitude, longitude: longitude,
      distanceMeters: distanceMeters, relevanceIndex: relevanceIndex, category: category, source: source,
      localityNames: localityNames, offsetEastMeters: offsetEastMeters, offsetNorthMeters: offsetNorthMeters
    )
  }
}

/// What crosses the bridge for one nearby place: an opaque id for the current generation, the
/// title, an address line, the rounded distance, its kind of place (the Apple category without
/// its prefix, e.g. "FitnessCenter"; the row says "Gym · 40 m"), where it lies from the visit in
/// whole metres east and north, and how it was found. The venue ranker (packages/shared
/// `rankVenues`) orders them. The coordinate stays in the native registry until the person picks
/// the place (`NearbyPointOfInterestCoordinator.resolve`).
struct NearbyPointOfInterestSuggestionValue: Equatable {
  let id: String
  let requestId: String
  let title: String
  let subtitle: String?
  let distanceMeters: Int
  var category: String? = nil
  var offsetEastMeters: Int? = nil
  var offsetNorthMeters: Int? = nil
  var source: String = "nearby"

  var dictionary: [String: Any] {
    [
      "id": id,
      "requestId": requestId,
      "title": title,
      "subtitle": subtitle as Any,
      "distanceMeters": distanceMeters,
      "category": category as Any,
      "offsetEastMeters": offsetEastMeters as Any,
      "offsetNorthMeters": offsetNorthMeters as Any,
      "source": source
    ]
  }

  /// A stable key for an Apple point-of-interest category: its raw value without "MKPOICategory".
  static func categoryKey(_ category: MKPointOfInterestCategory?) -> String? {
    guard let raw = category?.rawValue, !raw.isEmpty else { return nil }
    let key = raw.hasPrefix("MKPOICategory") ? String(raw.dropFirst("MKPOICategory".count)) : raw
    return key.isEmpty ? nil : key
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
  /// Names of the areas of interest the point lies in (a shopping centre, a campus), or none.
  /// Calls back exactly once, with none on failure or timeout.
  func areasOfInterest(center: CLLocationCoordinate2D, completion: @escaping ([String]) -> Void)
  func cancel()
}

/// The coordinator's internal answer, before ids are assigned.
struct NearbyPointOfInterestSearchResult: Equatable {
  let places: [NearbyPointOfInterestValue]
  let areasOfInterest: [String]
}

/// One nearby search's answer: the places and the areas of interest around the visit.
struct NearbyPointOfInterestList: Equatable {
  let places: [NearbyPointOfInterestSuggestionValue]
  let areasOfInterest: [String]
}

@MainActor
final class NearbyPointOfInterestCoordinator {
  /// The most places one search may return: MapKit answers with the nearest ~50 whatever the
  /// radius (owner's iOS 27.2 checks, 21 Oct 2026), plus the site and area searches.
  nonisolated static let maximumLimit = 60
  nonisolated static let defaultLimit = 3

  private let searcher: NearbyPointOfInterestSearching
  private let idFactory: () -> String
  /// Bumped on every start, cancel and teardown. A search, a callback or a published list belongs
  /// to the generation it started in, so nothing from an earlier one can publish or resolve, even
  /// when a reopened screen reuses the same request id (Codex r1 on #358).
  private var generation = 0
  private var pending: (
    generation: Int,
    continuation: CheckedContinuation<NearbyPointOfInterestSearchResult, Error>
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

  /// Searches around the centre and publishes at most `limit` places, nearest first (a site or
  /// area found by name always kept), as opaque suggestions with the areas of interest there.
  /// Coordinates never leave this coordinator until `resolve`.
  func suggestions(
    requestId: String,
    latitude: Double,
    longitude: Double,
    radiusMeters: Double,
    limit: Int = NearbyPointOfInterestCoordinator.defaultLimit
  ) async throws -> NearbyPointOfInterestList {
    let (started, result) = try await run(
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
    let places = result.places.map { place in
      let id = idFactory()
      registry[id] = place
      return NearbyPointOfInterestSuggestionValue(
        id: id,
        requestId: requestId,
        title: place.name,
        subtitle: place.formattedAddress,
        distanceMeters: place.distanceMeters,
        category: NearbyPointOfInterestSuggestionValue.categoryKey(place.category),
        offsetEastMeters: place.offsetEastMeters,
        offsetNorthMeters: place.offsetNorthMeters,
        source: place.source.key
      )
    }
    return NearbyPointOfInterestList(places: places, areasOfInterest: result.areasOfInterest)
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
    try await run(latitude: latitude, longitude: longitude, radiusMeters: radiusMeters, limit: limit).result.places
  }

  /// At most four requests per visit (design §6.3): the nearby search and the areas of interest
  /// together, then a search for a name the nearby places share (the site), then one for an area
  /// of interest no nearby place is named after (the centre itself).
  private func run(
    latitude: Double,
    longitude: Double,
    radiusMeters: Double,
    limit: Int
  ) async throws -> (generation: Int, result: NearbyPointOfInterestSearchResult) {
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
    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)

    let result: NearbyPointOfInterestSearchResult = try await withCheckedThrowingContinuation { continuation in
      pending = (started, continuation)
      var areas: [String]?
      var nearby: [NearbyPointOfInterestValue]?

      let publish: ([NearbyPointOfInterestValue], [String]) -> Void = { [weak self] values, areas in
        guard let self else { return }
        self.finish(generation: started, result: .success(NearbyPointOfInterestSearchResult(
          places: Self.presented(values, maximumDistanceMeters: nil, limit: cappedLimit),
          areasOfInterest: areas
        )))
      }
      let searchArea: ([NearbyPointOfInterestValue], [String]) -> Void = { [weak self] values, areas in
        guard let self, self.isPending(started) else { return }
        let named = Set(values.map { Self.normalizedName($0.name) })
        guard let area = areas.first(where: { !named.contains(Self.normalizedName($0)) }) else {
          publish(values, areas)
          return
        }
        self.searcher.searchContext(query: area, center: center, radiusMeters: radiusMeters) { [weak self] areaResult in
          guard let self, self.isPending(started) else { return }
          let found = (try? areaResult.get()) ?? []
          let matching = found
            .filter { Self.namesArea($0.name, area) }
            .map { $0.withSource(.area(name: area)) }
          publish(values + matching, areas)
        }
      }
      let proceed: () -> Void = { [weak self] in
        guard let self, self.isPending(started), let areas, let nearby else { return }
        guard let context = Self.contextQuery(from: nearby) else {
          searchArea(nearby, areas)
          return
        }
        self.searcher.searchContext(query: context, center: center, radiusMeters: radiusMeters) { [weak self] contextResult in
          guard let self, self.isPending(started) else { return }
          searchArea(nearby + ((try? contextResult.get()) ?? []), areas)
        }
      }

      searcher.areasOfInterest(center: center) { [weak self] names in
        guard let self, self.isPending(started), areas == nil else { return }
        areas = Self.distinctAreaNames(names)
        proceed()
      }
      searcher.searchNearby(center: center, radiusMeters: radiusMeters) { [weak self] result in
        guard let self, self.isPending(started) else { return }
        switch result {
        case .failure(let error):
          self.finish(generation: started, result: .failure(error))
        case .success(let values):
          nearby = values
          proceed()
        }
      }
    }
    return (started, result)
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

  /// The places to hand to the venue ranker: the `normalized` set, nearest first (ties by name).
  static func presented(
    _ values: [NearbyPointOfInterestValue],
    maximumDistanceMeters: Double? = nil,
    limit: Int = defaultLimit
  ) -> [NearbyPointOfInterestValue] {
    normalized(values, maximumDistanceMeters: maximumDistanceMeters, limit: limit)
      .sorted(by: nearestFirst)
  }

  /// Categories that are never somewhere a person spends a visit (parking, cash machines,
  /// chargers, toilets). They are dropped here on the phone: requests that ask MapKit to filter
  /// categories have been reported failing on Apple's side (design §1.5).
  static let excludedCategories: [MKPointOfInterestCategory] = [
    .parking, .atm, .evCharger, .restroom
  ]

  /// Plain hygiene before ranking (the venue ranker in packages/shared decides the order): drops
  /// nameless and excluded places and anything beyond `maximumDistanceMeters`, keeps one place per
  /// name (one found by name first, else the nearest), then keeps every place found by name (the
  /// site and the area searches) and fills up to `limit` with the nearest.
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
      if let existing = bestByName[key], !comesBefore(value, existing) { continue }
      bestByName[key] = value
    }
    let ordered = bestByName.values.sorted(by: comesBefore)
    return Array(ordered.prefix(cappedLimit))
  }

  /// Whole metres east and north from `origin` to `point` (a local flat approximation, ample
  /// within a few hundred metres).
  nonisolated static func offsetMeters(
    from origin: CLLocationCoordinate2D,
    to point: CLLocationCoordinate2D
  ) -> (east: Int, north: Int) {
    let metresPerDegree = 111_320.0
    let east = (point.longitude - origin.longitude) * metresPerDegree * cos(origin.latitude * .pi / 180)
    let north = (point.latitude - origin.latitude) * metresPerDegree
    return (Int(east.rounded()), Int(north.rounded()))
  }

  /// Names Apple gives the areas around a point, once each, in Apple's order.
  static func distinctAreaNames(_ names: [String]) -> [String] {
    var seen = Set<String>()
    return names
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && seen.insert(normalizedName($0)).inserted }
  }

  /// Whether an area search's result is the area itself (same name, or one name holding the other).
  static func namesArea(_ name: String, _ area: String) -> Bool {
    let place = normalizedName(name)
    let target = normalizedName(area)
    guard !place.isEmpty, !target.isEmpty else { return false }
    if place == target { return true }
    let (short, long) = place.count < target.count ? (place, target) : (target, place)
    return short.count >= 6 && long.contains(short)
  }

  private static func comesBefore(_ left: NearbyPointOfInterestValue, _ right: NearbyPointOfInterestValue) -> Bool {
    let leftNamed = isFoundByName(left)
    if leftNamed != isFoundByName(right) { return leftNamed }
    return nearestFirst(left, right)
  }

  private static func isFoundByName(_ value: NearbyPointOfInterestValue) -> Bool {
    if case .nearby = value.source { return false }
    return true
  }

  private static func nearestFirst(_ left: NearbyPointOfInterestValue, _ right: NearbyPointOfInterestValue) -> Bool {
    if left.distanceMeters != right.distanceMeters {
      return left.distanceMeters < right.distanceMeters
    }
    return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
  }

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
    result: Result<NearbyPointOfInterestSearchResult, PlaceSearchCoordinatorError>
  ) {
    guard isPending(started), let pending else { return }
    self.pending = nil
    pending.continuation.resume(with: result.mapError { $0 as Error })
  }

  static func normalizedName(_ value: String) -> String {
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
  /// How long the areas of interest may take before the search goes on without them.
  nonisolated static let areasOfInterestTimeout: TimeInterval = 2.5

  private var nearbySearch: MKLocalSearch?
  private var contextSearch: MKLocalSearch?
  private var geocoder: CLGeocoder?
  private var areasGeneration = 0

  func searchNearby(
    center: CLLocationCoordinate2D,
    radiusMeters: CLLocationDistance,
    completion: @escaping (Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void
  ) {
    cancel()
    // No category filter: those requests have been reported failing on Apple's side, so the
    // excluded kinds are dropped on the phone (NearbyPointOfInterestCoordinator.normalized).
    let request = MKLocalPointsOfInterestRequest(center: center, radius: radiusMeters)
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

  /// CLPlacemark.areasOfInterest, the only containment hint MapKit gives (deprecated in iOS 27.2
  /// but still answering there: one area at a busy centre, none elsewhere, owner's checks on
  /// 21 Oct 2026). Answers exactly once: the names, or none on failure, cancel or timeout.
  func areasOfInterest(center: CLLocationCoordinate2D, completion: @escaping ([String]) -> Void) {
    geocoder?.cancelGeocode()
    areasGeneration &+= 1
    let started = areasGeneration
    let geocoder = CLGeocoder()
    self.geocoder = geocoder
    var answered = false
    let answer: ([String]) -> Void = { [weak self] names in
      guard !answered else { return }
      answered = true
      if self?.areasGeneration == started { self?.geocoder = nil }
      completion(names)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.areasOfInterestTimeout) {
      answer([])
    }
    geocoder.reverseGeocodeLocation(CLLocation(latitude: center.latitude, longitude: center.longitude)) { placemarks, _ in
      DispatchQueue.main.async {
        answer(placemarks?.first?.areasOfInterest ?? [])
      }
    }
  }

  func cancel() {
    nearbySearch?.cancel()
    nearbySearch = nil
    contextSearch?.cancel()
    contextSearch = nil
    geocoder?.cancelGeocode()
    geocoder = nil
    areasGeneration &+= 1
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
      let offset = NearbyPointOfInterestCoordinator.offsetMeters(from: origin.coordinate, to: coordinate)
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
        localityNames: localityNames,
        offsetEastMeters: offset.east,
        offsetNorthMeters: offset.north
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
