import Foundation
import React
import WatchConnectivity

@objc(DayframeWatchBridge)
final class DayframeWatchBridge: RCTEventEmitter {
  override static func requiresMainQueueSetup() -> Bool { true }
  override func supportedEvents() -> [String] { ["dayframeWatchTimerCommand"] }

  override func startObserving() {
    Task { @MainActor [weak self] in DayframeWatchPhoneLink.shared.emitter = self }
  }

  override func stopObserving() {
    Task { @MainActor [weak self] in
      let link = DayframeWatchPhoneLink.shared
      if let self, link.emitter === self {
        link.emitter = nil
        link.setSnapshot(ownerKey: nil, entryId: nil, startedAt: nil)
      }
    }
  }

  @objc(updateTimerSnapshot:entryId:startedAt:)
  func updateTimerSnapshot(_ ownerKey: String?, entryId: String?, startedAt: String?) {
    Task { @MainActor in
      DayframeWatchPhoneLink.shared.setSnapshot(ownerKey: ownerKey, entryId: entryId, startedAt: startedAt)
    }
  }

  @objc(updateTimerDisplay:)
  func updateTimerDisplay(_ display: NSDictionary?) {
    let value = display as? [String: Any]
    Task { @MainActor in DayframeWatchPhoneLink.shared.setDisplay(value) }
  }

  @objc(completeTimerCommand:accepted:)
  func completeTimerCommand(_ requestId: String, accepted: Bool) {
    Task { @MainActor in
      DayframeWatchPhoneLink.shared.complete(requestId: requestId, accepted: accepted)
    }
  }
}

@MainActor
final class DayframeWatchPhoneLink: NSObject, WCSessionDelegate {
  static let shared = DayframeWatchPhoneLink()
  weak var emitter: DayframeWatchBridge?
  private var session: WCSession?
  private var ownerKey: String?
  private var snapshot: [String: Any] = ["dayframeWatchVersion": 1]
  // What the Watch draws around the timer (activity, colours, today's strip). Never part of the
  // revision: it changes on the minute, and a Start or Stop the Watch sent must stay valid.
  private var display: [String: Any]?
  private var consumedRevision: String?
  private var pending: (id: String, revision: String, reply: ([String: Any]) -> Void)?

  func activate() {
    guard WCSession.isSupported(), session == nil else { return }
    let session = WCSession.default
    self.session = session
    session.delegate = self
    session.activate()
  }

  func setSnapshot(ownerKey: String?, entryId: String?, startedAt: String?) {
    if ownerKey == self.ownerKey,
       entryId == snapshot["entryId"] as? String,
       startedAt == snapshot["startedAt"] as? String { return }
    let ownerChanged = ownerKey != self.ownerKey
    self.ownerKey = ownerKey
    if ownerChanged || ownerKey == nil { display = nil }
    var state: [String: Any] = ["dayframeWatchVersion": 1]
    if ownerKey != nil {
      state["revision"] = UUID().uuidString
      if let entryId, let startedAt {
        state["entryId"] = entryId
        state["startedAt"] = startedAt
      }
    }
    snapshot = state
    sendSnapshot()
    if ownerChanged, let pending { complete(requestId: pending.id, accepted: false) }
  }

  func setDisplay(_ value: [String: Any]?) {
    let next = ownerKey == nil ? nil : value.map(Self.propertyListSafe)
    if next.map({ $0 as NSDictionary }) == display.map({ $0 as NSDictionary }) { return }
    display = next
    sendSnapshot()
  }

