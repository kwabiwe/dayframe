import ExpoModulesCore
import UIKit

struct TodayDigitStripModel: Record {
  @Field var digit: Int = 0
  @Field var cellHeight: Double = 0
  @Field var reduceMotion: Bool = false
}

final class DayframeTodayDigitStrip: ExpoView {
  private static let rollKey = "dayframe.digitRoll"
  private var placed: TodayDigitStripModel?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    NotificationCenter.default.addObserver(
      self, selector: #selector(cancelRoll), name: UIApplication.willResignActiveNotification, object: nil
    )
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { cancelRoll() }
  }

  override func prepareForRecycle() {
    super.prepareForRecycle()
    placed = nil
    cancelRoll()
    place(at: 0)
  }

  func update(_ model: TodayDigitStripModel) {
    let previous = placed
    placed = model
    guard let previous else {
      place(at: target(model))
      return
    }

    let position = target(model)
    if model.reduceMotion || previous.cellHeight != model.cellHeight || window == nil ||
      UIApplication.shared.applicationState != .active {
      cancelRoll()
      place(at: position)
      return
    }
    guard previous.digit != model.digit else { return }

    let current = layer.presentation()?.transform.m42 ?? layer.transform.m42
    cancelRoll()
    place(at: position)

    let roll = CASpringAnimation(keyPath: "transform.translation.y")
    roll.mass = 1
    roll.stiffness = 260
    roll.damping = 26
    roll.initialVelocity = 0
    roll.fromValue = current
    roll.toValue = position
    roll.duration = roll.settlingDuration
    layer.add(roll, forKey: Self.rollKey)
  }

  private func target(_ model: TodayDigitStripModel) -> CGFloat {
    CGFloat(-Double(model.digit) * model.cellHeight)
  }

  private func place(at position: CGFloat) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.transform = CATransform3DMakeTranslation(0, position, 0)
    CATransaction.commit()
  }

  @objc private func cancelRoll() {
    layer.removeAnimation(forKey: Self.rollKey)
  }
}
