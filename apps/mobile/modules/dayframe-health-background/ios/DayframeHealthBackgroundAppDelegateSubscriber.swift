import ExpoModulesCore
import UIKit

public final class DayframeHealthBackgroundAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Synchronous on purpose: BGTaskScheduler handlers must be registered before launch ends.
    DayframeHealthBackgroundService.shared.launch()
    return true
  }
}
