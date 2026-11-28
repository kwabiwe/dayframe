import CoreText
import SwiftUI
import WatchConnectivity
import WatchKit

@main
struct DayframeWatchApp: App {
  @StateObject private var timer = WatchTimer()

  init() { WatchFonts.register() }

  var body: some Scene {
    WindowGroup {
      WatchRootView(timer: timer)
    }
  }
}

// MARK: - Look

/// Midnight Core tokens and the Blocks motion the iPhone uses (docs/brand-style-guide.md, .codex/reference/motion.md).
enum WatchStyle {
  static let canvas = Color(hex: "#050914")
  static let surface = Color(hex: "#151B27")
  static let surfaceRaised = Color(hex: "#1B2230")
  static let surfaceMuted = Color(hex: "#202838")
  static let track = Color(hex: "#252E40")
  static let textPrimary = Color(hex: "#F7F8FB")
  static let textSecondary = Color(hex: "#8993A7")
  static let accent = Color(hex: "#FF6248")
  static let onAccent = Color(hex: "#050914")
  static let danger = Color(hex: "#FF6B6B")

  /// The `land` spring (stiffness 320, damping 21): one small overshoot.
  static let land = Animation.interpolatingSpring(stiffness: 320, damping: 21)
  /// The Stop flight's curve (620 ms, cubic-bezier(.3,.7,.2,1)).
  static let flight = Animation.timingCurve(0.3, 0.7, 0.2, 1, duration: 0.62)
  static let fade = Animation.easeOut(duration: 0.14)

  static func display(_ size: CGFloat, relativeTo style: Font.TextStyle) -> Font {
    WatchFonts.available ? .custom(WatchFonts.displayBold, size: size, relativeTo: style) : .system(style, design: .rounded).weight(.bold)
  }
}

enum WatchFonts {
  static let displayBold = "BricolageGrotesque-Bold"
  private(set) static var available = false

  static func register() {
    guard let url = Bundle.main.url(forResource: displayBold, withExtension: "ttf") else { return }
    var error: Unmanaged<CFError>?
    if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
      available = true
    } else {
      // Already registered in this process counts as available.
      available = UIFont(name: displayBold, size: 12) != nil
    }
  }
}

extension Color {
  init(hex: String) {
    let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    var value: UInt64 = 0
    Scanner(string: digits).scanHexInt64(&value)
    self.init(.sRGB,
              red: Double((value >> 16) & 0xFF) / 255,
              green: Double((value >> 8) & 0xFF) / 255,
              blue: Double(value & 0xFF) / 255)
  }

  init?(validHex: String?) {
    guard let validHex, validHex.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil else { return nil }
    self.init(hex: validHex)
  }
}

private func haptic(_ type: WKHapticType) { WKInterfaceDevice.current().play(type) }

private func spokenDuration(_ seconds: Int) -> String {
  let hours = seconds / 3600, minutes = (seconds % 3600) / 60
  if hours > 0 { return minutes > 0 ? "\(hours) h \(minutes) m" : "\(hours) h" }
  return "\(minutes) m"
}

// MARK: - Screens

struct WatchRootView: View {
  @ObservedObject var timer: WatchTimer
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      WatchStyle.canvas.ignoresSafeArea()
      switch timer.screen {
      case .waiting:
        WaitingView()
          .transition(.opacity)
      case .idle:
        IdleView(timer: timer)
          .transition(.opacity)
      case .running(let startedAt):
        RunningView(timer: timer, startedAt: startedAt)
          .transition(reduceMotion
                      ? .opacity
                      : .asymmetric(insertion: .offset(y: 14).combined(with: .opacity),
                                    removal: .scale(scale: 0.12, anchor: .top).combined(with: .opacity)))
      }
      if let failure = timer.failure {
        FailureView(failure: failure, canRetry: timer.canSend,
                    dismiss: { timer.dismissFailure() },
                    retry: { timer.retryAfterFailure() })
          .transition(.opacity)
      }
    }
    .foregroundStyle(WatchStyle.textPrimary)
    .animation(reduceMotion ? WatchStyle.fade : timer.screenAnimation, value: timer.screen)
    .animation(WatchStyle.fade, value: timer.failure)
  }
}

