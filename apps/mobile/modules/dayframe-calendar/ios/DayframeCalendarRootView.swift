import SwiftUI
import UIKit

struct DayframeCalendarRootView: View {
  @ObservedObject var model: DayframeCalendarViewModel
  let actions: DayframeCalendarActions
  @Namespace private var weekStripSelection
  @State private var selectionHaptic = UISelectionFeedbackGenerator()

  var body: some View {
    let presentation = model.presentation
    let theme = presentation.theme

    VStack(spacing: 10) {
      calendarHeader(presentation: presentation, theme: theme)
        .padding(.horizontal, 18)
      weekStrip(presentation: presentation, theme: theme)
        .padding(.horizontal, 12)
      timeline(presentation: presentation, theme: theme)
    }
    .padding(.top, 4)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(dayframeCSS: theme.background).ignoresSafeArea())
    .preferredColorScheme(theme.mode == "light" ? .light : .dark)
  }

  private func playSelectionHaptic() {
    guard model.presentation.hapticsEnabled else { return }
    selectionHaptic.selectionChanged()
    selectionHaptic.prepare()
  }

  // Blocks header: the month as the screen title, the selected day's framed time, zoom − / +.
  @ViewBuilder
  private func calendarHeader(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(presentation.monthTitle)
          .font(.custom("BricolageGrotesque-Bold", size: 30, relativeTo: .largeTitle))
          .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
          .accessibilityAddTraits(.isHeader)
        Text(presentation.framedLabel)
          .font(.subheadline.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)

      zoomPill(theme: theme)
    }
    .dynamicTypeSize(.xSmall ... .xxxLarge)
  }

  @ViewBuilder
  private func zoomPill(theme: DayframeCalendarTheme) -> some View {
    HStack(spacing: 2) {
      zoomButton(direction: -1, enabled: model.canZoomOut, theme: theme)
      zoomButton(direction: 1, enabled: model.canZoomIn, theme: theme)
    }
    .padding(3)
    .background(Capsule(style: .continuous).fill(Color(dayframeCSS: theme.surface)))
  }

  @ViewBuilder
  private func zoomButton(direction: Int, enabled: Bool, theme: DayframeCalendarTheme) -> some View {
    Button {
      playSelectionHaptic()
      model.requestZoom(direction: direction)
    } label: {
      Image(systemName: direction > 0 ? "plus" : "minus")
        .font(.system(size: 17, weight: .semibold))
        .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
        .frame(width: 44, height: 44)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.35)
    .accessibilityLabel(direction > 0 ? "Zoom in" : "Zoom out")
    .accessibilityHint("Changes how many hours fit on screen")
  }

  // Week strip: weekday initial, the date in a 32-point circle (selected filled, today coral) and up
  // to three bars for the day's biggest activities. Swipe sideways to change week.
  @ViewBuilder
  private func weekStrip(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    HStack(spacing: 4) {
      ForEach(presentation.weekDays) { day in
        Button {
          if !day.isSelected { playSelectionHaptic() }
          actions.selectDay(day.dayKey)
        } label: {
          VStack(spacing: 3) {
            Text(day.weekdayLabel)
              .font(.caption2.weight(.bold))
              .textCase(.uppercase)
              .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
              .lineLimit(1)
            ZStack {
              if day.isSelected {
                Circle()
                  .fill(Color(dayframeCSS: theme.textPrimary))
                  .matchedGeometryEffect(id: "selected-day", in: weekStripSelection)
              }
              Text(day.dayNumber)
                .font(.system(size: 15, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color(dayframeCSS: dayNumberColor(day, theme: theme)))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            .frame(width: 32, height: 32)
            HStack(spacing: 2) {
              ForEach(Array(day.bars.enumerated()), id: \.offset) { _, color in
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                  .fill(Color(dayframeCSS: color))
                  .frame(width: 5, height: 4)
              }
            }
            .frame(height: 4)
            .accessibilityHidden(true)
          }
          .padding(.vertical, 5)
          .frame(maxWidth: .infinity, minHeight: 44)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.accessibilityLabel)
        .accessibilityAddTraits(day.isSelected ? .isSelected : [])
      }
    }
    .dynamicTypeSize(.xSmall ... .large)
    .animation(
      presentation.reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.82),
      value: presentation.selectedDayKey
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

  private func dayNumberColor(_ day: DayframeCalendarWeekDay, theme: DayframeCalendarTheme) -> String {
    if day.isSelected { return theme.background }
    return day.isToday ? theme.accent : theme.textPrimary
  }

  @ViewBuilder
  private func timeline(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    ScrollView(.vertical, showsIndicators: false) {
      DayframeCalendarTimelineCanvas(model: model, actions: actions)
        .frame(height: 24 * model.hourHeight)
        .padding(.trailing, 12)
    }
    .dynamicTypeSize(.xSmall ... .large)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityLabel("24-hour Calendar timeline")
    .accessibilityHint("Scroll vertically. Use two fingers or the zoom buttons to change time density. Touch and hold empty time, drag to adjust, then release to add an entry.")
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
          DayframeCalendarNowMarker(
            hourLabelWidth: hourLabelWidth,
            label: clockLabel(milliseconds: presentation.nowMs),
            theme: theme,
            width: geometry.size.width
          )
          .position(x: geometry.size.width / 2, y: lineTop)
          .zIndex(9_000)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
        }

        if
          let preview = model.creationPreview,
          preview.dayKey == presentation.selectedDayKey
        {
          DayframeCalendarCreationPreviewLayer(
            availableWidth: geometry.size.width,
            hourHeight: hourHeight,
            hourLabelWidth: hourLabelWidth,
            preview: preview,
            reduceTransparency: presentation.reduceTransparency,
            theme: theme
          )
          .zIndex(10_000)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
        }

        if
          presentation.entries.isEmpty,
          let emptyState = DayframeCalendarEmptyStateMath.metrics(
            availableWidth: Double(geometry.size.width),
            hourLabelWidth: Double(hourLabelWidth),
            hourHeight: Double(hourHeight)
          )
        {
          Text(presentation.emptyState)
            .font(.footnote)
            .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
            .multilineTextAlignment(.center)
            .frame(width: CGFloat(emptyState.textWidth))
            .position(
              x: CGFloat(emptyState.center.x),
              y: CGFloat(emptyState.center.y)
            )
            .allowsHitTesting(false)
        }
      }
      .frame(width: geometry.size.width, height: timelineHeight)
      .clipped()
      .background(alignment: .topLeading) {
        DayframeCalendarScrollResolver(
          model: model,
          actions: actions,
          layout: DayframeCalendarTimelineLayout(
            availableWidth: Double(geometry.size.width),
            hourLabelWidth: Double(hourLabelWidth)
          )
        )
        .frame(width: 1, height: 1)
        .accessibilityHidden(true)
      }
      .animation(
        presentation.reduceMotion ? nil : .easeOut(duration: 0.21),
        value: presentation.selectedDayKey
      )
    }
  }

  private func clockLabel(milliseconds: Double) -> String {
    let date = Date(timeIntervalSince1970: milliseconds / 1000)
    let components = Calendar.current.dateComponents([.hour, .minute], from: date)
    return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
  }

  private func minuteOfDay(milliseconds: Double) -> Double {
    let date = Date(timeIntervalSince1970: milliseconds / 1000)
    let components = Calendar.current.dateComponents([.hour, .minute, .second], from: date)
    return Double(components.hour ?? 0) * 60
      + Double(components.minute ?? 0)
      + Double(components.second ?? 0) / 60
  }
}

