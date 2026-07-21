import ExpoModulesCore
import UIKit

public final class DayframeLocationAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let locationRelaunch = launchOptions?[.location] != nil
    Task { @MainActor in
      DayframeLocationVisitService.shared.restoreIfEnabled(locationRelaunch: locationRelaunch)
    }
    return true
  }
}
