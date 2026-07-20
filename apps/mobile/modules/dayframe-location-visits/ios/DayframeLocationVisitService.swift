import CoreLocation
import CryptoKit
import Foundation
import UIKit

struct DayframeLocationSignal: Codable {
  let id: String
  let kind: String
  let occurredAt: String
  let endedAt: String?
  let latitude: Double?
  let longitude: Double?
  let horizontalAccuracyMeters: Double?
  let metadata: [String: String]

  var dictionary: [String: Any] {
    var result: [String: Any] = [
      "id": id,
      "kind": kind,
      "occurredAt": occurredAt,
      "metadata": metadata
    ]
    result["endedAt"] = endedAt ?? NSNull()
    result["latitude"] = latitude ?? NSNull()
    result["longitude"] = longitude ?? NSNull()
    result["horizontalAccuracyMeters"] = horizontalAccuracyMeters ?? NSNull()
    return result
  }
}

final class DayframeLocationSignalStore: @unchecked Sendable {
  static let shared = DayframeLocationSignalStore()

  private let queue = DispatchQueue(label: "com.dayframe.location-signals")
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()
  private let maximumCount: Int?
  private let retentionSeconds: TimeInterval
  private let now: () -> Date
  private let fileURL: URL?
  private var storageErrorCode: String?

  init(
    fileURL: URL? = nil,
    maximumCount: Int? = nil,
    retentionSeconds: TimeInterval = 7 * 24 * 60 * 60,
    now: @escaping () -> Date = Date.init
  ) {
    self.maximumCount = maximumCount
    self.retentionSeconds = retentionSeconds
    self.now = now
    if let fileURL {
      self.fileURL = fileURL
      return
    }
    do {
      let manager = FileManager.default
      let support = try manager.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let directory = support.appendingPathComponent("DayframeLocation", isDirectory: true)
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      try (directory as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
      self.fileURL = directory.appendingPathComponent("signals.json")
    } catch {
      self.fileURL = nil
      self.storageErrorCode = "storage_directory_unavailable"
    }
  }

  func append(_ signal: DayframeLocationSignal) {
    queue.sync {
      var signals = loadUnlocked()
      guard !signals.contains(where: { $0.id == signal.id }) else { return }
      signals.append(signal)
      persistUnlocked(prune(signals))
    }
  }

  func read(limit: Int) -> [DayframeLocationSignal] {
    queue.sync { Array(loadAndPersistPrunedUnlocked().prefix(limit)) }
  }

  func count() -> Int {
    queue.sync { loadAndPersistPrunedUnlocked().count }
  }

  func lastErrorCode() -> String? {
    queue.sync { storageErrorCode }
  }

  @discardableResult
  func remove(ids: Set<String>) -> Int {
    queue.sync {
      let existing = prune(loadUnlocked())
      let retained = existing.filter { !ids.contains($0.id) }
      persistUnlocked(retained)
      return existing.count - retained.count
    }
  }

  @discardableResult
  func removeAll() -> Int {
    queue.sync {
      let count = loadUnlocked().count
      persistUnlocked([])
      return count
    }
  }

  private func loadUnlocked() -> [DayframeLocationSignal] {
    guard let fileURL else { return [] }
    guard let data = try? Data(contentsOf: fileURL) else { return [] }
    guard let text = String(data: data, encoding: .utf8) else { return [] }
    return text.split(separator: "\n").compactMap { line in
      try? decoder.decode(DayframeLocationSignal.self, from: Data(line.utf8))
    }
  }

  private func persistUnlocked(_ signals: [DayframeLocationSignal]) {
    guard let fileURL else { return }
    let records = signals.compactMap { signal in
      (try? encoder.encode(signal)).flatMap { String(data: $0, encoding: .utf8) }
    }
    guard let data = records.joined(separator: "\n").data(using: .utf8) else { return }
    do {
      try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      try (fileURL as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
      storageErrorCode = nil
    } catch {
      storageErrorCode = "storage_write_failed"
    }
  }

  private func loadAndPersistPrunedUnlocked() -> [DayframeLocationSignal] {
    let existing = loadUnlocked()
    let retained = prune(existing)
    if retained.count != existing.count {
      persistUnlocked(retained)
    }
    return retained
  }

  private func prune(_ signals: [DayframeLocationSignal]) -> [DayframeLocationSignal] {
    let cutoff = now().addingTimeInterval(-retentionSeconds)
    let retained = signals.filter {
      ISO8601DateFormatter().date(from: $0.occurredAt).map { $0 >= cutoff } ?? false
    }
    guard let maximumCount else { return retained }
    return Array(retained.suffix(maximumCount))
  }
}

@MainActor
public final class DayframeLocationVisitService: NSObject, @preconcurrency CLLocationManagerDelegate {
  public static let shared = DayframeLocationVisitService()

  private static let enabledKey = "dayframe.locationVisits.enabled.v1"
  private var manager: CLLocationManager?
  private var restoredForLocationRelaunch = false

  public func startMonitoring(restoredForRelaunch: Bool = false) {
    UserDefaults.standard.set(true, forKey: Self.enabledKey)
    restoredForLocationRelaunch = restoredForLocationRelaunch || restoredForRelaunch
    let manager = configuredManager()
    manager.startMonitoringVisits()
    if CLLocationManager.significantLocationChangeMonitoringAvailable() {
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

  public func status() -> [String: Any] {
    let enabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
    return [
      "enabled": enabled,
      "authorizationStatus": authorizationName(CLLocationManager().authorizationStatus),
      "accuracyAuthorization": accuracyName(manager?.accuracyAuthorization),
      "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
      "backgroundRefreshStatus": backgroundRefreshName(UIApplication.shared.backgroundRefreshStatus),
      "pendingSignalCount": DayframeLocationSignalStore.shared.count(),
      "monitoringVisits": enabled,
      "monitoringSignificantChanges": enabled && CLLocationManager.significantLocationChangeMonitoringAvailable(),
      "restoredForLocationRelaunch": restoredForLocationRelaunch,
      "nativeStoreErrorCode": DayframeLocationSignalStore.shared.lastErrorCode() ?? NSNull()
    ]
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
        metadata: [:]
      )
    }
  }

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    appendSignal(
      kind: "provider_status",
      occurredAt: Date(),
      metadata: [
        "authorizationStatus": authorizationName(manager.authorizationStatus),
        "accuracyAuthorization": accuracyName(manager.accuracyAuthorization)
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
    metadata: [String: String]
  ) {
    let occurredAtText = ISO8601DateFormatter().string(from: occurredAt)
    let endedAtText = endedAt.map { ISO8601DateFormatter().string(from: $0) }
    let id = Self.stableSignalId(
      kind: kind,
      occurredAt: occurredAtText,
      endedAt: endedAtText,
      latitude: coordinate?.latitude,
      longitude: coordinate?.longitude
    )
    DayframeLocationSignalStore.shared.append(DayframeLocationSignal(
      id: id,
      kind: kind,
      occurredAt: occurredAtText,
      endedAt: endedAtText,
      latitude: coordinate?.latitude,
      longitude: coordinate?.longitude,
      horizontalAccuracyMeters: horizontalAccuracy,
      metadata: metadata
    ))
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
