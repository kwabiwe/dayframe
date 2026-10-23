import Foundation

public enum DayframeCalendarConstants {
  public static let defaultHourHeight = 72.0
  public static let minimumHourHeight = 48.0
  public static let maximumHourHeight = 128.0
  public static let minutesPerDay = 24.0 * 60.0
  public static let minimumVisualBlockHeight = 1.0
  public static let blockCornerRadius = 10.0
  public static let blockVisualGap = 1.0
  // Calendar titles at every zoom (location v4 C6). Mirrors CALENDAR_BLOCK_LABEL in
  // packages/shared/src/calendarBlockLayout.ts; nativeCalendar.contract.test.ts keeps them equal.
  /// Every block is drawn at least one label line tall: 15 pt at the default text size.
  public static let labelLineMinimumHeight = 15.0
  /// The label (and so the minimum height) grows with Dynamic Type up to this scale.
  public static let maximumLabelTextScale = 1.3
  /// From this drawn height a block shows a detail line under its title.
  public static let twoLineMinimumHeight = 34.0
  /// From this drawn height a trip block shows its leg strip (legs arrive in a later step).
  public static let legStripMinimumHeight = 44.0
  /// A column narrower than this shows the activity icon only.
  public static let iconOnlyMaximumWidth = 34.0
  /// In a column narrower than this the length takes at most half the line, scaled to fit whole.
  public static let compactLengthMaximumWidth = 72.0
  /// From this drawn height a block also lists its place and tags under the detail line.
  public static let extraLinesMinimumHeight = 58.0
  /// Below this drawn height the title uses the smaller label size.
  public static let compactTextMaximumHeight = 22.0
  /// Drawn edges this close count as touching, not colliding.
  public static let columnTouchTolerance = 0.5
  /// The minimum an older JS bundle's model was laid out for (no `columnGroup`): such blocks keep it,
  /// so React's fractions still separate what is drawn.
  public static let legacyMinimumBlockHeight = 4.0
  public static let longPressMinimumDuration = 0.50
  public static let longPressAllowableMovement = 11.0
  public static let longPressSnapMinutes = 15
  public static let creationPreviewDurationMinutes = 30
  public static let edgeAutoscrollActivationInset = 52.0
  public static let edgeAutoscrollMaximumSpeed = 420.0
  /// A day with a named pattern's bracket (location v3 PR 14b) moves its blocks right by this, so
  /// the bracket and its name sit in the gutter beside them and never under one.
  public static let bracketRailWidth = 12.0
  public static let bracketLabelMinimumHeight = 28.0
}

public struct DayframeCalendarHorizontalMetrics: Equatable {
  public let offset: Double
  public let width: Double
  public let hitHeight: Double
  public let showMeta: Bool
  public let showTitle: Bool

  public init(offset: Double, width: Double, hitHeight: Double, showMeta: Bool, showTitle: Bool) {
    self.offset = offset
    self.width = width
    self.hitHeight = hitHeight
    self.showMeta = showMeta
    self.showTitle = showTitle
  }
}

public enum DayframeCalendarHorizontalMath {
  public static func metrics(
    availableWidth: Double,
    offsetFraction: Double,
    widthFraction: Double,
    semanticHeight: Double,
    overlapCount: Int,
    textDensity: String
  ) -> DayframeCalendarHorizontalMetrics {
    let safeAvailableWidth = max(0, availableWidth.isFinite ? availableWidth : 0)
    let safeOffsetFraction = min(1, max(0, offsetFraction.isFinite ? offsetFraction : 0))
    let safeWidthFraction = min(
      1 - safeOffsetFraction,
      max(0, widthFraction.isFinite ? widthFraction : 1)
    )
    let width = safeAvailableWidth * safeWidthFraction
    let safeSemanticHeight = max(0, semanticHeight.isFinite ? semanticHeight : 0)
    // Every column keeps its title (location v4 C6); one under 34 pt wide shows the icon only.
    let wordsFit = width >= DayframeCalendarConstants.iconOnlyMaximumWidth
    return DayframeCalendarHorizontalMetrics(
      offset: safeAvailableWidth * safeOffsetFraction,
      width: width,
      hitHeight: overlapCount > 0 ? safeSemanticHeight : max(44, safeSemanticHeight),
      showMeta: wordsFit,
      showTitle: wordsFit
    )
  }
}

public struct DayframeCalendarVerticalMetrics: Equatable {
  public let hitHeight: Double
  public let hitCenterY: Double
  public let visualOffsetWithinHitTarget: Double

  public init(
    hitHeight: Double,
    hitCenterY: Double,
    visualOffsetWithinHitTarget: Double
  ) {
    self.hitHeight = hitHeight
    self.hitCenterY = hitCenterY
    self.visualOffsetWithinHitTarget = visualOffsetWithinHitTarget
  }
}

public enum DayframeCalendarVerticalMath {
  /// The hit target is centred on the block, but kept inside the timeline (0…timelineHeight) so a
  /// block at midnight still offers its whole target; the block itself is drawn at its real place.
  public static func metrics(
    semanticTop: Double,
    semanticHeight: Double,
    hitHeight: Double,
    timelineHeight: Double = .infinity
  ) -> DayframeCalendarVerticalMetrics {
    let safeSemanticTop = semanticTop.isFinite ? semanticTop : 0
    let safeSemanticHeight = max(0, semanticHeight.isFinite ? semanticHeight : 0)
    let safeHitHeight = max(
      safeSemanticHeight,
      hitHeight.isFinite ? hitHeight : safeSemanticHeight
    )
    let centredTop = safeSemanticTop - (safeHitHeight - safeSemanticHeight) / 2
    let maximumTop = timelineHeight.isFinite ? max(0, timelineHeight - safeHitHeight) : Double.infinity
    let hitTop = min(max(0, centredTop), maximumTop)

    return DayframeCalendarVerticalMetrics(
      hitHeight: safeHitHeight,
      hitCenterY: hitTop + safeHitHeight / 2,
      visualOffsetWithinHitTarget: safeSemanticTop - hitTop
    )
  }
}