/// Coral now line across the day column with a dot at its start and the time in a pill over the
/// hour labels (Blocks prototype).
private struct DayframeCalendarNowMarker: View {
  let hourLabelWidth: CGFloat
  let label: String
  let theme: DayframeCalendarTheme
  let width: CGFloat

  var body: some View {
    let accent = Color(dayframeCSS: theme.accent)
    ZStack(alignment: .leading) {
      Rectangle()
        .fill(accent)
        .frame(width: max(0, width - hourLabelWidth + 4), height: 2)
        .offset(x: hourLabelWidth - 4)
      Circle()
        .fill(accent)
        .frame(width: 10, height: 10)
        .offset(x: hourLabelWidth - 9)
      Text(label)
        .font(.caption2.weight(.heavy))
        .monospacedDigit()
        .foregroundStyle(Color(dayframeCSS: theme.onAccent))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(width: max(0, hourLabelWidth - 16), height: 18)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(accent))
        .offset(x: 4)
    }
    .frame(width: width, height: 18, alignment: .leading)
  }
}

private struct DayframeCalendarCreationPreviewLayer: View {
  let availableWidth: CGFloat
  let hourHeight: CGFloat
  let hourLabelWidth: CGFloat
  let preview: DayframeCalendarCreationPreview
  let reduceTransparency: Bool
  let theme: DayframeCalendarTheme

