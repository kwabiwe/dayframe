import Foundation
import Security

private struct DayframeShortcutRuntimeContext: Codable, Equatable {
  let apiBase: String
  let sessionToken: String
}

enum DayframeShortcutRuntimeContextStore {
  private static let service = "com.dayframe.app.shortcut-direct-event"
  private static let account = "runtime-context-v1"
  private static let lock = NSLock()
  private static let allowedAPIBaseURLs = Set([
    "https://dayframe-staging.vercel.app",
    "https://dayframe-web.vercel.app"
  ])

  static func set(apiBase: String, sessionToken: String) -> Bool {
    guard
      let normalizedAPIBase = normalizedAPIBase(apiBase),
      !sessionToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      let data = try? JSONEncoder().encode(
        DayframeShortcutRuntimeContext(apiBase: normalizedAPIBase, sessionToken: sessionToken)
      )
    else {
      clear()
      return false
    }

    return lock.withLock {
      let query = baseQuery
      var existingQuery = query
      existingQuery[kSecReturnData] = true
      existingQuery[kSecMatchLimit] = kSecMatchLimitOne
      var existingResult: CFTypeRef?
      if
        SecItemCopyMatching(existingQuery as CFDictionary, &existingResult) == errSecSuccess,
        let existingData = existingResult as? Data,
        existingData == data
      {
        return true
      }

      let attributes: [CFString: Any] = [
        kSecValueData: data,
        kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      ]
      let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
      if updateStatus == errSecSuccess {
        return true
      }
      guard updateStatus == errSecItemNotFound else {
        return false
      }

      var item = query
      attributes.forEach { item[$0] = $1 }
      return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }
  }

  static func clear() {
    lock.withLock {
      SecItemDelete(baseQuery as CFDictionary)
    }
  }

  fileprivate static func current() -> DayframeShortcutRuntimeContext? {
    lock.withLock {
      var query = baseQuery
      query[kSecReturnData] = true
      query[kSecMatchLimit] = kSecMatchLimitOne

      var result: CFTypeRef?
      guard
        SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
        let data = result as? Data,
        let context = try? JSONDecoder().decode(DayframeShortcutRuntimeContext.self, from: data),
        normalizedAPIBase(context.apiBase) == context.apiBase,
        !context.sessionToken.isEmpty
      else {
        return nil
      }
      return context
    }
  }

  private static var baseQuery: [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account
    ]
  }

  private static func normalizedAPIBase(_ value: String) -> String? {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return allowedAPIBaseURLs.contains(normalized) ? normalized : nil
  }
}

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
        !payload.eventId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        return false
      }
      return true
    } catch {
      return false
    }
  }
}
