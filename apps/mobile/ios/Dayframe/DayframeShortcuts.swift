import AppIntents
import Foundation

@available(iOS 16.4, *)
struct StartTrackingIntent: AppIntent {
  static var title: LocalizedStringResource = "Start tracking"
  static var description = IntentDescription("Start a Dayframe block with an optional description, activity, and workspace.")
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Description")
  var taskDescription: String?

  @Parameter(title: "Activity", optionsProvider: DayframeCategoryOptionsProvider())
  var category: String?

  @Parameter(title: "Workspace", optionsProvider: DayframeWorkspaceOptionsProvider())
  var workspace: String?

  func perform() async throws -> some IntentResult {
    await DayframeShortcutPerformer.perform(.start(
      description: taskDescription,
      categoryName: category,
      workspaceName: workspace
    ))
    return .result()
  }
}

// iOS 17+ requires this conformance when an App Intent creates a Live
// Activity from the background app process. iOS 16.4 retains the shortcut's
// durable queue behavior but does not attempt an unsupported background start.
@available(iOS 17.0, *)
extension StartTrackingIntent: LiveActivityIntent {}

@available(iOS 16.4, *)
struct StopTrackingIntent: AppIntent {
  static var title: LocalizedStringResource = "Stop tracking"
  static var description = IntentDescription("Stop the block Dayframe is recording.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult {
    // Stops whatever was running when the Stop ran (the server's `running_at` scope), never a block
    // started after it, so the Stop needs no Live Activity and is safe to deliver late. A Shortcut Start
    // that reaches the server after it fills its own slot there (owner decision 14 Oct, #403 option c).
    // Until 14 Oct the Stop needed a Live Activity's entry, so NFC and Shortcuts Stops did nothing without
    // one (none reached production from 13 Aug).
    await DayframeShortcutPerformer.perform(.stopRunning)
    return .result()
  }
}

@available(iOS 17.0, *)
struct DayframeLiveActivityStopIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Stop recording"
  static var description = IntentDescription("Stop the block Dayframe is recording, from the Live Activity.")
  static var openAppWhenRun: Bool = false
  static var isDiscoverable: Bool = false

  @Parameter(title: "Activity ID")
  var activityId: String?

  @Parameter(title: "Block ID")
  var entryId: String?

  @Parameter(title: "API base")
  var apiBase: String?

  @Parameter(title: "Stop request ID")
  var clientEventId: String?

  init() {}

  init(activityId: String, entryId: String, apiBase: String, clientEventId: String) {
    self.activityId = activityId
    self.entryId = entryId
    self.apiBase = apiBase
    self.clientEventId = clientEventId
  }

  @available(iOS 26.0, *)
  static var supportedModes: IntentModes = [.background]

  func perform() async throws -> some IntentResult {
    guard
      let activityId = dayframeCleanText(activityId),
      let entryId = dayframeCleanText(entryId),
      let apiBase = dayframeCleanText(apiBase),
      let clientEventId = dayframeCleanText(clientEventId)
    else {
      // A Live Activity archived by an older build has no immutable target.
      // The archived control has no immutable target, so even local dismissal
      // must be a no-op: a newer optimistic activity can also lack an entry ID.
      DayframeShortcutDeliveryDiagnosticStore.record(.legacyUnscoped)
      return .result()
    }
    await DayframeShortcutPerformer.perform(.stopLiveActivity(
      activityId: activityId,
      entryId: entryId,
      apiBase: apiBase,
      clientEventId: clientEventId
    ))
    return .result()
  }
}

@available(iOS 16.4, *)
struct DayframeShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartTrackingIntent(),
      phrases: [
        "Start tracking in \(.applicationName)",
        "Start a block in \(.applicationName)"
      ],
      shortTitle: "Start tracking",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: StopTrackingIntent(),
      phrases: [
        "Stop tracking in \(.applicationName)",
        "Stop recording in \(.applicationName)"
      ],
      shortTitle: "Stop tracking",
      systemImageName: "stop.circle"
    )
  }
}

private enum DayframeShortcutAction {
  case start(description: String?, categoryName: String?, workspaceName: String?)
  case stopRunning
  case stopLiveActivity(activityId: String, entryId: String, apiBase: String, clientEventId: String)
}

private func dayframeCleanText(_ value: String?) -> String? {
  guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
    return nil
  }
  return trimmed
}

