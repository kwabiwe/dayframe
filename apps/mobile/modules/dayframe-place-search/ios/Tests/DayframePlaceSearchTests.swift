import XCTest
import MapKit
@testable import DayframePlaceSearch

@MainActor
final class DayframePlaceSearchTests: XCTestCase {
  func testNearbySearchReturnsTopThreeDeduplicatedInProviderOrder() {
    let values = [
      nearby("Vue", distance: 140, relevance: 0),
      nearby("Wagamama", distance: 90, relevance: 1),
      nearby("vue", distance: 145, relevance: 2),
      nearby("Next", distance: 120, relevance: 3),
      nearby("Lakeside", distance: 60, relevance: 4)
    ]

    XCTAssertEqual(
      NearbyPointOfInterestCoordinator.normalized(values).map(\.name),
      ["Vue", "Wagamama", "Next"]
    )
  }

  func testNearbyOrderingUsesDistanceAsTieBreaker() {
    let values = [
      nearby("Farther", distance: 250, relevance: 0),
      nearby("Nearer", distance: 80, relevance: 0)
    ]
    XCTAssertEqual(
      NearbyPointOfInterestCoordinator.normalized(values).map(\.name),
      ["Nearer", "Farther"]
    )
  }

  func testContextQueryUsesRepeatedDistinctiveNameButRejectsLocalityAndGenericWords() {
    let lakeside = [
      nearby("Lakeside Parking", distance: 40, relevance: 0, category: .parking),
      nearby("Apple Lakeside", distance: 90, relevance: 1, category: .store),
      nearby("Vue Cinema Thurrock", distance: 130, relevance: 2, category: .movieTheater)
    ]
    XCTAssertEqual(NearbyPointOfInterestCoordinator.contextQuery(from: lakeside), "lakeside")

    let localityOnly = [
      nearby("Thurrock Cinema", distance: 40, relevance: 0, localityNames: ["Thurrock"]),
      nearby("Thurrock Store", distance: 60, relevance: 1, localityNames: ["Thurrock"])
    ]
    XCTAssertNil(NearbyPointOfInterestCoordinator.contextQuery(from: localityOnly))

    let genericOnly = [
      nearby("Central Retail Park", distance: 40, relevance: 0),
      nearby("Riverside Retail Park", distance: 60, relevance: 1)
    ]
    XCTAssertNil(NearbyPointOfInterestCoordinator.contextQuery(from: genericOnly))
  }

  func testContextualRankingPromotesSiteThenDiningAndActivity() {
    let values = [
      nearby("Mr Simms Sweet Shop", distance: 14, relevance: 0, category: .store),
      nearby("Brother2Brother", distance: 14, relevance: 1, category: .store),
      nearby("Charlie's Sweet Emporium", distance: 14, relevance: 2, category: .store),
      nearby("Lakeside Shopping Centre", distance: 378, relevance: 0, category: .store, source: .contextual(anchor: "lakeside")),
      nearby("IKEA", distance: 523, relevance: 1, category: .store, source: .contextual(anchor: "lakeside")),
      nearby("Vue Cinema Thurrock", distance: 496, relevance: 6, category: .movieTheater, source: .contextual(anchor: "lakeside")),
      nearby("wagamama", distance: 429, relevance: 12, category: .restaurant, source: .contextual(anchor: "lakeside"))
    ]

    XCTAssertEqual(
      NearbyPointOfInterestCoordinator.normalized(values, maximumDistanceMeters: 750).map(\.name),
      ["Lakeside Shopping Centre", "wagamama", "Vue Cinema Thurrock"]
    )
  }

  func testNearbyRankingDemotesUtilitiesAndEnforcesRadius() {
    let values = [
      nearby("Nearest parking", distance: 5, relevance: 0, category: .parking),
      nearby("Cafe", distance: 80, relevance: 1, category: .cafe),
      nearby("Outside venue", distance: 751, relevance: 2, category: .movieTheater)
    ]
    XCTAssertEqual(
      NearbyPointOfInterestCoordinator.normalized(values, maximumDistanceMeters: 750).map(\.name),
      ["Cafe", "Nearest parking"]
    )
  }

  func testNearbySearchPropagatesRequestAndResults() async throws {
    let searcher = FakeNearbySearcher()
    let coordinator = NearbyPointOfInterestCoordinator(searcher: searcher)
    let task = Task {
      try await coordinator.search(
        requestId: "nearby-1",
        latitude: 51.5,
        longitude: 0.4,
        radiusMeters: 750
      )
    }
    await Task.yield()
    XCTAssertEqual(searcher.radiusMeters, 750)
    searcher.completeNearby(.success([nearby("Cinema", distance: 100, relevance: 0)]))
    let result = try await task.value
    XCTAssertEqual(result.map(\.name), ["Cinema"])
  }

