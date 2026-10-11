import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// Dayframe Blocks tokens for the Live Activity, from packages/shared (theme.ts, blocks.ts). The Lock
/// Screen follows the phone's appearance (Midnight colours in dark, Daylight in light); the Dynamic
/// Island is always dark.
private enum DayframeLiveTokens {
  static let accentDark = Color(dayframeHex: "#FF6248")!
  static let surfaceRaisedDark = Color(dayframeHex: "#1B2230")!
  static let surfaceRaisedLight = Color(dayframeHex: "#FFFFFF")!
  static let textPrimaryDark = Color(dayframeHex: "#F7F8FB")!
  static let textPrimaryLight = Color(dayframeHex: "#111827")!
  static let textMutedDark = Color(dayframeHex: "#707B91")!
  static let onBlockWhite = "#FFFFFF"
  static let onBlockInk = "#0B1020"
  static let chipRadius: CGFloat = 8
  /// Bricolage Grotesque, the Blocks display face, bundled in this extension (Info.plist UIAppFonts).
  static let displayFont = "BricolageGrotesque-Bold"
}

/// The expanded island's lower row sits this far up so its descenders clear the clipping edge
/// (found on device).
private let dayframeExpandedMetadataLift: CGFloat = 10

/// The live block's fill and on-block text, as Today's live block draws them.
private struct DayframeLiveBlockColors {
  let fill: Color
  let text: Color
  let hasActivity: Bool

  init(state: DayframeTimerAttributes.ContentState, colorScheme: ColorScheme) {
    let hex = colorScheme == .light
      ? (state.categoryColorLight ?? state.categoryColor)
      : state.categoryColor
    if state.categoryName != nil, let hex, let fill = Color(dayframeHex: hex) {
      self.fill = fill
      self.text = Color(dayframeHex: dayframeOnBlockText(fillHex: hex))!
      self.hasActivity = true
    } else {
      self.fill = colorScheme == .light ? DayframeLiveTokens.surfaceRaisedLight : DayframeLiveTokens.surfaceRaisedDark
      self.text = colorScheme == .light ? DayframeLiveTokens.textPrimaryLight : DayframeLiveTokens.textPrimaryDark
      self.hasActivity = false
    }
  }
}

struct DayframeTimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DayframeTimerAttributes.self) { context in
      DayframeLockScreenTimerView(
        activityId: context.activityID,
        entryId: context.attributes.entryId,
        apiBase: context.attributes.apiBase,
        stopControlId: context.attributes.id,
        state: context.state
      )
    } dynamicIsland: { context in
      let colors = DayframeLiveBlockColors(state: context.state, colorScheme: .dark)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          DayframeElapsedTimerText(state: context.state, size: .expanded, runningColor: DayframeLiveTokens.accentDark)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if
            context.state.isRunning,
            context.state.canStop == true,
            let entryId = context.attributes.entryId,
            let apiBase = context.attributes.apiBase
          {
            DayframeLiveActivityStopButton(
              activityId: context.activityID,
              entryId: entryId,
              apiBase: apiBase,
              stopControlId: context.attributes.id,
              circle: colors.hasActivity ? colors.fill : DayframeLiveTokens.textPrimaryDark,
              square: colors.hasActivity ? colors.text : DayframeLiveTokens.surfaceRaisedDark,
              size: 58,
              iconSize: 22
            )
              .frame(width: 66, height: 66, alignment: .trailing)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          DayframeIslandLabel(state: context.state, colors: colors)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .offset(y: -dayframeExpandedMetadataLift)
        }
      } compactLeading: {
        DayframeLiveBlockMarker(state: context.state, colors: colors, size: 14)
      } compactTrailing: {
        DayframeElapsedTimerText(state: context.state, size: .compact, runningColor: DayframeLiveTokens.accentDark)
          .frame(minWidth: 34, idealWidth: 42, maxWidth: 52, alignment: .trailing)
      } minimal: {
        DayframeLiveBlockMarker(state: context.state, colors: colors, size: 12)
      }
      .keylineTint(colors.hasActivity ? colors.fill : DayframeLiveTokens.accentDark)
    }
  }
}

