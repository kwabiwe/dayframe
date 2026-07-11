import AppIntents
import Foundation
import UIKit

@available(iOS 16.4, *)
struct StartTrackingIntent: AppIntent {
  static var title: LocalizedStringResource = "Start tracking"
  static var description = IntentDescription("Start a Dayframe timer with a description and category.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Description")
  var taskDescription: String?

  @Parameter(title: "Category")
  var category: String?

  @MainActor
  func perform() async throws -> some IntentResult {
    await UIApplication.shared.open(DayframeShortcutURL.start(
      description: taskDescription,
      category: category
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
        "Start a task in \(.applicationName)"
      ],
      shortTitle: "Start tracking",
      systemImageName: "timer"
    )
  }
}

private enum DayframeShortcutURL {
  static func start(description: String?, category: String?) -> URL {
    var components = URLComponents()
    components.scheme = "dayframe"
    components.host = "action"
    components.path = "/start"
    components.queryItems = [
      queryItem(name: "description", value: description),
      queryItem(name: "category", value: category)
    ].compactMap { $0 }

    return components.url ?? URL(string: "dayframe://action/start")!
  }

  private static func queryItem(name: String, value: String?) -> URLQueryItem? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
      return nil
    }
    return URLQueryItem(name: name, value: trimmed)
  }
}