  var body: some View {
    if let geometry = DayframeCalendarCreationPreviewMath.geometry(
      startMinute: preview.startMinute,
      durationMinutes: preview.durationMinutes,
      hourHeight: Double(hourHeight)
    ) {
      let visual = DayframeCalendarBlockVisualMath.metrics(
        semanticHeight: geometry.semanticHeight,
        continuesIntoNextDay: geometry.continuesIntoNextDay
      )
      let width = max(0, availableWidth - hourLabelWidth - 18)
      let semanticHeight = CGFloat(visual.semanticHeight)
      let visualHeight = CGFloat(visual.visualHeight)
      let visibleHeight = CGFloat(geometry.visibleHeight)
      let shape = DayframeCalendarBlockShape(
        cornerRadius: CGFloat(visual.cornerRadius),
        continuesIntoNextDay: geometry.continuesIntoNextDay,
        startsBeforeDay: false
      )
      let accentColor = UIColor(dayframeCSS: theme.accent)
      let fill = accentColor.dayframeBlended(
        over: UIColor(dayframeCSS: theme.surface),
        alpha: reduceTransparency ? 0.34 : 0.22
      )

      ZStack(alignment: .leading) {
        shape.fill(Color(uiColor: fill))
        shape.strokeBorder(Color(uiColor: accentColor), lineWidth: 2)

        if visibleHeight >= 18 {
          VStack(alignment: .leading, spacing: 1) {
            if visibleHeight >= 50 {
              Text("New block")
                .font(.footnote.weight(.bold))
                .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
                .lineLimit(1)
            }
            Text(timeRange)
              .font(.caption2.weight(.semibold))
              .monospacedDigit()
              .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
              .lineLimit(1)
              .minimumScaleFactor(0.72)
          }
          .padding(.horizontal, 8)
          .padding(.vertical, visibleHeight >= 50 ? 6 : 3)
        }
      }
      .frame(width: width, height: visualHeight)
      .frame(height: semanticHeight, alignment: .top)
      .position(
        x: hourLabelWidth + 8 + width / 2,
        y: CGFloat(geometry.top) + semanticHeight / 2
      )
    }
  }

  private var timeRange: String {
    let finishMinute = preview.startMinute + preview.durationMinutes
    return "\(clock(preview.startMinute))–\(clock(finishMinute))"
  }