public struct DayframeCalendarPoint: Equatable {
  public let x: Double
  public let y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public struct DayframeCalendarEmptyStateMetrics: Equatable {
  public let center: DayframeCalendarPoint
  public let textWidth: Double

  public init(center: DayframeCalendarPoint, textWidth: Double) {
    self.center = center
    self.textWidth = textWidth
  }
}

public enum DayframeCalendarEmptyStateMath {
  public static func metrics(
    availableWidth: Double,
    hourLabelWidth: Double,
    hourHeight: Double
  ) -> DayframeCalendarEmptyStateMetrics? {
    guard
      availableWidth.isFinite,
      hourLabelWidth.isFinite,
      hourHeight.isFinite,
      availableWidth > hourLabelWidth,
      hourLabelWidth >= 0,
      hourHeight > 0
    else {
      return nil
    }

    let timelineWidth = max(0, availableWidth - hourLabelWidth - 8)
    return DayframeCalendarEmptyStateMetrics(
      center: DayframeCalendarPoint(
        x: hourLabelWidth + timelineWidth / 2,
        y: 2.5 * hourHeight
      ),
      textWidth: max(0, timelineWidth - 16)
    )
  }
}

public struct DayframeCalendarHitFrame: Equatable {
  public let minX: Double
  public let maxX: Double
  public let minY: Double
  public let maxY: Double

  public init(minX: Double, maxX: Double, minY: Double, maxY: Double) {
    self.minX = minX
    self.maxX = maxX
    self.minY = minY
    self.maxY = maxY
  }

  public func contains(_ point: DayframeCalendarPoint) -> Bool {
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
  }
}

public struct DayframeCalendarTimelineLayout: Equatable {
  public let availableWidth: Double
  public let hourLabelWidth: Double

  public init(availableWidth: Double, hourLabelWidth: Double) {
    self.availableWidth = availableWidth
    self.hourLabelWidth = hourLabelWidth
  }
}

public struct DayframeCalendarLongPressSlot: Equatable {
  public let startMinute: Int

  public init(startMinute: Int) {
    self.startMinute = startMinute
  }
}

public struct DayframeCalendarCreateRequest: Equatable {
  public let dayKey: String
  public let startMinute: Int

  public init(dayKey: String, startMinute: Int) {
    self.dayKey = dayKey
    self.startMinute = startMinute
  }
}

public struct DayframeCalendarEntryGeometryMetrics: Equatable {
  public let hitFrame: DayframeCalendarHitFrame
  public let horizontal: DayframeCalendarHorizontalMetrics
  public let vertical: DayframeCalendarVerticalMetrics

  public init(
    hitFrame: DayframeCalendarHitFrame,
    horizontal: DayframeCalendarHorizontalMetrics,
    vertical: DayframeCalendarVerticalMetrics
  ) {
    self.hitFrame = hitFrame
    self.horizontal = horizontal
    self.vertical = vertical
  }
}

public enum DayframeCalendarEntryGeometryMath {
  public static func metrics(
    availableWidth: Double,
    hourLabelWidth: Double,
    semanticTop: Double,
    semanticHeight: Double,
    offsetFraction: Double,
    widthFraction: Double,
    overlapCount: Int,
    textDensity: String,
    timelineHeight: Double = .infinity,
    leadingInset: Double = 0
  ) -> DayframeCalendarEntryGeometryMetrics? {
    guard
      availableWidth.isFinite,
      hourLabelWidth.isFinite,
      leadingInset.isFinite,
      semanticTop.isFinite,
      semanticHeight.isFinite,
      availableWidth > hourLabelWidth,
      hourLabelWidth >= 0,
      semanticHeight > 0
    else {
      return nil
    }

    // Lanes share the column right of any bracket rail.
    let inset = max(0, leadingInset)
    let blockWidth = max(0, availableWidth - hourLabelWidth - 18 - inset)
    let horizontal = DayframeCalendarHorizontalMath.metrics(
      availableWidth: blockWidth,
      offsetFraction: offsetFraction,
      widthFraction: widthFraction,
      semanticHeight: semanticHeight,
      overlapCount: overlapCount,
      textDensity: textDensity
    )
    let vertical = DayframeCalendarVerticalMath.metrics(
      semanticTop: semanticTop,
      semanticHeight: semanticHeight,
      hitHeight: horizontal.hitHeight,
      timelineHeight: timelineHeight
    )
    let minX = hourLabelWidth + 8 + inset + horizontal.offset
    let minY = vertical.hitCenterY - vertical.hitHeight / 2

    return DayframeCalendarEntryGeometryMetrics(
      hitFrame: DayframeCalendarHitFrame(
        minX: minX,
        maxX: minX + horizontal.width,
        minY: minY,
        maxY: minY + vertical.hitHeight
      ),
      horizontal: horizontal,
      vertical: vertical
    )
  }
}

public enum DayframeCalendarLongPressMath {
  public static func slot(
    contentY: Double,
    hourHeight: Double,
    snapMinutes: Int = DayframeCalendarConstants.longPressSnapMinutes
  ) -> DayframeCalendarLongPressSlot? {
    guard
      contentY.isFinite,
      hourHeight.isFinite,
      contentY >= 0,
      hourHeight > 0,
      snapMinutes > 0
    else {
      return nil
    }

    let rawMinute = contentY / hourHeight * 60
    guard rawMinute.isFinite else { return nil }
    let flooredMinute = floor(rawMinute / Double(snapMinutes)) * Double(snapMinutes)
    let maximumStartMinute = max(0, Int(DayframeCalendarConstants.minutesPerDay) - snapMinutes)
    return DayframeCalendarLongPressSlot(
      startMinute: min(maximumStartMinute, max(0, Int(flooredMinute)))
    )
  }

  public static func pointIsInTimeline(
    point: DayframeCalendarPoint,
    availableWidth: Double,
    hourLabelWidth: Double,
    hourHeight: Double
  ) -> Bool {
    guard
      point.x.isFinite,
      point.y.isFinite,
      availableWidth.isFinite,
      hourLabelWidth.isFinite,
      hourHeight.isFinite,
      availableWidth > hourLabelWidth,
      hourLabelWidth >= 0,
      hourHeight > 0
    else {
      return false
    }

    let timelineHeight = 24 * hourHeight
    return point.x > hourLabelWidth
      && point.x <= availableWidth
      && point.y >= 0
      && point.y <= timelineHeight
  }

