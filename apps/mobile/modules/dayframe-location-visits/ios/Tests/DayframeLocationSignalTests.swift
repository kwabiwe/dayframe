import XCTest
@testable import DayframeLocationVisits

@MainActor
final class DayframeLocationSignalTests: XCTestCase {
  private var temporaryDirectory: URL!
  private var signalFile: URL!

  override func setUpWithError() throws {
    temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    signalFile = temporaryDirectory.appendingPathComponent("signals.json")
  }

  override func tearDownWithError() throws {
    if let temporaryDirectory {
      try? FileManager.default.removeItem(at: temporaryDirectory)
    }
  }

  private func signal(id: String, kind: String = "visit", endedAt: String? = nil) -> DayframeLocationSignal {
    DayframeLocationSignal(
      id: id,
      kind: kind,
      occurredAt: "2026-07-20T09:37:00Z",
      endedAt: endedAt,
      latitude: 51.5,
      longitude: -0.12,
      horizontalAccuracyMeters: 45,
      metadata: endedAt == nil ? ["visitDepartureOpen": "true"] : [:]
    )
  }

  func testStableSignalIdsAreIdempotent() {
    let first = DayframeLocationVisitService.stableSignalId(
      kind: "visit",
      occurredAt: "2026-07-20T09:37:00Z",
      endedAt: nil,
      latitude: 51.5,
      longitude: -0.12
    )
    let second = DayframeLocationVisitService.stableSignalId(
      kind: "visit",
      occurredAt: "2026-07-20T09:37:00Z",
      endedAt: nil,
      latitude: 51.5,
      longitude: -0.12
    )
    XCTAssertEqual(first, second)
    XCTAssertTrue(first.hasPrefix("ios-"))
  }

  func testOpenVisitSerialisesWithoutAnInvalidDeparture() throws {
    let signal = signal(id: "ios-test")
    let encoded = try JSONEncoder().encode(signal)
    let decoded = try JSONDecoder().decode(DayframeLocationSignal.self, from: encoded)
    XCTAssertNil(decoded.endedAt)
    XCTAssertEqual(decoded.metadata["visitDepartureOpen"], "true")
  }

  func testDuplicateCallbacksAreStoredOnceAndAcknowledgedById() {
    let store = DayframeLocationSignalStore(fileURL: signalFile)
    store.append(signal(id: "duplicate"))
    store.append(signal(id: "duplicate"))
    XCTAssertEqual(store.read(limit: 100).map(\.id), ["duplicate"])
    XCTAssertEqual(store.remove(ids: ["duplicate"]), 1)
    XCTAssertTrue(store.read(limit: 100).isEmpty)
  }

  func testAtomicQueueWritesSurviveConcurrentCallbacks() {
    let store = DayframeLocationSignalStore(fileURL: signalFile)
    let group = DispatchGroup()
    for index in 0..<40 {
      let queuedSignal = signal(id: "signal-\(index)", kind: "significant_change")
      group.enter()
      DispatchQueue.global().async {
        store.append(queuedSignal)
        group.leave()
      }
    }
    XCTAssertEqual(group.wait(timeout: .now() + 5), .success)
    XCTAssertEqual(Set(store.read(limit: 100).map(\.id)).count, 40)
    XCTAssertNil(store.lastErrorCode())
  }

  func testInterruptedTrailingRecordDoesNotLoseCompletedRecords() throws {
    let valid = try JSONEncoder().encode(signal(id: "complete"))
    var contents = valid
    contents.append(Data("\n{\"id\":\"partial".utf8))
    try contents.write(to: signalFile, options: .atomic)

    let store = DayframeLocationSignalStore(fileURL: signalFile)
    XCTAssertEqual(store.read(limit: 100).map(\.id), ["complete"])
    store.append(signal(id: "after-recovery"))
    XCTAssertEqual(Set(store.read(limit: 100).map(\.id)), ["complete", "after-recovery"])
  }

  func testOpenVisitQueueSurvivesStoreRecreation() {
    DayframeLocationSignalStore(fileURL: signalFile).append(signal(id: "open-visit"))
    let restored = DayframeLocationSignalStore(fileURL: signalFile).read(limit: 100)
    XCTAssertEqual(restored.first?.id, "open-visit")
    XCTAssertNil(restored.first?.endedAt)
  }

  func testSignificantChangeSerialisesWithTheSameEnvelope() throws {
    let original = signal(id: "significant", kind: "significant_change", endedAt: nil)
    let decoded = try JSONDecoder().decode(
      DayframeLocationSignal.self,
      from: JSONEncoder().encode(original)
    )
    XCTAssertEqual(decoded.kind, "significant_change")
    XCTAssertEqual(decoded.latitude, original.latitude)
    XCTAssertEqual(decoded.occurredAt, original.occurredAt)
  }

  func testRetentionPrunesExpiredNativeSignals() {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let store = DayframeLocationSignalStore(
      fileURL: signalFile,
      retentionSeconds: 60,
      now: { now }
    )
    let expired = DayframeLocationSignal(
      id: "expired",
      kind: "visit",
      occurredAt: ISO8601DateFormatter().string(from: now.addingTimeInterval(-61)),
      endedAt: nil,
      latitude: nil,
      longitude: nil,
      horizontalAccuracyMeters: nil,
      metadata: [:]
    )
    store.append(expired)
    XCTAssertTrue(store.read(limit: 100).isEmpty)
  }

  func testRetentionRewritesAnExistingQueueWhenItIsReadAfterRelaunch() throws {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let expired = DayframeLocationSignal(
      id: "expired-on-relaunch",
      kind: "visit",
      occurredAt: ISO8601DateFormatter().string(from: now.addingTimeInterval(-61)),
      endedAt: nil,
      latitude: nil,
      longitude: nil,
      horizontalAccuracyMeters: nil,
      metadata: [:]
    )
    try JSONEncoder().encode(expired).write(to: signalFile, options: .atomic)
    let store = DayframeLocationSignalStore(fileURL: signalFile, retentionSeconds: 60, now: { now })

    XCTAssertTrue(store.read(limit: 100).isEmpty)
    XCTAssertEqual(try Data(contentsOf: signalFile).count, 0)
  }

  func testRelaunchRestorationOnlyRunsWhenMonitoringWasEnabled() {
    XCTAssertTrue(DayframeLocationVisitService.shouldRestoreMonitoring(enabled: true))
    XCTAssertFalse(DayframeLocationVisitService.shouldRestoreMonitoring(enabled: false))
  }
}