  func testNearbyCancellationRejectsPendingRequest() async {
    let searcher = FakeNearbySearcher()
    let coordinator = NearbyPointOfInterestCoordinator(searcher: searcher)
    let task = Task {
      try await coordinator.search(
        requestId: "nearby-1",
        latitude: 51.5,
        longitude: 0.4,
        radiusMeters: 750
      )
    }
    await Task.yield()
    coordinator.cancel()
    await XCTAssertThrowsErrorAsync(try await task.value) { error in
      XCTAssertEqual(error as? PlaceSearchCoordinatorError, .cancelled)
    }
    XCTAssertGreaterThanOrEqual(searcher.cancelCount, 2)
  }

  func testNearbyFailureIsStable() async {
    let searcher = FakeNearbySearcher()
    let coordinator = NearbyPointOfInterestCoordinator(searcher: searcher)
    let task = Task {
      try await coordinator.search(
        requestId: "nearby-1",
        latitude: 51.5,
        longitude: 0.4,
        radiusMeters: 750
      )
    }
    await Task.yield()
    searcher.completeNearby(.failure(.networkUnavailable))
    await XCTAssertThrowsErrorAsync(try await task.value) { error in
      XCTAssertEqual(error as? PlaceSearchCoordinatorError, .networkUnavailable)
    }
  }

  func testContextSearchMergesResultsBeforePublishing() async throws {
    let searcher = FakeNearbySearcher()
    let coordinator = NearbyPointOfInterestCoordinator(searcher: searcher)
    let task = Task {
      try await coordinator.search(
        requestId: "nearby-1",
        latitude: 51.5,
        longitude: 0.4,
        radiusMeters: 750
      )
    }
    await Task.yield()
    searcher.completeNearby(.success([
      nearby("Lakeside Parking", distance: 40, relevance: 0, category: .parking),
      nearby("Apple Lakeside", distance: 90, relevance: 1, category: .store)
    ]))
    await Task.yield()
    XCTAssertEqual(searcher.contextQuery, "lakeside")
    searcher.completeContext(.success([
      nearby("Lakeside Shopping Centre", distance: 300, relevance: 0, category: .store, source: .contextual(anchor: "lakeside")),
      nearby("wagamama", distance: 320, relevance: 4, category: .restaurant, source: .contextual(anchor: "lakeside"))
    ]))
    let result = try await task.value
    XCTAssertEqual(result.map(\.name), ["Lakeside Shopping Centre", "wagamama", "Apple Lakeside"])
  }

  func testContextFailureFallsBackToBaseNearbyResults() async throws {
    let searcher = FakeNearbySearcher()
    let coordinator = NearbyPointOfInterestCoordinator(searcher: searcher)
    let task = Task {
      try await coordinator.search(
        requestId: "nearby-1",
        latitude: 51.5,
        longitude: 0.4,
        radiusMeters: 750
      )
    }
    await Task.yield()
    searcher.completeNearby(.success([
      nearby("Riverside Cafe", distance: 40, relevance: 0, category: .cafe),
      nearby("Riverside Gym", distance: 90, relevance: 1, category: .fitnessCenter)
    ]))
    await Task.yield()
    searcher.completeContext(.failure(.networkUnavailable))
    let result = try await task.value
    XCTAssertEqual(result.map(\.name), ["Riverside Cafe", "Riverside Gym"])
  }

  func testCancellationDuringContextSearchRejectsAndIgnoresLateResults() async {
    let searcher = FakeNearbySearcher()
    let coordinator = NearbyPointOfInterestCoordinator(searcher: searcher)
    let task = Task {
      try await coordinator.search(
        requestId: "nearby-1",
        latitude: 51.5,
        longitude: 0.4,
        radiusMeters: 750
      )
    }
    await Task.yield()
    searcher.completeNearby(.success([
      nearby("Riverside Cafe", distance: 40, relevance: 0),
      nearby("Riverside Gym", distance: 90, relevance: 1)
    ]))
    await Task.yield()
    XCTAssertEqual(searcher.contextQuery, "riverside")
    coordinator.cancel()
    searcher.completeContext(.success([
      nearby("Late result", distance: 20, relevance: 0, source: .contextual(anchor: "riverside"))
    ]))
    await XCTAssertThrowsErrorAsync(try await task.value) { error in
      XCTAssertEqual(error as? PlaceSearchCoordinatorError, .cancelled)
    }
  }