/// A: no snapshot from the iPhone yet.
struct WaitingView: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var pulsing = false

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        ZStack {
          Circle()
            .stroke(WatchStyle.textSecondary, lineWidth: 2)
            .frame(width: 60, height: 60)
            .scaleEffect(reduceMotion ? 1 : (pulsing ? 1.35 : 1))
            .opacity(reduceMotion ? 0 : (pulsing ? 0 : 0.6))
            .animation(reduceMotion ? nil : .easeOut(duration: 1.6).repeatForever(autoreverses: false), value: pulsing)
          Circle().fill(WatchStyle.surface).frame(width: 60, height: 60)
          Image(systemName: "iphone").font(.system(size: 26, weight: .regular))
        }
        .accessibilityHidden(true)
        .onAppear { pulsing = true }
        VStack(spacing: 4) {
          Text("Waiting for your iPhone")
            .font(WatchStyle.display(17, relativeTo: .headline))
            .multilineTextAlignment(.center)
          Text("Open Dayframe on your iPhone once and stay signed in.")
            .font(.footnote)
            .foregroundStyle(WatchStyle.textSecondary)
            .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .combine)
      }
      .frame(maxWidth: .infinity)
      .padding(.top, 8)
    }
  }
}

/// B (and F while idle): today's strip, total and the Play orb.
struct IdleView: View {
  @ObservedObject var timer: WatchTimer

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .firstTextBaseline) {
          Text("Today").font(WatchStyle.display(20, relativeTo: .title3))
          Spacer(minLength: 4)
          if !timer.reachable { AwayPill() }
        }
        DayStrip(display: timer.display)
        TodayTotal(display: timer.display)
        if let queuedLine = timer.queuedLine {
          Text(queuedLine)
            .font(.footnote)
            .foregroundStyle(WatchStyle.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
        }
        PlayOrb(enabled: timer.canSend) { timer.changeRecording() }
          .frame(maxWidth: .infinity)
          .padding(.top, 4)
        if timer.queuedLine == nil {
          Text(timer.idleHint)
            .contentTransition(.opacity)
            .font(.footnote)
            .foregroundStyle(WatchStyle.textSecondary)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
      }
      .padding(.horizontal, 4)
      .animation(WatchStyle.fade, value: timer.idleHint)
      .animation(WatchStyle.fade, value: timer.queuedLine)
    }
  }
}

struct DayStrip: View {
  let display: WatchTimer.Display?

  var body: some View {
    GeometryReader { proxy in
      let segments = display?.segments ?? []
      let total = segments.reduce(0) { $0 + $1.seconds }
      let scale = Double(max(display?.goalSeconds ?? 0, total, 1))
      let gaps = CGFloat(max(segments.count, 0)) * 2
      let usable = max(proxy.size.width - gaps, 0)
      HStack(spacing: 2) {
        ForEach(segments.indices, id: \.self) { index in
          RoundedRectangle(cornerRadius: 3)
            .fill(Color(validHex: segments[index].fill) ?? WatchStyle.textSecondary)
            .frame(width: max(usable * CGFloat(Double(segments[index].seconds) / scale), 3))
        }
        RoundedRectangle(cornerRadius: 3).fill(WatchStyle.surfaceMuted)
      }
    }
    .frame(height: 9)
    .accessibilityHidden(true)
  }
}

struct TodayTotal: View {
  let display: WatchTimer.Display?

  var body: some View {
    let seconds = display?.todaySeconds ?? 0
    Group {
      if seconds >= 60 {
        (Text(spokenDuration(seconds)).font(WatchStyle.display(15, relativeTo: .body)).foregroundColor(WatchStyle.textPrimary)
         + Text(" framed").font(.footnote).foregroundColor(WatchStyle.textSecondary))
      } else {
        Text("Nothing framed yet").font(.footnote).foregroundStyle(WatchStyle.textSecondary)
      }
    }
    .accessibilityLabel(seconds >= 60 ? "Today, \(spokenDuration(seconds)) framed" : "Nothing framed yet today")
  }
}