  public static func pointHitsEntry(
    point: DayframeCalendarPoint,
    frames: [DayframeCalendarHitFrame]
  ) -> Bool {
    guard point.x.isFinite, point.y.isFinite else { return false }
    return frames.contains { $0.contains(point) }
  }
}

public enum DayframeCalendarCreationDragMath {
  public static func rawMinute(contentY: Double, hourHeight: Double) -> Double? {
    guard contentY.isFinite, hourHeight.isFinite, hourHeight > 0 else { return nil }
    let minute = contentY / hourHeight * 60
    return minute.isFinite ? minute : nil
  }

  public static func grabOffsetMinutes(
    contentY: Double,
    hourHeight: Double,
    startMinute: Int,
    snapMinutes: Int = DayframeCalendarConstants.longPressSnapMinutes
  ) -> Double? {
    guard
      let minute = rawMinute(contentY: contentY, hourHeight: hourHeight),
      snapMinutes > 0,
      startMinute >= 0
    else {
      return nil
    }
    return min(Double(snapMinutes), max(0, minute - Double(startMinute)))
  }

  public static func startMinute(
    contentY: Double,
    hourHeight: Double,
    grabOffsetMinutes: Double,
    snapMinutes: Int = DayframeCalendarConstants.longPressSnapMinutes
  ) -> Int? {
    guard
      let minute = rawMinute(contentY: contentY, hourHeight: hourHeight),
      grabOffsetMinutes.isFinite,
      snapMinutes > 0
    else {
      return nil
    }
    let anchoredMinute = minute - grabOffsetMinutes
    let flooredMinute = floor(anchoredMinute / Double(snapMinutes)) * Double(snapMinutes)
    guard flooredMinute.isFinite else { return nil }
    let maximumStartMinute = max(0, Int(DayframeCalendarConstants.minutesPerDay) - snapMinutes)
    return min(maximumStartMinute, max(0, Int(flooredMinute)))
  }
}

public struct DayframeCalendarCreationDragSession: Equatable {
  public let dayKey: String
  public let initialStartMinute: Int
  public let grabOffsetMinutes: Double
  public var currentStartMinute: Int
  public var lastHapticMinute: Int

  public init(
    dayKey: String,
    initialStartMinute: Int,
    grabOffsetMinutes: Double,
    currentStartMinute: Int,
    lastHapticMinute: Int
  ) {
    self.dayKey = dayKey
    self.initialStartMinute = initialStartMinute
    self.grabOffsetMinutes = grabOffsetMinutes
    self.currentStartMinute = currentStartMinute
    self.lastHapticMinute = lastHapticMinute
  }
}

public struct DayframeCalendarCreationDragState: Equatable {
  public var session: DayframeCalendarCreationDragSession?

  public init(session: DayframeCalendarCreationDragSession? = nil) {
    self.session = session
  }
}

public enum DayframeCalendarCreationDragEvent: Equatable {
  case began(dayKey: String, contentY: Double, hourHeight: Double)
  case changed(contentY: Double, hourHeight: Double)
  case ended
  case cancelled
}

public struct DayframeCalendarCreationDragTransition: Equatable {
  public let state: DayframeCalendarCreationDragState
  public let previewStartMinute: Int?
  public let request: DayframeCalendarCreateRequest?
  public let shouldClearPreview: Bool
  public let shouldTriggerHaptic: Bool

  public init(
    state: DayframeCalendarCreationDragState,
    previewStartMinute: Int? = nil,
    request: DayframeCalendarCreateRequest? = nil,
    shouldClearPreview: Bool = false,
    shouldTriggerHaptic: Bool = false
  ) {
    self.state = state
    self.previewStartMinute = previewStartMinute
    self.request = request
    self.shouldClearPreview = shouldClearPreview
    self.shouldTriggerHaptic = shouldTriggerHaptic
  }
}

public enum DayframeCalendarCreationDragReducer {
  public static func reduce(
    state: DayframeCalendarCreationDragState,
    event: DayframeCalendarCreationDragEvent
  ) -> DayframeCalendarCreationDragTransition {
    switch event {
    case let .began(dayKey, contentY, hourHeight):
      guard
        !dayKey.isEmpty,
        let slot = DayframeCalendarLongPressMath.slot(contentY: contentY, hourHeight: hourHeight),
        let grabOffset = DayframeCalendarCreationDragMath.grabOffsetMinutes(
          contentY: contentY,
          hourHeight: hourHeight,
          startMinute: slot.startMinute
        )
      else {
        return DayframeCalendarCreationDragTransition(state: state)
      }
      let session = DayframeCalendarCreationDragSession(
        dayKey: dayKey,
        initialStartMinute: slot.startMinute,
        grabOffsetMinutes: grabOffset,
        currentStartMinute: slot.startMinute,
        lastHapticMinute: slot.startMinute
      )
      return DayframeCalendarCreationDragTransition(
        state: DayframeCalendarCreationDragState(session: session),
        previewStartMinute: slot.startMinute,
        shouldTriggerHaptic: true
      )

    case let .changed(contentY, hourHeight):
      guard
        var session = state.session,
        let startMinute = DayframeCalendarCreationDragMath.startMinute(
          contentY: contentY,
          hourHeight: hourHeight,
          grabOffsetMinutes: session.grabOffsetMinutes
        )
      else {
        return DayframeCalendarCreationDragTransition(state: state)
      }
      guard startMinute != session.currentStartMinute else {
        return DayframeCalendarCreationDragTransition(state: state)
      }
      session.currentStartMinute = startMinute
      let shouldTriggerHaptic = startMinute != session.lastHapticMinute
      if shouldTriggerHaptic {
        session.lastHapticMinute = startMinute
      }
      return DayframeCalendarCreationDragTransition(
        state: DayframeCalendarCreationDragState(session: session),
        previewStartMinute: startMinute,
        shouldTriggerHaptic: shouldTriggerHaptic
      )

    case .ended:
      guard let session = state.session else {
        return DayframeCalendarCreationDragTransition(state: state)
      }
      return DayframeCalendarCreationDragTransition(
        state: DayframeCalendarCreationDragState(),
        request: DayframeCalendarCreateRequest(
          dayKey: session.dayKey,
          startMinute: session.currentStartMinute
        ),
        shouldClearPreview: true
      )

    case .cancelled:
      return DayframeCalendarCreationDragTransition(
        state: DayframeCalendarCreationDragState(),
        shouldClearPreview: state.session != nil
      )
    }
  }
}

public struct DayframeCalendarCreationPreviewGeometry: Equatable {
  public let continuesIntoNextDay: Bool
  public let semanticHeight: Double
  public let top: Double
  public let visibleHeight: Double

