import CoreLocation
import CryptoKit
import Foundation
import UIKit

@MainActor
public final class DayframeLocationVisitService: NSObject, @preconcurrency CLLocationManagerDelegate {
  public static let shared = DayframeLocationVisitService()

  private static let enabledKey = "dayframe.locationVisits.enabled.v1"
  /// `CLLocationManager.locationServicesEnabled()` blocks on locationd, so it runs here, never on main.
  nonisolated private static let locationStateQueue = DispatchQueue(label: "com.dayframe.location-state", qos: .utility)
  private var manager: CLLocationManager?
  private var restoredForLocationRelaunch = false
  // Location state is cached from `locationManagerDidChangeAuthorization` on the long-lived manager
  // (iOS calls it when the manager is created and on every change), so `status()` never makes a
  // synchronous locationd call on the main thread (TestFlight 125 report; stability audit
  // 22 Oct 2026, finding 11).
  private var authorizationStatus: CLAuthorizationStatus?
  private var accuracyAuthorization: CLAccuracyAuthorization?
  private var locationServicesEnabled: Bool?
  private var locationServicesGeneration = 0
  private lazy var significantChangesAvailable = CLLocationManager.significantLocationChangeMonitoringAvailable()

  public func startMonitoring(restoredForRelaunch: Bool = false) {
    UserDefaults.standard.set(true, forKey: Self.enabledKey)
    restoredForLocationRelaunch = restoredForLocationRelaunch || restoredForRelaunch
    let manager = configuredManager()
    manager.startMonitoringVisits()
    if significantChangesAvailable {
      manager.startMonitoringSignificantLocationChanges()
    }
  }

  public func stopMonitoring() {
    UserDefaults.standard.set(false, forKey: Self.enabledKey)
    manager?.stopMonitoringVisits()
    manager?.stopMonitoringSignificantLocationChanges()
  }

  public func restoreIfEnabled(locationRelaunch: Bool) {
    guard Self.shouldRestoreMonitoring(enabled: UserDefaults.standard.bool(forKey: Self.enabledKey)) else { return }
    startMonitoring(restoredForRelaunch: locationRelaunch)
  }

  static func shouldRestoreMonitoring(enabled: Bool) -> Bool {
    enabled
  }

  /// Main-actor status from cached state only. The journal's pending count and storage error are
  /// added by the module off the main thread (`DayframeLocationVisitsModule.status()`).
  public func status() -> [String: Any] {
    let enabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
    if locationServicesEnabled == nil && locationServicesGeneration == 0 { refreshLocationServicesEnabled() }
    return [
      "enabled": enabled,
      "authorizationStatus": authorizationStatus.map { authorizationName($0) } ?? "unknown",
      "accuracyAuthorization": accuracyName(accuracyAuthorization),
      // Until the first background answer: iOS reports every app denied while Location Services are off.
      "locationServicesEnabled": locationServicesEnabled ?? Self.isAuthorized(authorizationStatus),
      "backgroundRefreshStatus": backgroundRefreshName(UIApplication.shared.backgroundRefreshStatus),
      "monitoringVisits": enabled,
      "monitoringSignificantChanges": enabled && significantChangesAvailable,
      "restoredForLocationRelaunch": restoredForLocationRelaunch
    ]
  }

  private static func isAuthorized(_ status: CLAuthorizationStatus?) -> Bool {
    status == .authorizedAlways || status == .authorizedWhenInUse
  }

  /// Asks off the main thread; only the newest answer is kept.
  private func refreshLocationServicesEnabled() {
    locationServicesGeneration += 1
    let generation = locationServicesGeneration
    Self.locationStateQueue.async {
      let enabled = CLLocationManager.locationServicesEnabled()
      Task { @MainActor in
        let service = DayframeLocationVisitService.shared
        guard service.locationServicesGeneration == generation else { return }
        service.locationServicesEnabled = enabled
      }
    }
  }

  private func configuredManager() -> CLLocationManager {
    if let manager { return manager }
    let created = CLLocationManager()
    created.delegate = self
    created.activityType = .other
    created.pausesLocationUpdatesAutomatically = false
    created.allowsBackgroundLocationUpdates = true
    manager = created
    return created
  }

