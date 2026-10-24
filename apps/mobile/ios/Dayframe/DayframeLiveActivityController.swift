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
    apiBase: String?,
    title: String,
    categoryName: String?,
    categoryColor: String? = nil,
    categoryColorLight: String? = nil,
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
      isRunning: true,
      canStop: false,
      categoryColorLight: cleanText(categoryColorLight)
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
      await existing.update(ActivityContent(state: state, staleDate: nil))
      return StartResult(activityId: existing.id)
    }

    let attributes = DayframeTimerAttributes(
      id: UUID().uuidString,
      entryId: canonicalEntryId,
      apiBase: cleanAPIBase(apiBase)
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

  /// The APNs environment this build's Live Activity tokens belong to (`DayframeAPNSEnvironment`).
  static func pushEnvironment() -> String? {
    guard
      let value = Bundle.main.object(forInfoDictionaryKey: "DayframeAPNSEnvironment") as? String,
      value == "development" || value == "production"
    else {
      return nil
    }
    return value
  }

  static func immediatePushToken(activityId: String, entryId: String) -> String? {
    guard #available(iOS 16.2, *) else {
      return nil
    }
    guard
      let activity = Activity<DayframeTimerAttributes>.activities.first(where: {
        $0.id == activityId &&
          $0.attributes.entryId == entryId &&
          $0.activityState == .active &&
          $0.content.state.isRunning
      }),
      let token = activity.pushToken
    else {
      return nil
    }
    return token.dayframeHexString
  }

  static func enableStop(activityId: String, entryId: String) async -> Bool {
    guard #available(iOS 16.2, *) else {
      return false
    }
    guard
      let activity = Activity<DayframeTimerAttributes>.activities.first(where: {
        $0.id == activityId &&
          $0.attributes.entryId == entryId &&
          $0.activityState == .active &&
          $0.content.state.isRunning
      })
    else {
      return false
    }
    let current = activity.content.state
    let state = DayframeTimerAttributes.ContentState(
      title: current.title,
      categoryName: current.categoryName,
      categoryColor: current.categoryColor,
      startedAt: current.startedAt,
      elapsedSeconds: current.elapsedSeconds,
      isRunning: current.isRunning,
      canStop: true,
      categoryColorLight: current.categoryColorLight
    )
    await activity.update(ActivityContent(state: state, staleDate: nil))
    return true
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

  /// Whether the exact Activity is still shown running (not yet stopped by a Lock Screen Stop).
  static func isRunning(activityId: String, entryId: String) -> Bool {
    guard #available(iOS 16.2, *) else {
      return false
    }
    return Activity<DayframeTimerAttributes>.activities.contains(where: {
      $0.id == activityId &&
        $0.attributes.entryId == entryId &&
        $0.activityState == .active &&
        $0.content.state.isRunning
    })
  }

  /// Shows the exact Activity as stopped (time frozen, no Stop control) without ending it. A Lock
  /// Screen Stop does this first: ending an Activity can end the intent's process before its request
  /// finishes (13 Aug 2026), an update does not (owner decision 24 Oct 2026, option A).
  static func showStopped(activityId: String, entryId: String) async {
    guard #available(iOS 16.2, *) else {
      return
    }
    guard
      let activity = Activity<DayframeTimerAttributes>.activities.first(where: {
        $0.id == activityId && $0.attributes.entryId == entryId && $0.activityState == .active
      })
    else {
      return
    }
    // No stale date: a stale Activity is no longer `.active`, and the app's cleanup ends only active
    // ones, so one left here by an intent that died before ending it would escape (Codex r2 on #578).
    await activity.update(ActivityContent(state: stoppedState(activity), staleDate: nil))
  }

  static func cleanupActivities(activityIds: [String]) async -> Bool {
    await stop(activityIds: activityIds)
  }

  static func activityIds(entryId: String) -> [String] {
    guard #available(iOS 16.2, *) else {
      return []
    }
    return Activity<DayframeTimerAttributes>.activities
      .filter { $0.attributes.entryId == entryId }
      .map(\.id)
  }

  /// Activities for blocks that started before `date`: what a Shortcut Stop at `date` stopped (the server
  /// stops only blocks with `started_at < occurredAt`).
  static func activityIds(startedBefore date: Date) -> [String] {
    guard #available(iOS 16.2, *) else {
      return []
    }
    return Activity<DayframeTimerAttributes>.activities
      .filter { ($0.content.state.startedAt ?? .distantPast) < date }
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
    await activity.end(
      ActivityContent(state: stoppedState(activity), staleDate: Date()),
      dismissalPolicy: dismissalPolicy
    )
  }

  /// The Activity's content, stopped now: time frozen, no Stop control. An Activity already shown as
  /// stopped keeps its frozen time.
  @available(iOS 16.2, *)
  private static func stoppedState(_ activity: Activity<DayframeTimerAttributes>) -> DayframeTimerAttributes.ContentState {
    let current = activity.content.state
    return DayframeTimerAttributes.ContentState(
      title: current.title,
      categoryName: current.categoryName,
      categoryColor: current.categoryColor,
      startedAt: current.startedAt,
      elapsedSeconds: current.isRunning ? elapsedSeconds(from: current.startedAt) : current.elapsedSeconds,
      isRunning: false,
      canStop: false,
      categoryColorLight: current.categoryColorLight
    )
  }

  private static func elapsedSeconds(from startedAt: Date?) -> Int {
    guard let startedAt else {
      return 0
    }
    return max(0, Int(Date().timeIntervalSince(startedAt)))
  }

  private static func cleanTitle(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "No activity" : String(trimmed.prefix(80))
  }

  private static func cleanText(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
      return nil
    }
    return String(trimmed.prefix(80))
  }

  private static func cleanAPIBase(_ value: String?) -> String? {
    guard let value = cleanText(value) else { return nil }
    let normalized = value.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let allowed = Set([
      "https://dayframe-staging.vercel.app",
      "https://dayframe-web.vercel.app"
    ])
    return allowed.contains(normalized) ? normalized : nil
  }
}

private extension Data {
  var dayframeHexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
