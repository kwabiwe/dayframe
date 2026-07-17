import ExpoModulesCore
import SwiftUI

final class DayframeCalendarExpoView: ExpoView {
  let onChangeDay = EventDispatcher()
  let onChangeWeek = EventDispatcher()
  let onOpenActiveTimer = EventDispatcher()
  let onOpenCompletedEntry = EventDispatcher()
  let onOpenReviewItem = EventDispatcher()
  let onRequestRefresh = EventDispatcher()
  let onSelectDay = EventDispatcher()

  private let model = DayframeCalendarViewModel()
  private var hostingController: UIHostingController<DayframeCalendarRootView>?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true

    let actions = DayframeCalendarActions(
      changeDay: { [weak self] days in self?.onChangeDay(["days": days]) },
      changeWeek: { [weak self] weeks in self?.onChangeWeek(["weeks": weeks]) },
      open: { [weak self] target in self?.emitOpen(target) },
      requestRefresh: { [weak self] in self?.onRequestRefresh([:]) },
      selectDay: { [weak self] dayKey in self?.onSelectDay(["dayKey": dayKey]) }
    )
    let controller = UIHostingController(
      rootView: DayframeCalendarRootView(model: model, actions: actions)
    )
    controller.view.backgroundColor = .clear
    controller.view.translatesAutoresizingMaskIntoConstraints = true
    hostingController = controller
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    attachHostingControllerIfPossible()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController?.view.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let hostingController else { return }

    if window == nil {
      if hostingController.parent != nil {
        hostingController.willMove(toParent: nil)
        hostingController.view.removeFromSuperview()
        hostingController.removeFromParent()
      }
      return
    }

    attachHostingControllerIfPossible()
  }

  func update(model record: DayframeCalendarPresentationRecord) {
    model.update(record)
    backgroundColor = UIColor(dayframeCSS: record.theme.background)
  }

  private func emitOpen(_ target: DayframeCalendarActionTarget) {
    switch target.kind {
    case .active:
      onOpenActiveTimer(["entryId": target.id])
    case .completed:
      onOpenCompletedEntry(["entryId": target.id])
    case .review:
      onOpenReviewItem(["reviewItemId": target.id])
    }
  }

  private func attachHostingControllerIfPossible() {
    guard
      let hostingController,
      hostingController.parent == nil,
      let parent = nearestViewController()
    else { return }

    parent.addChild(hostingController)
    addSubview(hostingController.view)
    hostingController.view.frame = bounds
    hostingController.didMove(toParent: parent)
  }

  private func nearestViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let controller = current as? UIViewController { return controller }
      responder = current.next
    }
    return nil
  }
}
