import ExpoModulesCore
import UIKit

public final class DayframeTrackingNoticeAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    DayframeTrackingNoticeService.shared.clearNotice()
    return true
  }

  public func applicationWillTerminate(_ application: UIApplication) {
    DayframeTrackingNoticeService.shared.applicationWillTerminate()
  }
}
