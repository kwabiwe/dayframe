import ActivityKit
import SwiftUI
import WidgetKit

struct DayframeTimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DayframeTimerAttributes.self) { context in
      DayframeLockScreenTimerView(state: context.state)
        .activityBackgroundTint(Color(red: 0.02, green: 0.04, blue: 0.08))
        .activitySystemActionForegroundColor(Color(red: 1.0, green: 0.38, blue: 0.32))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          DayframeLiveActivityLabel(state: context.state)
        }
        DynamicIslandExpandedRegion(.trailing) {
          DayframeElapsedTimerText(state: context.state, compact: false)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.categoryName ?? "Dayframe")
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      } compactLeading: {
        Image(systemName: context.state.isRunning ? "timer" : "checkmark.circle")
          .foregroundStyle(Color(red: 1.0, green: 0.38, blue: 0.32))
      } compactTrailing: {
        DayframeElapsedTimerText(state: context.state, compact: true)
      } minimal: {
        Image(systemName: context.state.isRunning ? "timer" : "checkmark.circle")
          .foregroundStyle(Color(red: 1.0, green: 0.38, blue: 0.32))
      }
    }
  }
}

private struct DayframeLockScreenTimerView: View {
  let state: DayframeTimerAttributes.ContentState

  var body: some View {
    HStack(spacing: 14) {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color(red: 1.0, green: 0.38, blue: 0.32))
        .frame(width: 6)
      VStack(alignment: .leading, spacing: 6) {
        DayframeLiveActivityLabel(state: state)
        if let categoryName = state.categoryName {
          Text(categoryName)
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 12)
      DayframeElapsedTimerText(state: state, compact: false)
    }
    .padding(.vertical, 16)
    .padding(.horizontal, 18)
  }
}

private struct DayframeLiveActivityLabel: View {
  let state: DayframeTimerAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(state.isRunning ? "Active timer" : "Timer stopped")
        .font(.caption2)
        .fontWeight(.bold)
        .foregroundStyle(.secondary)
        .textCase(.uppercase)
      Text(state.title)
        .font(.headline)
        .fontWeight(.bold)
        .lineLimit(1)
        .minimumScaleFactor(0.78)
    }
  }
}

private struct DayframeElapsedTimerText: View {
  let state: DayframeTimerAttributes.ContentState
  let compact: Bool

  var body: some View {
    if state.isRunning, let startedAt = state.startedAt {
      Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
        .monospacedDigit()
        .font(compact ? .caption2 : .title3)
        .fontWeight(.black)
        .foregroundStyle(Color(red: 1.0, green: 0.38, blue: 0.32))
        .lineLimit(1)
        .minimumScaleFactor(0.72)
    } else {
      Text(formatElapsedSeconds(state.elapsedSeconds))
        .monospacedDigit()
        .font(compact ? .caption2 : .title3)
        .fontWeight(.black)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

private func formatElapsedSeconds(_ seconds: Int) -> String {
  let safeSeconds = max(0, seconds)
  let hours = safeSeconds / 3600
  let minutes = (safeSeconds % 3600) / 60
  let remainingSeconds = safeSeconds % 60
  return hours > 0
    ? String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds)
    : String(format: "%d:%02d", minutes, remainingSeconds)
}
