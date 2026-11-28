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
    let next = ownerKey == nil ? nil : value
    if next.map({ $0 as NSDictionary }) == display.map({ $0 as NSDictionary }) { return }
    display = next
    sendSnapshot()
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
    try? session.updateApplicationContext(context)
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
        replyHandler(["snapshot": self.context])
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