  public func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    let openDeparture = visit.departureDate == Date.distantFuture
    appendSignal(
      kind: "visit",
      occurredAt: visit.arrivalDate,
      endedAt: openDeparture ? nil : visit.departureDate,
      coordinate: visit.coordinate,
      horizontalAccuracy: visit.horizontalAccuracy,
      metadata: ["visitDepartureOpen": String(openDeparture)]
    )
  }

  public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
      appendSignal(
        kind: "significant_change",
        occurredAt: location.timestamp,
        coordinate: location.coordinate,
        horizontalAccuracy: location.horizontalAccuracy,
        speed: location.speed >= 0 ? location.speed : nil,
        millisecondPrecision: true,
        metadata: [:]
      )
    }
  }

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    let accuracy = manager.accuracyAuthorization
    authorizationStatus = status
    accuracyAuthorization = accuracy
    // A Location Services switch also arrives here as an authorisation change.
    refreshLocationServicesEnabled()
    appendSignal(
      kind: "provider_status",
      occurredAt: Date(),
      metadata: [
        "authorizationStatus": authorizationName(status),
        "accuracyAuthorization": accuracyName(accuracy)
      ]
    )
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let code = (error as? CLError).map { String($0.code.rawValue) } ?? "unknown"
    appendSignal(kind: "provider_status", occurredAt: Date(), metadata: ["errorCode": code])
  }

  public func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
    appendSignal(kind: "location_paused", occurredAt: Date(), metadata: [:])
  }

  public func locationManagerDidResumeLocationUpdates(_ manager: CLLocationManager) {
    appendSignal(kind: "location_resumed", occurredAt: Date(), metadata: [:])
  }

  private func appendSignal(
    kind: String,
    occurredAt: Date,
    endedAt: Date? = nil,
    coordinate: CLLocationCoordinate2D? = nil,
    horizontalAccuracy: Double? = nil,
    speed: Double? = nil,
    millisecondPrecision: Bool = false,
    metadata: [String: String]
  ) {
    DayframeLocationSignalStore.shared.append(Self.makeSignal(
      kind: kind, occurredAt: occurredAt, endedAt: endedAt,
      latitude: coordinate?.latitude, longitude: coordinate?.longitude,
      horizontalAccuracy: horizontalAccuracy, speed: speed,
      millisecondPrecision: millisecondPrecision, metadata: metadata, callbackAt: Date()
    ))
  }

  /// Builds the queued record. The callback clock is metadata, so duplicate
  /// callbacks for the same event keep one stable id.
  static func makeSignal(
    kind: String,
    occurredAt: Date,
    endedAt: Date?,
    latitude: Double?,
    longitude: Double?,
    horizontalAccuracy: Double?,
    speed: Double?,
    millisecondPrecision: Bool,
    metadata: [String: String],
    callbackAt: Date
  ) -> DayframeLocationSignal {
    let occurredAtText = millisecondPrecision ? DayframeSignalTime.milliseconds(occurredAt) : DayframeSignalTime.seconds(occurredAt)
    let endedAtText = endedAt.map { DayframeSignalTime.seconds($0) }
    var stamped = metadata
    stamped["nativeCallbackAt"] = DayframeSignalTime.milliseconds(callbackAt)
    return DayframeLocationSignal(
      id: stableSignalId(kind: kind, occurredAt: occurredAtText, endedAt: endedAtText, latitude: latitude, longitude: longitude),
      kind: kind,
      occurredAt: occurredAtText,
      endedAt: endedAtText,
      latitude: latitude,
      longitude: longitude,
      horizontalAccuracyMeters: horizontalAccuracy,
      metadata: stamped,
      speedMetersPerSecond: speed
    )
  }

  static func stableSignalId(
    kind: String,
    occurredAt: String,
    endedAt: String?,
    latitude: Double?,
    longitude: Double?
  ) -> String {
    let canonical = [kind, occurredAt, endedAt ?? "open", String(latitude ?? 0), String(longitude ?? 0)].joined(separator: "|")
    let digest = SHA256.hash(data: Data(canonical.utf8)).compactMap { String(format: "%02x", $0) }.joined()
    return "ios-\(digest.prefix(32))"
  }

  private func authorizationName(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedWhenInUse: return "when_in_use"
    case .authorizedAlways: return "always"
    @unknown default: return "unknown"
    }
  }

  private func accuracyName(_ authorization: CLAccuracyAuthorization?) -> String {
    guard let authorization else { return "unknown" }
    return authorization == .fullAccuracy ? "full" : "reduced"
  }

  private func backgroundRefreshName(_ status: UIBackgroundRefreshStatus) -> String {
    switch status {
    case .available: return "available"
    case .denied: return "denied"
    case .restricted: return "restricted"
    @unknown default: return "unknown"
    }
  }
}