  public init(
    continuesIntoNextDay: Bool,
    semanticHeight: Double,
    top: Double,
    visibleHeight: Double
  ) {
    self.continuesIntoNextDay = continuesIntoNextDay
    self.semanticHeight = semanticHeight
    self.top = top
    self.visibleHeight = visibleHeight
  }
}

public enum DayframeCalendarCreationPreviewMath {
  public static func geometry(
    startMinute: Int,
    durationMinutes: Int = DayframeCalendarConstants.creationPreviewDurationMinutes,
    hourHeight: Double
  ) -> DayframeCalendarCreationPreviewGeometry? {
    guard
      hourHeight.isFinite,
      hourHeight > 0,
      startMinute >= 0,
      startMinute < Int(DayframeCalendarConstants.minutesPerDay),
      durationMinutes > 0
    else {
      return nil
    }
    let endMinute = startMinute + durationMinutes
    let visibleMinutes = max(
      0,
      min(durationMinutes, Int(DayframeCalendarConstants.minutesPerDay) - startMinute)
    )
    return DayframeCalendarCreationPreviewGeometry(
      continuesIntoNextDay: endMinute > Int(DayframeCalendarConstants.minutesPerDay),
      semanticHeight: Double(durationMinutes) / 60 * hourHeight,
      top: Double(startMinute) / 60 * hourHeight,
      visibleHeight: Double(visibleMinutes) / 60 * hourHeight
    )
  }
}

public enum DayframeCalendarEdgeAutoscrollMath {
  public static func velocity(
    viewportY: Double,
    viewportHeight: Double,
    activationInset: Double = DayframeCalendarConstants.edgeAutoscrollActivationInset,
    maximumSpeed: Double = DayframeCalendarConstants.edgeAutoscrollMaximumSpeed
  ) -> Double? {
    guard
      viewportY.isFinite,
      viewportHeight.isFinite,
      activationInset.isFinite,
      maximumSpeed.isFinite,
      viewportHeight > 0,
      activationInset > 0,
      maximumSpeed > 0
    else {
      return nil
    }
    let resolvedInset = min(activationInset, viewportHeight / 2)
    if viewportY < resolvedInset {
      let depth = min(1, max(0, (resolvedInset - viewportY) / resolvedInset))
      return -maximumSpeed * depth
    }
    let bottomStart = viewportHeight - resolvedInset
    if viewportY > bottomStart {
      let depth = min(1, max(0, (viewportY - bottomStart) / resolvedInset))
      return maximumSpeed * depth
    }
    return 0
  }

  public static func nextContentOffset(
    currentOffset: Double,
    velocity: Double,
    deltaTime: Double,
    hourHeight: Double,
    viewportHeight: Double
  ) -> Double? {
    guard
      currentOffset.isFinite,
      velocity.isFinite,
      deltaTime.isFinite,
      hourHeight.isFinite,
      viewportHeight.isFinite,
      deltaTime >= 0,
      hourHeight > 0,
      viewportHeight > 0
    else {
      return nil
    }
    return DayframeCalendarZoomMath.clampContentOffset(
      currentOffset + velocity * deltaTime,
      hourHeight: hourHeight,
      viewportHeight: viewportHeight
    )
  }

  public static func contentY(viewportY: Double, contentOffsetY: Double) -> Double? {
    guard viewportY.isFinite, contentOffsetY.isFinite else { return nil }
    let contentY = viewportY + contentOffsetY
    return contentY.isFinite ? contentY : nil
  }
}

public struct DayframeCalendarBlockVisualMetrics: Equatable {
  public let cornerRadius: Double
  public let semanticHeight: Double
  public let visualHeight: Double
  public let visualGap: Double

  public init(
    cornerRadius: Double,
    semanticHeight: Double,
    visualHeight: Double,
    visualGap: Double
  ) {
    self.cornerRadius = cornerRadius
    self.semanticHeight = semanticHeight
    self.visualHeight = visualHeight
    self.visualGap = visualGap
  }
}

public enum DayframeCalendarBlockVisualMath {
  public static func metrics(
    semanticHeight: Double,
    continuesIntoNextDay: Bool
  ) -> DayframeCalendarBlockVisualMetrics {
    // Semantic block math supplies at least one label line. Clamp malformed direct
    // callers to 1 pt so drawing remains finite without changing valid geometry.
    let safeSemanticHeight = max(
      DayframeCalendarConstants.minimumVisualBlockHeight,
      semanticHeight.isFinite ? semanticHeight : DayframeCalendarConstants.minimumVisualBlockHeight
    )
    let requestedGap = continuesIntoNextDay ? 0 : DayframeCalendarConstants.blockVisualGap
    let visualGap = min(
      requestedGap,
      max(0, safeSemanticHeight - DayframeCalendarConstants.minimumVisualBlockHeight)
    )

    return DayframeCalendarBlockVisualMetrics(
      cornerRadius: DayframeCalendarConstants.blockCornerRadius,
      semanticHeight: safeSemanticHeight,
      visualHeight: max(
        DayframeCalendarConstants.minimumVisualBlockHeight,
        safeSemanticHeight - visualGap
      ),
      visualGap: visualGap
    )
  }
}

public struct DayframeCalendarZoomState: Equatable {
  public var contentOffsetY: Double
  public var hourHeight: Double