private enum DayframeShortcutPerformer {
  static func perform(_ action: DayframeShortcutAction) async {
    let catalog = DayframeShortcutCatalogStore.catalog
    // App Intents can run while Dayframe is signed out. Never create an
    // ownerless event that a different account could inherit later.
    guard catalog.user != nil, catalog.workspace != nil else {
      return
    }
    let event = DayframeShortcutEvent(action: action, catalog: catalog)
    let queued = DayframeNativeShortcutQueue.append(event)

    switch action {
    case .start(_, let categoryName, _):
      guard queued else {
        return
      }
      // Delivered first, as Stop is: a Live Activity's block is fixed when it starts, and a Stop or
      // Switch made elsewhere reaches it only through an APNs token registered for that block. The queued
      // copy stays only when delivery fails (the app delivers it later; the server dedupes by its client
      // event ID and places a late Start in its own slot).
      let delivery = await DayframeShortcutDirectEventClient.submitStart(event)
      if delivery != nil {
        _ = DayframeNativeShortcutQueue.remove(localIds: [event.localId])
      }
      // A Start the server did not leave running (placed late, superseded at the same moment, or finished
      // by a Stop that ran while it waited) shows nothing.
      guard delivery?.runsNow != false else {
        return
      }
      if #available(iOS 17.0, *) {
        let category = catalog.category(named: categoryName)
        guard let activity = await DayframeLiveActivityController.start(
          entryId: delivery?.timeEntryId,
          apiBase: delivery?.timeEntryId == nil ? nil : delivery?.context.apiBase,
          title: event.description ?? category?.name ?? "No activity",
          categoryName: category?.name ?? dayframeCleanText(categoryName),
          categoryColor: category?.color,
          categoryColorLight: category?.lightColor,
          startedAt: event.occurredAt
        ) else {
          return
        }
        // A Shortcut Stop that ran after this Start may have looked for Activities before this one existed.
        if stoppedAfter(event), DayframeShortcutCatalogStore.catalog.ownedBy(event) {
          _ = await DayframeLiveActivityController.stop(activityIds: [activity.activityId])
          return
        }
        // Offline, the Activity starts without a block; the app adopts or replaces it when it next runs.
        if let delivery, let entryId = delivery.timeEntryId {
          _ = await DayframeShortcutDirectEventClient.registerLiveActivity(
            activityId: activity.activityId,
            entryId: entryId,
            context: delivery.context
          )
        }
      }
    case .stopRunning:
      guard queued else {
        return
      }
      if let userId = event.userId, let workspaceId = event.workspaceId {
        DayframeShortcutStopMoments.record(userId: userId, workspaceId: workspaceId, at: event.occurredAt)
      }
      // Ending the Activity can terminate the background intent process on current iOS before a
      // concurrent URLSession request completes, so deliver first, then end the Activities of blocks that
      // started before this Stop, read after delivery so one a Start created meanwhile ends too. They end
      // even when delivery fails: the queued Stop names its own time, so the app's later delivery stops the
      // same block.
      if await DayframeShortcutDirectEventClient.submit(event) {
        _ = DayframeNativeShortcutQueue.remove(localIds: [event.localId])
      }
      // Activities carry no account: end them only while the Stop's account is still the signed-in one,
      // so a sign-in to another account during delivery keeps that account's Activity (Codex r8 on #403).
      guard DayframeShortcutCatalogStore.catalog.ownedBy(event) else {
        return
      }
      let activityIds = DayframeLiveActivityController.activityIds(startedBefore: event.occurredAt)
      _ = await DayframeLiveActivityController.stop(activityIds: activityIds)
    case .stopLiveActivity(let activityId, let entryId, let apiBase, _):
      // The event and local dismissal share the immutable identity archived in
      // the exact Live Activity view. The push token is the server-registered,
      // activity-scoped capability, so this locked-screen path never depends
      // on a broad account bearer or App Group/Keychain availability.
      guard let pushToken = DayframeLiveActivityController.immediatePushToken(
        activityId: activityId,
        entryId: entryId
      ) else {
        DayframeShortcutDeliveryDiagnosticStore.record(.capabilityUnavailable)
        return
      }
      let delivered = await DayframeShortcutDirectEventClient.submitLiveActivityStop(
        event,
        apiBase: apiBase,
        activityId: activityId,
        entryId: entryId,
        pushToken: pushToken
      )
      if delivered {
        _ = await DayframeLiveActivityController.stop(
          activityId: activityId,
          entryId: entryId
        )
        if queued {
          _ = DayframeNativeShortcutQueue.remove(localIds: [event.localId])
        }
      }
    }
  }
}

/// Whether a Shortcut Stop for this event's account ran at or after it.
private func stoppedAfter(_ event: DayframeShortcutEvent) -> Bool {
  guard
    let userId = event.userId,
    let workspaceId = event.workspaceId,
    let stoppedAt = DayframeShortcutStopMoments.latest(userId: userId, workspaceId: workspaceId)
  else {
    return false
  }
  return stoppedAt > event.occurredAt
}

struct DayframeShortcutEvent: Codable {
  let localId: String
  let source: String
  let type: String
  let occurredAt: Date
  let categoryId: String?
  let description: String?
  let rawPayload: [String: String]
  let userId: String?
  let workspaceId: String?

