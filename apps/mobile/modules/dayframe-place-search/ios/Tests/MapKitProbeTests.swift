import XCTest
import MapKit
@testable import DayframePlaceSearch

final class MapKitProbeTests: XCTestCase {
  func testRadiusResultCountsAndRoundsTheFarthestDistance() {
    XCTAssertEqual(
      MapKitProbeReport.radiusResult(radiusMeters: 400, distances: [12.4, 388.6, .nan, 41], error: nil),
      MapKitProbeRadiusResult(radiusMeters: 400, count: 3, farthestMeters: 389, error: nil)
    )
    XCTAssertEqual(
      MapKitProbeReport.radiusResult(radiusMeters: 1500, distances: nil, error: "throttled"),
      MapKitProbeRadiusResult(radiusMeters: 1500, count: 0, farthestMeters: nil, error: "throttled")
    )
  }

  func testKindsAreCountedByAppleCategoryKey() {
    XCTAssertEqual(
      MapKitProbeReport.kindCounts(["Store", nil, "Store", "Cafe"]),
      ["Store": 2, "Cafe": 1, "none": 1]
    )
  }

  func testRapidRequestsStopAtTheFirstFailure() {
    XCTAssertEqual(
      MapKitProbeReport.rapidResult([nil, nil, nil, "throttled"]),
      MapKitProbeRapidResult(attempts: 4, succeeded: 3, firstErrorAt: 4, firstError: "throttled")
    )
    XCTAssertEqual(
      MapKitProbeReport.rapidResult(Array(repeating: nil, count: 20)),
      MapKitProbeRapidResult(attempts: 20, succeeded: 20, firstErrorAt: nil, firstError: nil)
    )
  }

  func testErrorsAreReportedAsAStableWord() {
    XCTAssertEqual(MapKitProbeReport.errorWord(NSError(domain: MKErrorDomain, code: Int(MKError.Code.loadingThrottled.rawValue))), "throttled")
    XCTAssertEqual(MapKitProbeReport.errorWord(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)), "network")
    XCTAssertEqual(MapKitProbeReport.errorWord(NSError(domain: "Other", code: 1)), "error")
  }

  func testLookupsKeepNotFoundApartFromFailedRequests() {
    XCTAssertEqual(
      MapKitProbeLookupRound.from([nil, "not_found", "network", nil, "throttled"]),
      MapKitProbeLookupRound(found: 2, notFound: 1, failed: 2, failure: "network")
    )
    XCTAssertEqual(MapKitProbeLookupRound.from([]), MapKitProbeLookupRound(found: 0, notFound: 0, failed: 0, failure: nil))
  }

  func testTheReportCarriesOnlyCountsAndAnswers() throws {
    let report = MapKitProbeReport(
      osVersion: MapKitProbeReport.osVersion(OperatingSystemVersion(majorVersion: 27, minorVersion: 2, patchVersion: 1)),
      radii: [MapKitProbeRadiusResult(radiusMeters: 200, count: 4, farthestMeters: 190, error: nil)],
      kinds: ["Store": 3],
      areasOfInterest: MapKitProbeAreasResult(answered: true, count: 1, error: nil),
      placeIds: MapKitProbePlaceIdResult(
        supported: true, places: 4, withPlaceId: 4,
        first: MapKitProbeLookupRound(found: 4, notFound: 0, failed: 0, failure: nil),
        aMinuteLater: MapKitProbeLookupRound(found: 2, notFound: 0, failed: 2, failure: "network")
      ),
      rapid: MapKitProbeRapidResult(attempts: 20, succeeded: 20, firstErrorAt: nil, firstError: nil)
    )
    let dictionary = report.dictionary
    XCTAssertEqual(dictionary["osVersion"] as? String, "27.2.1")
    XCTAssertEqual(Set(dictionary.keys), ["osVersion", "radii", "kindsWithin400m", "areasOfInterest", "placeIds", "rapid"])
    let json = String(data: try JSONSerialization.data(withJSONObject: dictionary), encoding: .utf8) ?? ""
    for forbidden in ["latitude", "longitude", "name", "address", "identifier"] {
      XCTAssertFalse(json.contains(forbidden), "the report must not carry \(forbidden)")
    }
  }
}