  public init(contentOffsetY: Double, hourHeight: Double) {
    self.contentOffsetY = contentOffsetY
    self.hourHeight = hourHeight
  }
}

public struct DayframeCalendarPinchStart: Equatable {
  public let contentOffsetY: Double
  public let hourHeight: Double
  public let logicalMinute: Double
  public let midpointY: Double

  public init(contentOffsetY: Double, hourHeight: Double, midpointY: Double) {
    let safeHourHeight = DayframeCalendarZoomMath.clampHourHeight(hourHeight)
    self.contentOffsetY = max(0, contentOffsetY)
    self.hourHeight = safeHourHeight
    self.midpointY = midpointY
    self.logicalMinute = ((max(0, contentOffsetY) + midpointY) / safeHourHeight) * 60.0
  }
}

public enum DayframeCalendarZoomMath {
  public static func clampHourHeight(_ value: Double) -> Double {
    min(
      DayframeCalendarConstants.maximumHourHeight,
      max(DayframeCalendarConstants.minimumHourHeight, value.isFinite ? value : DayframeCalendarConstants.defaultHourHeight)
    )
  }

  public static func maximumContentOffset(hourHeight: Double, viewportHeight: Double) -> Double {
    max(0, 24.0 * clampHourHeight(hourHeight) - max(0, viewportHeight))
  }

  public static func clampContentOffset(_ value: Double, hourHeight: Double, viewportHeight: Double) -> Double {
    min(maximumContentOffset(hourHeight: hourHeight, viewportHeight: viewportHeight), max(0, value.isFinite ? value : 0))
  }

  public static func update(
    start: DayframeCalendarPinchStart,
    absoluteScale: Double,
    currentMidpointY: Double,
    viewportHeight: Double
  ) -> DayframeCalendarZoomState {
    let safeScale = absoluteScale.isFinite ? absoluteScale : 1
    let nextHourHeight = clampHourHeight(start.hourHeight * safeScale)
    let nextOffset = (start.logicalMinute / 60.0) * nextHourHeight - currentMidpointY
    return DayframeCalendarZoomState(
      contentOffsetY: clampContentOffset(nextOffset, hourHeight: nextHourHeight, viewportHeight: viewportHeight),
      hourHeight: nextHourHeight
    )
  }

  /// The zoom − / + buttons change the hour height by this factor per press.
  public static let buttonStepFactor = 1.4
  public static let buttonAnimationDuration = 0.26

  public static func buttonTarget(hourHeight: Double, direction: Int) -> Double {
    clampHourHeight(clampHourHeight(hourHeight) * (direction > 0 ? buttonStepFactor : 1 / buttonStepFactor))
  }

  /// One frame of a button zoom: ease-out cubic from the start height to the target, keeping the
  /// time at the viewport centre fixed (the same focal rule as a pinch). Progress 1 is the target.
  public static func buttonFrame(
    start: DayframeCalendarPinchStart,
    targetHourHeight: Double,
    progress: Double,
    viewportHeight: Double
  ) -> DayframeCalendarZoomState {
    let clampedProgress = min(1, max(0, progress.isFinite ? progress : 1))
    let eased = 1 - pow(1 - clampedProgress, 3)
    let height = start.hourHeight + (clampHourHeight(targetHourHeight) - start.hourHeight) * eased
    return update(
      start: start,
      absoluteScale: height / start.hourHeight,
      currentMidpointY: start.midpointY,
      viewportHeight: viewportHeight
    )
  }

  // Geometry is already committed during .changed. Ending a gesture performs no normalization.
  public static func end(_ current: DayframeCalendarZoomState) -> DayframeCalendarZoomState {
    current
  }
}

public enum DayframeCalendarExternalUpdate: Equatable {
  case dayChanged
  case modelChanged
  case nowChanged
}

public struct DayframeCalendarInteractionState: Equatable {
  public var zoom: DayframeCalendarZoomState

  public init(zoom: DayframeCalendarZoomState) {
    self.zoom = zoom
  }

  public func preservingState(
    for update: DayframeCalendarExternalUpdate,
    viewportHeight: Double
  ) -> DayframeCalendarInteractionState {
    _ = update
    return DayframeCalendarInteractionState(
      zoom: DayframeCalendarZoomState(
        contentOffsetY: DayframeCalendarZoomMath.clampContentOffset(
          zoom.contentOffsetY,
          hourHeight: zoom.hourHeight,
          viewportHeight: viewportHeight
        ),
        hourHeight: DayframeCalendarZoomMath.clampHourHeight(zoom.hourHeight)
      )
    )
  }
}

public struct DayframeCalendarBlockMetrics: Equatable {
  public let compact: Bool
  public let continuesIntoNextDay: Bool
  public let height: Double
  public let showMeta: Bool
  public let showTitle: Bool
  public let startsBeforeDay: Bool
  public let tiny: Bool
  public let top: Double

