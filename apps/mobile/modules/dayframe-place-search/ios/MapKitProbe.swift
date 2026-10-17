import CoreLocation
import Foundation
import MapKit

/// Settings › Sync help › "Check Apple Maps nearby data" (MapKit checks for location v3 PR 7/8).
/// It asks Apple's map service a fixed set of questions around one point and reports only counts,
/// distances, kinds of place and yes/no answers: never a name, address, coordinate or Place ID.
struct MapKitProbeRadiusResult: Equatable {
  let radiusMeters: Int
  let count: Int
  let farthestMeters: Int?
  let error: String?
}

struct MapKitProbeAreasResult: Equatable {
  let answered: Bool
  let count: Int
  let error: String?
}

struct MapKitProbePlaceIdResult: Equatable {
  /// Whether this iOS has Place IDs on map items (iOS 18 and later).
  let supported: Bool
  let places: Int
  let withPlaceId: Int
  let found: Int
  let notFound: Int
  let foundLater: Int?
  let notFoundLater: Int?
}

struct MapKitProbeRapidResult: Equatable {
  let attempts: Int
  let succeeded: Int
  /// The request (1-based) that first failed, if any; the run stops there.
  let firstErrorAt: Int?
  let firstError: String?
}

struct MapKitProbeReport {
  let osVersion: String
  let radii: [MapKitProbeRadiusResult]
  let kinds: [String: Int]
  let areasOfInterest: MapKitProbeAreasResult
  let placeIds: MapKitProbePlaceIdResult
  let rapid: MapKitProbeRapidResult

  var dictionary: [String: Any] {
    [
      "osVersion": osVersion,
      "radii": radii.map { result -> [String: Any] in
        [
          "radiusMeters": result.radiusMeters,
          "count": result.count,
          "farthestMeters": result.farthestMeters as Any,
          "error": result.error as Any
        ]
      },
      "kindsWithin400m": kinds,
      "areasOfInterest": [
        "answered": areasOfInterest.answered,
        "count": areasOfInterest.count,
        "error": areasOfInterest.error as Any
      ],
      "placeIds": [
        "supported": placeIds.supported,
        "places": placeIds.places,
        "withPlaceId": placeIds.withPlaceId,
        "found": placeIds.found,
        "notFound": placeIds.notFound,
        "foundAMinuteLater": placeIds.foundLater as Any,
        "notFoundAMinuteLater": placeIds.notFoundLater as Any
      ],
      "rapid": [
        "attempts": rapid.attempts,
        "succeeded": rapid.succeeded,
        "firstErrorAt": rapid.firstErrorAt as Any,
        "firstError": rapid.firstError as Any
      ]
    ]
  }

  static let radii = [200, 400, 750, 1500]
  static let rapidAttempts = 20
  static let placeIdSampleLimit = 10
  static let lookUpAgainAfterSeconds: Double = 60

  static func radiusResult(radiusMeters: Int, distances: [Double]?, error: String?) -> MapKitProbeRadiusResult {
    let rounded = (distances ?? []).filter(\.isFinite).map { max(0, Int($0.rounded())) }
    return MapKitProbeRadiusResult(
      radiusMeters: radiusMeters,
      count: rounded.count,
      farthestMeters: rounded.max(),
      error: error
    )
  }

  /// Kinds of place by Apple's category key ("FitnessCenter"); "none" when Apple gives no kind.
  static func kindCounts(_ keys: [String?]) -> [String: Int] {
    keys.reduce(into: [:]) { counts, key in counts[key ?? "none", default: 0] += 1 }
  }

  /// Outcomes in order (nil for a success); the run stops at the first failure.
  static func rapidResult(_ outcomes: [String?]) -> MapKitProbeRapidResult {
    let firstFailure = outcomes.firstIndex { $0 != nil }
    return MapKitProbeRapidResult(
      attempts: outcomes.count,
      succeeded: outcomes.prefix(firstFailure ?? outcomes.count).count,
      firstErrorAt: firstFailure.map { $0 + 1 },
      firstError: firstFailure.flatMap { outcomes[$0] }
    )
  }

  /// A stable word for an error, so the report says what kind of failure it was and nothing else.
  static func errorWord(_ error: Error) -> String {
    let error = error as NSError
    if error.domain == MKErrorDomain {
      switch MKError.Code(rawValue: UInt(error.code)) {
      case .loadingThrottled: return "throttled"
      case .placemarkNotFound: return "not_found"
      case .serverFailure: return "server_failure"
      case .directionsNotFound: return "not_found"
      case .decodingFailed: return "decoding_failed"
      default: return "map_error"
      }
    }
    if error.domain == kCLErrorDomain {
      return error.code == CLError.Code.network.rawValue ? "network" : "location_error"
    }
    if error.domain == NSURLErrorDomain { return "network" }
    return "error"
  }

  static func osVersion(_ version: OperatingSystemVersion) -> String {
    "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
  }
}

