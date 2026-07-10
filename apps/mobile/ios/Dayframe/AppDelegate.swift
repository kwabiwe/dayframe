internal import Expo
import ObjectiveC
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
    setupHealthKitBackgroundObservers()

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

private func setupHealthKitBackgroundObservers() {
  let classNames = [
    "ReactNativeHealthkit.BackgroundDeliveryManager",
    "_TtC20ReactNativeHealthkit25BackgroundDeliveryManager",
    "BackgroundDeliveryManager"
  ]

  guard let managerClass = classNames.compactMap({ NSClassFromString($0) }).first else {
    return
  }

  let sharedSelector = NSSelectorFromString("shared")
  let setupSelector = NSSelectorFromString("setupBackgroundObservers")

  guard
    let sharedMethod = class_getClassMethod(managerClass, sharedSelector),
    let setupMethod = class_getInstanceMethod(managerClass, setupSelector)
  else {
    return
  }

  typealias SharedFunction = @convention(c) (AnyClass, Selector) -> AnyObject
  typealias SetupFunction = @convention(c) (AnyObject, Selector) -> Void

  let shared = unsafeBitCast(method_getImplementation(sharedMethod), to: SharedFunction.self)(
    managerClass,
    sharedSelector
  )
  unsafeBitCast(method_getImplementation(setupMethod), to: SetupFunction.self)(
    shared,
    setupSelector
  )
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
