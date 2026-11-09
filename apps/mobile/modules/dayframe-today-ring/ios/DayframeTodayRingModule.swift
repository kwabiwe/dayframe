import ExpoModulesCore
import UIKit

public final class DayframeTodayRingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeTodayRing")

    View(DayframeTodayRingView.self) {
      Prop("mode") { (view, mode: String) in view.setMode(mode) }
      Prop("strokeColor") { (view, color: UIColor) in view.ring.borderColor = color.cgColor }
      Prop("cornerRadius") { (view, radius: Double) in view.ring.cornerRadius = CGFloat(radius) }
    }

    View(DayframeTodayDigitStrip.self) {
      Prop("model") { (view, model: TodayDigitStripModel) in view.update(model) }
    }
  }
}

final class DayframeTodayRingView: ExpoView {
  private enum Mode: String {
    case live, resting, hidden
  }

  private static let restingOpacity: Float = 0.32
  private static let minimumOpacity: Float = 0.14
  private static let maximumOpacity: Float = 0.5
  private static let halfCycle: CFTimeInterval = 1.2
  private static let fadeDuration: CFTimeInterval = 0.14
  private static let ease = CAMediaTimingFunction(controlPoints: 0.37, 0, 0.63, 1)

  let ring = CALayer()
  private var requestedMode = Mode.resting
  private var renderedMode: Mode?
  private var appActive = UIApplication.shared.applicationState == .active

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
    ring.actions = ["borderColor": NSNull(), "cornerRadius": NSNull()]
    ring.borderWidth = 2
    ring.masksToBounds = true
    ring.opacity = Self.restingOpacity
    layer.addSublayer(ring)
    let notifications = NotificationCenter.default
    notifications.addObserver(self, selector: #selector(resignActive), name: UIApplication.willResignActiveNotification, object: nil)
    notifications.addObserver(self, selector: #selector(becomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    ring.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateOpacity()
  }

  func setMode(_ value: String) {
    guard let mode = Mode(rawValue: value) else { return }
    requestedMode = mode
    updateOpacity()
  }

  @objc private func resignActive() {
    appActive = false
    updateOpacity()
  }

  @objc private func becomeActive() {
    appActive = true
    updateOpacity()
  }

  private func updateOpacity() {
    guard window != nil || renderedMode != nil else { return }
    let canAnimate = appActive && window != nil
    let mode = requestedMode == .live && !canAnimate ? .resting : requestedMode
    if !canAnimate && mode == .hidden {
      ring.removeAllAnimations()
    }
    guard renderedMode != mode else { return }
    renderedMode = mode
    let current = ring.presentation()?.opacity ?? ring.opacity
    ring.removeAllAnimations()

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    switch mode {
    case .resting:
      ring.opacity = Self.restingOpacity
    case .hidden:
      ring.opacity = 0
      if canAnimate {
        let fade = opacityAnimation(from: current, to: 0, duration: Self.fadeDuration)
        fade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        ring.add(fade, forKey: "fade")
      }
    case .live:
      ring.opacity = Self.maximumOpacity
      let rise = opacityAnimation(from: current, to: Self.maximumOpacity, duration: Self.halfCycle)
      rise.timingFunction = Self.ease
      ring.add(rise, forKey: "rise")

      let pulse = CAKeyframeAnimation(keyPath: "opacity")
      pulse.values = [Self.maximumOpacity, Self.minimumOpacity, Self.maximumOpacity]
      pulse.duration = Self.halfCycle * 2
      pulse.timingFunctions = [Self.ease, Self.ease]
      pulse.beginTime = ring.convertTime(CACurrentMediaTime(), from: nil) + Self.halfCycle
      pulse.repeatCount = .infinity
      ring.add(pulse, forKey: "pulse")
    }
    CATransaction.commit()
  }

  private func opacityAnimation(from: Float, to: Float, duration: CFTimeInterval) -> CABasicAnimation {
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = from
    animation.toValue = to
    animation.duration = duration
    return animation
  }
}