/// The small rounded square that marks an activity everywhere in Blocks (never a dot).
private struct DayframeLiveBlockMarker: View {
  let state: DayframeTimerAttributes.ContentState
  let colors: DayframeLiveBlockColors
  let size: CGFloat

  var body: some View {
    RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
      .fill(state.isRunning ? (colors.hasActivity ? colors.fill : DayframeLiveTokens.accentDark) : DayframeLiveTokens.textMutedDark)
      .frame(width: size, height: size)
      .accessibilityHidden(true)
  }
}

/// The Lock Screen Live Activity is the live block itself: the activity's fill with on-block text,
/// the activity name, the description when there is one, Bricolage digits and Today's Stop.
private struct DayframeLockScreenTimerView: View {
  let activityId: String
  let entryId: String?
  let apiBase: String?
  let stopControlId: String
  let state: DayframeTimerAttributes.ContentState
  @Environment(\.colorScheme) private var colorScheme
  @ScaledMetric(relativeTo: .subheadline) private var activitySize: CGFloat = 15
  @ScaledMetric(relativeTo: .headline) private var descriptionSize: CGFloat = 17

  var body: some View {
    let colors = DayframeLiveBlockColors(state: state, colorScheme: colorScheme)
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 2) {
        // Full on-block colour: measured contrast holds only for opaque text (hierarchy comes from
        // size and weight).
        Text(dayframeActivityName(state))
          .font(.system(size: activitySize, weight: .medium))
          .foregroundStyle(colors.text)
          .lineLimit(1)
          .minimumScaleFactor(0.75)
          .fixedSize(horizontal: false, vertical: true)
        if let description = dayframeDistinctDescription(state) {
          Text(description)
            .font(.system(size: descriptionSize, weight: .semibold))
            .foregroundStyle(colors.text)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .fixedSize(horizontal: false, vertical: true)
        }
        DayframeElapsedTimerText(state: state, size: .lockScreen, runningColor: colors.text)
          .padding(.top, 2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if state.isRunning, state.canStop == true, let entryId, let apiBase {
        DayframeLiveActivityStopButton(
          activityId: activityId,
          entryId: entryId,
          apiBase: apiBase,
          stopControlId: stopControlId,
          circle: colors.text,
          square: colors.fill,
          size: 54,
          iconSize: 20
        )
      }
    }
    .padding(.vertical, 14)
    .padding(.horizontal, 18)
    .activityBackgroundTint(colors.fill)
    .activitySystemActionForegroundColor(colors.text)
  }
}

/// The expanded Dynamic Island's lower row: the activity as a block chip, then the description.
private struct DayframeIslandLabel: View {
  let state: DayframeTimerAttributes.ContentState
  let colors: DayframeLiveBlockColors
  @ScaledMetric(relativeTo: .subheadline) private var chipSize: CGFloat = 14
  @ScaledMetric(relativeTo: .headline) private var descriptionSize: CGFloat = 16

  var body: some View {
    HStack(spacing: 8) {
      // The chip truncates within the region (long names, large text) and is kept ahead of the
      // description, which gives way first.
      Text(dayframeActivityName(state))
        .font(.system(size: chipSize, weight: .semibold))
        .foregroundStyle(colors.text)
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
          RoundedRectangle(cornerRadius: DayframeLiveTokens.chipRadius, style: .continuous)
            .fill(colors.fill)
        )
        .fixedSize(horizontal: false, vertical: true)
        .layoutPriority(1)
      if let description = dayframeDistinctDescription(state) {
        Text(description)
          .font(.system(size: descriptionSize, weight: .semibold))
          .foregroundStyle(DayframeLiveTokens.textPrimaryDark)
          .lineLimit(1)
          .truncationMode(.tail)
          .minimumScaleFactor(0.72)
          .fixedSize(horizontal: false, vertical: true)
          // Keeps a readable start of the description beside a long activity name.
          .frame(minWidth: 80, alignment: .leading)
      }
    }
  }
}

private struct DayframeElapsedTimerText: View {
  let state: DayframeTimerAttributes.ContentState
  let size: DayframeTimerTextSize
  let runningColor: Color