  public init(
    compact: Bool,
    continuesIntoNextDay: Bool,
    height: Double,
    showMeta: Bool,
    showTitle: Bool,
    startsBeforeDay: Bool,
    tiny: Bool,
    top: Double
  ) {
    self.compact = compact
    self.continuesIntoNextDay = continuesIntoNextDay
    self.height = height
    self.showMeta = showMeta
    self.showTitle = showTitle
    self.startsBeforeDay = startsBeforeDay
    self.tiny = tiny
    self.top = top
  }
}

public enum DayframeCalendarBlockMath {
  public static func metrics(
    startedAtMs: Double,
    stoppedAtMs: Double?,
    nowMs: Double,
    dayStartMs: Double,
    dayEndMs: Double,
    hourHeight: Double,
    minimumHeight: Double = DayframeCalendarConstants.labelLineMinimumHeight,
    calendar: Calendar = .current
  ) -> DayframeCalendarBlockMetrics? {
    let effectiveStopMs = stoppedAtMs ?? nowMs
    guard
      startedAtMs.isFinite,
      effectiveStopMs.isFinite,
      dayStartMs.isFinite,
      dayEndMs.isFinite,
      effectiveStopMs > startedAtMs,
      dayEndMs > dayStartMs
    else {
      return nil
    }

    let visibleStartMs = max(startedAtMs, dayStartMs)
    let visibleEndMs = min(effectiveStopMs, dayEndMs)
    guard visibleEndMs > visibleStartMs else {
      return nil
    }

    let startMinute = localMinute(
      milliseconds: visibleStartMs,
      dayEndMs: dayEndMs,
      calendar: calendar
    )
    let endMinute = localMinute(
      milliseconds: visibleEndMs,
      dayEndMs: dayEndMs,
      calendar: calendar
    )
    let durationMinutes = max(1, endMinute - startMinute)
    let safeHourHeight = DayframeCalendarZoomMath.clampHourHeight(hourHeight)
    // Never shorter than one label line (location v4 C6): the label prints the real length.
    let safeMinimumHeight = max(
      DayframeCalendarConstants.minimumVisualBlockHeight,
      minimumHeight.isFinite ? minimumHeight : DayframeCalendarConstants.labelLineMinimumHeight
    )
    let height = max(safeMinimumHeight, (durationMinutes / 60.0) * safeHourHeight)
    return DayframeCalendarBlockMetrics(
      compact: height < DayframeCalendarConstants.twoLineMinimumHeight,
      continuesIntoNextDay: effectiveStopMs > dayEndMs,
      height: height,
      showMeta: height >= DayframeCalendarConstants.twoLineMinimumHeight,
      showTitle: true,
      startsBeforeDay: startedAtMs < dayStartMs,
      tiny: height < DayframeCalendarConstants.compactTextMaximumHeight,
      top: (startMinute / 60.0) * safeHourHeight
    )
  }

  private static func localMinute(
    milliseconds: Double,
    dayEndMs: Double,
    calendar: Calendar
  ) -> Double {
    if milliseconds >= dayEndMs {
      return DayframeCalendarConstants.minutesPerDay
    }
    let date = Date(timeIntervalSince1970: milliseconds / 1000.0)
    let components = calendar.dateComponents([.hour, .minute, .second, .nanosecond], from: date)
    return Double(components.hour ?? 0) * 60.0
      + Double(components.minute ?? 0)
      + Double(components.second ?? 0) / 60.0
      + Double(components.nanosecond ?? 0) / 60_000_000_000.0
  }
}

/// A block as drawn at the current zoom: top and bottom in points, one label line at least.
public struct DayframeCalendarDrawnBlock: Equatable {
  public let id: String
  public let top: Double
  public let bottom: Double

  public init(id: String, top: Double, bottom: Double) {
    self.id = id
    self.top = top
    self.bottom = bottom
  }
}

public struct DayframeCalendarColumn: Equatable {
  public let id: String
  public let columnIndex: Int
  public let columnCount: Int
  public let offsetFraction: Double
  public let widthFraction: Double
  public let zIndex: Int
}

/// Side-by-side columns over drawn extents (location v4 C6), the same rule as the shared
/// `layoutCalendarBlockColumns` on the web: blocks are taken by top, then id; a cluster
/// grows while the next block starts above its lowest bottom; each block takes the leftmost column
/// whose last block has ended by its top. Every block in a cluster is 1 / columns wide.
/// O(n log n): one sort, then two heaps (columns in use by bottom, freed columns by index).
public enum DayframeCalendarColumnMath {
  /// `tolerance`: drawn edges this close count as touching. Review targets use 0 (strictly apart).
  public static func layout(
    _ blocks: [DayframeCalendarDrawnBlock],
    tolerance: Double = DayframeCalendarConstants.columnTouchTolerance
  ) -> [DayframeCalendarColumn] {
    var seen = Set<String>()
    let items = blocks
      .filter { block in
        guard !block.id.isEmpty, block.top.isFinite, block.bottom.isFinite, !seen.contains(block.id) else { return false }
        seen.insert(block.id)
        return true
      }
      .map { DayframeCalendarDrawnBlock(id: $0.id, top: $0.top, bottom: max($0.top, $0.bottom)) }
      .sorted { left, right in
        if left.top != right.top { return left.top < right.top }
        // Never by length: a running block growing past a neighbour that started with it keeps its column.
        return left.id.utf16.lexicographicallyPrecedes(right.id.utf16)
      }

    var out: [DayframeCalendarColumn] = []
    out.reserveCapacity(items.count)
    var cluster: [(id: String, column: Int)] = []
    var clusterBottom = -Double.infinity
    var columnCount = 0
    var busy = DayframeMinHeap<(bottom: Double, column: Int)> { left, right in
      left.bottom != right.bottom ? left.bottom < right.bottom : left.column < right.column
    }
    var free = DayframeMinHeap<Int> { $0 < $1 }
    func flush() {
      guard !cluster.isEmpty else { return }
      let count = columnCount
      for member in cluster {
        out.append(DayframeCalendarColumn(
          id: member.id,
          columnIndex: member.column,
          columnCount: count,
          offsetFraction: Double(member.column) / Double(count),
          widthFraction: 1 / Double(count),
          zIndex: count > 1 ? member.column + 1 : 0
        ))
      }
      cluster.removeAll(keepingCapacity: true)
      columnCount = 0
      busy.removeAll()
      free.removeAll()
    }
    for item in items {
      if item.top >= clusterBottom - tolerance {
        flush()
        clusterBottom = item.bottom
      }
      while let next = busy.peek, next.bottom <= item.top + tolerance {
        free.push(busy.pop()!.column)
      }
      let column: Int
      if let freed = free.pop() {
        column = freed
      } else {
        column = columnCount
        columnCount += 1
      }
      busy.push((item.bottom, column))
      cluster.append((item.id, column))
      clusterBottom = max(clusterBottom, item.bottom)
    }
    flush()
    return out
  }
}

/// A small binary min-heap for the column sweep.
struct DayframeMinHeap<Element> {
  private var items: [Element] = []
  private let less: (Element, Element) -> Bool

  init(less: @escaping (Element, Element) -> Bool) {
    self.less = less
  }

  var peek: Element? { items.first }

