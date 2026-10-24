import ExpoModulesCore
import SwiftUI

final class DayframeCalendarExpoView: ExpoView {
  let onChangeDay = EventDispatcher()
  let onChangeWeek = EventDispatcher()
  let onOpenActiveTimer = EventDispatcher()
  let onOpenCompletedEntry = EventDispatcher()
  let onOpenReviewItem = EventDispatcher()
  let onRequestCreateEntry = EventDispatcher()
  let onRequestRefresh = EventDispatcher()
  let onSelectDay = EventDispatcher()
  let onChangeLayout = EventDispatcher()
  let onHeaderHeight = EventDispatcher()

  private let model = DayframeCalendarViewModel()
  private var hostingController: UIHostingController<DayframeCalendarRootView>?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true

    let actions = DayframeCalendarActions(
      changeDay: { [weak self] days in self?.onChangeDay(["days": days]) },
      changeWeek: { [weak self] weeks in self?.onChangeWeek(["weeks": weeks]) },
      open: { [weak self] target in self?.emitOpen(target) },
      requestCreateEntry: { [weak self] request in
        self?.onRequestCreateEntry([
          "dayKey": request.dayKey,
          "startMinute": request.startMinute
        ])
      },
      requestRefresh: { [weak self] in self?.onRequestRefresh([:]) },
      selectDay: { [weak self] dayKey in self?.onSelectDay(["dayKey": dayKey]) },
      changeLayout: { [weak self] layout in self?.onChangeLayout(["layout": layout]) },
      reportHeaderHeight: { [weak self] height in self?.onHeaderHeight(["height": height]) }
    )
    let controller = UIHostingController(
      rootView: DayframeCalendarRootView(model: model, actions: actions)
    )
    controller.view.backgroundColor = .clear
    controller.view.translatesAutoresizingMaskIntoConstraints = true
    hostingController = controller
    updateLabelTextScale()
    if #available(iOS 17.0, *) {
      registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: DayframeCalendarExpoView, _: UITraitCollection) in
        view.updateLabelTextScale()
      }
    }
  }

  // iOS 16 has no trait registration: the older callback carries Text Size changes there.
  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if #unavailable(iOS 17.0), previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
      updateLabelTextScale()
    }
  }

  /// Block labels follow Dynamic Type (location v4 C6); the one-line minimum height grows with them.
  private func updateLabelTextScale() {
    model.updateLabelTextScale(Double(UIFontMetrics(forTextStyle: .footnote).scaledValue(for: 1, compatibleWith: traitCollection)))
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
    updateLabelTextScale()
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

  func update(modelJSON: String) {
    guard let data = modelJSON.data(using: .utf8) else { return }
    do {
      let record = try JSONDecoder().decode(DayframeCalendarPresentationRecord.self, from: data)
      guard record.modelVersion == 4 else {
        model.reset()
        return
      }
      model.update(record)
      backgroundColor = UIColor(dayframeCSS: record.theme.background)
    } catch {
      model.reset()
      assertionFailure("Invalid Dayframe Calendar model: \(error)")
    }
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