  var body: some View {
    if state.isRunning, let startedAt = state.startedAt {
      Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
        .monospacedDigit()
        .font(font)
        .foregroundStyle(runningColor)
        .lineLimit(1)
        .minimumScaleFactor(0.62)
    } else {
      Text(formatElapsedSeconds(state.elapsedSeconds))
        .monospacedDigit()
        .font(font)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.62)
    }
  }

  private var font: Font {
    switch size {
    case .compact:
      return .custom(DayframeLiveTokens.displayFont, size: 14, relativeTo: .caption)
    case .expanded:
      return .custom(DayframeLiveTokens.displayFont, size: 36, relativeTo: .largeTitle)
    case .lockScreen:
      return .custom(DayframeLiveTokens.displayFont, size: 36, relativeTo: .largeTitle)
    }
  }
}

private enum DayframeTimerTextSize {
  case compact
  case expanded
  case lockScreen
}

/// Today's Stop: a filled circle with the stop square.
private struct DayframeLiveActivityStopButton: View {
  let activityId: String
  let entryId: String
  let apiBase: String
  let stopControlId: String
  let circle: Color
  let square: Color
  let size: CGFloat
  let iconSize: CGFloat

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: DayframeLiveActivityStopIntent(
        activityId: activityId,
        entryId: entryId,
        apiBase: apiBase,
        clientEventId: "ios-live-activity-stop-\(stopControlId)"
      )) {
        stopButtonContent
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Stop running block")
    } else {
      stopButtonContent
        .accessibilityLabel("Stop running block")
    }
  }

  private var stopButtonContent: some View {
    ZStack {
      Circle()
        .fill(circle)
      RoundedRectangle(cornerRadius: max(3, iconSize * 0.22), style: .continuous)
        .fill(square)
        .frame(width: iconSize, height: iconSize)
    }
    .frame(width: size, height: size)
    .contentShape(Circle())
  }
}

/// "No activity" when the block has none, as everywhere else in Dayframe.
private func dayframeActivityName(_ state: DayframeTimerAttributes.ContentState) -> String {
  state.categoryName ?? "No activity"
}

/// The description, only when it says something the activity name does not: the title falls back
/// to the activity name (or "No activity") when a block has no description, and is not shown twice.
private func dayframeDistinctDescription(_ state: DayframeTimerAttributes.ContentState) -> String? {
  let title = state.title.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !title.isEmpty, title != dayframeActivityName(state) else { return nil }
  return title
}

/// On-block text: white or deep ink, whichever contrasts more with the fill (blocks.ts onBlockTextColor).
private func dayframeOnBlockText(fillHex: String) -> String {
  let fill = dayframeRelativeLuminance(fillHex)
  let white = dayframeRelativeLuminance(DayframeLiveTokens.onBlockWhite)
  let ink = dayframeRelativeLuminance(DayframeLiveTokens.onBlockInk)
  func contrast(_ a: Double, _ b: Double) -> Double { (max(a, b) + 0.05) / (min(a, b) + 0.05) }
  return contrast(fill, white) >= contrast(fill, ink) ? DayframeLiveTokens.onBlockWhite : DayframeLiveTokens.onBlockInk
}

private func dayframeRelativeLuminance(_ hex: String) -> Double {
  let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
  guard cleaned.count == 6, let rgb = UInt64(cleaned, radix: 16) else { return 0 }
  func channel(_ value: UInt64) -> Double {
    let c = Double(value) / 255
    return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel((rgb >> 16) & 0xFF) + 0.7152 * channel((rgb >> 8) & 0xFF) + 0.0722 * channel(rgb & 0xFF)
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

private extension Color {
  init?(dayframeHex value: String?) {
    guard let value else { return nil }
    let cleaned = value.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    guard cleaned.count == 6, let rgb = UInt64(cleaned, radix: 16) else { return nil }
    self.init(
      red: Double((rgb >> 16) & 0xFF) / 255,
      green: Double((rgb >> 8) & 0xFF) / 255,
      blue: Double(rgb & 0xFF) / 255
    )
  }
}
