import Foundation

public enum DayframeCalendarConstants {
  public static let defaultHourHeight = 72.0
  public static let minimumHourHeight = 48.0
  public static let maximumHourHeight = 128.0
  public static let minutesPerDay = 24.0 * 60.0
  public static let minimumVisualBlockHeight = 1.0
  /// Calendar v3 (owner, 24 Oct 2026): Apple-like corners.
  public static let blockCornerRadius = 5.0
  public static let blockVisualGap = 2.0
  // Dense-day rules (owner, 24 Oct 2026; calendar-dense-mockup v2). Mirrors CALENDAR_DENSE_LABEL in
  // packages/shared/src/calendarBlockLayout.ts; nativeCalendar.contract.test.ts keeps them equal.
  /// Every block is drawn at least one label line tall: 18 pt at the default text size.
  public static let labelLineMinimumHeight = 18.0
  /// The label (and so the minimum height) grows with Dynamic Type up to this scale.
  public static let maximumLabelTextScale = 1.3
  /// From this drawn height a trip block shows its leg strip (legs arrive in a later step).
  public static let legStripMinimumHeight = 44.0
  /// Below this drawn height, or `compactTextMaximumWidth` wide, the title uses compact type.
  public static let compactTextMaximumHeight = 34.0
  public static let compactTextMaximumWidth = 90.0
  /// From this width (and with a title line to spare) a block shows its times and length.
  public static let detailMinimumWidth = 120.0
  /// A column narrower than this shows its colour only.
  public static let sliverMaximumWidth = 22.0
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
  // Calendar v3, Apple's hybrid overlap (owner, 24 Oct 2026; calendar-v3-mockup). Mirrors
  // CALENDAR_V3_OVERLAP in packages/shared/src/calendarBlockLayout.ts.
  /// A block starting within this many minutes of its group's first start (or within its title line)
  /// sits beside it; a later start nests, indented and drawn on top.
  public static let overlapCloseMinutes = 20.0
  /// A nested block's inset from the left edge of the block it starts inside.
  public static let overlapIndent = 14.0
  /// A nested group is never narrower than this.
  public static let overlapMinimumNestedWidth = 40.0
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
    // Dense-day rules: a column under 22 pt shows its colour only.
    let wordsFit = width >= DayframeCalendarConstants.sliverMaximumWidth
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
  /// The width blocks are laid out across: right of the hour labels and any bracket rail.
  public static func laneWidth(availableWidth: Double, hourLabelWidth: Double, leadingInset: Double = 0) -> Double {
    max(0, availableWidth - hourLabelWidth - 18 - max(0, leadingInset.isFinite ? leadingInset : 0))
  }

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
    let blockWidth = laneWidth(availableWidth: availableWidth, hourLabelWidth: hourLabelWidth, leadingInset: inset)
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
  public let continuesIntoNextDay: Bool
  public let height: Double
  public let startsBeforeDay: Bool
  public let top: Double

  public init(
    continuesIntoNextDay: Bool,
    height: Double,
    startsBeforeDay: Bool,
    top: Double
  ) {
    self.continuesIntoNextDay = continuesIntoNextDay
    self.height = height
    self.startsBeforeDay = startsBeforeDay
    self.top = top
  }
}

/// A block's label (dense-day rules, Calendar v3): the title always wins and wraps to the whole lines
/// that fit, in bold; under it, with room in a column at least 120 points wide, the icon lines (place,
/// tags, times) while they fit. Compact type under 34 points tall or 90 wide; colour only under 22 wide.
public struct DayframeCalendarDenseLabel: Equatable {
  public let sliver: Bool
  public let compact: Bool
  /// Icon lines the block has room for under one title line (0 when compact or narrower than 120).
  public let detailLinesAvailable: Int
  public let titleFontSize: Double
  public let titleLineHeight: Double
  public let detailFontSize: Double
  public let detailLineHeight: Double
  /// Inside the drawn block: the colour bar's side, the trailing side, and the top.
  public let leadingPadding: Double
  public let trailingPadding: Double
  public let verticalPadding: Double
  /// The room under the top padding (the last line may use the bottom padding, as the mock-up does).
  public let room: Double

