import ExpoModulesCore
import UIKit

private struct DayframeDurationDialTheme: Decodable {
  let accent: String
  let accentSoft: String
  let border: String
  let onAccent: String
  let surface: String
  let surfaceMuted: String
  let textPrimary: String
  let textSecondary: String
}

private struct DayframeDurationDialRecord: Decodable {
  let endMs: Double
  let mode: String
  let modelVersion: Int
  let nowMs: Double
  let presentationId: Int
  let reduceMotion: Bool
  let revision: Int
  let startMs: Double
  let theme: DayframeDurationDialTheme
}

private enum DayframeDurationDialHandle: String {
  case start
  case end
  case range
}

private final class DayframeAdjustableButton: UIButton {
  var adjust: ((Int) -> Void)?

  override func accessibilityIncrement() { adjust?(1) }
  override func accessibilityDecrement() { adjust?(-1) }
}

final class DayframeDurationDialExpoView: ExpoView, UIGestureRecognizerDelegate {
  let onInteraction = EventDispatcher()

  private var record: DayframeDurationDialRecord?
  private let pan = UIPanGestureRecognizer()
  private var activeHandle: DayframeDurationDialHandle?
  private var activeInteractionId: String?
  private var interactionRecord: DayframeDurationDialRecord?
  private var previousAngle = 0.0
  private var accumulatedRadians = 0.0
  private var lastMinuteDelta = 0
  private weak var disabledAncestorScrollView: UIScrollView?
  private var ancestorScrollWasEnabled = true
  private let selectionHaptic = UISelectionFeedbackGenerator()
  private let fiveMinuteHaptic = UIImpactFeedbackGenerator(style: .light)
  private let hourHaptic = UIImpactFeedbackGenerator(style: .heavy)
  private let startButton = DayframeAdjustableButton(type: .custom)
  private let endButton = DayframeAdjustableButton(type: .custom)
  private let rangeButton = DayframeAdjustableButton(type: .custom)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isOpaque = false
    layer.isOpaque = false
    layer.backgroundColor = UIColor.clear.cgColor
    clearsContextBeforeDrawing = true
    contentMode = .redraw
    clipsToBounds = false
    isMultipleTouchEnabled = false

    pan.addTarget(self, action: #selector(handlePan(_:)))
    pan.delegate = self
    pan.minimumNumberOfTouches = 1
    pan.maximumNumberOfTouches = 1
    pan.cancelsTouchesInView = false
    addGestureRecognizer(pan)

    for (button, handle) in [
      (startButton, DayframeDurationDialHandle.start),
      (endButton, DayframeDurationDialHandle.end),
      (rangeButton, DayframeDurationDialHandle.range)
    ] {
      button.backgroundColor = .clear
      button.accessibilityTraits = [.adjustable]
      button.adjust = { [weak self] direction in
        self?.emitAccessibilityAdjustment(handle: handle, direction: direction)
      }
      addSubview(button)
    }
    bringSubviewToFront(startButton)
  }

