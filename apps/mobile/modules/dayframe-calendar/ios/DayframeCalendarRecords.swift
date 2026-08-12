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
  var warning = "#F2BA38"
  var warningText = "#F2BA38"
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
  var laneCount = 1
  var laneIndex = 0
  var layoutMode = "full"
  var meta = ""
  var offsetFraction: Double = 0
  var overlapCount = 0
  var overlapSeconds: Double = 0
  var placeText: String?
  var startedAtMs: Double = 0
  var startsBeforeDay = false
  var stoppedAtMs: Double?
  var tagText: String?
  var textDensity = "full"
  var title = ""
  var widthFraction: Double = 1
  var zIndex = 0
}

struct DayframeCalendarPresentationRecord: Codable {
  var dayEndMs: Double = 0
  var dayStartMs: Double = 0
  var emptyState = "No tracked time for this day."
  var entries: [DayframeCalendarEntryRecord] = []
  var modelVersion = 4
  var nowMs: Double = 0
  var reduceMotion = false
  var reduceTransparency = false
  var refreshing = false
  var selectedDayKey = ""
  var selectedDayTitle = "Calendar"
  var theme = DayframeCalendarThemeRecord()
  var todayKey = ""
  var additionalOverlapSeconds: Double = 0
  var coveredLabel = "0m"
  var coveredSeconds: Double = 0
  var loggedLabel = "0m"
  var loggedSeconds: Double = 0
  var totalLabel = "0m"
  var totalSeconds: Double = 0
  var transitionDirection = 1
  var weekDays: [DayframeCalendarWeekDayRecord] = []
}