  /// Title lines when `detailCount` icon lines are wanted: room is kept for as many of them as fit
  /// under one title line, and the title takes every whole line left (at least one: the title wins).
  public func titleLines(detailCount: Int) -> Int {
    guard !sliver else { return 0 }
    let reserved = Double(min(max(0, detailCount), detailLinesAvailable)) * detailLineHeight
    // Never a line in a block too short to show one (an older bundle's 4-point blocks show colour only).
    guard room >= titleLineHeight - 2 else { return 0 }
    return max(1, Int(floor((room - reserved) / titleLineHeight)))
  }

  /// Icon lines that fit under `titleLines` title lines.
  public func detailLines(titleLines: Int, detailCount: Int) -> Int {
    guard detailLinesAvailable > 0, titleLines > 0 else { return 0 }
    let left = room - Double(titleLines) * titleLineHeight
    return min(max(0, detailCount), max(0, Int(floor(left / detailLineHeight))))
  }
}

public enum DayframeCalendarDenseLabelMath {
  /// `height` is the drawn height (after the gap), `width` the drawn width; both in points.
  public static func label(height: Double, width: Double, textScale: Double = 1) -> DayframeCalendarDenseLabel {
    let scale = DayframeCalendarDayLayout.clampedTextScale(textScale)
    let safeHeight = max(0, height.isFinite ? height : 0)
    let safeWidth = max(0, width.isFinite ? width : 0)
    let sliver = safeWidth < DayframeCalendarConstants.sliverMaximumWidth
    let compact = safeHeight < DayframeCalendarConstants.compactTextMaximumHeight * max(1, scale)
      || safeWidth < DayframeCalendarConstants.compactTextMaximumWidth
    // calendar-v3-mockup: compact 11.5 on 14, regular 14 on 17, icon lines 12 on 15.
    let line = (compact ? 14.0 : 17.0) * scale
    let detailLine = 15.0 * scale
    let verticalPadding = 2.0
    let room = safeHeight - verticalPadding
    let detailLinesAvailable = !sliver && !compact && safeWidth >= DayframeCalendarConstants.detailMinimumWidth
      ? max(0, Int(floor((room - line) / detailLine)))
      : 0
    return DayframeCalendarDenseLabel(
      sliver: sliver,
      compact: compact,
      detailLinesAvailable: detailLinesAvailable,
      titleFontSize: (compact ? 11.5 : 14.0) * scale,
      titleLineHeight: line,
      detailFontSize: 12.0 * scale,
      detailLineHeight: detailLine,
      leadingPadding: 8,
      trailingPadding: 6,
      verticalPadding: verticalPadding,
      room: room
    )
  }
}

/// Fits a title into whole lines (dense-day rules): words are never split. A line that runs out of room
/// ends with an ellipsis after its last whole word; a word wider than a whole line is left out with
/// every word after it, so nothing is ever shown in part, and no lines at all mean colour only.
public enum DayframeCalendarTitleFit {
  public static let ellipsis = "\u{2026}"

  public static func lines(
    words: [String],
    maxLines: Int,
    width: Double,
    cutFirstWord: Bool = false,
    measure: (String) -> Double
  ) -> [String] {
    guard maxLines > 0, width > 0 else { return [] }
    let fitted = wholeWordLines(words: words, maxLines: maxLines, width: width, measure: measure)
    // Calendar v3 (owner OK, 24 Oct 2026): when not even the first word fits, the title still wins, cut
    // with an ellipsis as Apple does ("Quart…"), keeping at least two letters; otherwise colour only.
    guard cutFirstWord, fitted.isEmpty, let first = words.first(where: { !$0.isEmpty }) else { return fitted }
    var letters = Array(first)
    while letters.count > 2, measure(String(letters) + ellipsis) > width { letters.removeLast() }
    let cut = String(letters) + ellipsis
    return letters.count >= 2 && measure(cut) <= width ? [cut] : []
  }