  private func clock(_ minute: Int) -> String {
    let normalized = ((minute % 1_440) + 1_440) % 1_440
    return String(format: "%02d:%02d", normalized / 60, normalized % 60)
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
        .foregroundStyle(Color(dayframeCSS: theme.textMuted))
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
        ), let entryGeometry = DayframeCalendarEntryGeometryMath.metrics(
          availableWidth: Double(availableWidth),
          hourLabelWidth: Double(hourLabelWidth),
          semanticTop: metrics.top,
          semanticHeight: metrics.height,
          offsetFraction: entry.offsetFraction,
          widthFraction: entry.widthFraction,
          overlapCount: entry.overlapCount,
          textDensity: entry.textDensity
        ) {
          let visualMetrics = DayframeCalendarBlockVisualMath.metrics(
            semanticHeight: metrics.height,
            continuesIntoNextDay: metrics.continuesIntoNextDay
          )
          let semanticHeight = CGFloat(visualMetrics.semanticHeight)
          let visualHeight = CGFloat(visualMetrics.visualHeight)
          let horizontal = entryGeometry.horizontal
          let vertical = entryGeometry.vertical
          let resolvedWidth = CGFloat(horizontal.width)
          let hitHeight = CGFloat(vertical.hitHeight)

          Button {
            actions.open(entry.actionTarget)
          } label: {
            DayframeCalendarBlockView(
              cornerRadius: CGFloat(visualMetrics.cornerRadius),
              entry: entry,
              horizontal: horizontal,
              metrics: metrics,
              reduceMotion: presentation.reduceMotion,
              reduceTransparency: presentation.reduceTransparency,
              theme: presentation.theme
            )
            .frame(maxWidth: .infinity)
            .frame(height: visualHeight)
            .frame(height: semanticHeight, alignment: .top)
            .offset(y: CGFloat(vertical.visualOffsetWithinHitTarget))
            .frame(height: hitHeight, alignment: .top)
          }
          .buttonStyle(.plain)
          .contentShape(Rectangle())
          .modifier(DayframeCalendarHorizontalGeometry(
            width: resolvedWidth,
            x: CGFloat((entryGeometry.hitFrame.minX + entryGeometry.hitFrame.maxX) / 2),
            y: CGFloat(vertical.hitCenterY)
          ))
          .animation(
            presentation.reduceMotion ? nil : .easeOut(duration: 0.21),
            value: "\(entry.offsetFraction):\(entry.widthFraction)"
          )
          .zIndex(Double(entry.zIndex))
          .accessibilityLabel(entry.accessibilityLabel)
          .accessibilityHint(entry.isReview ? "Opens Review" : entry.isActive ? "Opens Edit Timer" : "Opens entry editor")
          .accessibilityAddTraits(entry.isActive ? .isSelected : [])
        }
      }
    }
    .frame(width: availableWidth, height: 24 * hourHeight, alignment: .topLeading)
  }
}

// Blocks: a logged block is a solid activity fill with measured on-block text; the running block
// adds a breathing inner ring; a Review suggestion is hatched in its suggested colour with theme text.
private struct DayframeCalendarBlockView: View {
  let cornerRadius: CGFloat
  let entry: DayframeCalendarEntry
  let horizontal: DayframeCalendarHorizontalMetrics
  let metrics: DayframeCalendarBlockMetrics
  let reduceMotion: Bool
  let reduceTransparency: Bool
  let theme: DayframeCalendarTheme