  func testRequestIdPropagationAndSerializableSuggestionDTO() {
    let harness = Harness(ids: ["opaque-1"])
    var received: (String, [PlaceSearchSuggestionValue])?
    harness.coordinator.onSuggestionsChanged = { received = ($0, $1) }

    harness.coordinator.setQuery(requestId: "request-7", query: "Home", bias: nil)
    harness.source.emit(requestId: "request-7", completions: [completion("Home", "Chelmsford")])

    XCTAssertEqual(harness.source.lastRequestId, "request-7")
    XCTAssertEqual(received?.0, "request-7")
    XCTAssertEqual(received?.1.first, PlaceSearchSuggestionValue(
      id: "opaque-1",
      requestId: "request-7",
      title: "Home",
      subtitle: "Chelmsford"
    ))
    XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: received!.1[0].dictionary))
  }

  func testStaleCompletionUpdateIsRejected() {
    let harness = Harness(ids: ["new-id"])
    var received: [String] = []
    harness.coordinator.onSuggestionsChanged = { requestId, _ in
      received.append(requestId)
    }

    harness.coordinator.setQuery(requestId: "old", query: "Cher", bias: nil)
    harness.coordinator.setQuery(requestId: "new", query: "Home", bias: nil)
    harness.source.emit(requestId: "old", completions: [completion("Old")])
    harness.source.emit(requestId: "new", completions: [completion("New")])

    XCTAssertEqual(received, ["new"])
  }

  func testOpaqueIdentifierResolvesCurrentSuggestion() async throws {
    let expected = ResolvedPlaceSearchValue(
      title: "The King's Church",
      subtitle: "Chelmsford",
      name: "The King's Church",
      formattedAddress: "Moulsham Street, Chelmsford",
      latitude: 51.73,
      longitude: 0.47
    )
    let harness = Harness(ids: ["short-lived"], resolution: .success(expected))
    harness.coordinator.setQuery(requestId: "current", query: "Kings", bias: nil)
    harness.source.emit(requestId: "current", completions: [completion("The King's Church")])

    let result = try await harness.coordinator.resolve(
      suggestionId: "short-lived",
      requestId: "current"
    )
    XCTAssertEqual(result, expected)
    XCTAssertEqual(harness.resolver.resolveCount, 1)
  }

  func testUnknownOrStaleSuggestionIsRejected() async {
    let harness = Harness(ids: ["current-id"])
    harness.coordinator.setQuery(requestId: "current", query: "Home", bias: nil)
    harness.source.emit(requestId: "current", completions: [completion("Home")])

    await XCTAssertThrowsErrorAsync(
      try await harness.coordinator.resolve(suggestionId: "missing", requestId: "current")
    ) { error in
      XCTAssertEqual(error as? PlaceSearchCoordinatorError, .staleSuggestion)
    }
  }

  func testCancelClearsRegistryAndNativeWork() async {
    let harness = Harness(ids: ["current-id"])
    harness.coordinator.setQuery(requestId: "current", query: "Home", bias: nil)
    harness.source.emit(requestId: "current", completions: [completion("Home")])
    harness.coordinator.cancel()

    XCTAssertEqual(harness.source.cancelCount, 1)
    XCTAssertGreaterThanOrEqual(harness.resolver.cancelCount, 2)
    await XCTAssertThrowsErrorAsync(
      try await harness.coordinator.resolve(suggestionId: "current-id", requestId: "current")
    ) { error in
      XCTAssertEqual(error as? PlaceSearchCoordinatorError, .staleSuggestion)
    }
  }

  func testNoResolvedResultIsStable() async {
    let harness = Harness(ids: ["current-id"], resolution: .failure(.noResolvedResult))
    harness.coordinator.setQuery(requestId: "current", query: "Nowhere", bias: nil)
    harness.source.emit(requestId: "current", completions: [completion("Nowhere")])

    await XCTAssertThrowsErrorAsync(
      try await harness.coordinator.resolve(suggestionId: "current-id", requestId: "current")
    ) { error in
      XCTAssertEqual(error as? PlaceSearchCoordinatorError, .noResolvedResult)
    }
  }

  func testClearQueryCancelsAndEmitsEmptyCurrentGeneration() {
    let harness = Harness(ids: [])
    var result: (String, Int)?
    harness.coordinator.onSuggestionsChanged = { result = ($0, $1.count) }
    harness.coordinator.setQuery(requestId: "clear", query: " ", bias: nil)

    XCTAssertEqual(harness.source.cancelCount, 1)
    XCTAssertEqual(result?.0, "clear")
    XCTAssertEqual(result?.1, 0)
  }

  func testRapidReplacementKeepsOnlyLatestRegistry() async throws {
    let resolved = ResolvedPlaceSearchValue(
      title: "Home",
      subtitle: nil,
      name: "Home",
      formattedAddress: nil,
      latitude: 51,
      longitude: 0
    )
    let harness = Harness(ids: ["cher-id", "home-id"], resolution: .success(resolved))
    harness.coordinator.setQuery(requestId: "cher", query: "Cher", bias: nil)
    harness.source.emit(requestId: "cher", completions: [completion("Cherwell")])
    harness.coordinator.setQuery(requestId: "home", query: "Home", bias: nil)
    harness.source.emit(requestId: "home", completions: [completion("Home")])

    await XCTAssertThrowsErrorAsync(
      try await harness.coordinator.resolve(suggestionId: "cher-id", requestId: "cher")
    ) { error in
      XCTAssertEqual(error as? PlaceSearchCoordinatorError, .staleSuggestion)
    }
    _ = try await harness.coordinator.resolve(suggestionId: "home-id", requestId: "home")
  }
}

