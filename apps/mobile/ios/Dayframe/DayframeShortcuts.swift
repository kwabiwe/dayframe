import AppIntents
import Foundation

@available(iOS 16.4, *)
struct StartTrackingIntent: AppIntent {
  static var title: LocalizedStringResource = "Start tracking"
  static var description = IntentDescription("Start a Dayframe timer with an optional description, category, and workspace.")
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Description")
  var taskDescription: String?

  @Parameter(title: "Category", optionsProvider: DayframeCategoryOptionsProvider())
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

@available(iOS 16.4, *)
struct StopTrackingIntent: AppIntent {
  static var title: LocalizedStringResource = "Stop tracking"
  static var description = IntentDescription("Stop the current Dayframe timer.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult {
    await DayframeShortcutPerformer.perform(.stop)
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
        "Start a task in \(.applicationName)"
      ],
      shortTitle: "Start tracking",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: StopTrackingIntent(),
      phrases: [
        "Stop tracking in \(.applicationName)",
        "Stop the timer in \(.applicationName)"
      ],
      shortTitle: "Stop tracking",
      systemImageName: "stop.circle"
    )
  }
}

private enum DayframeShortcutAction {
  case start(description: String?, categoryName: String?, workspaceName: String?)
  case stop
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
    let event = DayframeShortcutEvent(action: action, catalog: catalog)
    let queued = DayframeNativeShortcutQueue.append(event)
    guard queued else {
      return
    }

    switch action {
    case .start(_, let categoryName, _):
      _ = await DayframeLiveActivityController.start(
        title: event.description ?? "Tracking",
        categoryName: dayframeCleanText(categoryName),
        startedAt: event.occurredAt
      )
    case .stop:
      _ = await DayframeLiveActivityController.stop()
    }
  }
}

fileprivate struct DayframeShortcutEvent: Codable {
  let localId: String
  let source: String
  let type: String
  let occurredAt: Date
  let categoryId: String?
  let description: String?
  let rawPayload: [String: String]

  init(action: DayframeShortcutAction, catalog: DayframeShortcutCatalog) {
    let now = Date()
    let actionName: String
    var nextType: String
    var nextCategoryId: String?
    var nextDescription: String?
    var payload = ["origin": "ios_app_intent"]

    switch action {
    case .start(let description, let categoryName, let workspaceName):
      actionName = "start"
      nextType = "shortcut_action"
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
    case .stop:
      actionName = "stop"
      nextType = "timer_stop"
    }

    localId = "ios-shortcut-\(actionName)-\(Int(now.timeIntervalSince1970 * 1000))-\(UUID().uuidString)"
    source = "shortcut"
    type = nextType
    occurredAt = now
    categoryId = nextCategoryId
    description = nextDescription
    rawPayload = payload
  }

}

enum DayframeNativeShortcutQueue {
  private static let key = "dayframe.nativeShortcutQueue.v1"
  private static let lock = NSLock()

  fileprivate static func append(_ event: DayframeShortcutEvent) -> Bool {
    lock.withLock {
      var queue = readUnlocked()
      guard !queue.contains(where: { $0.localId == event.localId }) else {
        return true
      }
      queue.append(event)
      return writeUnlocked(queue)
    }
  }

  static func pendingDictionaries() -> [[String: Any]] {
    lock.withLock {
      guard
        let data = try? JSONEncoder.dayframe.encode(readUnlocked()),
        let object = try? JSONSerialization.jsonObject(with: data),
        let dictionaries = object as? [[String: Any]]
      else {
        return []
      }
      return dictionaries
    }
  }

  static func remove(localIds: [String]) -> Int {
    let ids = Set(localIds.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
    guard !ids.isEmpty else {
      return 0
    }

    return lock.withLock {
      let queue = readUnlocked()
      let next = queue.filter { !ids.contains($0.localId) }
      let removed = queue.count - next.count
      guard removed > 0 else {
        return 0
      }
      return writeUnlocked(next) ? removed : 0
    }
  }

  private static func readUnlocked() -> [DayframeShortcutEvent] {
    guard
      let value = UserDefaults.standard.string(forKey: key),
      let data = value.data(using: .utf8),
      let decoded = try? JSONDecoder.dayframe.decode([DayframeShortcutEvent].self, from: data)
    else {
      return []
    }
    return decoded
  }

  private static func writeUnlocked(_ events: [DayframeShortcutEvent]) -> Bool {
    guard let data = try? JSONEncoder.dayframe.encode(events), let value = String(data: data, encoding: .utf8) else {
      return false
    }
    UserDefaults.standard.set(value, forKey: key)
    return UserDefaults.standard.synchronize()
  }
}

extension NSLock {
  fileprivate func withLock<T>(_ body: () throws -> T) rethrows -> T {
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
      return DayframeShortcutCatalog(workspace: nil, categories: [])
    }

    return decoded
  }
}

private struct DayframeShortcutCatalog: Decodable {
  let workspace: DayframeShortcutWorkspace?
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

private struct DayframeShortcutWorkspace: Decodable {
  let id: String
  let name: String
}

private struct DayframeShortcutCategory: Decodable {
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