  mutating func removeAll() {
    items.removeAll(keepingCapacity: true)
  }

  mutating func push(_ element: Element) {
    items.append(element)
    var index = items.count - 1
    while index > 0 {
      let parent = (index - 1) / 2
      guard less(items[index], items[parent]) else { break }
      items.swapAt(index, parent)
      index = parent
    }
  }

  mutating func pop() -> Element? {
    guard !items.isEmpty else { return nil }
    let top = items[0]
    let last = items.removeLast()
    if !items.isEmpty {
      items[0] = last
      var index = 0
      while true {
        let left = index * 2 + 1
        let right = left + 1
        var smallest = index
        if left < items.count, less(items[left], items[smallest]) { smallest = left }
        if right < items.count, less(items[right], items[smallest]) { smallest = right }
        if smallest == index { break }
        items.swapAt(index, smallest)
        index = smallest
      }
    }
    return top
  }
}

/// What the day layout needs from one presentation entry.
public struct DayframeCalendarLayoutInput: Equatable {
  public let id: String
  public let startedAtMs: Double
  public let stoppedAtMs: Double?
  /// "logged" or "review": blocks are put in columns within their own group. Nil (a model from an
  /// older bundle) keeps the fractions React sent.
  public let columnGroup: String?
  /// The part of the day column the group draws in (logged blocks beside the Review lane use the left part).
  public let regionOffsetFraction: Double
  public let regionWidthFraction: Double
  public let fallbackOffsetFraction: Double
  public let fallbackWidthFraction: Double
  public let fallbackZIndex: Int

  public init(
    id: String,
    startedAtMs: Double,
    stoppedAtMs: Double?,
    columnGroup: String?,
    regionOffsetFraction: Double,
    regionWidthFraction: Double,
    fallbackOffsetFraction: Double,
    fallbackWidthFraction: Double,
    fallbackZIndex: Int
  ) {
    self.id = id
    self.startedAtMs = startedAtMs
    self.stoppedAtMs = stoppedAtMs
    self.columnGroup = columnGroup
    self.regionOffsetFraction = regionOffsetFraction
    self.regionWidthFraction = regionWidthFraction
    self.fallbackOffsetFraction = fallbackOffsetFraction
    self.fallbackWidthFraction = fallbackWidthFraction
    self.fallbackZIndex = fallbackZIndex
  }
}

public struct DayframeCalendarLaidOutEntry: Equatable {
  public let block: DayframeCalendarBlockMetrics
  public let offsetFraction: Double
  public let widthFraction: Double
  public let columnCount: Int
  public let zIndex: Int
  /// Another block is drawn inside this block's 44-point target in the same horizontal space, so the
  /// target stays the block's own height and a tap never lands on the wrong block.
  public let sharesTarget: Bool
}

/// One layout for the day at one zoom and text size, used by drawing and by hit testing alike.
public enum DayframeCalendarDayLayout {
  public static let reviewZIndexBase = 1_000

  /// One label line at the given Dynamic Type scale (capped like the metadata text).
  public static func labelMinimumHeight(textScale: Double) -> Double {
    let safe = textScale.isFinite ? textScale : 1
    return DayframeCalendarConstants.labelLineMinimumHeight
      * min(DayframeCalendarConstants.maximumLabelTextScale, max(0.8, safe))
  }

  public static func layout(
    entries: [DayframeCalendarLayoutInput],
    nowMs: Double,
    dayStartMs: Double,
    dayEndMs: Double,
    hourHeight: Double,
    textScale: Double = 1,
    calendar: Calendar = .current
  ) -> [String: DayframeCalendarLaidOutEntry] {
    let minimumHeight = labelMinimumHeight(textScale: textScale)
    var blocks: [String: DayframeCalendarBlockMetrics] = [:]
    var groups: [String: [DayframeCalendarDrawnBlock]] = [:]
    for entry in entries {
      guard let block = DayframeCalendarBlockMath.metrics(
        startedAtMs: entry.startedAtMs,
        stoppedAtMs: entry.stoppedAtMs,
        nowMs: nowMs,
        dayStartMs: dayStartMs,
        dayEndMs: dayEndMs,
        hourHeight: hourHeight,
        minimumHeight: entry.columnGroup == nil ? DayframeCalendarConstants.legacyMinimumBlockHeight : minimumHeight,
        calendar: calendar
      ) else { continue }
      blocks[entry.id] = block
      if let group = entry.columnGroup {
        // Review suggestions never share a target: their columns are laid out over the 44-point
        // target each one gets (as hit testing places it), not just over what is drawn.
        let extent = group == "review"
          ? targetExtent(top: block.top, height: block.height, timelineHeight: 24 * hourHeight)
          : (top: block.top, bottom: block.top + block.height)
        groups[group, default: []].append(DayframeCalendarDrawnBlock(id: entry.id, top: extent.top, bottom: extent.bottom))
      }
    }
    var columns: [String: DayframeCalendarColumn] = [:]
    for (group, members) in groups {
      // Review targets must not meet at all: no touching tolerance.
      for column in DayframeCalendarColumnMath.layout(members, tolerance: group == "review" ? 0 : DayframeCalendarConstants.columnTouchTolerance) {
        columns[column.id] = column
      }
    }

    var placed: [(id: String, block: DayframeCalendarBlockMetrics, offset: Double, width: Double, count: Int, z: Int)] = []
    for entry in entries {
      guard let block = blocks[entry.id] else { continue }
      if entry.columnGroup != nil, let column = columns[entry.id] {
        let regionOffset = min(1, max(0, entry.regionOffsetFraction.isFinite ? entry.regionOffsetFraction : 0))
        let regionWidth = min(1 - regionOffset, max(0, entry.regionWidthFraction.isFinite ? entry.regionWidthFraction : 1))
        placed.append((
          entry.id,
          block,
          regionOffset + column.offsetFraction * regionWidth,
          column.widthFraction * regionWidth,
          column.columnCount,
          (entry.columnGroup == "review" ? reviewZIndexBase : 0) + column.zIndex
        ))
      } else {
        placed.append((entry.id, block, entry.fallbackOffsetFraction, entry.fallbackWidthFraction, 1, entry.fallbackZIndex))
      }
    }

    // A short block's 44-point target may grow only where no other block is drawn in its space. Only
    // blocks whose top or bottom falls inside the target can be drawn there (a block covering the
    // whole target would collide with this one, so it is in another column or region), found with two
    // sorted arrays: O(n log n) plus the matches.
    let epsilon = 1e-9
    let timelineHeight = 24 * hourHeight
    let byTop = placed.indices.sorted { placed[$0].block.top < placed[$1].block.top }
    let byBottom = placed.indices.sorted { placed[$0].block.top + placed[$0].block.height < placed[$1].block.top + placed[$1].block.height }
    let tops = byTop.map { placed[$0].block.top }
    let bottoms = byBottom.map { placed[$0].block.top + placed[$0].block.height }
    func firstIndex(_ values: [Double], atLeast value: Double, strictly: Bool) -> Int {
      var low = 0, high = values.count
      while low < high {
        let mid = (low + high) / 2
        if strictly ? values[mid] <= value : values[mid] < value { low = mid + 1 } else { high = mid }
      }
      return low
    }
    var out: [String: DayframeCalendarLaidOutEntry] = [:]
    for (index, item) in placed.enumerated() {
      var sharesTarget = false
      if item.block.height < 44 {
        let target = targetExtent(top: item.block.top, height: item.block.height, timelineHeight: timelineHeight)
        let sharesSpace = { (other: Int) -> Bool in
          let candidate = placed[other]
          return other != index
            && candidate.offset < item.offset + item.width - epsilon
            && item.offset < candidate.offset + candidate.width - epsilon
            && candidate.block.top < target.bottom
            && target.top < candidate.block.top + candidate.block.height
        }
        // Tops in [target.top, target.bottom), then bottoms in (target.top, target.bottom].
        var cursor = firstIndex(tops, atLeast: target.top, strictly: false)
        while !sharesTarget, cursor < tops.count, tops[cursor] < target.bottom {
          sharesTarget = sharesSpace(byTop[cursor])
          cursor += 1
        }
        cursor = firstIndex(bottoms, atLeast: target.top, strictly: true)
        while !sharesTarget, cursor < bottoms.count, bottoms[cursor] <= target.bottom {
          sharesTarget = sharesSpace(byBottom[cursor])
          cursor += 1
        }
      }
      out[item.id] = DayframeCalendarLaidOutEntry(
        block: item.block,
        offsetFraction: item.offset,
        widthFraction: item.width,
        columnCount: item.count,
        zIndex: item.z,
        sharesTarget: sharesTarget
      )
    }
    return out
  }

