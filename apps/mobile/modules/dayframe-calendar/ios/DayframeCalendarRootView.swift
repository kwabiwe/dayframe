import SwiftUI
import UIKit

struct DayframeCalendarRootView: View {
  @ObservedObject var model: DayframeCalendarViewModel
  let actions: DayframeCalendarActions

  var body: some View {
    let presentation = model.presentation
    let theme = presentation.theme

    VStack(spacing: 12) {
      weekStrip(presentation: presentation, theme: theme)
      calendarPanel(presentation: presentation, theme: theme)
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
    .padding(.bottom, 10)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(dayframeCSS: theme.background).ignoresSafeArea())
    .preferredColorScheme(theme.mode == "light" ? .light : .dark)
  }

  @ViewBuilder
  private func weekStrip(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    HStack(spacing: 6) {
      ForEach(presentation.weekDays) { day in
        Button {
          actions.selectDay(day.dayKey)
        } label: {
          VStack(spacing: 4) {
            Text(day.weekdayLabel)
              .font(.caption2.weight(.semibold))
              .foregroundStyle(Color(dayframeCSS: day.isSelected || day.isToday ? theme.accentText : theme.textSecondary))
              .lineLimit(1)
            Text(day.dayNumber)
              .font(.body.weight(.semibold))
              .monospacedDigit()
              .foregroundStyle(Color(dayframeCSS: day.isSelected ? theme.accentText : theme.textPrimary))
              .lineLimit(1)
            Circle()
              .fill(Color(dayframeCSS: theme.accent))
              .frame(width: 4, height: 4)
              .opacity(day.isToday && !day.isSelected ? 1 : 0)
          }
          .frame(maxWidth: .infinity, minHeight: 56)
          .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .fill(Color(dayframeCSS: day.isSelected ? theme.accentSoft : theme.surfaceMuted))
          )
          .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.accessibilityLabel)
        .accessibilityAddTraits(day.isSelected ? .isSelected : [])
      }
    }
    .dynamicTypeSize(.xSmall ... .large)
    .padding(8)
    .background(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .fill(Color(dayframeCSS: theme.surfaceRaised))
        .shadow(
          color: presentation.reduceTransparency ? .clear : Color(dayframeCSS: theme.shadow),
          radius: 10,
          y: 3
        )
    )
    .contentShape(Rectangle())
    .simultaneousGesture(
      DragGesture(minimumDistance: 18, coordinateSpace: .local)
        .onEnded { value in
          let horizontal = value.translation.width
          let vertical = value.translation.height
          guard abs(horizontal) >= 28, abs(horizontal) > abs(vertical) * 0.72 else { return }
          actions.changeWeek(horizontal < 0 ? 1 : -1)
        }
    )
  }

  @ViewBuilder
  private func calendarPanel(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    VStack(spacing: 12) {
      calendarHeader(presentation: presentation, theme: theme)

      ScrollView(.vertical) {
        DayframeCalendarTimelineCanvas(model: model, actions: actions)
          .frame(height: 24 * model.hourHeight)
          .background(
            DayframeCalendarScrollResolver(model: model, actions: actions)
              .frame(width: 1, height: 1)
          )
      }
      .dynamicTypeSize(.xSmall ... .large)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(dayframeCSS: theme.surfaceMuted))
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
      .accessibilityLabel("24-hour Calendar timeline")
      .accessibilityHint("Scroll vertically. Use two fingers to change time density.")
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .fill(Color(dayframeCSS: theme.surfaceRaised))
        .shadow(
          color: presentation.reduceTransparency ? .clear : Color(dayframeCSS: theme.shadow),
          radius: 12,
          y: 4
        )
    )
  }

  @ViewBuilder
  private func calendarHeader(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .center, spacing: 12) {
        calendarTitle(presentation: presentation, theme: theme)
          .fixedSize(horizontal: true, vertical: false)
        Spacer(minLength: 8)
        calendarTotal(presentation: presentation, theme: theme)
          .fixedSize(horizontal: true, vertical: false)
      }

      VStack(alignment: .leading, spacing: 8) {
        calendarTitle(presentation: presentation, theme: theme)
        calendarTotal(presentation: presentation, theme: theme)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  @ViewBuilder
  private func calendarTitle(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text("Calendar")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
        .textCase(.uppercase)
        .lineLimit(1)
      Text(presentation.selectedDayTitle)
        .font(.headline.weight(.semibold))
        .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
        .lineLimit(2)
    }
  }

  @ViewBuilder
  private func calendarTotal(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    Text(presentation.totalLabel)
      .font(.title3.weight(.semibold))
      .monospacedDigit()
      .foregroundStyle(Color(dayframeCSS: theme.accentText))
      .lineLimit(1)
      .minimumScaleFactor(0.75)
      .accessibilityLabel("Selected day total, \(presentation.totalLabel)")
  }
}

