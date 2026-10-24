import Foundation

struct DayframeCalendarThemeRecord: Codable {
  var accent = "#FF6248"
  var accentSoft = "rgba(255, 98, 72, 0.12)"
  var accentText = "#FF6248"
  var background = "#050914"
  var border = "#2A3345"
  var borderStrong = "#3B465B"
  /// Calendar v3's now line and time pill; an older bundle's model falls back to these.
  var danger: String?
  var dangerText: String?
  var mode = "dark"
  var onAccent = "#050914"
  var shadow = "rgba(0, 0, 0, 0.32)"
  var surface = "#151B27"
  var surfaceMuted = "#202838"
  var surfaceRaised = "#1B2230"
  var textMuted = "#707B91"
  var textPrimary = "#F7F8FB"
  var textSecondary = "#8993A7"
  var warning = "#F2BA38"
  var warningText = "#F2BA38"
}

struct DayframeCalendarWeekDayRecord: Codable {
  var accessibilityLabel = ""
  var bars: [String] = []
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
  /// "logged" or "review" (location v4 C6): Swift puts both in one set of columns at every zoom.
  /// Absent from an older bundle, which keeps the fractions below.
  var columnGroup: String?
  var continuesIntoNextDay = false
  /// Calendar v3: the icon lines under the title. Absent from an older bundle (the time line only).
  var detailLines: [DayframeCalendarDetailLineRecord]?
  var entryId = ""
  /// The activity's registry glyph, drawn alone in a column under 34 points wide.
  var glyph: String?
  var isActive = false
  /// A finished block of a minute or less (dense-day rules): drawn as a tick at the gutter's edge,
  /// never as a block. Absent from an older bundle (a block, as before).
  var isMoment: Bool?
  var isReview = false
  var isUncategorized = false
  var laneCount = 1
  var laneIndex = 0
  var layoutMode = "full"
  /// The whole entry's length, printed after the title: "11m", "1h 45m".
  var lengthLabel: String?
  var meta = ""
  var offsetFraction: Double = 0
  var overlapCount = 0
  var overlapSeconds: Double = 0
  var placeText: String?
  /// The part of the day column the group draws in (left of the Review lane, or the lane itself).
  var regionOffsetFraction: Double?
  var regionWidthFraction: Double?
  var startedAtMs: Double = 0
  var startsBeforeDay = false
  var stoppedAtMs: Double?
  var tagText: String?
  var textColor = "#0B1020"
  var textDensity = "full"
  var title = ""
  var warningOverlapCount = 0
  var widthFraction: Double = 1
  var zIndex = 0
}

struct DayframeCalendarDetailLineRecord: Codable, Equatable {
  /// "place", "trip", "health", "tag" or "time": the Calendar glyph drawn before the text.
  var glyph = "time"
  var text = ""
}

/// A named pattern's bracket (location v3 PR 14b): React finds the trip; Swift only draws it.
struct DayframeCalendarBracketRecord: Codable {
  var key = ""
  /// The parts' entry ids: the bracket is drawn from their blocks as laid out.
  var memberIds: [String] = []
  var name = ""
  var startedAtMs: Double = 0
  var stoppedAtMs: Double = 0
}

struct DayframeCalendarPresentationRecord: Codable {
  /// Named patterns on the day; a model without them (an older bundle) draws none.
  var brackets: [DayframeCalendarBracketRecord]?
  var dayEndMs: Double = 0
  var dayStartMs: Double = 0
  var emptyState = "No tracked time for this day."
  var entries: [DayframeCalendarEntryRecord] = []
  var framedLabel = ""
  /// Calendar v3: the framed line with the full date, for VoiceOver.
  var framedAccessibilityLabel: String?
  var hapticsEnabled = true
  /// "grid" or "list" (location v4 step 9); a model without it (an older bundle) is the Grid.
  var layout: String?
  /// "12h" or "24h" (PRD D18); a model without it (an older bundle) keeps 24-hour.
  var clockFormat: String?
  var modelVersion = 4
  var monthTitle = ""
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