  private static func wholeWordLines(
    words: [String],
    maxLines: Int,
    width: Double,
    measure: (String) -> Double
  ) -> [String] {
    var lines: [[String]] = []
    var current: [String] = []
    var cut = false
    for word in words where !word.isEmpty {
      if measure((current + [word]).joined(separator: " ")) <= width {
        current.append(word)
        continue
      }
      if !current.isEmpty {
        if lines.count < maxLines { lines.append(current) } else { cut = true }
        current = []
      }
      if cut || lines.count >= maxLines || measure(word) > width {
        cut = true
        break
      }
      current = [word]
    }
    if !current.isEmpty {
      if lines.count < maxLines { lines.append(current) } else { cut = true }
    }
    var out = lines.map { $0.joined(separator: " ") }
    guard cut, var last = lines.last else { return out }
    out.removeLast()
    while true {
      let text = last.joined(separator: " ") + ellipsis
      if measure(text) <= width {
        out.append(text)
        break
      }
      if last.count > 1 {
        last.removeLast()
      } else {
        // No room for the ellipsis beside the one whole word: the word alone.
        out.append(last.joined(separator: " "))
        break
      }
    }
    return out
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
    textScale: Double = 1,
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
      continuesIntoNextDay: effectiveStopMs > dayEndMs,
      height: height,
      startsBeforeDay: startedAtMs < dayStartMs,
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
  /// Columns it spans: 1, or more when it widens right into columns free for its whole drawn height.
  public let spanCount: Int
  public let offsetFraction: Double
  public let widthFraction: Double
  public let zIndex: Int
}

/// Side-by-side columns over drawn extents (location v4 C6), the same rule as the shared
/// `layoutCalendarBlockColumns` on the web: blocks are taken by top, then id; a cluster
/// grows while the next block starts above its lowest bottom; each block takes the leftmost column
/// whose last block has ended by its top. Every block in a cluster is 1 / columns wide, or, with
/// `expandRight` (dense-day rules), widens right while the next column is free for its whole height.
/// O(n log n) to place, plus the widening check within each cluster.
public enum DayframeCalendarColumnMath {
  /// `tolerance`: drawn edges this close count as touching.
  public static func layout(
    _ blocks: [DayframeCalendarDrawnBlock],
    tolerance: Double = DayframeCalendarConstants.columnTouchTolerance,
    expandRight: Bool = false
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
    var cluster: [(id: String, column: Int, top: Double, bottom: Double)] = []
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
        var span = 1
        if expandRight {
          while member.column + span < count, !cluster.contains(where: { other in
            other.column == member.column + span
              && other.top < member.bottom - tolerance
              && other.bottom > member.top + tolerance
          }) {
            span += 1
          }
        }
        out.append(DayframeCalendarColumn(
          id: member.id,
          columnIndex: member.column,
          columnCount: count,
          spanCount: span,
          offsetFraction: Double(member.column) / Double(count),
          widthFraction: Double(span) / Double(count),
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
      cluster.append((item.id, column, item.top, item.bottom))
      clusterBottom = max(clusterBottom, item.bottom)
    }
    flush()
    return out
  }
}

public struct DayframeCalendarHybridBlock: Equatable {
  public let id: String
  public let top: Double
  public let bottom: Double

