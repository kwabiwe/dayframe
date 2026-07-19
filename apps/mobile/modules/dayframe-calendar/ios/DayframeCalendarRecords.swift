import Foundation

struct DayframeCalendarThemeRecord: Codable {
  var accent = "#FF6248"
  var accentSoft = "rgba(255, 98, 72, 0.12)"
  var accentText = "#FF6248"
  var background = "#050914"
  var border = "#2A3345"
  var borderStrong = "#3B465B"
  var mode = "dark"
  var shadow = "rgba(0, 0, 0, 0.32)"
  var surface = "#151B27"
  var surfaceMuted = "#202838"
  var surfaceRaised = "#1B2230"
  var textPrimary = "#F7F8FB"
  var textSecondary = "#8993A7"
}

struct DayframeCalendarWeekDayRecord: Codable {
  var accessibilityLabel = ""
  var dayKey = ""
  var dayNumber = ""
  var isSelected = false
  var isToday = false
  var weekdayLabel = ""
}

struct DayframeCalendarEntryRecord: Codable {
  var actionId = ""
  var actionKind = "completed"
  var accessibilityLabel = ""
  var color = "#7F91AB"
  var continuesIntoNextDay = false
  var entryId = ""
  var isActive = false
  var isReview = false
  var isUncategorized = false
  var meta = ""
  var startedAtMs: Double = 0
  var startsBeforeDay = false
  var stoppedAtMs: Double?
  var tagText: String?
  var title = ""
}

struct DayframeCalendarPresentationRecord: Codable {
  var dayEndMs: Double = 0
  var dayStartMs: Double = 0
  var emptyState = "No tracked time for this day."
  var entries: [DayframeCalendarEntryRecord] = []
  var modelVersion = 2
  var nowMs: Double = 0
  var reduceMotion = false
  var reduceTransparency = false
  var refreshing = false
  var selectedDayKey = ""
  var selectedDayTitle = "Calendar"
  var theme = DayframeCalendarThemeRecord()
  var todayKey = ""
  var totalLabel = "0m"
  var totalSeconds: Double = 0
  var transitionDirection = 1
  var weekDays: [DayframeCalendarWeekDayRecord] = []
}