private struct DayframeCalendarTimelineCanvas: View {
  @ObservedObject var model: DayframeCalendarViewModel
  let actions: DayframeCalendarActions
  @ScaledMetric(relativeTo: .caption) private var scaledHourLabelWidth: CGFloat = 68

  var body: some View {
    let presentation = model.presentation
    let theme = presentation.theme
    let hourHeight = model.hourHeight
    let timelineHeight: CGFloat = 24 * hourHeight
    let hourLabelWidth: CGFloat = min(94, max(68, scaledHourLabelWidth))

    GeometryReader { geometry in
      ZStack(alignment: .topLeading) {
        DayframeCalendarHourGrid(
          hourHeight: hourHeight,
          hourLabelWidth: hourLabelWidth,
          theme: theme,
          timelineHeight: timelineHeight
        )

        DayframeCalendarEntriesLayer(
          actions: actions,
          availableWidth: geometry.size.width,
          hourHeight: hourHeight,
          hourLabelWidth: hourLabelWidth,
          presentation: presentation
        )
        .id(presentation.selectedDayKey)
        .transition(
          .asymmetric(
            insertion: .move(edge: presentation.transitionDirection > 0 ? .trailing : .leading).combined(with: .opacity),
            removal: .opacity
          )
        )

        if presentation.selectedDayKey == presentation.todayKey {
          let currentMinute = CGFloat(minuteOfDay(milliseconds: presentation.nowMs))
          let lineTop = min(timelineHeight, max(0, currentMinute / 60 * hourHeight))
          Rectangle()
            .fill(Color(dayframeCSS: theme.accent))
            .frame(width: max(0, geometry.size.width - hourLabelWidth - 8), height: 2)
            .position(
              x: hourLabelWidth + max(0, geometry.size.width - hourLabelWidth - 8) / 2,
              y: lineTop
            )
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }

        if presentation.entries.isEmpty {
          Text(presentation.emptyState)
            .font(.footnote)
            .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
            .multilineTextAlignment(.center)
            .frame(width: max(0, geometry.size.width - hourLabelWidth - 24))
            .position(
              x: hourLabelWidth + max(0, geometry.size.width - hourLabelWidth) / 2,
              y: min(160, timelineHeight / 2)
            )
            .allowsHitTesting(false)
        }
      }
      .frame(width: geometry.size.width, height: timelineHeight)
      .clipped()
      .animation(
        presentation.reduceMotion ? nil : .easeOut(duration: 0.21),
        value: presentation.selectedDayKey
      )
    }
  }

  private func minuteOfDay(milliseconds: Double) -> Double {
    let date = Date(timeIntervalSince1970: milliseconds / 1000)
    let components = Calendar.current.dateComponents([.hour, .minute, .second], from: date)
    return Double(components.hour ?? 0) * 60
      + Double(components.minute ?? 0)
      + Double(components.second ?? 0) / 60
  }
}

private struct DayframeCalendarHourGrid: View {
  let hourHeight: CGFloat
  let hourLabelWidth: CGFloat
  let theme: DayframeCalendarTheme
  let timelineHeight: CGFloat
  @Environment(\.displayScale) private var displayScale