@MainActor
final class MapKitProbe {
  private let sleep: (Double) async -> Void

  init(sleep: @escaping (Double) async -> Void = { seconds in
    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
  }) {
    self.sleep = sleep
  }

  func run(latitude: Double, longitude: Double) async -> MapKitProbeReport {
    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    let origin = CLLocation(latitude: latitude, longitude: longitude)

    var radii: [MapKitProbeRadiusResult] = []
    var itemsWithin400m: [MKMapItem] = []
    for radius in MapKitProbeReport.radii {
      switch await nearby(center: center, radiusMeters: radius) {
      case let .success(items):
        if radius == 400 { itemsWithin400m = items }
        radii.append(MapKitProbeReport.radiusResult(
          radiusMeters: radius,
          distances: items.map { origin.distance(from: CLLocation(
            latitude: $0.placemark.coordinate.latitude,
            longitude: $0.placemark.coordinate.longitude
          )) },
          error: nil
        ))
      case let .failure(error):
        radii.append(MapKitProbeReport.radiusResult(radiusMeters: radius, distances: nil, error: MapKitProbeReport.errorWord(error)))
      }
    }

    let kinds = MapKitProbeReport.kindCounts(itemsWithin400m.map {
      NearbyPointOfInterestSuggestionValue.categoryKey($0.pointOfInterestCategory)
    })
    let areas = await areasOfInterest(at: origin)
    let placeIds = await placeIdLookups(itemsWithin400m)
    let rapid = await rapidRequests(center: center)

    return MapKitProbeReport(
      osVersion: MapKitProbeReport.osVersion(ProcessInfo.processInfo.operatingSystemVersion),
      radii: radii,
      kinds: kinds,
      areasOfInterest: areas,
      placeIds: placeIds,
      rapid: rapid
    )
  }

  private func nearby(center: CLLocationCoordinate2D, radiusMeters: Int) async -> Result<[MKMapItem], Error> {
    // No category filter: the probe reports what Apple returns, parking and the like included.
    let search = MKLocalSearch(request: MKLocalPointsOfInterestRequest(
      center: center,
      radius: CLLocationDistance(radiusMeters)
    ))
    return await withCheckedContinuation { continuation in
      search.start { response, error in
        if let error {
          continuation.resume(returning: .failure(error))
        } else {
          continuation.resume(returning: .success(response?.mapItems ?? []))
        }
      }
    }
  }

  private func areasOfInterest(at location: CLLocation) async -> MapKitProbeAreasResult {
    do {
      // Deprecated in iOS 27.2: whether it still answers is what this check is for.
      let placemarks = try await CLGeocoder().reverseGeocodeLocation(location)
      let count = placemarks.first?.areasOfInterest?.count ?? 0
      return MapKitProbeAreasResult(answered: true, count: count, error: nil)
    } catch {
      return MapKitProbeAreasResult(answered: false, count: 0, error: MapKitProbeReport.errorWord(error))
    }
  }

  private func placeIdLookups(_ items: [MKMapItem]) async -> MapKitProbePlaceIdResult {
    guard #available(iOS 18.0, macOS 15.0, *) else {
      return MapKitProbePlaceIdResult(
        supported: false, places: items.count, withPlaceId: 0, found: 0, notFound: 0, foundLater: nil, notFoundLater: nil
      )
    }
    // The IDs stay in this function: only how many were found crosses the bridge.
    let identifiers = items.prefix(MapKitProbeReport.placeIdSampleLimit).compactMap(\.identifier)
    let started = Date()
    let first = await lookUp(identifiers)
    let elapsed = Date().timeIntervalSince(started)
    await sleep(max(0, MapKitProbeReport.lookUpAgainAfterSeconds - elapsed))
    let later = await lookUp(identifiers)
    return MapKitProbePlaceIdResult(
      supported: true,
      places: items.count,
      withPlaceId: items.filter { $0.identifier != nil }.count,
      found: first,
      notFound: identifiers.count - first,
      foundLater: later,
      notFoundLater: identifiers.count - later
    )
  }

  @available(iOS 18.0, macOS 15.0, *)
  private func lookUp(_ identifiers: [MKMapItem.Identifier]) async -> Int {
    var found = 0
    for identifier in identifiers {
      if (try? await MKMapItemRequest(mapItemIdentifier: identifier).mapItem) != nil { found += 1 }
    }
    return found
  }

  private func rapidRequests(center: CLLocationCoordinate2D) async -> MapKitProbeRapidResult {
    var outcomes: [String?] = []
    for _ in 0 ..< MapKitProbeReport.rapidAttempts {
      switch await nearby(center: center, radiusMeters: 200) {
      case .success:
        outcomes.append(nil)
      case let .failure(error):
        outcomes.append(MapKitProbeReport.errorWord(error))
        return MapKitProbeReport.rapidResult(outcomes)
      }
    }
    return MapKitProbeReport.rapidResult(outcomes)
  }
}
