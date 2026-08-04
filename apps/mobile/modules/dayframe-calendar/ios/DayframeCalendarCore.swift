import Foundation

public enum DayframeCalendarConstants {
  public static let defaultHourHeight = 72.0
  public static let minimumHourHeight = 48.0
  public static let maximumHourHeight = 128.0
  public static let minutesPerDay = 24.0 * 60.0
  public static let minimumVisibleBlockHeight = 4.0
  public static let minimumVisualBlockHeight = 1.0
  public static let blockCornerRadius = 8.0
  public static let blockVisualGap = 1.0
  public static let titleMinimumHeight = 24.0
  public static let metaMinimumHeight = 58.0
  public static let titleMinimumWidth = 64.0
  public static let metaMinimumWidth = 150.0
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
    let densityAllowsTitle = textDensity != "none"
    let densityAllowsMeta = textDensity == "full"
    return DayframeCalendarHorizontalMetrics(
      offset: safeAvailableWidth * safeOffsetFraction,
      width: width,
      hitHeight: overlapCount > 0 ? safeSemanticHeight : max(44, safeSemanticHeight),
      showMeta: densityAllowsMeta && width >= DayframeCalendarConstants.metaMinimumWidth,
      showTitle: densityAllowsTitle && width >= DayframeCalendarConstants.titleMinimumWidth
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
  public static func metrics(
    semanticTop: Double,
    semanticHeight: Double,
    hitHeight: Double
  ) -> DayframeCalendarVerticalMetrics {
    let safeSemanticTop = semanticTop.isFinite ? semanticTop : 0
    let safeSemanticHeight = max(0, semanticHeight.isFinite ? semanticHeight : 0)
    let safeHitHeight = max(
      safeSemanticHeight,
      hitHeight.isFinite ? hitHeight : safeSemanticHeight
    )

    return DayframeCalendarVerticalMetrics(
      hitHeight: safeHitHeight,
      hitCenterY: safeSemanticTop + safeSemanticHeight / 2,
      visualOffsetWithinHitTarget: (safeHitHeight - safeSemanticHeight) / 2
    )
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
    // Semantic block math normally supplies at least 4 pt. Clamp malformed direct
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
    let height = max(
      DayframeCalendarConstants.minimumVisibleBlockHeight,
      (durationMinutes / 60.0) * safeHourHeight
    )
    return DayframeCalendarBlockMetrics(
      compact: height < DayframeCalendarConstants.metaMinimumHeight,
      continuesIntoNextDay: effectiveStopMs > dayEndMs,
      height: height,
      showMeta: height >= DayframeCalendarConstants.metaMinimumHeight,
      showTitle: height >= DayframeCalendarConstants.titleMinimumHeight,
      startsBeforeDay: startedAtMs < dayStartMs,
      tiny: height < DayframeCalendarConstants.titleMinimumHeight,
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
