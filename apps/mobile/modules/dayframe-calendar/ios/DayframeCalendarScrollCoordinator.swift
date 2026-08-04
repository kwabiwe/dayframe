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
    view.onDetach = {
      context.coordinator.detach()
    }
    return view
  }

  func updateUIView(_ view: DayframeCalendarResolverView, context: Context) {
    context.coordinator.update(layout: layout)
    view.onResolve = { scrollView in
      context.coordinator.attach(to: scrollView)
    }
    view.onDetach = {
      context.coordinator.detach()
    }
    view.resolveScrollView()
    context.coordinator.synchronize()
  }

  static func dismantleUIView(
    _ view: DayframeCalendarResolverView,
    coordinator: Coordinator
  ) {
    view.onResolve = nil
    view.onDetach = nil
    coordinator.detach()
  }

  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    private struct LongPressCandidate {
      let dayKey: String
    }

    private final class DisplayLinkProxy: NSObject {
      weak var owner: Coordinator?

      @objc func tick(_ displayLink: CADisplayLink) {
        owner?.handleEdgeAutoscrollFrame(displayLink)
      }
    }

    private weak var model: DayframeCalendarViewModel?
    private let actions: DayframeCalendarActions
    private weak var scrollView: UIScrollView?
    private let pinchGesture = UIPinchGestureRecognizer()
    private let horizontalPanGesture = UIPanGestureRecognizer()
    private let longPressGesture = UILongPressGestureRecognizer()
    private let refreshControl = UIRefreshControl()
    private let selectionHaptic = UISelectionFeedbackGenerator()
    private let displayLinkProxy = DisplayLinkProxy()
    private var layout: DayframeCalendarTimelineLayout
    private var longPressCandidate: LongPressCandidate?
    private var creationDragState = DayframeCalendarCreationDragState()
    private var creationPreviewSessionToken: UInt64?
    private var creationGestureLockActive = false
    private var scrollPanWasEnabled = true
    private var pinchWasEnabled = true
    private var horizontalPanWasEnabled = true
    private var edgeAutoscrollDisplayLink: CADisplayLink?
    private var edgeAutoscrollVelocity = 0.0
    private var edgeAutoscrollLastTimestamp: CFTimeInterval?
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
      displayLinkProxy.owner = self

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
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(handleApplicationWillResignActive),
        name: UIApplication.willResignActiveNotification,
        object: nil
      )
    }

    deinit {
      NotificationCenter.default.removeObserver(self)
      edgeAutoscrollDisplayLink?.invalidate()
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
        cancelLongPressRecognition()
        previous.removeGestureRecognizer(pinchGesture)
        previous.removeGestureRecognizer(horizontalPanGesture)
        previous.removeGestureRecognizer(longPressGesture)
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
      nextScrollView.addGestureRecognizer(longPressGesture)
      synchronize()
    }

    func detach() {
      guard let scrollView else {
        cancelCreationInteraction()
        return
      }
      cancelLongPressRecognition()
      scrollView.removeGestureRecognizer(pinchGesture)
      scrollView.removeGestureRecognizer(horizontalPanGesture)
      scrollView.removeGestureRecognizer(longPressGesture)
      if scrollView.refreshControl === refreshControl {
        scrollView.refreshControl = nil
      }
      self.scrollView = nil
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
      if
        !creationContextIsValid(model: model),
        creationDragState.session != nil || longPressCandidate != nil
      {
        cancelLongPressRecognition()
      }
      if let token = creationPreviewSessionToken,
         model.creationPreview?.sessionToken != token {
        cancelLongPressRecognition()
      }
      if model.presentation.refreshing,
         creationDragState.session != nil || longPressCandidate != nil {
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
      cancelLongPressRecognition()
      actions.requestRefresh()
    }

    @objc private func handleApplicationWillResignActive() {
      cancelLongPressRecognition()
    }

    @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
      guard creationDragState.session == nil, let model, let scrollView else { return }
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
      guard creationDragState.session == nil else { return }
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
          cancelCreationInteraction()
          return
        }

        longPressCandidate = nil
        let contentY = Double(gesture.location(in: scrollView).y)
        let transition = DayframeCalendarCreationDragReducer.reduce(
          state: creationDragState,
          event: .began(
            dayKey: request.dayKey,
            contentY: contentY,
            hourHeight: Double(model.hourHeight)
          )
        )
        guard
          transition.request == nil,
          let previewStartMinute = transition.previewStartMinute,
          transition.state.session != nil
        else {
          cancelCreationInteraction()
          return
        }
        creationDragState = transition.state
        creationPreviewSessionToken = model.beginCreationPreview(
          dayKey: request.dayKey,
          startMinute: previewStartMinute
        )
        setCreationGestureLock(true)
        if transition.shouldTriggerHaptic {
          selectionHaptic.selectionChanged()
          selectionHaptic.prepare()
        }
        updateEdgeAutoscrollIntent(for: gesture, in: scrollView)

      case .changed:
        guard
          let model,
          let scrollView,
          gesture.numberOfTouches == 1,
          let session = creationDragState.session,
          session.dayKey == model.presentation.selectedDayKey,
          creationContextIsValid(model: model)
        else {
          cancelLongPressRecognition()
          return
        }
        updateCreationDrag(
          contentY: Double(gesture.location(in: scrollView).y),
          model: model
        )
        updateEdgeAutoscrollIntent(for: gesture, in: scrollView)

      case .ended:
        guard
          let model,
          let scrollView,
          let session = creationDragState.session,
          session.dayKey == model.presentation.selectedDayKey,
          creationContextIsValid(model: model)
        else {
          cancelCreationInteraction()
          return
        }
        updateCreationDrag(
          contentY: Double(gesture.location(in: scrollView).y),
          model: model
        )
        completeCreationInteraction()

      case .cancelled, .failed:
        cancelCreationInteraction()
      default:
        break
      }
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
      if gestureRecognizer === horizontalPanGesture {
        guard creationDragState.session == nil else { return false }
        guard let view = gestureRecognizer.view else { return false }
        let velocity = horizontalPanGesture.velocity(in: view)
        return abs(velocity.x) > abs(velocity.y) * 0.72
      }

      if gestureRecognizer === pinchGesture {
        return creationDragState.session == nil
      }

      if gestureRecognizer === longPressGesture {
        guard
          let model,
          let scrollView,
          creationDragState.session == nil,
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
      cancelCreationInteraction()
      longPressGesture.isEnabled = false
      longPressGesture.isEnabled = true
    }

    private func updateCreationDrag(
      contentY: Double,
      model: DayframeCalendarViewModel
    ) {
      let transition = DayframeCalendarCreationDragReducer.reduce(
        state: creationDragState,
        event: .changed(contentY: contentY, hourHeight: Double(model.hourHeight))
      )
      creationDragState = transition.state
      if
        let previewStartMinute = transition.previewStartMinute,
        let token = creationPreviewSessionToken
      {
        model.updateCreationPreview(
          sessionToken: token,
          startMinute: previewStartMinute
        )
      }
      if transition.shouldTriggerHaptic {
        selectionHaptic.selectionChanged()
        selectionHaptic.prepare()
      }
    }

    private func completeCreationInteraction() {
      stopEdgeAutoscroll()
      let transition = DayframeCalendarCreationDragReducer.reduce(
        state: creationDragState,
        event: .ended
      )
      creationDragState = transition.state
      if let token = creationPreviewSessionToken {
        model?.clearCreationPreview(sessionToken: token)
      }
      creationPreviewSessionToken = nil
      longPressCandidate = nil
      setCreationGestureLock(false)
      if let request = transition.request {
        actions.requestCreateEntry(request)
      }
    }

    private func cancelCreationInteraction() {
      stopEdgeAutoscroll()
      let transition = DayframeCalendarCreationDragReducer.reduce(
        state: creationDragState,
        event: .cancelled
      )
      creationDragState = transition.state
      if let token = creationPreviewSessionToken {
        model?.clearCreationPreview(sessionToken: token)
      }
      creationPreviewSessionToken = nil
      longPressCandidate = nil
      setCreationGestureLock(false)
    }

    private func setCreationGestureLock(_ locked: Bool) {
      guard creationGestureLockActive != locked else { return }
      creationGestureLockActive = locked
      guard let scrollView else { return }
      if locked {
        scrollPanWasEnabled = scrollView.panGestureRecognizer.isEnabled
        pinchWasEnabled = pinchGesture.isEnabled
        horizontalPanWasEnabled = horizontalPanGesture.isEnabled
        scrollView.panGestureRecognizer.isEnabled = false
        pinchGesture.isEnabled = false
        horizontalPanGesture.isEnabled = false
      } else {
        scrollView.panGestureRecognizer.isEnabled = scrollPanWasEnabled
        pinchGesture.isEnabled = pinchWasEnabled
        horizontalPanGesture.isEnabled = horizontalPanWasEnabled
      }
    }

    private func creationContextIsValid(model: DayframeCalendarViewModel) -> Bool {
      let presentation = model.presentation
      return !presentation.selectedDayKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && presentation.dayEndMs.isFinite
        && presentation.dayStartMs.isFinite
        && presentation.dayEndMs > presentation.dayStartMs
        && layout.availableWidth.isFinite
        && layout.hourLabelWidth.isFinite
        && layout.availableWidth > layout.hourLabelWidth
        && layout.hourLabelWidth >= 0
        && model.hourHeight.isFinite
        && model.hourHeight > 0
    }

    private func updateEdgeAutoscrollIntent(
      for gesture: UILongPressGestureRecognizer,
      in scrollView: UIScrollView
    ) {
      let viewportY = Double(gesture.location(in: scrollView).y - scrollView.bounds.minY)
      guard
        let velocity = DayframeCalendarEdgeAutoscrollMath.velocity(
          viewportY: viewportY,
          viewportHeight: Double(scrollView.bounds.height)
        ),
        velocity != 0,
        creationDragState.session != nil
      else {
        stopEdgeAutoscroll()
        return
      }
      edgeAutoscrollVelocity = velocity
      guard edgeAutoscrollDisplayLink == nil else { return }
      edgeAutoscrollLastTimestamp = nil
      let displayLink = CADisplayLink(target: displayLinkProxy, selector: #selector(DisplayLinkProxy.tick(_:)))
      displayLink.preferredFramesPerSecond = 60
      displayLink.add(to: .main, forMode: .common)
      edgeAutoscrollDisplayLink = displayLink
    }

    private func stopEdgeAutoscroll() {
      edgeAutoscrollDisplayLink?.invalidate()
      edgeAutoscrollDisplayLink = nil
      edgeAutoscrollVelocity = 0
      edgeAutoscrollLastTimestamp = nil
    }

    fileprivate func handleEdgeAutoscrollFrame(_ displayLink: CADisplayLink) {
      guard
        let model,
        let scrollView,
        creationDragState.session != nil,
        creationContextIsValid(model: model),
        longPressGesture.state == .began || longPressGesture.state == .changed
      else {
        cancelLongPressRecognition()
        return
      }
      let viewportY = Double(longPressGesture.location(in: scrollView).y - scrollView.bounds.minY)
      guard
        let velocity = DayframeCalendarEdgeAutoscrollMath.velocity(
          viewportY: viewportY,
          viewportHeight: Double(scrollView.bounds.height)
        ),
        velocity != 0
      else {
        stopEdgeAutoscroll()
        return
      }
      edgeAutoscrollVelocity = velocity
      guard let previousTimestamp = edgeAutoscrollLastTimestamp else {
        edgeAutoscrollLastTimestamp = displayLink.timestamp
        return
      }
      edgeAutoscrollLastTimestamp = displayLink.timestamp
      let deltaTime = min(1.0 / 15.0, max(0, displayLink.timestamp - previousTimestamp))
      guard let nextOffset = DayframeCalendarEdgeAutoscrollMath.nextContentOffset(
        currentOffset: Double(scrollView.contentOffset.y),
        velocity: edgeAutoscrollVelocity,
        deltaTime: deltaTime,
        hourHeight: Double(model.hourHeight),
        viewportHeight: Double(scrollView.bounds.height)
      ) else {
        cancelLongPressRecognition()
        return
      }
      guard abs(nextOffset - Double(scrollView.contentOffset.y)) > 0.001 else {
        stopEdgeAutoscroll()
        return
      }
      scrollView.setContentOffset(
        CGPoint(x: scrollView.contentOffset.x, y: CGFloat(nextOffset)),
        animated: false
      )
      updateCreationDrag(
        contentY: Double(longPressGesture.location(in: scrollView).y),
        model: model
      )
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
  var onDetach: (() -> Void)?

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    resolveScrollView()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      onDetach?()
    } else {
      resolveScrollView()
    }
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