  var body: some View {
    ForEach(0...24, id: \.self) { hour in
      let lineTop = CGFloat(hour) * hourHeight
      let labelTop = min(timelineHeight - 11, max(11, lineTop))

      Text(String(format: "%02d:00", hour % 24))
        .font(.caption2.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
        .frame(width: hourLabelWidth - 8, alignment: .trailing)
        .position(x: (hourLabelWidth - 8) / 2, y: labelTop)
        .accessibilityHidden(true)

      Rectangle()
        .fill(Color(dayframeCSS: theme.border))
        .frame(height: max(1 / displayScale, 0.5))
        .padding(.leading, hourLabelWidth)
        .offset(y: lineTop)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }
}

private struct DayframeCalendarEntriesLayer: View {
  let actions: DayframeCalendarActions
  let availableWidth: CGFloat
  let hourHeight: CGFloat
  let hourLabelWidth: CGFloat
  let presentation: DayframeCalendarPresentation

  var body: some View {
    ZStack(alignment: .topLeading) {
      ForEach(presentation.entries) { entry in
        if let metrics = DayframeCalendarBlockMath.metrics(
          startedAtMs: entry.startedAtMs,
          stoppedAtMs: entry.stoppedAtMs,
          nowMs: presentation.nowMs,
          dayStartMs: presentation.dayStartMs,
          dayEndMs: presentation.dayEndMs,
          hourHeight: Double(hourHeight)
        ) {
          let blockWidth = max(0, availableWidth - hourLabelWidth - 18)
          let visualHeight = CGFloat(metrics.height)
          let hitHeight = max(44, visualHeight)

          Button {
            actions.open(entry.actionTarget)
          } label: {
            DayframeCalendarBlockView(
              entry: entry,
              metrics: metrics,
              reduceTransparency: presentation.reduceTransparency,
              theme: presentation.theme
            )
            .frame(width: blockWidth, height: visualHeight)
          }
          .buttonStyle(.plain)
          .frame(width: blockWidth, height: hitHeight)
          .contentShape(Rectangle())
          .position(
            x: hourLabelWidth + 8 + blockWidth / 2,
            y: CGFloat(metrics.top + metrics.height / 2)
          )
          .accessibilityLabel(entry.accessibilityLabel)
          .accessibilityHint(entry.isReview ? "Opens Review" : entry.isActive ? "Opens Edit Timer" : "Opens entry editor")
          .accessibilityAddTraits(entry.isActive ? .isSelected : [])
        }
      }
    }
    .frame(width: availableWidth, height: 24 * hourHeight, alignment: .topLeading)
  }
}

private struct DayframeCalendarBlockView: View {
  let entry: DayframeCalendarEntry
  let metrics: DayframeCalendarBlockMetrics
  let reduceTransparency: Bool
  let theme: DayframeCalendarTheme

  var body: some View {
    let shape = DayframeCalendarBlockShape(
      continuesIntoNextDay: metrics.continuesIntoNextDay,
      startsBeforeDay: metrics.startsBeforeDay
    )
    let cueColor = UIColor(dayframeCSS: entry.color)
    let backgroundColor = UIColor(dayframeCSS: theme.surfaceMuted)
    let fillAlpha: CGFloat = entry.isReview ? 0.16 : entry.isActive ? 0.22 : 0.30
    let resolvedAlpha = reduceTransparency ? min(0.48, fillAlpha + 0.10) : fillAlpha
    let fill = cueColor.dayframeBlended(over: backgroundColor, alpha: resolvedAlpha)

    ZStack(alignment: .leading) {
      shape.fill(Color(uiColor: fill))

      if entry.isUncategorized {
        DayframeCalendarHatch(color: Color(dayframeCSS: theme.textSecondary))
          .clipShape(shape)
          .opacity(reduceTransparency ? 0.34 : 0.22)
      }

      shape.stroke(
        Color(dayframeCSS: entry.isReview ? theme.borderStrong : entry.color),
        style: StrokeStyle(
          lineWidth: 1,
          lineCap: .round,
          dash: entry.isReview || entry.isActive ? [4, 3] : []
        )
      )

      if metrics.showTitle {
        VStack(alignment: .leading, spacing: metrics.compact ? 1 : 4) {
          HStack(spacing: 7) {
            Circle()
              .fill(Color(dayframeCSS: entry.color))
              .frame(width: 7, height: 7)
              .accessibilityHidden(true)
            Text(entry.title)
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
              .lineLimit(1)
          }

          if metrics.showMeta {
            Text(entry.meta)
              .font(.caption2.weight(.semibold))
              .monospacedDigit()
              .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
              .lineLimit(metrics.height < DayframeCalendarConstants.metaMinimumHeight + 16 ? 1 : 2)
          }

          if metrics.showMeta, let tagText = entry.tagText, !tagText.isEmpty {
            HStack(spacing: 4) {
              Image(systemName: "tag")
                .font(.caption2)
                .accessibilityHidden(true)
              Text(tagText)
                .font(.caption2)
                .lineLimit(1)
            }
            .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
          }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, metrics.compact ? 4 : 7)
      }
    }
  }
}

private struct DayframeCalendarBlockShape: Shape {
  let continuesIntoNextDay: Bool
  let startsBeforeDay: Bool

  func path(in rect: CGRect) -> Path {
    var corners: UIRectCorner = []
    if !startsBeforeDay {
      corners.formUnion([.topLeft, .topRight])
    }
    if !continuesIntoNextDay {
      corners.formUnion([.bottomLeft, .bottomRight])
    }
    let path = UIBezierPath(
      roundedRect: rect,
      byRoundingCorners: corners,
      cornerRadii: CGSize(width: min(13, rect.height / 2), height: min(13, rect.height / 2))
    )
    return Path(path.cgPath)
  }
}

private struct DayframeCalendarHatch: View {
  let color: Color

  var body: some View {
    GeometryReader { geometry in
      Path { path in
        let diagonal = geometry.size.height
        var x = -diagonal
        while x < geometry.size.width + diagonal {
          path.move(to: CGPoint(x: x, y: geometry.size.height))
          path.addLine(to: CGPoint(x: x + diagonal, y: 0))
          x += 8
        }
      }
      .stroke(color, lineWidth: 1)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
