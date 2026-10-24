import Combine
import SwiftUI

struct DayframeCalendarTheme: Equatable {
  let accent: String
  let accentSoft: String
  let accentText: String
  let background: String
  let border: String
  let borderStrong: String
  let danger: String
  let dangerText: String
  let mode: String
  let onAccent: String
  let shadow: String
  let surface: String
  let surfaceMuted: String
  let surfaceRaised: String
  let textMuted: String
  let textPrimary: String
  let textSecondary: String
  let warning: String
  let warningText: String

  init(_ record: DayframeCalendarThemeRecord) {
    accent = record.accent
    accentSoft = record.accentSoft
    accentText = record.accentText
    background = record.background
    border = record.border
    borderStrong = record.borderStrong
    danger = record.danger ?? (record.mode == "light" ? "#D94F4F" : "#FF6B6B")
    dangerText = record.dangerText ?? (record.mode == "light" ? "#B42318" : "#FF6B6B")
    mode = record.mode
    onAccent = record.onAccent
    shadow = record.shadow
    surface = record.surface
    surfaceMuted = record.surfaceMuted
    surfaceRaised = record.surfaceRaised
    textMuted = record.textMuted
    textPrimary = record.textPrimary
    textSecondary = record.textSecondary
    warning = record.warning
    warningText = record.warningText
  }
}

struct DayframeCalendarWeekDay: Equatable, Identifiable {
  let accessibilityLabel: String
  let bars: [String]
  let dayKey: String
  let dayNumber: String
  let isSelected: Bool
  let isToday: Bool
  let weekdayLabel: String

  var id: String { dayKey }

  init(_ record: DayframeCalendarWeekDayRecord) {
    accessibilityLabel = record.accessibilityLabel
    bars = Array(record.bars.prefix(3))
    dayKey = record.dayKey
    dayNumber = record.dayNumber
    isSelected = record.isSelected
    isToday = record.isToday
    weekdayLabel = record.weekdayLabel
  }
}

struct DayframeCalendarEntry: Equatable, Identifiable {
  let accessibilityLabel: String
  let actionTarget: DayframeCalendarActionTarget
  let color: String
  let columnGroup: String?
  let continuesIntoNextDay: Bool
  let detailLines: [DayframeCalendarDetailLineRecord]
  let entryId: String
  let glyph: String?
  let isActive: Bool
  let isMoment: Bool
  let isReview: Bool
  let isUncategorized: Bool
  let laneCount: Int
  let laneIndex: Int
  let layoutMode: String
  let lengthLabel: String?
  let meta: String
  let offsetFraction: Double
  let overlapCount: Int
  let overlapSeconds: Double
  let placeText: String?
  let regionOffsetFraction: Double
  let regionWidthFraction: Double
  let startedAtMs: Double
  let startsBeforeDay: Bool
  let stoppedAtMs: Double?
  let tagText: String?
  let textColor: String
  let textDensity: String
  let title: String
  let warningOverlapCount: Int
  let widthFraction: Double
  let zIndex: Int

  var id: String { entryId }

  init(_ record: DayframeCalendarEntryRecord) {
    accessibilityLabel = record.accessibilityLabel
    actionTarget = DayframeCalendarActionTarget(
      id: record.actionId,
      kind: DayframeCalendarActionKind(rawValue: record.actionKind) ?? .completed
    )
    color = record.color
    columnGroup = record.columnGroup
    continuesIntoNextDay = record.continuesIntoNextDay
    detailLines = record.detailLines ?? [DayframeCalendarDetailLineRecord(glyph: "time", text: record.meta)]
    entryId = record.entryId
    glyph = record.glyph
    isActive = record.isActive
    isMoment = record.isMoment ?? false
    isReview = record.isReview
    isUncategorized = record.isUncategorized
    laneCount = max(1, record.laneCount)
    laneIndex = max(0, record.laneIndex)
    layoutMode = record.layoutMode
    lengthLabel = record.lengthLabel
    meta = record.meta
    offsetFraction = record.offsetFraction
    overlapCount = max(0, record.overlapCount)
    overlapSeconds = max(0, record.overlapSeconds)
    placeText = record.placeText
    regionOffsetFraction = record.regionOffsetFraction ?? 0
    regionWidthFraction = record.regionWidthFraction ?? 1
    startedAtMs = record.startedAtMs
    startsBeforeDay = record.startsBeforeDay
    stoppedAtMs = record.stoppedAtMs
    tagText = record.tagText
    textColor = record.textColor
    textDensity = record.textDensity
    title = record.title
    warningOverlapCount = max(0, record.warningOverlapCount)
    widthFraction = record.widthFraction
    zIndex = record.zIndex
  }

  var layoutInput: DayframeCalendarLayoutInput {
    DayframeCalendarLayoutInput(
      id: entryId,
      startedAtMs: startedAtMs,
      stoppedAtMs: stoppedAtMs,
      columnGroup: columnGroup,
      isMoment: isMoment,
      regionOffsetFraction: regionOffsetFraction,
      regionWidthFraction: regionWidthFraction,
      fallbackOffsetFraction: offsetFraction,
      fallbackWidthFraction: widthFraction,
      fallbackZIndex: zIndex
    )
  }
}

