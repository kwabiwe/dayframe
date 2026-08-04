import SwiftUI
import UIKit

struct DayframeCalendarScrollResolver: UIViewRepresentable {
  @ObservedObject var model: DayframeCalendarViewModel
  let actions: DayframeCalendarActions
  let layout: DayframeCalendarTimelineLayout

  func makeCoordinator() -> Coordinator {
    Coordinator(model: model, actions: actions, layout: layout)
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
    context.coordinator.update(layout: layout)
    view.onResolve = { scrollView in
      context.coordinator.attach(to: scrollView)
    }
    view.resolveScrollView()
    context.coordinator.synchronize()
  }

  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    private struct LongPressCandidate {
      let dayKey: String
    }

    private weak var model: DayframeCalendarViewModel?
    private let actions: DayframeCalendarActions
    private weak var scrollView: UIScrollView?
    private let pinchGesture = UIPinchGestureRecognizer()
    private let horizontalPanGesture = UIPanGestureRecognizer()
    private let longPressGesture = UILongPressGestureRecognizer()
    private let refreshControl = UIRefreshControl()
    private let selectionHaptic = UISelectionFeedbackGenerator()
    private var layout: DayframeCalendarTimelineLayout
    private var longPressCandidate: LongPressCandidate?
    private var selectedDayKey = ""
    private var pinchStart: DayframeCalendarPinchStart?
    private var pendingContentOffsetY: Double?

