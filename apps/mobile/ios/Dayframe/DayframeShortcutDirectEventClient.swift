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

  static func submit(_ event: DayframeShortcutEvent) async -> Bool {
    guard
      let context = DayframeShortcutRuntimeContextStore.current(),
      let url = URL(string: "\(context.apiBase)/api/events"),
      let body = try? JSONEncoder.dayframe.encode(EventRequest(event: event))
    else {
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
      guard
        let httpResponse = response as? HTTPURLResponse,
        httpResponse.statusCode == 200 || httpResponse.statusCode == 201,
        let payload = try? JSONDecoder().decode(EventResponse.self, from: data),
        !payload.eventId.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).isEmpty
      else {
        return false
      }
      return true
    } catch {
      return false
    }
  }
}
