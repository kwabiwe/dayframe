import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

private let dayframeLiveActivityAccent = Color(red: 1.0, green: 0.38, blue: 0.32)
private let dayframeLiveActivityStopBackground = Color(red: 0.28, green: 0.11, blue: 0.09)

struct DayframeTimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DayframeTimerAttributes.self) { context in
      DayframeLockScreenTimerView(state: context.state)
        .activityBackgroundTint(Color(red: 0.02, green: 0.04, blue: 0.08))
        .activitySystemActionForegroundColor(dayframeLiveActivityAccent)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          DayframeElapsedTimerText(state: context.state, size: .expanded)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if context.state.isRunning {
            DayframeLiveActivityStopButton(size: 58, iconSize: 26)
              .frame(width: 66, height: 66, alignment: .trailing)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          DayframeLiveActivityLabel(state: context.state, size: .expandedIsland)
            .frame(maxWidth: .infinity, alignment: .leading)
            .offset(y: -3)
        }
      } compactLeading: {
        DayframeElapsedTimerText(state: context.state, size: .compact)
          .frame(minWidth: 34, idealWidth: 42, maxWidth: 52, alignment: .leading)
      } compactTrailing: {
        if context.state.isRunning {
          DayframeLiveActivityStatusIcon(isRunning: true, size: 16)
        } else {
          DayframeLiveActivityStatusIcon(isRunning: false, size: 16)
        }
      } minimal: {
        DayframeLiveActivityStatusIcon(isRunning: context.state.isRunning, size: 11)
      }
      .keylineTint(dayframeLiveActivityAccent)
    }
  }
}

private struct DayframeLiveActivityStatusIcon: View {
  let isRunning: Bool
  let size: CGFloat

  var body: some View {
    Image(systemName: isRunning ? "timer" : "checkmark.circle.fill")
      .font(.system(size: size, weight: .semibold))
      .foregroundStyle(isRunning ? dayframeLiveActivityAccent : .secondary)
  }
}

private struct DayframeLockScreenTimerView: View {
  let state: DayframeTimerAttributes.ContentState

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 10) {
        DayframeElapsedTimerText(state: state, size: .lockScreen)
        DayframeLiveActivityLabel(state: state, size: .lockScreen)
      }
      Spacer(minLength: 12)
      if state.isRunning {
        DayframeLiveActivityStopButton(size: 54, iconSize: 24)
      }
    }
    .padding(.vertical, 14)
    .padding(.horizontal, 18)
  }
}

private struct DayframeLiveActivityLabel: View {
  let state: DayframeTimerAttributes.ContentState
  let size: DayframeLiveActivityLabelSize

  var body: some View {
    VStack(alignment: .leading, spacing: size.spacing) {
      Text(state.title)
        .font(.system(size: size.titleSize, weight: .semibold, design: .default))
        .lineLimit(1)
        .minimumScaleFactor(0.72)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let categoryName = state.categoryName {
        Text(categoryName)
          .font(.system(size: size.categorySize, weight: .medium, design: .default))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.75)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }
}

private enum DayframeLiveActivityLabelSize {
  case expandedIsland
  case lockScreen

  var titleSize: CGFloat {
    switch self {
    case .expandedIsland:
      return 19
    case .lockScreen:
      return 20
    }
  }

  var categorySize: CGFloat {
    switch self {
    case .expandedIsland:
      return 14
    case .lockScreen:
      return 16
    }
  }

  var spacing: CGFloat {
    switch self {
    case .expandedIsland:
      return 3
    case .lockScreen:
      return 5
    }
  }
}

private struct DayframeElapsedTimerText: View {
  let state: DayframeTimerAttributes.ContentState
  let size: DayframeTimerTextSize

  var body: some View {
    if state.isRunning, let startedAt = state.startedAt {
      Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
        .monospacedDigit()
        .font(font)
        .fontWeight(weight)
        .foregroundStyle(dayframeLiveActivityAccent)
        .lineLimit(1)
        .minimumScaleFactor(0.62)
    } else {
      Text(formatElapsedSeconds(state.elapsedSeconds))
        .monospacedDigit()
        .font(font)
        .fontWeight(weight)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.62)
    }
  }

  private var font: Font {
    switch size {
    case .compact:
      return .system(size: 14, weight: .bold, design: .rounded)
    case .minimal:
      return .system(size: 11, weight: .semibold, design: .rounded)
    case .expanded:
      return .system(size: 38, weight: .semibold, design: .rounded)
    case .lockScreen:
      return .system(size: 36, weight: .semibold, design: .rounded)
    }
  }

  private var weight: Font.Weight {
    switch size {
    case .compact, .minimal:
      return .bold
    case .expanded, .lockScreen:
      return .semibold
    }
  }
}

private enum DayframeTimerTextSize {
  case compact
  case minimal
  case expanded
  case lockScreen
}

private struct DayframeLiveActivityStopButton: View {
  let size: CGFloat
  let iconSize: CGFloat

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: DayframeLiveActivityStopIntent()) {
        stopButtonContent
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Stop timer")
    } else {
      stopButtonContent
        .accessibilityLabel("Stop timer")
    }
  }

  private var stopButtonContent: some View {
    ZStack {
      Circle()
        .fill(dayframeLiveActivityStopBackground)
      RoundedRectangle(cornerRadius: max(3, iconSize * 0.18), style: .continuous)
        .fill(dayframeLiveActivityAccent)
        .frame(width: iconSize, height: iconSize)
    }
    .frame(width: size, height: size)
    .contentShape(Circle())
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