@MainActor
private final class FakeNearbySearcher: NearbyPointOfInterestSearching {
  var radiusMeters: Double?
  var contextQuery: String?
  var cancelCount = 0
  private var nearbyCompletion: ((Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void)?
  private var contextCompletion: ((Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void)?

  func searchNearby(
    center: CLLocationCoordinate2D,
    radiusMeters: CLLocationDistance,
    completion: @escaping (Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void
  ) {
    self.radiusMeters = radiusMeters
    nearbyCompletion = completion
  }

  func searchContext(
    query: String,
    center: CLLocationCoordinate2D,
    radiusMeters: CLLocationDistance,
    completion: @escaping (Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) -> Void
  ) {
    contextQuery = query
    contextCompletion = completion
  }

  func cancel() {
    cancelCount += 1
  }

  func completeNearby(_ result: Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) {
    let completion = nearbyCompletion
    nearbyCompletion = nil
    completion?(result)
  }

  func completeContext(_ result: Result<[NearbyPointOfInterestValue], PlaceSearchCoordinatorError>) {
    let completion = contextCompletion
    contextCompletion = nil
    completion?(result)
  }
}

@MainActor
private final class Harness {
  let source = FakeCompletionSource()
  let resolver: FakeResultResolver
  let coordinator: PlaceSearchCoordinator

  init(
    ids: [String],
    resolution: Result<ResolvedPlaceSearchValue, PlaceSearchCoordinatorError> = .failure(.noResolvedResult)
  ) {
    var iterator = ids.makeIterator()
    resolver = FakeResultResolver(result: resolution)
    coordinator = PlaceSearchCoordinator(
      source: source,
      resolver: resolver,
      idFactory: { iterator.next() ?? "fallback-id" }
    )
  }
}

@MainActor
private final class FakeCompletionSource: PlaceSearchCompletionSourcing {
  var onSuggestions: ((String, [PlaceSearchCompletionValue]) -> Void)?
  var onError: ((String, PlaceSearchCoordinatorError) -> Void)?
  var lastRequestId: String?
  var cancelCount = 0

  func setQuery(requestId: String, query: String, bias: PlaceSearchBiasValue?) {
    lastRequestId = requestId
  }

  func cancel() {
    cancelCount += 1
  }

  func emit(requestId: String, completions: [PlaceSearchCompletionValue]) {
    onSuggestions?(requestId, completions)
  }
}

@MainActor
private final class FakeResultResolver: PlaceSearchResultResolving {
  let result: Result<ResolvedPlaceSearchValue, PlaceSearchCoordinatorError>
  var resolveCount = 0
  var cancelCount = 0

  init(result: Result<ResolvedPlaceSearchValue, PlaceSearchCoordinatorError>) {
    self.result = result
  }

  func resolve(
    completion: PlaceSearchCompletionValue,
    bias: PlaceSearchBiasValue?,
    completionHandler: @escaping (Result<ResolvedPlaceSearchValue, PlaceSearchCoordinatorError>) -> Void
  ) {
    resolveCount += 1
    completionHandler(result)
  }

  func cancel() {
    cancelCount += 1
  }
}

private func completion(_ title: String, _ subtitle: String? = nil) -> PlaceSearchCompletionValue {
  PlaceSearchCompletionValue(title: title, subtitle: subtitle, payload: NSObject())
}

private func nearby(
  _ name: String,
  distance: Int,
  relevance: Int,
  category: MKPointOfInterestCategory? = nil,
  source: NearbyPointOfInterestValue.Source = .nearby,
  localityNames: [String] = []
) -> NearbyPointOfInterestValue {
  NearbyPointOfInterestValue(
    name: name,
    formattedAddress: nil,
    latitude: 51.5,
    longitude: 0.4,
    distanceMeters: distance,
    relevanceIndex: relevance,
    category: category,
    source: source,
    localityNames: localityNames
  )
}

private func XCTAssertThrowsErrorAsync<T>(
  _ expression: @autoclosure () async throws -> T,
  _ errorHandler: (Error) -> Void = { _ in },
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  do {
    _ = try await expression()
    XCTFail("Expected expression to throw", file: file, line: line)
  } catch {
    errorHandler(error)
  }
}