  /// A Stop pressed on the Watch while the iPhone was out of reach, sent once it is back. It carries no
  /// revision (a relaunched iPhone has a new one); the block id decides: it stops only the block it was
  /// pressed for, at the time it was pressed, and only while that block is still running.
  private func receiveQueuedStop(_ message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    guard let entryId = message["entryId"] as? String, !entryId.isEmpty,
          let stoppedAt = message["stoppedAt"] as? String,
          let requestId = message["requestId"] as? String, UUID(uuidString: requestId) != nil
    else {
      replyHandler(["accepted": false, "snapshot": context])
      return
    }
    // Signed out, still loading, or busy with another Watch command: the Watch keeps it and asks again.
    guard pending == nil, let emitter, ownerKey != nil, let revision = snapshot["revision"] as? String else {
      replyHandler(["notReady": true, "snapshot": context])
      return
    }
    guard snapshot["entryId"] as? String == entryId else {
      replyHandler(["accepted": false, "snapshot": context])
      return
    }
    pending = (requestId, revision, replyHandler)
    emitter.sendEvent(withName: "dayframeWatchTimerCommand",
                      body: ["requestId": requestId, "action": "stop", "entryId": entryId, "stoppedAt": stoppedAt])
  }

  /// WatchConnectivity only carries property-list values. A JS `null` arrives as NSNull, and one
  /// NSNull fails the whole reply or application context, so absent fields are left out instead.
  private static func propertyListSafe(_ value: [String: Any]) -> [String: Any] {
    var safe: [String: Any] = [:]
    for (key, item) in value {
      if let cleaned = propertyListSafeValue(item) { safe[key] = cleaned }
    }
    return safe
  }

  private static func propertyListSafeValue(_ value: Any) -> Any? {
    switch value {
    case is NSNull: return nil
    case let dictionary as [String: Any]: return propertyListSafe(dictionary)
    case let array as [Any]: return array.compactMap(propertyListSafeValue)
    case is String, is NSNumber, is Date, is Data: return value
    default: return nil
    }
  }

  /// The snapshot plus the display, as the Watch receives it in every context and reply.
  private var context: [String: Any] {
    var value = snapshot
    if let display { value["display"] = display }
    return value
  }

  func complete(requestId: String, accepted: Bool) {
    guard let pending, pending.id == requestId else { return }
    self.pending = nil
    if accepted { consumedRevision = pending.revision }
    pending.reply(["accepted": accepted, "snapshot": context])
  }

  private func sendSnapshot() {
    guard let session, session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
    // The display is decoration: if it is ever refused, the timer state must still reach the Watch.
    do { try session.updateApplicationContext(context) } catch { try? session.updateApplicationContext(snapshot) }
  }

  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    Task { @MainActor in self.sendSnapshot() }
  }

  // The iPhone can already have a timer snapshot when the Watch app finishes installing.
  nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
    Task { @MainActor in self.sendSnapshot() }
  }

  nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

  nonisolated func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                           replyHandler: @escaping ([String: Any]) -> Void) {
    Task { @MainActor in
      if message["dayframeWatchVersion"] as? Int == 1, message["action"] as? String == "snapshot" {
        // "busy": a Watch command is still being carried out, so this snapshot may not show it yet.
        replyHandler(["snapshot": self.context, "busy": self.pending != nil])
        return
      }
      if message["dayframeWatchVersion"] as? Int == 1, message["action"] as? String == "queuedStop" {
        self.receiveQueuedStop(message, replyHandler: replyHandler)
        return
      }
      let current = self.snapshot["entryId"] as? String
      guard self.pending == nil, let emitter = self.emitter,
            message["dayframeWatchVersion"] as? Int == 1,
            let revision = message["revision"] as? String, revision == self.snapshot["revision"] as? String,
            revision != self.consumedRevision,
            let requestId = message["requestId"] as? String, UUID(uuidString: requestId) != nil,
            let action = message["action"] as? String,
            (action == "start" && current == nil && message["entryId"] == nil ||
             action == "stop" && current != nil && message["entryId"] as? String == current)
      else {
        replyHandler(["accepted": false, "snapshot": self.context])
        return
      }
      self.pending = (requestId, revision, replyHandler)
      emitter.sendEvent(withName: "dayframeWatchTimerCommand", body: message)
    }
  }
}
