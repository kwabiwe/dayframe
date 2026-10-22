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

/// The app's assertion for `DayframeSharedFileLock`: a finite UIKit background task, ended exactly once
/// by whichever comes first, the lock's release or the system's expiry.
private final class DayframeSharedFileLockBackgroundTask: @unchecked Sendable {
  private let lock = NSLock()
  private var identifier: UIBackgroundTaskIdentifier = .invalid
  private var ended = false

  static func begin(name: String) -> (() -> Void)? {
    let task = DayframeSharedFileLockBackgroundTask()
    let identifier = UIApplication.shared.beginBackgroundTask(withName: name) { task.end() }
    guard identifier != .invalid else {
      return nil
    }
    let endedEarly = task.lock.withLock { () -> Bool in
      if task.ended { return true }
      task.identifier = identifier
      return false
    }
    if endedEarly {
      UIApplication.shared.endBackgroundTask(identifier)
      return nil
    }
    return { task.end() }
  }

  private func end() {
    let identifier = lock.withLock { () -> UIBackgroundTaskIdentifier in
      ended = true
      let identifier = self.identifier
      self.identifier = .invalid
      return identifier
    }
    if identifier != .invalid {
      UIApplication.shared.endBackgroundTask(identifier)
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
