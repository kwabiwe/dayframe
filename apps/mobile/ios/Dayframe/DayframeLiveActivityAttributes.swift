import ActivityKit
import Foundation

struct DayframeTimerAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var title: String
    var categoryName: String?
    var categoryColor: String?
    var startedAt: Date?
    var elapsedSeconds: Int
    var isRunning: Bool
    // Optional so activities archived by older builds continue to decode.
    // The Stop control is exposed only after the server has registered this
    // exact ActivityKit push token as the capability for this timer entry.
    var canStop: Bool?
  }

  // `id` is retained so activities archived by older builds still decode.
  // New activities additionally carry the canonical server entry identity;
  // a missing value marks a legacy/offline activity whose Stop control must
  // never be allowed to stop whichever timer happens to be current later.
  var id: String
  var entryId: String?
  // Immutable hosted API origin used by the background LiveActivityIntent.
  // Optional preserves decoding for activities archived by older builds.
  var apiBase: String?
}
