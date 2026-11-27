import SwiftUI
import WatchConnectivity

@main
struct DayframeWatchApp: App {
  @StateObject private var timer = WatchTimer()

  var body: some Scene {
    WindowGroup {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          Text("Dayframe").font(.headline)
          if let startedAt = timer.startedAt {
            Text(timerInterval: startedAt ... Date.distantFuture, countsDown: false)
              .font(.system(.title2, design: .rounded).weight(.bold))
              .monospacedDigit()
          } else {
            Text(timer.snapshot == nil ? "Open Dayframe on your iPhone." : "Nothing recording")
              .font(.body)
          }
          if timer.snapshot != nil {
            Button {
              timer.changeRecording()
            } label: {
              Label(timer.startedAt == nil ? "Start a block" : "Stop block",
                    systemImage: timer.startedAt == nil ? "play.fill" : "stop.fill")
            }
            .buttonStyle(.borderedProminent)
            .disabled(!timer.canSend)
          }
          if let notice = timer.notice {
            Text(notice).font(.footnote).foregroundStyle(.secondary)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
      }
    }
  }
}

@MainActor
private final class WatchTimer: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var snapshot: Snapshot?
  @Published private(set) var notice: String?
  @Published private var reachable = false
  @Published private var waiting = false
  private let formatter = ISO8601DateFormatter()
  private var session: WCSession?
  private var refreshingSnapshot = false
  private var snapshotSequence = 0

  struct Snapshot {
    let revision: String
    let entryId: String?
    let startedAt: Date?
  }

  var startedAt: Date? { snapshot?.startedAt }
  var canSend: Bool { reachable && !waiting && snapshot != nil }

  override init() {
    super.init()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    self.session = session
    session.delegate = self
    session.activate()
  }

  func changeRecording() {
    guard canSend, let session, let snapshot else { return }
    waiting = true
    notice = nil
    var message: [String: Any] = [
      "dayframeWatchVersion": 1,
      "requestId": UUID().uuidString,
      "revision": snapshot.revision,
      "action": snapshot.entryId == nil ? "start" : "stop"
    ]
    if let entryId = snapshot.entryId { message["entryId"] = entryId }
    session.sendMessage(message) { [weak self] reply in
      Task { @MainActor in
        guard let self else { return }
        self.waiting = false
        if let context = reply["snapshot"] as? [String: Any] { self.apply(context) }
        if reply["accepted"] as? Bool != true {
          self.notice = "Timer changed or is unavailable. Check Dayframe on your iPhone."
        }
      }
    } errorHandler: { [weak self] _ in
      Task { @MainActor in
        self?.waiting = false
        self?.notice = "Couldn’t reach Dayframe on your iPhone."
      }
    }
  }

  private func refreshSnapshot() {
    guard reachable, !waiting, !refreshingSnapshot, let session else { return }
    refreshingSnapshot = true
    let sequence = snapshotSequence
    session.sendMessage(["dayframeWatchVersion": 1, "action": "snapshot"]) { [weak self] reply in
      Task { @MainActor in
        guard let self else { return }
        self.refreshingSnapshot = false
        if self.snapshotSequence == sequence, let context = reply["snapshot"] as? [String: Any] {
          self.apply(context)
        }
      }
    } errorHandler: { [weak self] _ in
      Task { @MainActor in self?.refreshingSnapshot = false }
    }
  }

  private func apply(_ context: [String: Any]) {
    snapshotSequence += 1
    guard context["dayframeWatchVersion"] as? Int == 1, let revision = context["revision"] as? String else {
      snapshot = nil
      return
    }
    let entry = context["entryId"] as? String
    let start = (context["startedAt"] as? String).flatMap { formatter.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) }
    guard (entry == nil) == (start == nil), start.map({ $0 <= Date() }) ?? true else {
      snapshot = nil
      return
    }
    snapshot = Snapshot(revision: revision, entryId: entry, startedAt: start)
  }

  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    let context = session.receivedApplicationContext
    let canReachPhone = session.isReachable
    Task { @MainActor in
      self.reachable = canReachPhone
      self.apply(context)
      self.refreshSnapshot()
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    let canReachPhone = session.isReachable
    Task { @MainActor in
      self.reachable = canReachPhone
      self.refreshSnapshot()
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor in self.apply(applicationContext) }
  }
}
