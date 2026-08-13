import Darwin
import Foundation
import Security

enum DayframeSharedStorageConfiguration {
  static let appGroupIdentifier = "group.com.layereight.dayframe"

  static var keychainAccessGroup: String? {
    guard
      let value = Bundle.main.object(forInfoDictionaryKey: "DayframeSharedKeychainAccessGroup") as? String,
      !value.isEmpty,
      !value.contains("$(")
    else {
      return nil
    }
    return value
  }

  static var containerURL: URL? {
    FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupIdentifier
    )
  }
}

enum DayframeShortcutDeliveryDiagnostic {
  case legacyUnscoped
  case started
  case contextUnavailable
  case capabilityUnavailable
  case requestInvalid
  case responseInvalid
  case httpFailure(statusCode: Int)
  case transportFailure
  case delivered

  fileprivate var fileSuffix: String {
    switch self {
    case .legacyUnscoped:
      return "legacy-unscoped"
    case .started:
      return "started"
    case .contextUnavailable:
      return "context-unavailable"
    case .capabilityUnavailable:
      return "capability-unavailable"
    case .requestInvalid:
      return "request-invalid"
    case .responseInvalid:
      return "response-invalid"
    case .httpFailure(let statusCode):
      if statusCode == 401 || statusCode == 403 { return "http-auth" }
      if (500...599).contains(statusCode) { return "http-server" }
      return "http-rejected"
    case .transportFailure:
      return "transport-failure"
    case .delivered:
      return "delivered"
    }
  }
}

enum DayframeShortcutDeliveryDiagnosticStore {
  private static let filePrefix = "dayframe-shortcut-delivery-v1."

  static func record(_ diagnostic: DayframeShortcutDeliveryDiagnostic) {
    guard let containerURL = DayframeSharedStorageConfiguration.containerURL else {
      return
    }
    let fileManager = FileManager.default
    if let files = try? fileManager.contentsOfDirectory(
      at: containerURL,
      includingPropertiesForKeys: nil
    ) {
      for file in files where file.lastPathComponent.hasPrefix(filePrefix) {
        try? fileManager.removeItem(at: file)
      }
    }
    let destination = containerURL.appendingPathComponent(
      "\(filePrefix)\(diagnostic.fileSuffix)",
      isDirectory: false
    )
    _ = fileManager.createFile(atPath: destination.path, contents: Data())
  }
}

struct DayframeShortcutRuntimeContext: Codable, Equatable {
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
      guard let accessGroup = DayframeSharedStorageConfiguration.keychainAccessGroup else {
        return false
      }
      let didWrite = upsert(data: data, accessGroup: accessGroup)
      if didWrite {
        SecItemDelete(baseQuery(accessGroup: nil) as CFDictionary)
      }
      return didWrite
    }
  }

  static func clear() {
    lock.withLock {
      if let accessGroup = DayframeSharedStorageConfiguration.keychainAccessGroup {
        SecItemDelete(baseQuery(accessGroup: accessGroup) as CFDictionary)
      }
      // Remove the pre-App-Group item from the current process's private
      // keychain as part of the one-version migration path.
      SecItemDelete(baseQuery(accessGroup: nil) as CFDictionary)
    }
  }

  static func current() -> DayframeShortcutRuntimeContext? {
    lock.withLock {
      if
        let accessGroup = DayframeSharedStorageConfiguration.keychainAccessGroup,
        let shared = read(accessGroup: accessGroup)
      {
        return shared
      }

      // Only the containing app can see the legacy host item. If it finds one,
      // copy it into the shared group so the next extension invocation can use
      // it. An extension with no shared item simply returns nil and preserves
      // its already-queued event.
      guard let legacy = read(accessGroup: nil) else {
        return nil
      }
      if
        let accessGroup = DayframeSharedStorageConfiguration.keychainAccessGroup,
        let data = try? JSONEncoder().encode(legacy),
        upsert(data: data, accessGroup: accessGroup)
      {
        SecItemDelete(baseQuery(accessGroup: nil) as CFDictionary)
      }
      return legacy
    }
  }

  private static func read(accessGroup: String?) -> DayframeShortcutRuntimeContext? {
    var query = baseQuery(accessGroup: accessGroup)
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

  private static func upsert(data: Data, accessGroup: String) -> Bool {
    let query = baseQuery(accessGroup: accessGroup)
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

  private static func baseQuery(accessGroup: String?) -> [CFString: Any] {
    var query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account
    ]
    if let accessGroup {
      query[kSecAttrAccessGroup] = accessGroup
    }
    return query
  }

  private static func normalizedAPIBase(_ value: String) -> String? {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return allowedAPIBaseURLs.contains(normalized) ? normalized : nil
  }
}