struct AwayPill: View {
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "iphone.slash").font(.system(size: 11, weight: .semibold))
        .foregroundStyle(WatchStyle.textSecondary)
      Text("Out of reach").font(.system(size: 12, weight: .semibold))
    }
    .padding(.horizontal, 7)
    .padding(.vertical, 3)
    .background(Capsule().fill(WatchStyle.surfaceMuted))
    .accessibilityLabel("iPhone out of reach")
  }
}

struct PlayOrb: View {
  let enabled: Bool
  let action: () -> Void

  var body: some View {
    let button = Button(action: action) {
      Image(systemName: "play.fill")
        .font(.system(size: 30, weight: .bold))
        .foregroundStyle(WatchStyle.onAccent)
        .offset(x: 2)
        .frame(width: 84, height: 84)
        .background(Circle().fill(WatchStyle.accent))
    }
    .buttonStyle(OrbPressStyle())
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.4)
    .accessibilityLabel("Start a block")
    if #available(watchOS 11.0, *) {
      button.handGestureShortcut(.primaryAction)
    } else {
      button
    }
  }
}

private struct OrbPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.9 : 1)
      .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
  }
}

/// C, D and F while recording: the live block, its clock and Stop.
struct RunningView: View {
  @ObservedObject var timer: WatchTimer
  let startedAt: Date

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .center) {
          // "Sending" and "Saved" take Recording's place, so the block below never moves.
          HStack(spacing: 5) {
            Circle().fill(timer.deliveryLine == nil ? WatchStyle.accent : WatchStyle.textSecondary).frame(width: 7, height: 7)
            Text(timer.deliveryLine ?? "Recording")
              .font(.system(size: 14, weight: .semibold))
              .foregroundStyle(timer.deliveryLine == nil ? WatchStyle.accent : WatchStyle.textSecondary)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
              .contentTransition(.opacity)
          }
          .accessibilityElement(children: .combine)
          Spacer(minLength: 4)
          if !timer.reachable { AwayPill() }
        }
        LiveBlock(display: timer.isStartPending ? nil : timer.display, startedAt: startedAt)
        StopOrb(startedAt: startedAt, enabled: timer.canSend || timer.canQueueStop) { timer.changeRecording() }
          .accessibilityHint(timer.reachable ? "" : "Stops now. Sent when your iPhone is back.")
          .frame(maxWidth: .infinity)
      }
      .padding(.horizontal, 2)
      .animation(WatchStyle.fade, value: timer.deliveryLine)
    }
  }
}

struct LiveBlock: View {
  let display: WatchTimer.Display?
  let startedAt: Date
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.isLuminanceReduced) private var luminanceReduced
  @State private var breathing = false

  var body: some View {
    let fill = Color(validHex: display?.activityFill) ?? WatchStyle.surfaceRaised
    let ink = Color(validHex: display?.activityText) ?? WatchStyle.textPrimary
    let activity = display?.activityName
    let title = display?.title ?? (activity == nil ? "New block" : nil)
    let still = reduceMotion || luminanceReduced

    VStack(alignment: .leading, spacing: 2) {
      Text(activity ?? "No activity")
        .font(.system(size: 13, weight: .semibold))
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(Capsule().fill(ink.opacity(0.14)))
      if let title {
        Text(title)
          .font(.system(size: 15, weight: .semibold))
          .lineLimit(1)
          .padding(.top, 1)
      }
      LiveClock(startedAt: startedAt, rolling: !still)
        .font(WatchStyle.display(32, relativeTo: .title))
        .minimumScaleFactor(0.6)
        .lineLimit(1)
    }
    .foregroundStyle(ink)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(fill))
    .overlay(
      // The one slow breathing ring: opacity only, still under Reduce Motion and on the dimmed face.
      RoundedRectangle(cornerRadius: 20, style: .continuous)
        .strokeBorder(ink == WatchStyle.textPrimary ? WatchStyle.textPrimary : Color.white, lineWidth: 2)
        .opacity(still ? 0.45 : (breathing ? 0.9 : 0.25))
        .animation(still ? nil : .easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: breathing)
    )
    .onAppear { breathing = true }
    .accessibilityElement(children: .combine)
    .accessibilityLabel([activity ?? "No activity", title].compactMap { $0 }.joined(separator: ". "))
  }
}

