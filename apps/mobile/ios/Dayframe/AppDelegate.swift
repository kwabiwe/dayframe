internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    DayframeSharedFileLock.install(DayframeSharedFileLockBackgroundTask.begin)
    DayframeDiagnosticsService.shared.start()
    DayframeLocalDatabaseBackup.exclude()
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

/// expo-sqlite keeps every Dayframe database (the Location, Health and Review journals and outboxes)
/// in `Documents/SQLite`, which iCloud and computer backups include. They hold precise location and
/// Health data that logout and Delete recent evidence must be able to remove, so the folder is kept out
/// of backups (stability audit 22 Oct 2026, location-5), before JavaScript can open a database. iOS
/// applies a folder's exclusion to everything inside it; this runs at every launch, background ones too.
private enum DayframeLocalDatabaseBackup {
  static func exclude() {
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
    var directory = documents.appendingPathComponent("SQLite", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
    } catch {
      // Best effort: the next launch tries again.
    }
  }
}

/// The app's assertion for `DayframeSharedFileLock`: a finite UIKit background task. Its expiry goes
/// through `DayframeSharedFileLockAssertion.expire()`, which releases a held lock before the task ends;
/// the identifier is ended exactly once, even when the expiry races the begin.
private enum DayframeSharedFileLockBackgroundTask {
  static func begin(name: String) -> DayframeSharedFileLockAssertion? {
    let identifier = Identifier()
    let assertion = DayframeSharedFileLockAssertion { identifier.end() }
    let granted = UIApplication.shared.beginBackgroundTask(withName: name) { assertion.expire() }
    guard granted != .invalid else {
      return nil
    }
    identifier.set(granted)
    return assertion
  }

  private final class Identifier: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UIBackgroundTaskIdentifier = .invalid
    private var ended = false

    func set(_ granted: UIBackgroundTaskIdentifier) {
      let endNow = lock.withLock { () -> Bool in
        if ended { return true }
        value = granted
        return false
      }
      if endNow { UIApplication.shared.endBackgroundTask(granted) }
    }

    func end() {
      let current = lock.withLock { () -> UIBackgroundTaskIdentifier in
        ended = true
        defer { value = .invalid }
        return value
      }
      if current != .invalid { UIApplication.shared.endBackgroundTask(current) }
    }
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
