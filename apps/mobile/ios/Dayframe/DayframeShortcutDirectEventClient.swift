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
    let timeEntryId: String?
    let startOutcome: String?
  }

  /// What the server made of a delivered Shortcut Start, and the checked session that delivered it.
  struct StartDelivery {
    let timeEntryId: String?
    /// A late Start the server placed as an already finished block, or a duplicate of a block that starts
    /// at the same moment (#403): nothing is running for it.
    let runsNow: Bool
    let context: DayframeShortcutRuntimeContext
  }

  private struct LiveActivityRegistrationRequest: Encodable {
    let token: String
    let activityId: String
    let activeEntryId: String
    let environment: String
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

  /// Delivers a queued Shortcut event with the app's mirrored session, only when that session belongs to
  /// the event's account; otherwise the event waits in the queue for the app to deliver it.
  static func submit(_ event: DayframeShortcutEvent) async -> Bool {
    await deliver(event) != nil
  }

  /// Delivers a Shortcut Start like `submit`, returning the block the server made of it.
  static func submitStart(_ event: DayframeShortcutEvent) async -> StartDelivery? {
    guard let (payload, context) = await deliver(event) else { return nil }
    let entryId = payload.timeEntryId.flatMap { isCanonicalEntryId($0) ? $0.lowercased() : nil }
    return StartDelivery(timeEntryId: entryId, runsNow: payload.startOutcome == nil, context: context)
  }

  /// Registers a Shortcut-started Live Activity's APNs push token for its block with the session that
  /// delivered the Start (`POST /api/live-activities`), then shows its Stop control, as the app does for
  /// Activities it starts. Without this a Stop or Switch made on the web or another device could not end
  /// or update the Activity (roadmap card 10).
  static func registerLiveActivity(
    activityId: String,
    entryId: String,
    context: DayframeShortcutRuntimeContext
  ) async -> Bool {
    guard
      let environment = DayframeLiveActivityController.pushEnvironment(),
      let token = await DayframeLiveActivityController.pushToken(activityId: activityId),
      let url = URL(string: "\(context.apiBase)/api/live-activities"),
      let body = try? JSONEncoder.dayframe.encode(LiveActivityRegistrationRequest(
        token: token,
        activityId: activityId,
        activeEntryId: entryId,
        environment: environment
      ))
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
    do {
      let (_, response) = try await URLSession(configuration: configuration).data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 201 else { return false }
    } catch {
      return false
    }
    return await DayframeLiveActivityController.enableStop(activityId: activityId, entryId: entryId)
  }

  static func isCanonicalEntryId(_ value: String) -> Bool {
    value.range(
      of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      options: [.regularExpression, .caseInsensitive]
    ) != nil
  }

  private static func deliver(_ event: DayframeShortcutEvent) async -> (EventResponse, DayframeShortcutRuntimeContext)? {
    DayframeShortcutDeliveryDiagnosticStore.record(.started)
    guard
      let context = DayframeShortcutRuntimeContextStore.current()
    else {
      DayframeShortcutDeliveryDiagnosticStore.record(.contextUnavailable)
      return nil
    }
    guard
      let userId = event.userId,
      let workspaceId = event.workspaceId,
      context.userId == userId,
      context.workspaceId == workspaceId
    else {
      DayframeShortcutDeliveryDiagnosticStore.record(.ownerUnverified)
      return nil
    }
    guard
      let url = URL(string: "\(context.apiBase)/api/events"),
      let body = try? JSONEncoder.dayframe.encode(EventRequest(event: event))
    else {
      DayframeShortcutDeliveryDiagnosticStore.record(.requestInvalid)
      return nil
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
        return nil
      }
      guard httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
        DayframeShortcutDeliveryDiagnosticStore.record(.httpFailure(statusCode: httpResponse.statusCode))
        return nil
      }
      guard
        let payload = try? JSONDecoder().decode(EventResponse.self, from: data),
        !payload.eventId.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).isEmpty
      else {
        DayframeShortcutDeliveryDiagnosticStore.record(.responseInvalid)
        return nil
      }
      DayframeShortcutDeliveryDiagnosticStore.record(.delivered)
      return (payload, context)
    } catch {
      DayframeShortcutDeliveryDiagnosticStore.record(.transportFailure)
      return nil
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
