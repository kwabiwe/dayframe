import Foundation

enum DayframeSharedStorageConfiguration {
  // Info.plist and the signed entitlement expand the same DAYFRAME_APP_GROUP
  // build setting. Never infer the lane from JS, API URLs, or process env vars.
  static var appGroupIdentifier: String? {
    appGroupIdentifier(
      configuredValue: Bundle.main.object(forInfoDictionaryKey: "DayframeSharedAppGroupIdentifier"),
      bundleIdentifier: Bundle.main.bundleIdentifier
    )
  }

  static func appGroupIdentifier(configuredValue: Any?, bundleIdentifier: String?) -> String? {
    guard let value = configuredValue as? String else { return nil }
    let expected: String
    switch bundleIdentifier {
    case "com.layereight.dayframe", "com.layereight.dayframe.DayframeLiveActivity":
      expected = "group.com.layereight.dayframe"
    case "com.layereight.dayframe.staging", "com.layereight.dayframe.staging.DayframeLiveActivity":
      expected = "group.com.layereight.dayframe.staging"
    default:
      return nil
    }
    // Missing, unresolved, or cross-lane configuration disables shared storage.
    // There is deliberately no production fallback or container probing.
    return value == expected ? value : nil
  }

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
    guard let appGroupIdentifier else { return nil }
    return FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupIdentifier
    )
  }
}
