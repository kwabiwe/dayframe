import ActivityKit
import Foundation

enum DayframeLiveActivityController {
  static func start(
    title: String,
    categoryName: String?,
    categoryColor: String? = nil,
    startedAt: Date = Date()
  ) async -> Bool {
    guard #available(iOS 16.2, *) else {
      return false
    }

    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      return false
    }

    await endActive(dismissalPolicy: .immediate)

    let attributes = DayframeTimerAttributes(id: UUID().uuidString)
    let state = DayframeTimerAttributes.ContentState(
      title: cleanTitle(title),
      categoryName: cleanText(categoryName),
      categoryColor: cleanText(categoryColor),
      startedAt: startedAt,
      elapsedSeconds: 0,
      isRunning: true
    )

    do {
      _ = try Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state, staleDate: nil),
        pushType: nil
      )
      return true
    } catch {
      return false
    }
  }

  static func stop() async -> Bool {
    guard #available(iOS 16.2, *) else {
      return true
    }

    await endActive(dismissalPolicy: .immediate)
    return true
  }

  @available(iOS 16.2, *)
  private static func endActive(dismissalPolicy: ActivityUIDismissalPolicy) async {
    for activity in Activity<DayframeTimerAttributes>.activities {
      let state = DayframeTimerAttributes.ContentState(
        title: activity.content.state.title,
        categoryName: activity.content.state.categoryName,
        categoryColor: activity.content.state.categoryColor,
        startedAt: activity.content.state.startedAt,
        elapsedSeconds: elapsedSeconds(from: activity.content.state.startedAt),
        isRunning: false
      )
      await activity.end(
        ActivityContent(state: state, staleDate: Date()),
        dismissalPolicy: dismissalPolicy
      )
    }
  }

  private static func elapsedSeconds(from startedAt: Date?) -> Int {
    guard let startedAt else {
      return 0
    }
    return max(0, Int(Date().timeIntervalSince(startedAt)))
  }

  private static func cleanTitle(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Tracking" : String(trimmed.prefix(80))
  }

  private static func cleanText(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
      return nil
    }
    return String(trimmed.prefix(80))
  }
}