/// A named pattern's bracket (location v3 PR 14b): drawn beside its parts, which stay blocks.
struct DayframeCalendarBracket: Equatable, Identifiable {
  let key: String
  let memberIds: [String]
  let name: String
  let startedAtMs: Double
  let stoppedAtMs: Double

  var id: String { key }

  init(_ record: DayframeCalendarBracketRecord) {
    key = record.key
    memberIds = record.memberIds
    name = record.name
    startedAtMs = record.startedAtMs
    stoppedAtMs = record.stoppedAtMs
  }
}

struct DayframeCalendarPresentation: Equatable {
  let brackets: [DayframeCalendarBracket]
  let dayEndMs: Double
  let dayStartMs: Double
  let emptyState: String
  let entries: [DayframeCalendarEntry]
  let framedLabel: String
  let framedAccessibilityLabel: String
  let hapticsEnabled: Bool
  /// Calendar › Grid or List (location v4 step 9): in List the view draws only its header and week
  /// strip, and the app draws the List under it.
  let isList: Bool
  /// "12h" or "24h" (PRD D18): the hour grid, now marker and drag preview follow it.
  let clockFormat: String
  let modelVersion: Int
  let monthTitle: String
  let nowMs: Double
  let reduceMotion: Bool
  let reduceTransparency: Bool
  let refreshing: Bool
  let selectedDayKey: String
  let selectedDayTitle: String
  let theme: DayframeCalendarTheme
  let todayKey: String
  let additionalOverlapSeconds: Double
  let coveredLabel: String
  let coveredSeconds: Double
  let loggedLabel: String
  let loggedSeconds: Double
  let totalLabel: String
  let totalSeconds: Double
  let transitionDirection: Int
  let weekDays: [DayframeCalendarWeekDay]

  init(_ record: DayframeCalendarPresentationRecord) {
    brackets = (record.brackets ?? []).map(DayframeCalendarBracket.init)
    dayEndMs = record.dayEndMs
    dayStartMs = record.dayStartMs
    emptyState = record.emptyState
    entries = record.entries.map(DayframeCalendarEntry.init)
    framedLabel = record.framedLabel
    framedAccessibilityLabel = record.framedAccessibilityLabel ?? record.framedLabel
    hapticsEnabled = record.hapticsEnabled
    isList = record.layout == "list"
    clockFormat = record.clockFormat == "12h" ? "12h" : "24h"
    modelVersion = record.modelVersion
    monthTitle = record.monthTitle
    nowMs = record.nowMs
    reduceMotion = record.reduceMotion
    reduceTransparency = record.reduceTransparency
    refreshing = record.refreshing
    selectedDayKey = record.selectedDayKey
    selectedDayTitle = record.selectedDayTitle
    theme = DayframeCalendarTheme(record.theme)
    todayKey = record.todayKey
    additionalOverlapSeconds = max(0, record.additionalOverlapSeconds)
    coveredLabel = record.coveredLabel
    coveredSeconds = max(0, record.coveredSeconds)
    loggedLabel = record.loggedLabel
    loggedSeconds = max(0, record.loggedSeconds)
    totalLabel = record.totalLabel
    totalSeconds = record.totalSeconds
    transitionDirection = record.transitionDirection < 0 ? -1 : 1
    weekDays = record.weekDays.map(DayframeCalendarWeekDay.init)
  }

  static let empty = DayframeCalendarPresentation(DayframeCalendarPresentationRecord())

  /// Dense-day rules: a bracket's rail and name sit in the hour gutter, so blocks keep the full width.
  var entryLeadingInset: Double { 0 }
}

/// A moment as the entries layer draws it and the coordinator hit-tests it (dense-day rules).
struct DayframeCalendarMomentPlacement {
  let entry: DayframeCalendarEntry
  let top: Double
  let frame: DayframeCalendarHitFrame
}

enum DayframeCalendarMomentLayout {
  /// The day's moments with their ticks and targets, resolved together (DayframeCalendarMomentMath.hitFrames).
  static func layout(presentation: DayframeCalendarPresentation, hourHeight: Double, hourLabelWidth: Double) -> [DayframeCalendarMomentPlacement] {
    let placed = presentation.entries.compactMap { entry -> (DayframeCalendarEntry, Double)? in
      guard entry.isMoment, let stoppedAtMs = entry.stoppedAtMs, let top = DayframeCalendarMomentMath.top(
        startedAtMs: entry.startedAtMs,
        stoppedAtMs: stoppedAtMs,
        dayStartMs: presentation.dayStartMs,
        dayEndMs: presentation.dayEndMs,
        hourHeight: hourHeight
      ) else {
        return nil
      }
      return (entry, top)
    }
    let frames = DayframeCalendarMomentMath.hitFrames(tops: placed.map(\.1), hourLabelWidth: hourLabelWidth, timelineHeight: 24 * hourHeight)
    return zip(placed, frames).map { DayframeCalendarMomentPlacement(entry: $0.0.0, top: $0.0.1, frame: $0.1) }
  }
}

