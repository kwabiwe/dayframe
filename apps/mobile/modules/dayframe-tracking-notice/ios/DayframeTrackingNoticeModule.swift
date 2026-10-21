import ExpoModulesCore

public final class DayframeTrackingNoticeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DayframeTrackingNotice")

    AsyncFunction("setArmed") { (armed: Bool) in
      DayframeTrackingNoticeService.shared.setArmed(armed)
    }.runOnQueue(.main)

    AsyncFunction("getStatus") { () -> [String: Any] in
      DayframeTrackingNoticeService.shared.status()
    }.runOnQueue(.main)
  }
}