/// The running time. Awake, a once-a-second timeline rolls the changed digits; on the dimmed face (or
/// under Reduce Motion) the system's own timer text keeps it right without waking the app every second.
struct LiveClock: View {
  let startedAt: Date
  let rolling: Bool

  var body: some View {
    if rolling {
      TimelineView(.periodic(from: startedAt, by: 1)) { context in
        let seconds = max(0, Int(context.date.timeIntervalSince(startedAt)))
        Text(Self.format(seconds))
          .monospacedDigit()
          .contentTransition(.numericText(countsDown: false))
          .animation(.snappy(duration: 0.3), value: seconds)
      }
    } else {
      Text(timerInterval: startedAt ... Date.distantFuture, countsDown: false)
        .monospacedDigit()
    }
  }

  static func format(_ seconds: Int) -> String {
    String(format: "%d:%02d:%02d", seconds / 3600, (seconds / 60) % 60, seconds % 60)
  }
}

struct StopOrb: View {
  let startedAt: Date
  let enabled: Bool
  let action: () -> Void
  @Environment(\.isLuminanceReduced) private var luminanceReduced

  var body: some View {
    let button = Button(action: action) {
      ZStack {
        // The seconds ring is a clock, not decoration: it steps once a second, Reduce Motion or not.
        if luminanceReduced {
          Circle().stroke(WatchStyle.track, lineWidth: 3)
        } else {
          TimelineView(.periodic(from: startedAt, by: 1)) { context in
            let second = max(0, Int(context.date.timeIntervalSince(startedAt))) % 60
            ZStack {
              Circle().stroke(WatchStyle.track, lineWidth: 3)
              Circle()
                .trim(from: 0, to: CGFloat(second) / 60)
                .stroke(WatchStyle.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            }
          }
        }
        Circle().fill(WatchStyle.accent).padding(6)
        RoundedRectangle(cornerRadius: 3).fill(WatchStyle.onAccent).frame(width: 14, height: 14)
      }
      .frame(width: 56, height: 56)
    }
    .buttonStyle(OrbPressStyle())
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.4)
    .accessibilityLabel("Stop block")
    if #available(watchOS 11.0, *) {
      button.handGestureShortcut(.primaryAction)
    } else {
      button
    }
  }
}

/// E: the iPhone refused or didn't answer. The screen behind has already rolled back.
struct FailureView: View {
  let failure: WatchTimer.Failure
  let canRetry: Bool
  let dismiss: () -> Void
  let retry: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var shakes: CGFloat = 0

  var body: some View {
    ZStack {
      WatchStyle.canvas.opacity(0.92).ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 10) {
          VStack(alignment: .leading, spacing: 4) {
            Label(failure.title, systemImage: "exclamationmark.circle")
              .font(.system(size: 14, weight: .semibold))
              .foregroundStyle(WatchStyle.danger)
            Text(failure.message).font(.system(size: 15))
          }
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(WatchStyle.surface))
          .modifier(Shake(travel: shakes))
          .accessibilityElement(children: .combine)
          HStack(spacing: 6) {
            Button("OK", action: dismiss)
              .buttonStyle(PillStyle(fill: WatchStyle.surfaceMuted, ink: WatchStyle.textPrimary))
            if canRetry {
              Button("Try again", action: retry)
                .buttonStyle(PillStyle(fill: WatchStyle.accent, ink: WatchStyle.onAccent))
            }
          }
        }
        .padding(.horizontal, 4)
      }
    }
    .onAppear {
      guard !reduceMotion else { return }
      withAnimation(.linear(duration: 0.4)) { shakes = 1 }
    }
  }
}

private struct Shake: GeometryEffect {
  var travel: CGFloat
  var animatableData: CGFloat {
    get { travel }
    set { travel = newValue }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    // Three diminishing swings that settle at rest.
    let x = 7 * (1 - travel) * sin(travel * .pi * 6)
    return ProjectionTransform(CGAffineTransform(translationX: x, y: 0))
  }
}

private struct PillStyle: ButtonStyle {
  let fill: Color
  let ink: Color

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(ink)
      .frame(maxWidth: .infinity, minHeight: 40)
      .background(Capsule().fill(fill))
      .opacity(configuration.isPressed ? 0.8 : 1)
  }
}

// MARK: - Model

