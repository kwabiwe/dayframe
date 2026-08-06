import ActivityKit
import Foundation

enum DayframeLiveActivityController {
  struct StartResult {
    let activityId: String
  }

  static func start(
    title: String,
    categoryName: String?,
    categoryColor: String? = nil,
    startedAt: Date = Date()
  ) async -> StartResult? {
    guard #available(iOS 16.2, *) else {
      return nil
    }

    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      return nil
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
      let activity = try Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state, staleDate: nil),
        pushType: .token
      )
      return StartResult(activityId: activity.id)
    } catch {
      return nil
    }
  }

  static func pushToken(activityId: String) async -> String? {
    guard #available(iOS 16.2, *),
          let activity = Activity<DayframeTimerAttributes>.activities.first(where: { $0.id == activityId })
    else {
      return nil
    }

    if let token = activity.pushToken {
      return token.dayframeHexString
    }

    return await withTaskGroup(of: String?.self) { group in
      group.addTask {
        for await token in activity.pushTokenUpdates {
          return token.dayframeHexString
        }
        return nil
      }
      group.addTask {
        try? await Task.sleep(for: .seconds(15))
        return nil
      }
      let token = await group.next() ?? nil
      group.cancelAll()
      return token
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
    return trimmed.isEmpty ? "Uncategorized" : String(trimmed.prefix(80))
  }

  private static func cleanText(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
      return nil
    }
    return String(trimmed.prefix(80))
  }
}

private extension Data {
  var dayframeHexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