  var body: some View {
    let shape = DayframeCalendarBlockShape(
      cornerRadius: cornerRadius,
      continuesIntoNextDay: metrics.continuesIntoNextDay,
      startsBeforeDay: metrics.startsBeforeDay
    )
    let blockColor = UIColor(dayframeCSS: entry.color)
    let textColor = Color(dayframeCSS: entry.textColor)

    ZStack(alignment: .topLeading) {
      if entry.isReview {
        let base = blockColor.dayframeBlended(
          over: UIColor(dayframeCSS: theme.surface),
          alpha: reduceTransparency ? 0.28 : 0.16
        )
        shape.fill(Color(uiColor: base))
        DayframeCalendarHatch(color: Color(uiColor: blockColor))
          .opacity(reduceTransparency ? 0.55 : 0.4)
          .clipShape(shape)
        shape.strokeBorder(Color(uiColor: blockColor).opacity(0.7), lineWidth: 1.5)
      } else {
        shape.fill(Color(uiColor: blockColor))
        if entry.isActive {
          DayframeCalendarLiveRing(color: textColor, reduceMotion: reduceMotion, shape: shape)
        }
      }

      if metrics.showTitle && horizontal.showTitle {
        VStack(alignment: .leading, spacing: 1) {
          Text(entry.isReview ? "\(entry.title) · review" : entry.title)
            .font(.footnote.weight(.bold))
            .foregroundStyle(textColor)
            .lineLimit(1)

          if metrics.showMeta && horizontal.showMeta {
            Text(entry.meta)
              .font(.caption2.weight(.semibold))
              .monospacedDigit()
              .foregroundStyle(textColor)
              .lineLimit(metrics.height < DayframeCalendarConstants.metaMinimumHeight + 16 ? 1 : 2)
          }

          if metrics.showMeta, horizontal.showMeta, let placeText = entry.placeText, !placeText.isEmpty {
            HStack(spacing: 4) {
              Image(systemName: "mappin.and.ellipse")
                .font(.caption2)
                .accessibilityHidden(true)
              Text(placeText)
                .font(.caption2)
                .lineLimit(1)
            }
            .foregroundStyle(textColor)
          }

          if metrics.showMeta, horizontal.showMeta, let tagText = entry.tagText, !tagText.isEmpty {
            HStack(spacing: 4) {
              Image(systemName: "tag.fill")
                .font(.caption2)
                .accessibilityHidden(true)
              Text(tagText)
                .font(.caption2)
                .lineLimit(1)
            }
            .foregroundStyle(textColor)
          }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, metrics.compact ? 3 : 6)
      }
    }
    .shadow(
      color: entry.isReview && !reduceTransparency ? Color(dayframeCSS: theme.shadow) : .clear,
      radius: 6,
      y: 2
    )
    .overlay(alignment: .topTrailing) {
      if entry.warningOverlapCount > 0 && horizontal.width >= 22 {
        Circle()
          .fill(Color(dayframeCSS: theme.warning))
          .overlay(Circle().strokeBorder(textColor.opacity(0.6), lineWidth: 1))
          .frame(width: 8, height: 8)
          .padding(5)
          .accessibilityHidden(true)
      }
    }
  }
}

/// The running block's inner ring: on-block text colour at 40%, breathing 0.35 ↔ 1 over 2.4 s.
/// Reduce Motion holds it still at 0.6.
private struct DayframeCalendarLiveRing: View {
  let color: Color
  let reduceMotion: Bool
  let shape: DayframeCalendarBlockShape
  @State private var bright = false

  var body: some View {
    shape
      .strokeBorder(color.opacity(0.4), lineWidth: 2)
      .opacity(reduceMotion ? 0.6 : bright ? 1 : 0.35)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
      .task(id: reduceMotion) { startBreathing() }
  }

  private func startBreathing() {
    guard !reduceMotion else {
      bright = false
      return
    }
    bright = false
    withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
      bright = true
    }
  }
}

private struct DayframeCalendarHorizontalGeometry: AnimatableModifier {
  var width: CGFloat
  var x: CGFloat
  let y: CGFloat

  var animatableData: AnimatablePair<CGFloat, CGFloat> {
    get { AnimatablePair(width, x) }
    set {
      width = newValue.first
      x = newValue.second
    }
  }

  func body(content: Content) -> some View {
    content
      .frame(width: width)
      .position(x: x, y: y)
  }
}

private struct DayframeCalendarBlockShape: InsettableShape {
  let cornerRadius: CGFloat
  let continuesIntoNextDay: Bool
  let startsBeforeDay: Bool
  var insetAmount: CGFloat = 0

  func inset(by amount: CGFloat) -> DayframeCalendarBlockShape {
    var copy = self
    copy.insetAmount += amount
    return copy
  }

  func path(in rect: CGRect) -> Path {
    var corners: UIRectCorner = []
    if !startsBeforeDay {
      corners.formUnion([.topLeft, .topRight])
    }
    if !continuesIntoNextDay {
      corners.formUnion([.bottomLeft, .bottomRight])
    }
    let insetRect = rect.insetBy(dx: insetAmount, dy: insetAmount)
    let effectiveRadius = max(
      0,
      min(cornerRadius - insetAmount, insetRect.width / 2, insetRect.height / 2)
    )
    let path = UIBezierPath(
      roundedRect: insetRect,
      byRoundingCorners: corners,
      cornerRadii: CGSize(
        width: effectiveRadius,
        height: effectiveRadius
      )
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
          x += 12
        }
      }
      .stroke(color, lineWidth: 4)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