@MainActor
final class WatchTimer: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var snapshot: Snapshot?
  @Published private(set) var display: Display?
  @Published private(set) var reachable = false
  @Published private(set) var pending: Pending?
  @Published private(set) var failure: Failure?
  @Published private(set) var savedAt: Date?
  private let formatter = ISO8601DateFormatter()
  private var session: WCSession?
  private var refreshingSnapshot = false
  private var snapshotSequence = 0
  private var pendingTimeout: Task<Void, Never>?
  private var savedTimeout: Task<Void, Never>?
  private var lastAction: Pending.Kind?
  /// A Stop pressed while the iPhone was out of reach. Kept on the Watch (it survives a relaunch) and
  /// sent with the moment it was pressed once the iPhone is back.
  @Published private(set) var queuedStop: QueuedStop?
  private var deliveringQueuedStop = false
  private static let queuedStopKey = "dayframe.watch.queuedStop"
  private static let clock: DateFormatter = {
    let formatter = DateFormatter()
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    return formatter
  }()

  struct QueuedStop: Equatable, Codable {
    let entryId: String
    let at: Date
  }

  struct Snapshot: Equatable {
    let revision: String
    let entryId: String?
    let startedAt: Date?
  }

  struct Display: Equatable {
    struct Segment: Equatable { let fill: String; let seconds: Int }
    let activityName: String?
    let activityFill: String?
    let activityText: String?
    let title: String?
    let todaySeconds: Int
    let goalSeconds: Int?
    let segments: [Segment]
  }

  /// An action the Watch has already shown, waiting for the iPhone to confirm it.
  struct Pending: Equatable {
    enum Kind: Equatable { case start(at: Date), stop(entryId: String, at: Date) }
    let kind: Kind
    var accepted = false
    /// The reply never came. That does not mean nothing happened: the iPhone may have carried the
    /// action out, so its timer state decides, never a guess.
    var confirming = false
  }

  struct Failure: Equatable {
    enum Reason: Equatable {
      /// The iPhone answered no.
      case refused
      /// No answer, and the iPhone's timer state shows the action did not happen.
      case noAnswer
      /// No answer and no timer state either: the outcome is unknown.
      case unconfirmed
    }
    let isStart: Bool
    let reason: Reason
    var title: String {
      if reason == .unconfirmed { return "Not confirmed" }
      return isStart ? "Not started" : "Not stopped"
    }
    var message: String {
      switch reason {
      case .refused: return "The timer changed on your iPhone. Check Dayframe there."
      case .noAnswer: return "Your iPhone didn’t answer. Nothing changed."
      case .unconfirmed: return "Your iPhone didn’t answer. Check Dayframe there before trying again."
      }
    }
  }

  enum Screen: Equatable {
    case waiting, idle, running(Date)
  }

  var screen: Screen {
    if let pending {
      switch pending.kind {
      case .start(let at): return .running(snapshot?.startedAt ?? at)
      case .stop: return snapshot == nil ? .waiting : .idle
      }
    }
    guard let snapshot else { return .waiting }
    // A queued Stop shows the block already stopped, as a sent one does.
    if let queuedStop, snapshot.entryId == queuedStop.entryId { return .idle }
    if let startedAt = snapshot.startedAt { return .running(startedAt) }
    return .idle
  }

  /// A Stop flies the block into the day; everything else lands with the shared spring.
  var screenAnimation: Animation {
    if case .stop = pending?.kind { return WatchStyle.flight }
    if queuedStop != nil { return WatchStyle.flight }
    return WatchStyle.land
  }

  var isStartPending: Bool {
    if case .start = pending?.kind { return snapshot?.startedAt == nil }
    return false
  }

  var canSend: Bool { reachable && pending == nil && snapshot != nil && queuedStop == nil }

  /// Out of reach with a block running: Stop still works and is sent when the iPhone is back.
  /// Start does not: a block can't begin until the iPhone has said what is running.
  var canQueueStop: Bool { !reachable && pending == nil && queuedStop == nil && snapshot?.entryId != nil }

  /// Shown under Today's total while a Stop waits for the iPhone.
  var queuedLine: String? {
    queuedStop.map { "Stopped at \(Self.clock.string(from: $0.at)) · sends when your iPhone is back" }
  }

  var idleHint: String {
    if let deliveryLine { return deliveryLine }
    return reachable ? "Tap to start a block" : "Bring your iPhone closer to start"
  }

  var deliveryLine: String? {
    if pending != nil { return "Sending to your iPhone" }
    if savedAt != nil { return "Saved on iPhone" }
    return nil
  }

  override init() {
    super.init()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    #if DEBUG
    if WatchDemo.apply(to: self) { return }
    #endif
    queuedStop = UserDefaults.standard.data(forKey: Self.queuedStopKey)
      .flatMap { try? JSONDecoder().decode(QueuedStop.self, from: $0) }
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    self.session = session
    session.delegate = self
    session.activate()
  }

  func changeRecording() {
    if canQueueStop, let entryId = snapshot?.entryId {
      queueStop(entryId)
      return
    }
    guard canSend, let snapshot else { return }
    let kind: Pending.Kind = snapshot.entryId.map { .stop(entryId: $0, at: Date()) } ?? .start(at: Date())
    send(kind, against: snapshot)
  }

  func dismissFailure() { failure = nil }

  func retryAfterFailure() {
    failure = nil
    changeRecording()
  }

  private func send(_ kind: Pending.Kind, against snapshot: Snapshot) {
    failure = nil
    savedAt = nil
    lastAction = kind
    // Shown at once, like the iPhone's timer actions: no spinner, one haptic, rolled back if refused.
    pending = Pending(kind: kind)
    if case .start = kind { haptic(.start) } else { haptic(.stop) }
    armPendingTimeout()

    guard let session else { return }
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
        if let context = reply["snapshot"] as? [String: Any] { self.apply(context) }
        if reply["accepted"] as? Bool == true {
          self.pending?.accepted = true
          self.settlePending()
        } else {
          self.rollBack(.refused)
        }
      }
    } errorHandler: { [weak self] _ in
      Task { @MainActor in self?.confirmWithPhone() }
    }
  }

  /// No answer and no timer state. A Start is unknown, so the card says so. A Stop is kept instead and
  /// sent once the iPhone answers: it stops only that block, at the time it was pressed, and is dropped
  /// if the iPhone has already stopped it.
  private func giveUpOrQueue() {
    guard case .stop(let entryId, let at) = pending?.kind else {
      rollBack(.unconfirmed)
      return
    }
    pendingTimeout?.cancel()
    pending = nil
    if let session { reachable = session.isReachable }
    setQueuedStop(QueuedStop(entryId: entryId, at: at))
  }

  private func queueStop(_ entryId: String) {
    failure = nil
    savedAt = nil
    setQueuedStop(QueuedStop(entryId: entryId, at: Date()))
    haptic(.stop)
  }

  private func setQueuedStop(_ value: QueuedStop?) {
    queuedStop = value
    if let value, let data = try? JSONEncoder().encode(value) {
      UserDefaults.standard.set(data, forKey: Self.queuedStopKey)
    } else {
      UserDefaults.standard.removeObject(forKey: Self.queuedStopKey)
    }
  }

  /// Sends a queued Stop. Called when the iPhone becomes reachable or sends its state; a Stop it can't
  /// take yet (signed out, loading, busy) stays queued for the next of those.
  private func deliverQueuedStop() {
    guard let stop = queuedStop, reachable, pending == nil, !deliveringQueuedStop, let session else { return }
    deliveringQueuedStop = true
    let message: [String: Any] = [
      "dayframeWatchVersion": 1,
      "requestId": UUID().uuidString,
      "action": "queuedStop",
      "entryId": stop.entryId,
      "stoppedAt": formatter.string(from: stop.at)
    ]
    session.sendMessage(message) { [weak self] reply in
      Task { @MainActor in
        guard let self else { return }
        self.deliveringQueuedStop = false
        // Settle the Stop before the reply's state is applied, which would otherwise drop it unread.
        if self.queuedStop == stop, reply["notReady"] as? Bool != true {
          self.setQueuedStop(nil)
          if reply["accepted"] as? Bool == true {
            self.flashSaved()
          } else {
            self.failure = Failure(isStart: false, reason: .refused)
            haptic(.failure)
          }
        }
        if let context = reply["snapshot"] as? [String: Any] { self.apply(context) }
      }
    } errorHandler: { [weak self] _ in
      // Kept: the next reachability change or iPhone state sends it again.
      Task { @MainActor in self?.deliveringQueuedStop = false }
    }
  }

  private func rollBack(_ reason: Failure.Reason) {
    guard let pending else { return }
    let isStart: Bool
    if case .start = pending.kind { isStart = true } else { isStart = false }
    pendingTimeout?.cancel()
    self.pending = nil
    failure = Failure(isStart: isStart, reason: reason)
    haptic(.failure)
  }

  /// Whether the iPhone's snapshot shows the pending action carried out.
  private var pendingIsDone: Bool {
    guard let pending, let snapshot else { return false }
    switch pending.kind {
    case .start: return snapshot.entryId != nil
    case .stop: return snapshot.entryId == nil
    }
  }

  /// An accepted (or unanswered) action stays shown until the iPhone's snapshot agrees with it.
  private func settlePending() {
    guard let pending, pending.accepted || pending.confirming, pendingIsDone else { return }
    pendingTimeout?.cancel()
    self.pending = nil
    flashSaved()
  }

  /// The reply failed or never came: ask the iPhone what its timer is doing now and go by that.
  private func confirmWithPhone() {
    guard let current = pending, !current.accepted else { return }
    if current.confirming {
      // Asked once already and still nothing settled: the outcome is unknown.
      giveUpOrQueue()
      return
    }
    pending?.confirming = true
    armPendingTimeout()
    guard reachable, let session else { return }
    session.sendMessage(["dayframeWatchVersion": 1, "action": "snapshot"]) { [weak self] reply in
      Task { @MainActor in
        guard let self, self.pending?.confirming == true else { return }
        if let context = reply["snapshot"] as? [String: Any] { self.apply(context) }
        guard self.pending != nil else { return } // apply settled it: the iPhone did it
        // Still being carried out on the iPhone: its next snapshot or the timeout decides.
        if reply["busy"] as? Bool == true { return }
        self.rollBack(.noAnswer)
      }
    } errorHandler: { [weak self] _ in
      Task { @MainActor in
        guard let self, self.pending?.confirming == true else { return }
        self.giveUpOrQueue()
      }
    }
  }

  private func flashSaved() {
    savedAt = Date()
    savedTimeout?.cancel()
    savedTimeout = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 1_600_000_000)
      guard !Task.isCancelled else { return }
      self?.savedAt = nil
    }
  }

  private func armPendingTimeout() {
    pendingTimeout?.cancel()
    pendingTimeout = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 10_000_000_000)
      guard !Task.isCancelled, let self, let pending = self.pending else { return }
      if pending.accepted {
        // Accepted but the snapshot never caught up: show the iPhone's truth.
        self.pending = nil
        self.refreshSnapshot()
      } else {
        self.confirmWithPhone()
      }
    }
  }

  private func refreshSnapshot() {
    guard reachable, pending == nil, !refreshingSnapshot, let session else { return }
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

  fileprivate func apply(_ context: [String: Any]) {
    snapshotSequence += 1
    guard context["dayframeWatchVersion"] as? Int == 1, let revision = context["revision"] as? String else {
      snapshot = nil
      display = nil
      return
    }
    let entry = context["entryId"] as? String
    let start = (context["startedAt"] as? String).flatMap { formatter.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) }
    guard (entry == nil) == (start == nil), start.map({ $0 <= Date() }) ?? true else {
      snapshot = nil
      display = nil
      return
    }
    snapshot = Snapshot(revision: revision, entryId: entry, startedAt: start)
    // The iPhone has stopped or replaced that block itself since: its state stands.
    if let queuedStop, entry != queuedStop.entryId { setQueuedStop(nil) }
    display = Self.parseDisplay(context["display"])
    settlePending()
  }

  private static func parseDisplay(_ value: Any?) -> Display? {
    guard let value = value as? [String: Any] else { return nil }
    let segments = (value["segments"] as? [[String: Any]] ?? []).prefix(4).compactMap { item -> Display.Segment? in
      guard let fill = item["fill"] as? String, let seconds = (item["seconds"] as? NSNumber)?.intValue, seconds > 0 else { return nil }
      return Display.Segment(fill: fill, seconds: seconds)
    }
    return Display(
      activityName: value["activityName"] as? String,
      activityFill: value["activityFill"] as? String,
      activityText: value["activityText"] as? String,
      title: value["title"] as? String,
      todaySeconds: (value["todaySeconds"] as? NSNumber)?.intValue ?? 0,
      goalSeconds: (value["goalSeconds"] as? NSNumber)?.intValue,
      segments: Array(segments)
    )
  }

  #if DEBUG
  fileprivate func seedDemo(snapshot: Snapshot?, display: Display?, reachable: Bool, pending: Pending?, failure: Failure?) {
    self.snapshot = snapshot
    self.display = display
    self.reachable = reachable
    self.pending = pending
    self.failure = failure
  }

  fileprivate func seedQueuedStop(entryId: String, at: Date) {
    queuedStop = QueuedStop(entryId: entryId, at: at)
  }
  #endif

  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    let context = session.receivedApplicationContext
    let canReachPhone = session.isReachable
    Task { @MainActor in
      self.reachable = canReachPhone
      self.apply(context)
      self.refreshSnapshot()
      self.deliverQueuedStop()
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    let canReachPhone = session.isReachable
    Task { @MainActor in
      self.reachable = canReachPhone
      self.refreshSnapshot()
      self.deliverQueuedStop()
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor in
      self.apply(applicationContext)
      self.deliverQueuedStop()
    }
  }
}