  func update(modelJSON: String) {
    guard let data = modelJSON.data(using: .utf8) else { return }
    do {
      let next = try JSONDecoder().decode(DayframeDurationDialRecord.self, from: data)
      guard next.modelVersion == 1 else { return }
      if record?.presentationId != next.presentationId {
        cancelInteraction(emit: false)
      }
      record = next
      setNeedsDisplay()
      setNeedsLayout()
    } catch {
      assertionFailure("Invalid Dayframe Duration Dial model: \(error)")
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateAccessibilityHandles()
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    guard super.point(inside: point, with: event), let record else { return false }
    return DayframeDurationDialCore.ownsTouch(
      x: Double(point.x),
      y: Double(point.y),
      width: Double(bounds.width),
      height: Double(bounds.height),
      includesRangeHandle: record.mode != "running"
    )
  }

  override func draw(_ rect: CGRect) {
    guard let record, let context = UIGraphicsGetCurrentContext() else { return }
    context.clear(rect)
    let centre = CGPoint(x: rect.midX, y: rect.midY)
    let baseRadius = min(rect.width, rect.height) * 0.34
    drawTicks(context: context, centre: centre, radius: baseRadius, record: record)
    drawArc(context: context, centre: centre, radius: baseRadius, record: record)
    drawCentre(context: context, centre: centre, record: record)
    drawHandle(.end, record: record)
    drawHandle(.start, record: record)
    if record.mode != "running" {
      drawHandle(.range, record: record)
    }
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === pan, let record else { return false }
    let point = gestureRecognizer.location(in: self)
    activeHandle = nearestHandle(to: point, record: record)
    return activeHandle != nil
  }

  @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
    guard let record, let activeHandle else { return }
    let point = gesture.location(in: self)
    let angle = atan2(Double(point.y - bounds.midY), Double(point.x - bounds.midX))

    switch gesture.state {
    case .began:
      let interactionId = UUID().uuidString
      activeInteractionId = interactionId
      interactionRecord = record
      previousAngle = angle
      accumulatedRadians = 0
      lastMinuteDelta = 0
      disableAncestorScrolling()
      selectionHaptic.prepare()
      fiveMinuteHaptic.prepare()
      hourHaptic.prepare()
      emit(phase: "began", handle: activeHandle, deltaMinutes: 0, record: record)
    case .changed:
      guard let interactionRecord else {
        cancelInteraction(emit: false)
        return
      }
      let delta = DayframeDurationDialCore.unwrap(previous: previousAngle, next: angle)
      previousAngle = angle
      accumulatedRadians += delta
      let proposed = DayframeDurationDialCore.minuteDelta(radians: accumulatedRadians)
      let accepted = clamp(
        deltaMinutes: proposed,
        handle: activeHandle,
        record: interactionRecord
      )
      if accepted != proposed {
        accumulatedRadians = Double(accepted) / 60 * DayframeDurationDialCore.fullTurn
      }
      guard accepted != lastMinuteDelta else { return }
      fireHaptic(from: lastMinuteDelta, to: accepted)
      lastMinuteDelta = accepted
      emit(
        phase: "changed",
        handle: activeHandle,
        deltaMinutes: accepted,
        record: interactionRecord
      )
    case .ended:
      emit(
        phase: "ended",
        handle: activeHandle,
        deltaMinutes: lastMinuteDelta,
        record: interactionRecord ?? record
      )
      cancelInteraction(emit: false)
    case .cancelled, .failed:
      emit(
        phase: "cancelled",
        handle: activeHandle,
        deltaMinutes: lastMinuteDelta,
        record: interactionRecord ?? record
      )
      cancelInteraction(emit: false)
    default:
      break
    }
  }

  private func emitAccessibilityAdjustment(handle: DayframeDurationDialHandle, direction: Int) {
    guard let record else { return }
    let interactionId = UUID().uuidString
    activeInteractionId = interactionId
    let delta = clamp(deltaMinutes: direction, handle: handle, record: record)
    emit(phase: "began", handle: handle, deltaMinutes: 0, record: record)
    fireHaptic(from: 0, to: delta)
    emit(phase: "changed", handle: handle, deltaMinutes: delta, record: record)
    emit(phase: "ended", handle: handle, deltaMinutes: delta, record: record)
    activeInteractionId = nil
  }

  private func emit(
    phase: String,
    handle: DayframeDurationDialHandle,
    deltaMinutes: Int,
    record: DayframeDurationDialRecord
  ) {
    guard let interactionId = activeInteractionId else { return }
    onInteraction([
      "deltaMinutes": deltaMinutes,
      "handle": handle.rawValue,
      "interactionId": interactionId,
      "phase": phase,
      "presentationId": record.presentationId
    ])
  }

  private func clamp(
    deltaMinutes: Int,
    handle: DayframeDurationDialHandle,
    record: DayframeDurationDialRecord
  ) -> Int {
    let minute = 60_000.0
    let minimumDuration = 1_000.0
    let maximumDuration = 86_400_000.0
    let effectiveEnd = record.mode == "running" ? record.nowMs : record.endMs
    if record.mode == "running" && handle != .start { return 0 }
    switch handle {
    case .start:
      let minimum = Int(ceil((effectiveEnd - maximumDuration - record.startMs) / minute))
      let maximum = Int(floor((effectiveEnd - minimumDuration - record.startMs) / minute))
      return min(maximum, max(minimum, deltaMinutes))
    case .end:
      let minimum = Int(ceil((record.startMs + minimumDuration - record.endMs) / minute))
      let maximum = Int(floor((record.startMs + maximumDuration - record.endMs) / minute))
      return min(maximum, max(minimum, deltaMinutes))
    case .range:
      return min(1_440, max(-1_440, deltaMinutes))
    }
  }

