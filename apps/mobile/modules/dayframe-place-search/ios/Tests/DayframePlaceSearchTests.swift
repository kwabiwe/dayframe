import XCTest
@testable import DayframePlaceSearch

@MainActor
final class DayframePlaceSearchTests: XCTestCase {
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
