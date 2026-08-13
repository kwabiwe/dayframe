import ActivityKit
import Foundation

enum DayframeLiveActivityController {
  struct StartResult {
    let activityId: String
  }

  struct Snapshot {
    let activityId: String
    let entryId: String?
    let isActive: Bool
    let isRunning: Bool
  }

  static func start(
    entryId: String?,
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

    let canonicalEntryId = cleanText(entryId)
    let state = DayframeTimerAttributes.ContentState(
      title: cleanTitle(title),
      categoryName: cleanText(categoryName),
      categoryColor: cleanText(categoryColor),
      startedAt: startedAt,
      elapsedSeconds: 0,
      isRunning: true
    )

    if
      let canonicalEntryId,
      let existing = Activity<DayframeTimerAttributes>.activities.first(where: {
        $0.activityState == .active &&
          $0.content.state.isRunning &&
          $0.attributes.entryId == canonicalEntryId
      })
    {
      // The logical run already owns an Activity. Update it in place. Sibling
      // cleanup belongs to the generation-fenced JS reconciler; a native start
      // cannot know whether an observed sibling is stale or concurrently new.
      Task(priority: .userInitiated) {
        await existing.update(ActivityContent(state: state, staleDate: nil))
      }
      return StartResult(activityId: existing.id)
    }

    let attributes = DayframeTimerAttributes(
      id: UUID().uuidString,
      entryId: canonicalEntryId
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

  static func stop(activityIds: [String]) async -> Bool {
    guard #available(iOS 16.2, *) else {
      return true
    }
    for activityId in Set(activityIds.compactMap(cleanText)) {
      guard
        let activity = Activity<DayframeTimerAttributes>.activities.first(where: {
          $0.id == activityId
        })
      else {
        continue
      }
      await end(activity, dismissalPolicy: .immediate)
    }
    return true
  }

  static func stop(activityId: String, entryId: String) async -> Bool {
    guard #available(iOS 16.2, *) else {
      return true
    }
    guard
      let activity = Activity<DayframeTimerAttributes>.activities.first(where: {
        $0.id == activityId && $0.attributes.entryId == entryId
      })
    else {
      // An already-ended exact Activity is an idempotent success. Crucially,
      // never fall back to ending another Activity.
      return true
    }
    await end(activity, dismissalPolicy: .immediate)
    return true
  }

  static func cleanupActivities(activityIds: [String]) {
    guard #available(iOS 16.2, *) else {
      return
    }
    scheduleEndActivities(activityIds: activityIds)
  }

  static func activityIds(entryId: String) -> [String] {
    guard #available(iOS 16.2, *) else {
      return []
    }
    return Activity<DayframeTimerAttributes>.activities
      .filter { $0.attributes.entryId == entryId }
      .map(\.id)
  }

  static func currentCanonicalEntryId() -> String? {
    guard #available(iOS 16.2, *) else {
      return nil
    }
    return Activity<DayframeTimerAttributes>.activities
      .filter {
        $0.activityState == .active &&
          $0.content.state.isRunning &&
          cleanText($0.attributes.entryId) != nil
      }
      .sorted {
        ($0.content.state.startedAt ?? .distantPast) >
          ($1.content.state.startedAt ?? .distantPast)
      }
      .first?
      .attributes
      .entryId
  }

  static func snapshots() -> [Snapshot] {
    guard #available(iOS 16.2, *) else {
      return []
    }
    return Activity<DayframeTimerAttributes>.activities.map { activity in
      Snapshot(
        activityId: activity.id,
        entryId: activity.attributes.entryId,
        isActive: activity.activityState == .active,
        isRunning: activity.content.state.isRunning
      )
    }
  }

  @available(iOS 16.2, *)
  private static func end(
    _ activity: Activity<DayframeTimerAttributes>,
    dismissalPolicy: ActivityUIDismissalPolicy
  ) async {
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

  @available(iOS 16.2, *)
  private static func scheduleEndActivities(activityIds: [String]) {
    let activityIds = Array(Set(activityIds.compactMap(cleanText)))
    guard !activityIds.isEmpty else { return }
    Task(priority: .userInitiated) {
      for activityId in activityIds {
        guard
          let activity = Activity<DayframeTimerAttributes>.activities.first(where: {
            $0.id == activityId
          })
        else {
          continue
        }
        await end(activity, dismissalPolicy: .immediate)
      }
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