    init(
      model: DayframeCalendarViewModel,
      actions: DayframeCalendarActions,
      layout: DayframeCalendarTimelineLayout
    ) {
      self.model = model
      self.actions = actions
      self.layout = layout
      super.init()

      pinchGesture.addTarget(self, action: #selector(handlePinch(_:)))
      pinchGesture.delegate = self
      pinchGesture.cancelsTouchesInView = false

      horizontalPanGesture.addTarget(self, action: #selector(handleHorizontalPan(_:)))
      horizontalPanGesture.delegate = self
      horizontalPanGesture.minimumNumberOfTouches = 1
      horizontalPanGesture.maximumNumberOfTouches = 1
      horizontalPanGesture.cancelsTouchesInView = false

      longPressGesture.addTarget(self, action: #selector(handleLongPress(_:)))
      longPressGesture.delegate = self
      longPressGesture.minimumPressDuration = DayframeCalendarConstants.longPressMinimumDuration
      longPressGesture.allowableMovement = DayframeCalendarConstants.longPressAllowableMovement
      longPressGesture.numberOfTouchesRequired = 1
      longPressGesture.cancelsTouchesInView = true

      refreshControl.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
    }

    func update(layout nextLayout: DayframeCalendarTimelineLayout) {
      guard layout != nextLayout else { return }
      layout = nextLayout
      cancelLongPressRecognition()
    }

    func attach(to nextScrollView: UIScrollView) {
      guard scrollView !== nextScrollView else {
        synchronize()
        return
      }

      if let previous = scrollView {
        previous.removeGestureRecognizer(pinchGesture)
        previous.removeGestureRecognizer(horizontalPanGesture)
        previous.removeGestureRecognizer(longPressGesture)
        if previous.refreshControl === refreshControl {
          previous.refreshControl = nil
        }
      }

      cancelLongPressRecognition()
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
      nextScrollView.addGestureRecognizer(longPressGesture)
      synchronize()
    }

    func synchronize() {
      guard let model, let scrollView else { return }
      let nextSelectedDayKey = model.presentation.selectedDayKey
      if selectedDayKey.isEmpty {
        selectedDayKey = nextSelectedDayKey
      } else if selectedDayKey != nextSelectedDayKey {
        selectedDayKey = nextSelectedDayKey
        cancelLongPressRecognition()
      }
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

    @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
      switch gesture.state {
      case .began:
        guard
          let model,
          let scrollView,
          let candidate = longPressCandidate,
          candidate.dayKey == model.presentation.selectedDayKey,
          gesture.numberOfTouches == 1,
          !scrollView.isDragging,
          !scrollView.isDecelerating,
          !refreshControl.isRefreshing,
          !model.presentation.refreshing,
          scrollView.contentOffset.y >= 0,
          pinchGesture.state != .began,
          pinchGesture.state != .changed,
          horizontalPanGesture.state != .began,
          horizontalPanGesture.state != .changed,
          let request = createRequest(for: gesture, model: model, scrollView: scrollView)
        else {
          longPressCandidate = nil
          return
        }

        longPressCandidate = nil
        selectionHaptic.selectionChanged()
        actions.requestCreateEntry(request)
      case .ended, .cancelled, .failed:
        longPressCandidate = nil
      default:
        break
      }
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
      if gestureRecognizer === horizontalPanGesture {
        guard let view = gestureRecognizer.view else { return false }
        let velocity = horizontalPanGesture.velocity(in: view)
        return abs(velocity.x) > abs(velocity.y) * 0.72
      }

      if gestureRecognizer === longPressGesture {
        guard
          let model,
          let scrollView,
          longPressGesture.numberOfTouches == 1,
          !scrollView.isDragging,
          !scrollView.isDecelerating,
          !refreshControl.isRefreshing,
          !model.presentation.refreshing,
          scrollView.contentOffset.y >= 0,
          pinchGesture.state != .began,
          pinchGesture.state != .changed,
          horizontalPanGesture.state != .began,
          horizontalPanGesture.state != .changed,
          let request = createRequest(for: longPressGesture, model: model, scrollView: scrollView)
        else {
          longPressCandidate = nil
          return false
        }
        longPressCandidate = LongPressCandidate(dayKey: request.dayKey)
        selectionHaptic.prepare()
      }

      return true
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldReceive touch: UITouch
    ) -> Bool {
      guard gestureRecognizer === longPressGesture else { return true }
      if longPressGesture.numberOfTouches >= 1 {
        cancelLongPressRecognition()
        return false
      }
      return true
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer,
      shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
      if gestureRecognizer === longPressGesture || otherGestureRecognizer === longPressGesture {
        return false
      }
      return gestureRecognizer === pinchGesture || otherGestureRecognizer === pinchGesture
    }

    private func createRequest(
      for gesture: UIGestureRecognizer,
      model: DayframeCalendarViewModel,
      scrollView: UIScrollView
    ) -> DayframeCalendarCreateRequest? {
      let presentation = model.presentation
      let dayKey = presentation.selectedDayKey.trimmingCharacters(in: .whitespacesAndNewlines)
      let hourHeight = Double(model.hourHeight)
      guard
        !dayKey.isEmpty,
        presentation.dayEndMs > presentation.dayStartMs,
        layout.availableWidth.isFinite,
        layout.hourLabelWidth.isFinite
      else {
        return nil
      }

      let location = gesture.location(in: scrollView)
      let point = DayframeCalendarPoint(x: Double(location.x), y: Double(location.y))
      guard DayframeCalendarLongPressMath.pointIsInTimeline(
        point: point,
        availableWidth: layout.availableWidth,
        hourLabelWidth: layout.hourLabelWidth,
        hourHeight: hourHeight
      ), let slot = DayframeCalendarLongPressMath.slot(
        contentY: point.y,
        hourHeight: hourHeight
      ) else {
        return nil
      }

      let hitFrames = presentation.entries.compactMap { entry -> DayframeCalendarHitFrame? in
        guard let block = DayframeCalendarBlockMath.metrics(
          startedAtMs: entry.startedAtMs,
          stoppedAtMs: entry.stoppedAtMs,
          nowMs: presentation.nowMs,
          dayStartMs: presentation.dayStartMs,
          dayEndMs: presentation.dayEndMs,
          hourHeight: hourHeight
        ) else {
          return nil
        }
        return DayframeCalendarEntryGeometryMath.metrics(
          availableWidth: layout.availableWidth,
          hourLabelWidth: layout.hourLabelWidth,
          semanticTop: block.top,
          semanticHeight: block.height,
          offsetFraction: entry.offsetFraction,
          widthFraction: entry.widthFraction,
          overlapCount: entry.overlapCount,
          textDensity: entry.textDensity
        )?.hitFrame
      }
      guard !DayframeCalendarLongPressMath.pointHitsEntry(point: point, frames: hitFrames) else {
        return nil
      }

      return DayframeCalendarCreateRequest(dayKey: dayKey, startMinute: slot.startMinute)
    }

    private func cancelLongPressRecognition() {
      longPressCandidate = nil
      longPressGesture.isEnabled = false
      longPressGesture.isEnabled = true
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
