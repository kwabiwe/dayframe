import SwiftUI
import UIKit

struct DayframeCalendarScrollResolver: UIViewRepresentable {
  @ObservedObject var model: DayframeCalendarViewModel
  let actions: DayframeCalendarActions

  func makeCoordinator() -> Coordinator {
    Coordinator(model: model, actions: actions)
  }

  func makeUIView(context: Context) -> DayframeCalendarResolverView {
    let view = DayframeCalendarResolverView()
    view.isHidden = true
    view.onResolve = { scrollView in
      context.coordinator.attach(to: scrollView)
    }
    return view
  }

  func updateUIView(_ view: DayframeCalendarResolverView, context: Context) {
    view.onResolve = { scrollView in
      context.coordinator.attach(to: scrollView)
    }
    view.resolveScrollView()
    context.coordinator.synchronize()
  }

  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    private weak var model: DayframeCalendarViewModel?
    private let actions: DayframeCalendarActions
    private weak var scrollView: UIScrollView?
    private let pinchGesture = UIPinchGestureRecognizer()
    private let horizontalPanGesture = UIPanGestureRecognizer()
    private let refreshControl = UIRefreshControl()
    private var pinchStart: DayframeCalendarPinchStart?
    private var pendingContentOffsetY: Double?

    init(model: DayframeCalendarViewModel, actions: DayframeCalendarActions) {
      self.model = model
      self.actions = actions
      super.init()

      pinchGesture.addTarget(self, action: #selector(handlePinch(_:)))
      pinchGesture.delegate = self
      pinchGesture.cancelsTouchesInView = false

      horizontalPanGesture.addTarget(self, action: #selector(handleHorizontalPan(_:)))
      horizontalPanGesture.delegate = self
      horizontalPanGesture.minimumNumberOfTouches = 1
      horizontalPanGesture.maximumNumberOfTouches = 1
      horizontalPanGesture.cancelsTouchesInView = false

      refreshControl.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
    }

    func attach(to nextScrollView: UIScrollView) {
      guard scrollView !== nextScrollView else {
        synchronize()
        return
      }

      if let previous = scrollView {
        previous.removeGestureRecognizer(pinchGesture)
        previous.removeGestureRecognizer(horizontalPanGesture)
        if previous.refreshControl === refreshControl {
          previous.refreshControl = nil
        }
      }

      scrollView = nextScrollView
      nextScrollView.alwaysBounceVertical = true
      nextScrollView.canCancelContentTouches = true
      nextScrollView.contentInsetAdjustmentBehavior = .never
      nextScrollView.decelerationRate = .normal
      nextScrollView.delaysContentTouches = false
      nextScrollView.isDirectionalLockEnabled = true
      nextScrollView.panGestureRecognizer.maximumNumberOfTouches = 1
      nextScrollView.refreshControl = refreshControl
      nextScrollView.addGestureRecognizer(pinchGesture)
      nextScrollView.addGestureRecognizer(horizontalPanGesture)
      synchronize()
    }

    func synchronize() {
      guard let model, let scrollView else { return }
      refreshControl.tintColor = UIColor(dayframeCSS: model.presentation.theme.accent)
      if model.presentation.refreshing {
        if !refreshControl.isRefreshing {
          refreshControl.beginRefreshing()
        }
      } else if refreshControl.isRefreshing {
        refreshControl.endRefreshing()
      }

      if let pendingContentOffsetY {
        let clamped = DayframeCalendarZoomMath.clampContentOffset(
          pendingContentOffsetY,
          hourHeight: Double(model.hourHeight),
          viewportHeight: Double(scrollView.bounds.height)
        )
        scrollView.setContentOffset(
          CGPoint(x: scrollView.contentOffset.x, y: CGFloat(clamped)),
          animated: false
        )
        self.pendingContentOffsetY = nil
      } else if pinchStart == nil {
        let clamped = DayframeCalendarZoomMath.clampContentOffset(
          Double(scrollView.contentOffset.y),
          hourHeight: Double(model.hourHeight),
          viewportHeight: Double(scrollView.bounds.height)
        )
        if abs(Double(scrollView.contentOffset.y) - clamped) > 0.5 {
          scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: CGFloat(clamped)), animated: false)
        }
      }
    }

    @objc private func handleRefresh() {
      actions.requestRefresh()
    }

    @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
      guard let model, let scrollView else { return }
      let midpointY = viewportMidpointY(for: gesture, in: scrollView)

      switch gesture.state {
      case .began:
        pinchStart = DayframeCalendarPinchStart(
          contentOffsetY: Double(scrollView.contentOffset.y),
          hourHeight: Double(model.hourHeight),
          midpointY: midpointY
        )
      case .changed:
        guard let pinchStart else { return }
        let next = DayframeCalendarZoomMath.update(
          start: pinchStart,
          absoluteScale: Double(gesture.scale),
          currentMidpointY: midpointY,
          viewportHeight: Double(scrollView.bounds.height)
        )
        model.updateHourHeight(next.hourHeight)
        pendingContentOffsetY = next.contentOffsetY
        scrollView.setContentOffset(
          CGPoint(x: scrollView.contentOffset.x, y: CGFloat(next.contentOffsetY)),
          animated: false
        )
      case .ended, .cancelled, .failed:
        // The changed-state geometry is final. There is intentionally no release normalization.
        pinchStart = nil
        synchronize()
      default:
        break
      }
    }

    @objc private func handleHorizontalPan(_ gesture: UIPanGestureRecognizer) {
      guard gesture.state == .ended, let view = gesture.view else { return }
      let translation = gesture.translation(in: view)
      let velocity = gesture.velocity(in: view)
      let committed = abs(translation.x) >= 22 || abs(velocity.x) >= 260
      guard committed else { return }
      actions.changeDay(translation.x < 0 ? 1 : -1)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
      guard gestureRecognizer === horizontalPanGesture, let view = gestureRecognizer.view else {
        return true
      }
      let velocity = horizontalPanGesture.velocity(in: view)
      return abs(velocity.x) > abs(velocity.y) * 0.72
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
      gestureRecognizer === pinchGesture || otherGestureRecognizer === pinchGesture
    }

    private func viewportMidpointY(
      for gesture: UIGestureRecognizer,
      in scrollView: UIScrollView
    ) -> Double {
      Double(gesture.location(in: scrollView).y - scrollView.bounds.minY)
    }
  }
}

final class DayframeCalendarResolverView: UIView {
  var onResolve: ((UIScrollView) -> Void)?

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    resolveScrollView()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    resolveScrollView()
  }

  func resolveScrollView() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      var candidate = self.superview
      while let current = candidate {
        if let scrollView = current as? UIScrollView {
          self.onResolve?(scrollView)
          return
        }
        candidate = current.superview
      }
    }
  }
}