  fileprivate init(action: DayframeShortcutAction, catalog: DayframeShortcutCatalog) {
    // The moment as it is sent (whole milliseconds), so the native comparisons with Activities and Stop
    // moments agree with the server's: a Start and a Stop that serialize to the same time are the same
    // moment here too (Codex r9 on #403).
    let now = ISO8601DateFormatter.dayframe.date(from: ISO8601DateFormatter.dayframe.string(from: Date())) ?? Date()
    let actionName: String
    var nextType: String
    var nextCategoryId: String?
    var nextDescription: String?
    var payload: [String: String]

    switch action {
    case .start(let description, let categoryName, let workspaceName):
      actionName = "start"
      nextType = "shortcut_action"
      payload = ["origin": "ios_app_shortcut"]
      nextDescription = dayframeCleanText(description)
      if let category = catalog.category(named: categoryName) {
        nextCategoryId = category.id
        payload["categoryName"] = category.name
      } else if let categoryName = dayframeCleanText(categoryName) {
        payload["categoryName"] = categoryName
      }
      if let workspaceName = dayframeCleanText(workspaceName) {
        payload["workspaceName"] = workspaceName
      }
    case .stopRunning:
      actionName = "stop"
      nextType = "timer_stop"
      payload = [
        "origin": "ios_app_shortcut",
        "stopScope": "running_at"
      ]
    case .stopLiveActivity(let activityId, let entryId, _, let clientEventId):
      actionName = "stop"
      nextType = "timer_stop"
      payload = [
        "origin": "ios_live_activity",
        "stopScope": "entry",
        "targetActivityId": activityId,
        "targetEntryId": entryId
      ]
      localId = clientEventId
      source = "shortcut"
      type = nextType
      occurredAt = now
      categoryId = nextCategoryId
      description = nextDescription
      rawPayload = payload
      userId = catalog.user?.id
      workspaceId = catalog.workspace?.id
      return
    }

    localId = "ios-shortcut-\(actionName)-\(Int(now.timeIntervalSince1970 * 1000))-\(UUID().uuidString)"
    source = "shortcut"
    type = nextType
    occurredAt = now
    categoryId = nextCategoryId
    description = nextDescription
    rawPayload = payload
    userId = catalog.user?.id
    workspaceId = catalog.workspace?.id
  }

}

extension NSLock {
  func withLock<T>(_ body: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try body()
  }
}

@available(iOS 16.4, *)
private struct DayframeCategoryOptionsProvider: DynamicOptionsProvider {
  func results() async throws -> [String] {
    DayframeShortcutCatalogStore.catalog.categoryNames
  }
}

@available(iOS 16.4, *)
private struct DayframeWorkspaceOptionsProvider: DynamicOptionsProvider {
  func results() async throws -> [String] {
    DayframeShortcutCatalogStore.catalog.workspaceNames
  }
}

private enum DayframeShortcutCatalogStore {
  private static let key = "dayframe.shortcutCatalog.v1"

  static var catalog: DayframeShortcutCatalog {
    guard
      let value = UserDefaults.standard.string(forKey: key),
      let data = value.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(DayframeShortcutCatalog.self, from: data)
    else {
      return DayframeShortcutCatalog(user: nil, workspace: nil, categories: [])
    }

    return decoded
  }
}

private struct DayframeShortcutCatalog: Decodable {
  let user: DayframeShortcutUser?
  let workspace: DayframeShortcutWorkspace?
  let categories: [DayframeShortcutCategory]

  /// Whether this catalog's signed-in account is the one the event was made for.
  func ownedBy(_ event: DayframeShortcutEvent) -> Bool {
    guard let userId = user?.id, let workspaceId = workspace?.id else { return false }
    return event.userId == userId && event.workspaceId == workspaceId
  }

  var categoryNames: [String] {
    unique(categories.map(\.name))
  }

  var workspaceNames: [String] {
    unique([workspace?.name].compactMap { $0 })
  }

  func category(named value: String?) -> DayframeShortcutCategory? {
    guard let name = cleanText(value) else {
      return nil
    }
    return categories.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }
  }

  private func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.compactMap { value in
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty, !seen.contains(trimmed.lowercased()) else {
        return nil
      }
      seen.insert(trimmed.lowercased())
      return trimmed
    }
  }

  private func cleanText(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
      return nil
    }
    return trimmed
  }
}

private struct DayframeShortcutUser: Decodable {
  let id: String
}

private struct DayframeShortcutWorkspace: Decodable {
  let id: String
  let name: String
}

private struct DayframeShortcutCategory: Decodable {
  let color: String?
  // Optional: catalogs written by older builds have the dark fill only.
  let lightColor: String?
  let id: String
  let name: String
}

extension ISO8601DateFormatter {
  static let dayframe: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

extension JSONEncoder {
  static let dayframe: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      var container = encoder.singleValueContainer()
      try container.encode(ISO8601DateFormatter.dayframe.string(from: date))
    }
    return encoder
  }()
}

extension JSONDecoder {
  static let dayframe: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let value = try container.decode(String.self)
      guard let date = ISO8601DateFormatter.dayframe.date(from: value) else {
        throw DecodingError.dataCorruptedError(
          in: container,
          debugDescription: "Expected ISO-8601 date."
        )
      }
      return date
    }
    return decoder
  }()
}
