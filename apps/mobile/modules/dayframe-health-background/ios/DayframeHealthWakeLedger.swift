import Foundation

/// One iOS reason to run a bounded Apple Health pass: a HealthKit observer
/// delivery for one kind, or a background app refresh for both.
public struct DayframeHealthWake: Equatable, Sendable {
  public let id: String
  /// "sleep", "workout" or "all".
  public let kind: String
  /// "observer" or "refresh".
  public let reason: String
  public let receivedAt: Date

  public init(id: String, kind: String, reason: String, receivedAt: Date) {
    self.id = id
    self.kind = kind
    self.reason = reason
    self.receivedAt = receivedAt
  }

  public var dictionary: [String: Any] {
    ["id": id, "kind": kind, "reason": reason, "receivedAt": receivedAt.timeIntervalSince1970 * 1000]
  }
}

/// Pure wake bookkeeping used by the HealthKit service. Every wake is finished
/// exactly once — by JavaScript, by its time cap, or by expiry — and wakes that
/// arrive before JavaScript listens (a cold background launch) wait for it.
public struct DayframeHealthWakeLedger: Sendable {
  public static let maxUndelivered = 16

  public private(set) var isListening = false
  private var undelivered: [DayframeHealthWake] = []
  private var outstanding: [String: DayframeHealthWake] = [:]

  public init() {}

  public var outstandingCount: Int { outstanding.count }
  public var hasOutstanding: Bool { !outstanding.isEmpty }

  /// Records a wake. Returns `deliverNow` when JavaScript is listening, and any
  /// older undelivered wakes that had to make room (finish them unsuccessfully).
  public mutating func add(_ wake: DayframeHealthWake) -> (deliverNow: Bool, overflow: [DayframeHealthWake]) {
    outstanding[wake.id] = wake
    if isListening { return (true, []) }
    undelivered.append(wake)
    var overflow: [DayframeHealthWake] = []
    while undelivered.count > Self.maxUndelivered {
      let dropped = undelivered.removeFirst()
      outstanding.removeValue(forKey: dropped.id)
      overflow.append(dropped)
    }
    return (false, overflow)
  }

  /// JavaScript is ready: hands over (and forgets) every wake it has not seen.
  public mutating func startListening() -> [DayframeHealthWake] {
    isListening = true
    let pending = undelivered
    undelivered.removeAll()
    return pending
  }

  /// The JavaScript runtime went away (reload or teardown). Wakes it was given
  /// but never finished stay outstanding until their cap or expiry.
  public mutating func stopListening() {
    isListening = false
  }

  /// Finishes one wake. Returns it only the first time.
  public mutating func finish(id: String) -> DayframeHealthWake? {
    guard let wake = outstanding.removeValue(forKey: id) else { return nil }
    undelivered.removeAll { $0.id == id }
    return wake
  }

  /// Finishes every wake, for expiry or turning background sync off.
  public mutating func finishAll() -> [DayframeHealthWake] {
    let all = outstanding.values.sorted { $0.receivedAt < $1.receivedAt }
    outstanding.removeAll()
    undelivered.removeAll()
    return all
  }
}
