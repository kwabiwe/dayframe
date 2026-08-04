import Combine
import SwiftUI

struct DayframeCalendarTheme: Equatable {
  let accent: String
  let accentSoft: String
  let accentText: String
  let background: String
  let border: String
  let borderStrong: String
  let mode: String
  let shadow: String
  let surface: String
  let surfaceMuted: String
  let surfaceRaised: String
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
    mode = record.mode
    shadow = record.shadow
    surface = record.surface
    surfaceMuted = record.surfaceMuted
    surfaceRaised = record.surfaceRaised
    textPrimary = record.textPrimary
    textSecondary = record.textSecondary
    warning = record.warning
    warningText = record.warningText
  }
}

struct DayframeCalendarWeekDay: Equatable, Identifiable {
  let accessibilityLabel: String
  let dayKey: String
  let dayNumber: String
  let isSelected: Bool
  let isToday: Bool
  let weekdayLabel: String

  var id: String { dayKey }

  init(_ record: DayframeCalendarWeekDayRecord) {
    accessibilityLabel = record.accessibilityLabel
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
  let continuesIntoNextDay: Bool
  let entryId: String
  let isActive: Bool
  let isReview: Bool
  let isUncategorized: Bool
  let laneCount: Int
  let laneIndex: Int
  let layoutMode: String
  let meta: String
  let offsetFraction: Double
  let overlapCount: Int
  let overlapSeconds: Double
  let startedAtMs: Double
  let startsBeforeDay: Bool
  let stoppedAtMs: Double?
  let tagText: String?
  let textDensity: String
  let title: String
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
    continuesIntoNextDay = record.continuesIntoNextDay
    entryId = record.entryId
    isActive = record.isActive
    isReview = record.isReview
    isUncategorized = record.isUncategorized
    laneCount = max(1, record.laneCount)
    laneIndex = max(0, record.laneIndex)
    layoutMode = record.layoutMode
    meta = record.meta
    offsetFraction = record.offsetFraction
    overlapCount = max(0, record.overlapCount)
    overlapSeconds = max(0, record.overlapSeconds)
    startedAtMs = record.startedAtMs
    startsBeforeDay = record.startsBeforeDay
    stoppedAtMs = record.stoppedAtMs
    tagText = record.tagText
    textDensity = record.textDensity
    title = record.title
    widthFraction = record.widthFraction
    zIndex = record.zIndex
  }
}

struct DayframeCalendarPresentation: Equatable {
  let dayEndMs: Double
  let dayStartMs: Double
  let emptyState: String
  let entries: [DayframeCalendarEntry]
  let modelVersion: Int
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
    dayEndMs = record.dayEndMs
    dayStartMs = record.dayStartMs
    emptyState = record.emptyState
    entries = record.entries.map(DayframeCalendarEntry.init)
    modelVersion = record.modelVersion
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
}

@MainActor
final class DayframeCalendarViewModel: ObservableObject {
  @Published private(set) var presentation = DayframeCalendarPresentation.empty
  @Published private(set) var hourHeight = CGFloat(DayframeCalendarConstants.defaultHourHeight)

  func update(_ record: DayframeCalendarPresentationRecord) {
    guard record.modelVersion == 3 else {
      reset()
      return
    }
    let next = DayframeCalendarPresentation(record)
    guard next != presentation else { return }
    withTransaction(Transaction(animation: nil)) {
      presentation = next
    }
  }

  func reset() {
    withTransaction(Transaction(animation: nil)) {
      presentation = .empty
    }
  }

  func updateHourHeight(_ nextHourHeight: Double) {
    let clamped = CGFloat(DayframeCalendarZoomMath.clampHourHeight(nextHourHeight))
    guard clamped != hourHeight else { return }
    withTransaction(Transaction(animation: nil)) {
      hourHeight = clamped
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
}
