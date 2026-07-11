import AppIntents
import Foundation
import UIKit

@available(iOS 16.4, *)
struct StartTrackingIntent: AppIntent {
  static var title: LocalizedStringResource = "Start tracking"
  static var description = IntentDescription("Start a Dayframe timer with an optional description, category, and workspace.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Description")
  var taskDescription: String?

  @Parameter(title: "Category", optionsProvider: DayframeCategoryOptionsProvider())
  var category: String?

  @Parameter(title: "Workspace", optionsProvider: DayframeWorkspaceOptionsProvider())
  var workspace: String?

  @MainActor
  func perform() async throws -> some IntentResult {
    await UIApplication.shared.open(DayframeShortcutURL.start(
      description: taskDescription,
      category: category,
      workspace: workspace
    ))
    return .result()
  }
}

@available(iOS 16.4, *)
struct StopTrackingIntent: AppIntent {
  static var title: LocalizedStringResource = "Stop tracking"
  static var description = IntentDescription("Stop the current Dayframe timer.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await UIApplication.shared.open(DayframeShortcutURL.stop())
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

private enum DayframeShortcutURL {
  static func start(description: String?, category: String?, workspace: String?) -> URL {
    var components = URLComponents()
    components.scheme = "dayframe"
    components.host = "action"
    components.path = "/start"
    components.queryItems = [
      queryItem(name: "description", value: description),
      queryItem(name: "category", value: category),
      queryItem(name: "workspace", value: workspace)
    ].compactMap { $0 }

    return components.url ?? URL(string: "dayframe://action/start")!
  }

  static func stop() -> URL {
    URL(string: "dayframe://action/stop")!
  }

  private static func queryItem(name: String, value: String?) -> URLQueryItem? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
      return nil
    }
    return URLQueryItem(name: name, value: trimmed)
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
}

private struct DayframeShortcutWorkspace: Decodable {
  let id: String
  let name: String
}

private struct DayframeShortcutCategory: Decodable {
  let id: String
  let name: String
}
