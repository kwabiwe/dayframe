import Foundation

enum DayframeShortcutDirectEventClient {
  private struct EventRequest: Encodable {
    let source: String
    let type: String
    let occurredAt: Date
    let clientEventId: String
    let categoryId: String?
    let description: String?
    let rawPayload: [String: String]

    init(event: DayframeShortcutEvent) {
      source = event.source
      type = event.type
      occurredAt = event.occurredAt
      clientEventId = event.localId
      categoryId = event.categoryId
      description = event.description
      rawPayload = event.rawPayload
    }
  }

  private struct EventResponse: Decodable {
    let eventId: String
  }

  private struct LiveActivityStopRequest: Encodable {
    let token: String
    let activityId: String
    let entryId: String
    let clientEventId: String
  }

  private static let allowedAPIBaseURLs = Set([
    "https://dayframe-staging.vercel.app",
    "https://dayframe-web.vercel.app"
  ])

  static func submit(_ event: DayframeShortcutEvent) async -> Bool {
    DayframeShortcutDeliveryDiagnosticStore.record(.started)
    guard
      let context = DayframeShortcutRuntimeContextStore.current()
    else {
      DayframeShortcutDeliveryDiagnosticStore.record(.contextUnavailable)
      return false
    }
    guard
      let url = URL(string: "\(context.apiBase)/api/events"),
      let body = try? JSONEncoder.dayframe.encode(EventRequest(event: event))
    else {
      DayframeShortcutDeliveryDiagnosticStore.record(.requestInvalid)
      return false
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = body
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(context.sessionToken)", forHTTPHeaderField: "Authorization")

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 8
    configuration.timeoutIntervalForResource = 10
    let session = URLSession(configuration: configuration)

    do {
      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        DayframeShortcutDeliveryDiagnosticStore.record(.responseInvalid)
        return false
      }
      guard httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
        DayframeShortcutDeliveryDiagnosticStore.record(.httpFailure(statusCode: httpResponse.statusCode))
        return false
      }
      guard
        let payload = try? JSONDecoder().decode(EventResponse.self, from: data),
        !payload.eventId.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).isEmpty
      else {
        DayframeShortcutDeliveryDiagnosticStore.record(.responseInvalid)
        return false
      }
      DayframeShortcutDeliveryDiagnosticStore.record(.delivered)
      return true
    } catch {
      DayframeShortcutDeliveryDiagnosticStore.record(.transportFailure)
      return false
    }
  }

  static func submitLiveActivityStop(
    _ event: DayframeShortcutEvent,
    apiBase: String,
    activityId: String,
    entryId: String,
    pushToken: String
  ) async -> Bool {
    DayframeShortcutDeliveryDiagnosticStore.record(.started)
    guard
      let normalizedAPIBase = normalizedAPIBase(apiBase),
      !activityId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !entryId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      pushToken.range(of: "^[0-9a-f]{32,512}$", options: [.regularExpression, .caseInsensitive]) != nil,
      let url = URL(string: "\(normalizedAPIBase)/api/live-activities/stop"),
      let body = try? JSONEncoder.dayframe.encode(LiveActivityStopRequest(
        token: pushToken.lowercased(),
        activityId: activityId,
        entryId: entryId,
        clientEventId: event.localId
      ))
    else {
      DayframeShortcutDeliveryDiagnosticStore.record(.requestInvalid)
      return false
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = body
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 8
    configuration.timeoutIntervalForResource = 10
    let session = URLSession(configuration: configuration)

    do {
      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        DayframeShortcutDeliveryDiagnosticStore.record(.responseInvalid)
        return false
      }
      guard httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
        DayframeShortcutDeliveryDiagnosticStore.record(.httpFailure(statusCode: httpResponse.statusCode))
        return false
      }
      guard
        let payload = try? JSONDecoder().decode(EventResponse.self, from: data),
        !payload.eventId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        DayframeShortcutDeliveryDiagnosticStore.record(.responseInvalid)
        return false
      }
      DayframeShortcutDeliveryDiagnosticStore.record(.delivered)
      return true
    } catch {
      DayframeShortcutDeliveryDiagnosticStore.record(.transportFailure)
      return false
    }
  }

  private static func normalizedAPIBase(_ value: String) -> String? {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return allowedAPIBaseURLs.contains(normalized) ? normalized : nil
  }
}
