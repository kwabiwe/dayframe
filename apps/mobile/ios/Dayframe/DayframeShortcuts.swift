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
    // A replayable current/global Stop can target a different timer if the request is delayed, so the
    // Stop always names one entry: the running Live Activity's, else the entry the server says is running
    // now. Without either it fails closed. Until 13 Oct the Live Activity was the only source, so NFC and
    // Shortcuts Stops did nothing whenever no Live Activity carried an entry (none reached production from
    // 13 Aug).
    if let entryId = DayframeLiveActivityController.currentCanonicalEntryId() {
      await DayframeShortcutPerformer.perform(.stopEntry(entryId: entryId))
      return .result()
    }
    // The lookup, the queued event and its delivery must all belong to one account and one session.
    guard let context = DayframeShortcutRuntimeContextStore.current() else {
      DayframeShortcutDeliveryDiagnosticStore.record(.contextUnavailable)
      return .result()
    }
    guard
      let userId = context.userId,
      let workspaceId = context.workspaceId,
      DayframeShortcutCatalogStore.catalog.belongs(userId: userId, workspaceId: workspaceId)
    else {
      DayframeShortcutDeliveryDiagnosticStore.record(.ownerUnverified)
      return .result()
    }
    let catalog = DayframeShortcutCatalogStore.catalog
    guard !startPending(userId: userId, workspaceId: workspaceId) else {
      DayframeShortcutDeliveryDiagnosticStore.record(.startPending)
      return .result()
    }
    switch await DayframeShortcutDirectEventClient.serverRunningEntry(context: context) {
    case .running(let entryId):
      guard
        DayframeShortcutRuntimeContextStore.current() == context,
        catalog.belongs(userId: userId, workspaceId: workspaceId),
        DayframeShortcutCatalogStore.catalog.belongs(userId: userId, workspaceId: workspaceId)
      else {
        DayframeShortcutDeliveryDiagnosticStore.record(.ownerUnverified)
        return .result()
      }
      // A Start queued while the lookup ran must still win.
      guard !startPending(userId: userId, workspaceId: workspaceId) else {
        DayframeShortcutDeliveryDiagnosticStore.record(.startPending)
        return .result()
      }
      // The event is built from the checked catalog and delivered with the checked session.
      await DayframeShortcutPerformer.perform(.stopEntry(entryId: entryId), context: context, catalog: catalog)
    case .nothingRunning:
      DayframeShortcutDeliveryDiagnosticStore.record(.nothingRunning)
    case .unavailable:
      DayframeShortcutDeliveryDiagnosticStore.record(.targetUnavailable)
    }
    return .result()
  }

  private func startPending(userId: String, workspaceId: String) -> Bool {
    DayframeNativeShortcutQueue.hasPendingStart(userId: userId, workspaceId: workspaceId) ||
      DayframePendingShortcutStarts.contains(userId: userId, workspaceId: workspaceId)
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
  case stopEntry(entryId: String)
  case stopLiveActivity(activityId: String, entryId: String, apiBase: String, clientEventId: String)
}

private func dayframeCleanText(_ value: String?) -> String? {
  guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
    return nil
  }
  return trimmed
}

private enum DayframeShortcutPerformer {
  static func perform(
    _ action: DayframeShortcutAction,
    context: DayframeShortcutRuntimeContext? = nil,
    catalog checked: DayframeShortcutCatalog? = nil
  ) async {
    let catalog = checked ?? DayframeShortcutCatalogStore.catalog
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
      if let userId = event.userId, let workspaceId = event.workspaceId {
        DayframePendingShortcutStarts.add(localId: event.localId, userId: userId, workspaceId: workspaceId)
      }
      guard #available(iOS 17.0, *) else {
        return
      }
      let category = catalog.category(named: categoryName)
      _ = await DayframeLiveActivityController.start(
        entryId: nil,
        apiBase: nil,
        title: event.description ?? category?.name ?? "No activity",
        categoryName: category?.name ?? dayframeCleanText(categoryName),
        categoryColor: category?.color,
        categoryColorLight: category?.lightColor,
        startedAt: event.occurredAt
      )
    case .stopEntry(let entryId):
      // Ending the Activity can terminate the background intent process on
      // current iOS before a concurrent URLSession request completes. Finish
      // the bounded server/APNs path first, then dismiss locally. A failed
      // request remains queued for foreground replay.
      let activityIds = DayframeLiveActivityController.activityIds(entryId: entryId)
      let delivered = await DayframeShortcutDirectEventClient.submit(event, context: context)
      if delivered {
        _ = await DayframeLiveActivityController.stop(activityIds: activityIds)
        if queued {
          _ = DayframeNativeShortcutQueue.remove(localIds: [event.localId])
        }
      }
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
    let now = Date()
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
    case .stopEntry(let entryId):
      actionName = "stop"
      nextType = "timer_stop"
      payload = [
        "origin": "ios_app_shortcut",
        "stopScope": "entry",
        "targetEntryId": entryId
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

  func belongs(userId: String, workspaceId: String) -> Bool {
    user?.id == userId && workspace?.id == workspaceId
  }
  let categories: [DayframeShortcutCategory]

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