  public init(id: String, top: Double, bottom: Double) {
    self.id = id
    self.top = top
    self.bottom = bottom
  }
}

public struct DayframeCalendarHybridPlacement: Equatable {
  public let id: String
  /// Points from the lane's left edge, and the width, before the visual gap.
  public let x: Double
  public let width: Double
  /// 0 for a block on the lane, +1 for each block it nests inside.
  public let depth: Int
  public let columnIndex: Int
  public let columnCount: Int
}

/// Calendar v3: Apple Calendar's hybrid overlap (calendar-v3-mockup `layout`). Blocks are taken by top,
/// longer first. A block whose start is close to the first start of a group still running here joins
/// that group, and the group's members share equal columns (spreading right while free). Any other
/// block that starts while blocks are running nests: it starts a group of its own, indented
/// `overlapIndent` from the left edge of the latest-starting running block, drawn on top of it, and
/// reaching right until a block not under it is still running there.
public enum DayframeCalendarHybridMath {
  public static func layout(
    _ blocks: [DayframeCalendarHybridBlock],
    laneWidth: Double,
    closeDistance: Double,
    tolerance: Double = DayframeCalendarConstants.columnTouchTolerance
  ) -> [DayframeCalendarHybridPlacement] {
    let width = max(0, laneWidth.isFinite ? laneWidth : 0)
    let close = max(0, closeDistance.isFinite ? closeDistance : 0)
    var seen = Set<String>()
    let items = blocks
      .filter { block in
        guard !block.id.isEmpty, block.top.isFinite, block.bottom.isFinite, !seen.contains(block.id) else { return false }
        seen.insert(block.id)
        return true
      }
      .map { DayframeCalendarHybridBlock(id: $0.id, top: $0.top, bottom: max($0.top, $0.bottom)) }
      .sorted { left, right in
        if left.top != right.top { return left.top < right.top }
        let leftHeight = left.bottom - left.top, rightHeight = right.bottom - right.top
        if leftHeight != rightHeight { return leftHeight > rightHeight }
        return left.id.utf16.lexicographicallyPrecedes(right.id.utf16)
      }

    struct Group {
      let firstTop: Double
      let firstBottom: Double
      let parent: Int?
      let depth: Int
      var members: [Int] = []
      var columns: [[Int]] = []
    }
    var groups: [Group] = []
    var groupOf: [Int] = []
    var column: [Int] = []
    // Indices of blocks still running at the current top, so each step looks only at live blocks.
    var running: [Int] = []
    for (index, item) in items.enumerated() {
      running.removeAll { items[$0].bottom <= item.top + tolerance }
      let joined = running
        .map { groupOf[$0] }
        .filter { item.top - groups[$0].firstTop < close }
        .min()
      let group: Int
      if let joined {
        group = joined
      } else {
        // Nested inside the latest-starting running block (the deepest when tied, then the first placed,
        // as the mock-up's stable sort); on the lane when none runs.
        var parent: Int?
        for candidate in running {
          guard let best = parent else { parent = candidate; continue }
          let later = items[candidate].top > items[best].top
          let deeper = items[candidate].top == items[best].top && groups[groupOf[candidate]].depth > groups[groupOf[best]].depth
          if later || deeper { parent = candidate }
        }
        groups.append(Group(
          firstTop: item.top,
          firstBottom: item.bottom,
          parent: parent,
          depth: parent.map { groups[groupOf[$0]].depth + 1 } ?? 0
        ))
        group = groups.count - 1
      }
      groups[group].members.append(index)
      let free = groups[group].columns.firstIndex { lane in items[lane.last!].bottom <= item.top + tolerance }
      if let free {
        groups[group].columns[free].append(index)
        column.append(free)
      } else {
        groups[group].columns.append([index])
        column.append(groups[group].columns.count - 1)
      }
      groupOf.append(group)
      running.append(index)
    }

    var x = [Double](repeating: 0, count: items.count)
    var placedWidth = [Double](repeating: 0, count: items.count)
    var resolved = [Bool](repeating: false, count: items.count)
    var out: [DayframeCalendarHybridPlacement] = []
    out.reserveCapacity(items.count)
    for (groupIndex, group) in groups.enumerated() {
      var left = 0.0
      var right = width
      if let parent = group.parent {
        left = x[parent] + DayframeCalendarConstants.overlapIndent
        // Stop short of a block already placed to the right of the parent, at its depth or shallower,
        // that is still running beside this group's first block.
        let parentDepth = groups[groupOf[parent]].depth
        for other in items.indices where resolved[other]
          && other != parent
          && groupOf[other] != groupIndex
          && items[other].top < group.firstBottom
          && items[other].bottom > group.firstTop
          && x[other] > x[parent]
          && groups[groupOf[other]].depth <= parentDepth {
          right = min(right, x[other] - DayframeCalendarConstants.blockVisualGap)
        }
        left = min(left, max(0, width - DayframeCalendarConstants.overlapMinimumNestedWidth))
        right = min(width, max(left + DayframeCalendarConstants.overlapMinimumNestedWidth, right))
      }
      let count = max(1, group.columns.count)
      let columnWidth = (right - left) / Double(count)
      for member in group.members {
        var span = 1
        while column[member] + span < count, !group.columns[column[member] + span].contains(where: { other in
          items[other].top < items[member].bottom - tolerance && items[other].bottom > items[member].top + tolerance
        }) {
          span += 1
        }
        x[member] = left + Double(column[member]) * columnWidth
        placedWidth[member] = columnWidth * Double(span)
        resolved[member] = true
        out.append(DayframeCalendarHybridPlacement(
          id: items[member].id,
          x: x[member],
          width: placedWidth[member],
          depth: group.depth,
          columnIndex: column[member],
          columnCount: count
        ))
      }
    }
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
  /// A finished block of a minute or less: a tick at the gutter's edge, outside the block layout.
  public let isMoment: Bool
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
    isMoment: Bool = false,
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
    self.isMoment = isMoment
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
  /// Calendar v3: each nesting depth draws above every column of the depth below it, for any crowd.
  public static let depthZIndexStride = 1_000_000
  /// Moments draw above every block.
  public static let momentZIndex = 1_000_000_000

  /// One label line at the given Dynamic Type scale (capped like the metadata text): the mock-up's
  /// `MIN_H`, the gap below included, so columns form exactly where calendar-dense-mockup v2 forms
  /// them. What is painted (2 points less) holds one compact line and its padding at every scale.
  public static func labelMinimumHeight(textScale: Double) -> Double {
    DayframeCalendarConstants.labelLineMinimumHeight * clampedTextScale(textScale)
  }

  /// The label's Dynamic Type scale, capped like the metadata text.
  public static func clampedTextScale(_ textScale: Double) -> Double {
    let safe = textScale.isFinite ? textScale : 1
    return min(DayframeCalendarConstants.maximumLabelTextScale, max(0.8, safe))
  }

  public static func layout(
    entries: [DayframeCalendarLayoutInput],
    nowMs: Double,
    dayStartMs: Double,
    dayEndMs: Double,
    hourHeight: Double,
    textScale: Double = 1,
    laneWidth: Double? = nil,
    calendar: Calendar = .current
  ) -> [String: DayframeCalendarLaidOutEntry] {
    let minimumHeight = labelMinimumHeight(textScale: textScale)
    var blocks: [String: DayframeCalendarBlockMetrics] = [:]
    var groups: [String: [DayframeCalendarDrawnBlock]] = [:]
    for entry in entries where !entry.isMoment {
      guard let block = DayframeCalendarBlockMath.metrics(
        startedAtMs: entry.startedAtMs,
        stoppedAtMs: entry.stoppedAtMs,
        nowMs: nowMs,
        dayStartMs: dayStartMs,
        dayEndMs: dayEndMs,
        hourHeight: hourHeight,
        minimumHeight: entry.columnGroup == nil ? DayframeCalendarConstants.legacyMinimumBlockHeight : minimumHeight,
        textScale: textScale,
        calendar: calendar
      ) else { continue }
      blocks[entry.id] = block
      if entry.columnGroup != nil {
        // Dense-day rules: logged blocks and Review suggestions share one set of columns over what
        // is drawn (the minimum label height and the gap below included), so nothing is ever drawn
        // on top of another and a suggestion needs no lane of its own.
        groups["day", default: []].append(DayframeCalendarDrawnBlock(id: entry.id, top: block.top, bottom: block.top + block.height))
      }
    }
    var columns: [String: DayframeCalendarColumn] = [:]
    // Nested blocks (Calendar v3) sit inside their parent's horizontal space, so their targets are shared.
    var nested = Set<String>()
    if let laneWidth, laneWidth.isFinite, laneWidth > 0 {
      // Calendar v3: Apple's hybrid overlap in the lane's own points (the indent is in points), sent on
      // as fractions of the lane. Close starts share columns; a later start nests on top, indented.
      let close = max(DayframeCalendarConstants.overlapCloseMinutes / 60 * hourHeight, minimumHeight)
      for (_, members) in groups {
        let placements = DayframeCalendarHybridMath.layout(
          members.map { DayframeCalendarHybridBlock(id: $0.id, top: $0.top, bottom: $0.bottom) },
          laneWidth: laneWidth,
          closeDistance: close
        )
        for placement in placements {
          if placement.depth > 0 { nested.insert(placement.id) }
          // The painted block keeps a 2-point gap on its right, so side-by-side blocks never touch.
          let paintedWidth = max(0, placement.width - DayframeCalendarConstants.blockVisualGap)
          columns[placement.id] = DayframeCalendarColumn(
            id: placement.id,
            columnIndex: placement.columnIndex,
            columnCount: placement.columnCount,
            spanCount: 1,
            offsetFraction: placement.x / laneWidth,
            widthFraction: paintedWidth / laneWidth,
            zIndex: min(placement.depth, 999) * depthZIndexStride + min(placement.columnIndex, depthZIndexStride - 2) + 1
          )
        }
      }
    } else {
      for (_, members) in groups {
        for column in DayframeCalendarColumnMath.layout(members, expandRight: true) {
          columns[column.id] = column
        }
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
      // A nested block lies wholly inside its parent's space (the parent's interval contains its target,
      // which the top and bottom search below would not find), so it keeps its own height (Codex r5 on #580).
      var sharesTarget = nested.contains(item.id)
      if !sharesTarget, item.block.height < 44 {
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

/// A moment (dense-day rules): a finished block of a minute or less, drawn as a short tick with a dot
/// at the gutter's edge, just left of the blocks, so it never crosses one. Its 44-point square target
/// lies over the hour labels' edge, never over a block, and stays inside the day like a block's.
public enum DayframeCalendarMomentMath {
  public static let targetSize = 44.0
  /// Where the tick is drawn: the day's own clipped start (one across midnight sits at the top).
  public static func top(
    startedAtMs: Double,
    stoppedAtMs: Double,
    dayStartMs: Double,
    dayEndMs: Double,
    hourHeight: Double,
    calendar: Calendar = .current
  ) -> Double? {
    DayframeCalendarBlockMath.metrics(
      startedAtMs: startedAtMs,
      stoppedAtMs: stoppedAtMs,
      nowMs: stoppedAtMs,
      dayStartMs: dayStartMs,
      dayEndMs: dayEndMs,
      hourHeight: hourHeight,
      minimumHeight: DayframeCalendarConstants.minimumVisualBlockHeight,
      calendar: calendar
    )?.top
  }

  /// The target ends where the blocks begin (`hourLabelWidth + 8`).
  public static func hitFrame(top: Double, hourLabelWidth: Double, timelineHeight: Double) -> DayframeCalendarHitFrame {
    let maxX = hourLabelWidth + 8
    let minY = min(max(0, top - targetSize / 2), max(0, timelineHeight - targetSize))
    return DayframeCalendarHitFrame(minX: maxX - targetSize, maxX: maxX, minY: minY, maxY: minY + targetSize)
  }

  /// Every moment's target, in the order given, resolved together (Codex r1 and r2 on #580). Ticks at
  /// the same time form one group with one target; between groups each target stops at the midpoint to
  /// its neighbour, so a tap opens the nearest. A group's target is split into equal slices, one per
  /// moment in the order given, so every moment keeps a target of its own, at the day's edges too.
  public static func hitFrames(tops: [Double], hourLabelWidth: Double, timelineHeight: Double) -> [DayframeCalendarHitFrame] {
    let order = tops.indices.sorted { tops[$0] != tops[$1] ? tops[$0] < tops[$1] : $0 < $1 }
    var groups: [[Int]] = []
    for index in order {
      if let last = groups.last?.last, abs(tops[last] - tops[index]) < 0.5 {
        groups[groups.count - 1].append(index)
      } else {
        groups.append([index])
      }
    }
    var frames = tops.map { hitFrame(top: $0, hourLabelWidth: hourLabelWidth, timelineHeight: timelineHeight) }
    for (rank, group) in groups.enumerated() {
      let top = tops[group[0]]
      let base = hitFrame(top: top, hourLabelWidth: hourLabelWidth, timelineHeight: timelineHeight)
      var minY = base.minY
      var maxY = base.maxY
      if rank > 0 { minY = max(minY, (tops[groups[rank - 1][0]] + top) / 2) }
      if rank + 1 < groups.count { maxY = min(maxY, (top + tops[groups[rank + 1][0]]) / 2) }
      let slice = (maxY - minY) / Double(group.count)
      for (position, index) in group.sorted().enumerated() {
        let sliceTop = minY + Double(position) * slice
        frames[index] = DayframeCalendarHitFrame(minX: base.minX, maxX: base.maxX, minY: sliceTop, maxY: sliceTop + slice)
      }
    }
    return frames
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