  private func fireHaptic(from previous: Int, to next: Int) {
    switch DayframeDurationDialCore.strongestHaptic(from: previous, to: next) {
    case 3:
      hourHaptic.impactOccurred()
      hourHaptic.prepare()
    case 2:
      fiveMinuteHaptic.impactOccurred()
      fiveMinuteHaptic.prepare()
    case 1:
      selectionHaptic.selectionChanged()
      selectionHaptic.prepare()
    default:
      break
    }
  }

  private func disableAncestorScrolling() {
    var ancestor = superview
    while let view = ancestor {
      if let scrollView = view as? UIScrollView {
        disabledAncestorScrollView = scrollView
        ancestorScrollWasEnabled = scrollView.isScrollEnabled
        scrollView.isScrollEnabled = false
        return
      }
      ancestor = view.superview
    }
  }

  private func cancelInteraction(emit: Bool) {
    if emit, let record, let activeHandle {
      self.emit(phase: "cancelled", handle: activeHandle, deltaMinutes: lastMinuteDelta, record: record)
    }
    disabledAncestorScrollView?.isScrollEnabled = ancestorScrollWasEnabled
    disabledAncestorScrollView = nil
    activeHandle = nil
    activeInteractionId = nil
    interactionRecord = nil
    accumulatedRadians = 0
    lastMinuteDelta = 0
  }

  private func nearestHandle(
    to point: CGPoint,
    record: DayframeDurationDialRecord
  ) -> DayframeDurationDialHandle? {
    let candidates: [DayframeDurationDialHandle] = record.mode == "running"
      ? [.start]
      : [.start, .end, .range]
    return candidates
      .map { handle in (handle, distance(point, handlePoint(handle, record: record))) }
      .filter { $0.1 <= 32 }
      .min { $0.1 < $1.1 }?
      .0
  }

  private func distance(_ lhs: CGPoint, _ rhs: CGPoint) -> CGFloat {
    hypot(lhs.x - rhs.x, lhs.y - rhs.y)
  }

  private func handlePoint(
    _ handle: DayframeDurationDialHandle,
    record: DayframeDurationDialRecord
  ) -> CGPoint {
    let centre = CGPoint(x: bounds.midX, y: bounds.midY)
    let baseRadius = min(bounds.width, bounds.height) * 0.34
    let radius: CGFloat = handle == .range ? baseRadius + 34 : baseRadius
    let angle: Double
    switch handle {
    case .start:
      angle = DayframeDurationDialCore.angle(timestampMilliseconds: record.startMs)
    case .end:
      angle = DayframeDurationDialCore.angle(
        timestampMilliseconds: record.mode == "running" ? record.nowMs : record.endMs
      )
    case .range:
      angle = DayframeDurationDialCore.angle(
        timestampMilliseconds: record.startMs + (record.endMs - record.startMs) / 2
      )
    }
    return CGPoint(
      x: centre.x + cos(angle) * radius,
      y: centre.y + sin(angle) * radius
    )
  }

  private func drawTicks(
    context: CGContext,
    centre: CGPoint,
    radius: CGFloat,
    record: DayframeDurationDialRecord
  ) {
    context.saveGState()
    context.setLineCap(.round)
    for minute in 0..<60 {
      let angle = CGFloat(Double(minute) / 60 * DayframeDurationDialCore.fullTurn - Double.pi / 2)
      let strong = minute % 5 == 0
      let inner = radius - (strong ? 10 : 5)
      let outer = radius + (strong ? 2 : 0)
      context.move(to: CGPoint(x: centre.x + cos(angle) * inner, y: centre.y + sin(angle) * inner))
      context.addLine(to: CGPoint(x: centre.x + cos(angle) * outer, y: centre.y + sin(angle) * outer))
      let tickColor = UIColor(dayframeHex: record.theme.textSecondary)
        .withAlphaComponent(strong ? 0.9 : 0.55)
      context.setStrokeColor(tickColor.cgColor)
      context.setLineWidth(strong ? 2 : 1)
      context.strokePath()
    }
    context.restoreGState()
  }