/// One press of the header's zoom − / + buttons. The scroll coordinator, the timeline's only
/// geometry owner, animates it around the viewport centre and records the token it has handled.
struct DayframeCalendarZoomRequest: Equatable {
  let token: UInt64
  let direction: Int
}

struct DayframeCalendarCreationPreview: Equatable {
  let sessionToken: UInt64
  let dayKey: String
  let startMinute: Int
  let durationMinutes: Int
}

@MainActor
final class DayframeCalendarViewModel: ObservableObject {
  @Published private(set) var presentation = DayframeCalendarPresentation.empty
  @Published private(set) var hourHeight = CGFloat(DayframeCalendarConstants.defaultHourHeight)
  @Published private(set) var creationPreview: DayframeCalendarCreationPreview?
  @Published private(set) var zoomRequest: DayframeCalendarZoomRequest?
  /// The Dynamic Type scale of the block labels, set by the hosting view from its traits, so drawing
  /// and hit testing size the one-line minimum alike (location v4 C6).
  @Published private(set) var labelTextScale: Double = 1
  private var nextCreationSessionToken: UInt64 = 0
  private var nextZoomToken: UInt64 = 0

  var canZoomIn: Bool { Double(hourHeight) < DayframeCalendarConstants.maximumHourHeight - 0.5 }
  var canZoomOut: Bool { Double(hourHeight) > DayframeCalendarConstants.minimumHourHeight + 0.5 }

  func requestZoom(direction: Int) {
    guard direction > 0 ? canZoomIn : canZoomOut else { return }
    nextZoomToken &+= 1
    zoomRequest = DayframeCalendarZoomRequest(token: nextZoomToken, direction: direction > 0 ? 1 : -1)
  }

  func update(_ record: DayframeCalendarPresentationRecord) {
    guard record.modelVersion == 4 else {
      reset()
      return
    }
    let next = DayframeCalendarPresentation(record)
    guard next != presentation else { return }
    withTransaction(Transaction(animation: nil)) {
      presentation = next
      if creationPreview?.dayKey != next.selectedDayKey {
        creationPreview = nil
      }
    }
  }

  func reset() {
    withTransaction(Transaction(animation: nil)) {
      presentation = .empty
      creationPreview = nil
    }
  }

  func updateHourHeight(_ nextHourHeight: Double) {
    let clamped = CGFloat(DayframeCalendarZoomMath.clampHourHeight(nextHourHeight))
    guard clamped != hourHeight else { return }
    // Zoom is direct manipulation: columns and label tiers follow the fingers with no easing, so
    // even the lane modifier's own animation is disabled for zoom-driven changes.
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      hourHeight = clamped
    }
  }

  func updateLabelTextScale(_ scale: Double) {
    guard scale.isFinite, abs(scale - labelTextScale) > 0.001 else { return }
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      labelTextScale = scale
    }
  }

  @discardableResult
  func beginCreationPreview(dayKey: String, startMinute: Int) -> UInt64 {
    nextCreationSessionToken &+= 1
    if nextCreationSessionToken == 0 {
      nextCreationSessionToken = 1
    }
    let token = nextCreationSessionToken
    withTransaction(Transaction(animation: nil)) {
      creationPreview = DayframeCalendarCreationPreview(
        sessionToken: token,
        dayKey: dayKey,
        startMinute: startMinute,
        durationMinutes: DayframeCalendarConstants.creationPreviewDurationMinutes
      )
    }
    return token
  }

  @discardableResult
  func updateCreationPreview(sessionToken: UInt64, startMinute: Int) -> Bool {
    guard
      let current = creationPreview,
      current.sessionToken == sessionToken,
      current.startMinute != startMinute
    else {
      return false
    }
    withTransaction(Transaction(animation: nil)) {
      creationPreview = DayframeCalendarCreationPreview(
        sessionToken: current.sessionToken,
        dayKey: current.dayKey,
        startMinute: startMinute,
        durationMinutes: current.durationMinutes
      )
    }
    return true
  }

  func clearCreationPreview(sessionToken: UInt64? = nil) {
    guard
      creationPreview != nil,
      sessionToken == nil || creationPreview?.sessionToken == sessionToken
    else {
      return
    }
    withTransaction(Transaction(animation: nil)) {
      creationPreview = nil
    }
  }
}

struct DayframeCalendarActions {
  let changeDay: (Int) -> Void
  let changeWeek: (Int) -> Void
  let open: (DayframeCalendarActionTarget) -> Void
  let requestCreateEntry: (DayframeCalendarCreateRequest) -> Void
  let requestRefresh: () -> Void
  let selectDay: (String) -> Void
  /// Grid · List in the header (location v4 step 9).
  let changeLayout: (String) -> Void
  /// In List: the height the header and week strip need, so the app sizes the view to them.
  let reportHeaderHeight: (Double) -> Void
}