enum DayframeNativeShortcutQueue {
  private static let legacyKey = "dayframe.nativeShortcutQueue.v1"
  private static let queueFileName = "dayframe-native-shortcut-queue-v2.json"
  private static let lockFileName = "dayframe-native-shortcut-queue-v2.lock"
  private static let processLock = NSLock()

  static var isSharedContainerAvailable: Bool {
    DayframeSharedStorageConfiguration.containerURL != nil
  }

  static func append(_ event: DayframeShortcutEvent) -> Bool {
    processLock.withLock {
      guard let result = withSharedQueueLock({ queueURL in
        var queue = readSharedUnlocked(queueURL: queueURL)
        queue = merge(queue, legacyEvents())
        guard !queue.contains(where: { $0.localId == event.localId }) else {
          clearLegacyEvents()
          return true
        }
        queue.append(event)
        let written = writeSharedUnlocked(queue, queueURL: queueURL)
        if written { clearLegacyEvents() }
        return written
      }) else {
        return appendLegacy(event)
      }
      return result
    }
  }

  static func pendingDictionaries() -> [[String: Any]] {
    processLock.withLock {
      let events = withSharedQueueLock { queueURL in
        let merged = merge(readSharedUnlocked(queueURL: queueURL), legacyEvents())
        if writeSharedUnlocked(merged, queueURL: queueURL) {
          clearLegacyEvents()
        }
        return merged
      } ?? legacyEvents()
      guard
        let data = try? JSONEncoder.dayframe.encode(events),
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

    return processLock.withLock {
      if let removed = withSharedQueueLock({ queueURL in
        let queue = merge(readSharedUnlocked(queueURL: queueURL), legacyEvents())
        let next = queue.filter { !ids.contains($0.localId) }
        let removed = queue.count - next.count
        guard removed > 0 else {
          clearLegacyEvents()
          return 0
        }
        guard writeSharedUnlocked(next, queueURL: queueURL) else {
          return 0
        }
        clearLegacyEvents()
        return removed
      }) {
        return removed
      }
      return removeLegacy(localIds: ids)
    }
  }

  private static func withSharedQueueLock<T>(_ body: (URL) -> T) -> T? {
    guard let containerURL = DayframeSharedStorageConfiguration.containerURL else {
      return nil
    }
    let lockURL = containerURL.appendingPathComponent(lockFileName, isDirectory: false)
    let queueURL = containerURL.appendingPathComponent(queueFileName, isDirectory: false)
    let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else {
      return nil
    }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else {
      return nil
    }
    defer { flock(descriptor, LOCK_UN) }
    return body(queueURL)
  }

  private static func readSharedUnlocked(queueURL: URL) -> [DayframeShortcutEvent] {
    guard
      let data = try? Data(contentsOf: queueURL),
      let decoded = try? JSONDecoder.dayframe.decode([DayframeShortcutEvent].self, from: data)
    else {
      return []
    }
    return decoded
  }

  private static func writeSharedUnlocked(_ events: [DayframeShortcutEvent], queueURL: URL) -> Bool {
    guard let data = try? JSONEncoder.dayframe.encode(events) else {
      return false
    }
    do {
      try data.write(to: queueURL, options: .atomic)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: queueURL.path
      )
      return true
    } catch {
      return false
    }
  }

  private static func merge(
    _ shared: [DayframeShortcutEvent],
    _ legacy: [DayframeShortcutEvent]
  ) -> [DayframeShortcutEvent] {
    var ids = Set<String>()
    return (shared + legacy).filter { ids.insert($0.localId).inserted }
  }

  private static func legacyEvents() -> [DayframeShortcutEvent] {
    guard
      let value = UserDefaults.standard.string(forKey: legacyKey),
      let data = value.data(using: .utf8),
      let decoded = try? JSONDecoder.dayframe.decode([DayframeShortcutEvent].self, from: data)
    else {
      return []
    }
    return decoded
  }

  private static func appendLegacy(_ event: DayframeShortcutEvent) -> Bool {
    var queue = legacyEvents()
    guard !queue.contains(where: { $0.localId == event.localId }) else {
      return true
    }
    queue.append(event)
    return writeLegacy(queue)
  }

  private static func removeLegacy(localIds: Set<String>) -> Int {
    let queue = legacyEvents()
    let next = queue.filter { !localIds.contains($0.localId) }
    let removed = queue.count - next.count
    return removed > 0 && writeLegacy(next) ? removed : 0
  }

  private static func writeLegacy(_ events: [DayframeShortcutEvent]) -> Bool {
    guard
      let data = try? JSONEncoder.dayframe.encode(events),
      let value = String(data: data, encoding: .utf8)
    else {
      return false
    }
    UserDefaults.standard.set(value, forKey: legacyKey)
    return UserDefaults.standard.synchronize()
  }

  private static func clearLegacyEvents() {
    UserDefaults.standard.removeObject(forKey: legacyKey)
  }
}