  /// The vertical span of a block's full-size tap target, placed as hit testing places it.
  static func targetExtent(top: Double, height: Double, timelineHeight: Double) -> (top: Double, bottom: Double) {
    let vertical = DayframeCalendarVerticalMath.metrics(
      semanticTop: top,
      semanticHeight: height,
      hitHeight: max(44, height),
      timelineHeight: timelineHeight
    )
    let hitTop = vertical.hitCenterY - vertical.hitHeight / 2
    return (hitTop, hitTop + vertical.hitHeight)
  }
}

public struct DayframeCalendarBracketSpan: Equatable {
  public let top: Double
  public let height: Double

  public init(top: Double, height: Double) {
    self.top = top
    self.height = height
  }
}

public enum DayframeCalendarBracketMath {
  /// A named pattern's bracket (location v3 PR 14b) runs from its first part's drawn top to its last
  /// part's drawn bottom: each part measured as the block it is (its minimum height, a clock change's
  /// wall-clock place), never the trip as one block, so it stays beside its parts at every zoom.
  public static func span(
    parts: [(startedAtMs: Double, stoppedAtMs: Double?)],
    nowMs: Double,
    dayStartMs: Double,
    dayEndMs: Double,
    hourHeight: Double,
    minimumHeight: Double = DayframeCalendarConstants.labelLineMinimumHeight,
    calendar: Calendar = .current
  ) -> DayframeCalendarBracketSpan? {
    let blocks = parts.compactMap { part in
      DayframeCalendarBlockMath.metrics(
        startedAtMs: part.startedAtMs,
        stoppedAtMs: part.stoppedAtMs,
        nowMs: nowMs,
        dayStartMs: dayStartMs,
        dayEndMs: dayEndMs,
        hourHeight: hourHeight,
        minimumHeight: minimumHeight,
        calendar: calendar
      )
    }
    guard
      let top = blocks.map(\.top).min(),
      let bottom = blocks.map({ $0.top + $0.height }).max()
    else {
      return nil
    }
    return DayframeCalendarBracketSpan(top: top, height: bottom - top)
  }
}

public enum DayframeCalendarActionKind: String, Equatable {
  case active
  case completed
  case review
}

public struct DayframeCalendarActionTarget: Equatable {
  public let id: String
  public let kind: DayframeCalendarActionKind

  public init(id: String, kind: DayframeCalendarActionKind) {
    self.id = id
    self.kind = kind
  }
}

/// Clock times in Dayframe's per-device 12/24-hour format (PRD D18), matching the shared
/// `formatClockParts` / `formatClockHour` in `packages/shared`: "09:30" or "9:30 AM", and whole-hour
/// grid labels "08:00" or "8 AM".
enum DayframeClockText {
  static func time(hour: Int, minute: Int, clockFormat: String) -> String {
    guard clockFormat == "12h" else { return String(format: "%02d:%02d", hour, minute) }
    return String(format: "%d:%02d %@", twelveHour(hour), minute, meridiem(hour))
  }

  static func hour(_ hour: Int, clockFormat: String) -> String {
    guard clockFormat == "12h" else { return String(format: "%02d:00", hour) }
    return "\(twelveHour(hour)) \(meridiem(hour))"
  }

  private static func twelveHour(_ hour: Int) -> Int {
    let value = hour % 12
    return value == 0 ? 12 : value
  }

  private static func meridiem(_ hour: Int) -> String {
    hour % 24 < 12 ? "AM" : "PM"
  }
}
