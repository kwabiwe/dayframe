import ActivityKit
import Foundation

struct DayframeTimerAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var title: String
    var categoryName: String?
    var startedAt: Date?
    var elapsedSeconds: Int
    var isRunning: Bool
  }

  var id: String
}