  private func drawArc(
    context: CGContext,
    centre: CGPoint,
    radius: CGFloat,
    record: DayframeDurationDialRecord
  ) {
    let start = DayframeDurationDialCore.angle(timestampMilliseconds: record.startMs)
    let effectiveEnd = record.mode == "running" ? record.nowMs : record.endMs
    let duration = max(0, effectiveEnd - record.startMs)
    let end = duration >= 3_600_000
      ? start + DayframeDurationDialCore.fullTurn
      : DayframeDurationDialCore.angle(timestampMilliseconds: effectiveEnd)
    context.saveGState()
    context.setStrokeColor(UIColor(dayframeHex: record.theme.accent).cgColor)
    context.setLineWidth(5)
    context.setLineCap(.round)
    context.addArc(
      center: centre,
      radius: radius,
      startAngle: CGFloat(start),
      endAngle: CGFloat(end < start ? end + DayframeDurationDialCore.fullTurn : end),
      clockwise: false
    )
    context.strokePath()
    context.restoreGState()
  }

  private func drawCentre(
    context: CGContext,
    centre: CGPoint,
    record: DayframeDurationDialRecord
  ) {
    let effectiveEnd = record.mode == "running" ? record.nowMs : record.endMs
    let text = DayframeDurationDialCore.formatDuration(milliseconds: effectiveEnd - record.startMs)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: UIFont.monospacedDigitSystemFont(ofSize: 24, weight: .semibold),
      .foregroundColor: UIColor(dayframeHex: record.theme.textPrimary)
    ]
    let size = text.size(withAttributes: attributes)
    text.draw(
      at: CGPoint(x: centre.x - size.width / 2, y: centre.y - size.height / 2),
      withAttributes: attributes
    )
  }

  private func drawHandle(
    _ handle: DayframeDurationDialHandle,
    record: DayframeDurationDialRecord
  ) {
    let point = handlePoint(handle, record: record)
    let size: CGFloat = handle == .range ? 13 : 34
    let rect = CGRect(x: point.x - size / 2, y: point.y - size / 2, width: size, height: size)
    let fill = handle == .range
      ? UIColor(dayframeHex: record.theme.accent)
      : UIColor(dayframeHex: handle == .end && record.mode == "running"
          ? record.theme.surfaceMuted
          : record.theme.accent)
    fill.setFill()
    UIBezierPath(ovalIn: rect).fill()
    guard handle != .range else { return }
    let symbolName = handle == .start ? "play.fill" : "stop.fill"
    let symbolColor = handle == .end && record.mode == "running"
      ? UIColor(dayframeHex: record.theme.textPrimary)
      : UIColor(dayframeHex: record.theme.onAccent)
    let symbol = UIImage(systemName: symbolName)?.withTintColor(
      symbolColor,
      renderingMode: .alwaysOriginal
    )
    symbol?.draw(in: rect.insetBy(dx: 10, dy: 10))
  }

  private func updateAccessibilityHandles() {
    guard let record else { return }
    let duration = max(0, (record.mode == "running" ? record.nowMs : record.endMs) - record.startMs)
    for (button, handle, label) in [
      (startButton, DayframeDurationDialHandle.start, "Adjust start time"),
      (endButton, DayframeDurationDialHandle.end, "Adjust end time"),
      (rangeButton, DayframeDurationDialHandle.range, "Move time window")
    ] {
      let point = handlePoint(handle, record: record)
      button.frame = CGRect(x: point.x - 22, y: point.y - 22, width: 44, height: 44)
      button.accessibilityLabel = label
      button.accessibilityValue = DayframeDurationDialCore.formatDuration(milliseconds: duration)
      button.isHidden = handle == .range && record.mode == "running"
      button.isEnabled = !(handle == .end && record.mode == "running")
      if handle == .end && record.mode == "running" {
        button.accessibilityHint = "The end follows the current time"
      } else {
        button.accessibilityHint = "Swipe up or down to adjust by one minute"
      }
    }
  }
}

private extension UIColor {
  convenience init(dayframeHex value: String) {
    let normalized = value.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var integer: UInt64 = 0
    Scanner(string: normalized).scanHexInt64(&integer)
    let red = CGFloat((integer >> 16) & 0xFF) / 255
    let green = CGFloat((integer >> 8) & 0xFF) / 255
    let blue = CGFloat(integer & 0xFF) / 255
    self.init(red: red, green: green, blue: blue, alpha: 1)
  }
}
