import ExpoModulesCore

struct DayframeCalendarThemeRecord: Record {
  @Field var accent: String = "#FF6248"
  @Field var accentSoft: String = "rgba(255, 98, 72, 0.12)"
  @Field var accentText: String = "#FF6248"
  @Field var background: String = "#050914"
  @Field var border: String = "#2A3345"
  @Field var borderStrong: String = "#3B465B"
  @Field var mode: String = "dark"
  @Field var shadow: String = "rgba(0, 0, 0, 0.32)"
  @Field var surface: String = "#151B27"
  @Field var surfaceMuted: String = "#202838"
  @Field var surfaceRaised: String = "#1B2230"
  @Field var textPrimary: String = "#F7F8FB"
  @Field var textSecondary: String = "#8993A7"
}

struct DayframeCalendarWeekDayRecord: Record {
  @Field var accessibilityLabel: String = ""
  @Field var dayKey: String = ""
  @Field var dayNumber: String = ""
  @Field var isSelected: Bool = false
  @Field var isToday: Bool = false
  @Field var weekdayLabel: String = ""
}

struct DayframeCalendarEntryRecord: Record {
  @Field var actionId: String = ""
  @Field var actionKind: String = "completed"
  @Field var accessibilityLabel: String = ""
  @Field var color: String = "#7F91AB"
  @Field var continuesIntoNextDay: Bool = false
  @Field var entryId: String = ""
  @Field var isActive: Bool = false
  @Field var isReview: Bool = false
  @Field var isUncategorized: Bool = false
  @Field var meta: String = ""
  @Field var startedAtMs: Double = 0
  @Field var startsBeforeDay: Bool = false
  @Field var stoppedAtMs: Double?
  @Field var title: String = ""
}

struct DayframeCalendarPresentationRecord: Record {
  @Field var dayEndMs: Double = 0
  @Field var dayStartMs: Double = 0
  @Field var emptyState: String = "No tracked time for this day."
  @Field var entries: [DayframeCalendarEntryRecord] = []
  @Field var modelVersion: Int = 1
  @Field var nowMs: Double = 0
  @Field var reduceMotion: Bool = false
  @Field var reduceTransparency: Bool = false
  @Field var refreshing: Bool = false
  @Field var selectedDayKey: String = ""
  @Field var selectedDayTitle: String = "Calendar"
  @Field var theme: DayframeCalendarThemeRecord = DayframeCalendarThemeRecord()
  @Field var todayKey: String = ""
  @Field var totalLabel: String = "0m"
  @Field var totalSeconds: Double = 0
  @Field var transitionDirection: Int = 1
  @Field var weekDays: [DayframeCalendarWeekDayRecord] = []
}