#if DEBUG
/// Debug builds only: `-DayframeWatchDemo waiting|idle|running|sending|error|away|queued` seeds one screen
/// without a paired iPhone, for Simulator screenshots. Release and Staging builds never contain it.
@MainActor
private enum WatchDemo {
  static func apply(to timer: WatchTimer) -> Bool {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "-DayframeWatchDemo"), index + 1 < arguments.count else { return false }
    let state = arguments[index + 1]
    let segments = [
      WatchTimer.Display.Segment(fill: "#16D2A6", seconds: 4_500),
      WatchTimer.Display.Segment(fill: "#FFBD1F", seconds: 1_500),
      WatchTimer.Display.Segment(fill: "#3B8BF6", seconds: 5_400),
      WatchTimer.Display.Segment(fill: "#FF5CA8", seconds: 900)
    ]
    let idleDisplay = WatchTimer.Display(activityName: nil, activityFill: nil, activityText: nil, title: nil,
                                         todaySeconds: 12_300, goalSeconds: 28_800, segments: segments)
    let liveDisplay = WatchTimer.Display(activityName: "Deep work", activityFill: "#3B8BF6", activityText: "#050914",
                                         title: "Watch concepts", todaySeconds: 12_300, goalSeconds: 28_800, segments: segments)
    let started = Date().addingTimeInterval(-5_047)
    let idle = WatchTimer.Snapshot(revision: "demo", entryId: nil, startedAt: nil)
    let running = WatchTimer.Snapshot(revision: "demo", entryId: "demo-entry", startedAt: started)
    switch state {
    case "waiting": timer.seedDemo(snapshot: nil, display: nil, reachable: false, pending: nil, failure: nil)
    case "idle": timer.seedDemo(snapshot: idle, display: idleDisplay, reachable: true, pending: nil, failure: nil)
    case "running": timer.seedDemo(snapshot: running, display: liveDisplay, reachable: true, pending: nil, failure: nil)
    case "sending": timer.seedDemo(snapshot: idle, display: idleDisplay, reachable: true,
                                   pending: .init(kind: .start(at: Date().addingTimeInterval(-2))), failure: nil)
    case "error": timer.seedDemo(snapshot: idle, display: idleDisplay, reachable: true, pending: nil,
                                 failure: .init(isStart: true, reason: .noAnswer))
    case "away": timer.seedDemo(snapshot: running, display: liveDisplay, reachable: false, pending: nil, failure: nil)
    case "queued":
      timer.seedDemo(snapshot: running, display: idleDisplay, reachable: false, pending: nil, failure: nil)
      if let entryId = running.entryId { timer.seedQueuedStop(entryId: entryId, at: Date().addingTimeInterval(-90)) }
    default: return false
    }
    return true
  }
}
#endif
