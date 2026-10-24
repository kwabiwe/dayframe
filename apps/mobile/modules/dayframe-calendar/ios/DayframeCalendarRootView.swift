import SwiftUI
import UIKit

struct DayframeCalendarRootView: View {
  @ObservedObject var model: DayframeCalendarViewModel
  let actions: DayframeCalendarActions
  @Namespace private var weekStripSelection
  @Namespace private var layoutSelection
  @State private var selectionHaptic = UISelectionFeedbackGenerator()

  var body: some View {
    let presentation = model.presentation
    let theme = presentation.theme

    VStack(spacing: 10) {
      VStack(spacing: 10) {
        calendarHeader(presentation: presentation, theme: theme)
          .padding(.horizontal, 18)
        weekStrip(presentation: presentation, theme: theme)
          .padding(.horizontal, 12)
      }
      .padding(.top, 4)
      // In List the app sizes this view to its header and week strip, and draws the List under it.
      .background(GeometryReader { geometry in
        Color.clear
          .onAppear { actions.reportHeaderHeight(Double(geometry.size.height)) }
          .onChange(of: geometry.size.height) { height in actions.reportHeaderHeight(Double(height)) }
      })
      // The app owns the Grid ↔ List handoff (its List fades over this view), so the timeline switches at once.
      if !presentation.isList {
        timeline(presentation: presentation, theme: theme)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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

      layoutPill(presentation: presentation, theme: theme)
      if !presentation.isList {
        zoomPill(theme: theme)
      }
    }
    .dynamicTypeSize(.xSmall ... .xxxLarge)
  }

  /// Grid · List (location v4 step 9, mock-up #ios-list): the selection slides between the two.
  @ViewBuilder
  private func layoutPill(presentation: DayframeCalendarPresentation, theme: DayframeCalendarTheme) -> some View {
    HStack(spacing: 2) {
      layoutButton(title: "Grid", layout: "grid", selected: !presentation.isList, presentation: presentation, theme: theme)
      layoutButton(title: "List", layout: "list", selected: presentation.isList, presentation: presentation, theme: theme)
    }
    .padding(3)
    .background(Capsule(style: .continuous).fill(Color(dayframeCSS: theme.surface)))
    // Only the pill's selection animates (it slides); the app owns the List's own fade (Codex r2 on #570).
    .animation(presentation.reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.82), value: presentation.isList)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Calendar view")
  }

  @ViewBuilder
  private func layoutButton(
    title: String, layout: String, selected: Bool, presentation: DayframeCalendarPresentation, theme: DayframeCalendarTheme
  ) -> some View {
    Button {
      guard !selected else { return }
      playSelectionHaptic()
      actions.changeLayout(layout)
    } label: {
      Text(title)
        .font(.subheadline.weight(.bold))
        .foregroundStyle(Color(dayframeCSS: selected ? theme.textPrimary : theme.textSecondary))
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background {
          if selected {
            Capsule(style: .continuous)
              .fill(Color(dayframeCSS: theme.surfaceRaised))
              .matchedGeometryEffect(id: "selected-layout", in: layoutSelection)
          }
        }
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
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
      DayframeCalendarGlyph(name: direction > 0 ? "zoom-in" : "zoom-out", size: 18)
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
                // X3: a block marker (30% of the 4 pt side, activityMarkerRadius), not a capsule.
                RoundedRectangle(cornerRadius: 1.2, style: .continuous)
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
          clockFormat: presentation.clockFormat,
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
          labelTextScale: model.labelTextScale,
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
            clockFormat: presentation.clockFormat,
            hourHeight: hourHeight,
            hourLabelWidth: hourLabelWidth,
            leadingInset: CGFloat(presentation.entryLeadingInset),
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
    return DayframeClockText.time(
      hour: components.hour ?? 0,
      minute: components.minute ?? 0,
      clockFormat: model.presentation.clockFormat
    )
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
  let clockFormat: String
  let hourHeight: CGFloat
  let hourLabelWidth: CGFloat
  let leadingInset: CGFloat
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
      let width = max(0, availableWidth - hourLabelWidth - 18 - leadingInset)
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
        x: hourLabelWidth + 8 + leadingInset + width / 2,
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
    return DayframeClockText.time(hour: normalized / 60, minute: normalized % 60, clockFormat: clockFormat)
  }
}

private struct DayframeCalendarHourGrid: View {
  let clockFormat: String
  let hourHeight: CGFloat
  let hourLabelWidth: CGFloat
  let theme: DayframeCalendarTheme
  let timelineHeight: CGFloat
  @Environment(\.displayScale) private var displayScale

  var body: some View {
    ForEach(0...24, id: \.self) { hour in
      let lineTop = CGFloat(hour) * hourHeight
      let labelTop = min(timelineHeight - 11, max(11, lineTop))

      Text(DayframeClockText.hour(hour % 24, clockFormat: clockFormat))
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
  let labelTextScale: Double
  let presentation: DayframeCalendarPresentation

  var body: some View {
    // One layout per zoom step and text size (location v4 C6): every block at least one label line
    // tall, colliding drawn blocks side by side. The scroll coordinator hit-tests the same layout.
    let dayLayout = DayframeCalendarDayLayout.layout(
      entries: presentation.entries.map(\.layoutInput),
      nowMs: presentation.nowMs,
      dayStartMs: presentation.dayStartMs,
      dayEndMs: presentation.dayEndMs,
      hourHeight: Double(hourHeight),
      textScale: labelTextScale
    )
    ZStack(alignment: .topLeading) {
      // Named patterns (location v3 PR 14b; dense-day rules): each bracket's rail at the hour gutter's
      // edge and its name level in the gutter, spanning its parts as they are drawn (the blocks' own
      // maths, part by part), so zoom, scroll and a day change carry it with them. It comes and goes
      // like a block (the same fade, none under Reduce Motion) and never takes a touch.
      ForEach(presentation.brackets) { bracket in
        if let metrics = DayframeCalendarBracketMath.span(
          parts: presentation.entries
            .filter { bracket.memberIds.contains($0.entryId) }
            .map { (startedAtMs: $0.startedAtMs, stoppedAtMs: $0.stoppedAtMs) },
          nowMs: presentation.nowMs,
          dayStartMs: presentation.dayStartMs,
          dayEndMs: presentation.dayEndMs,
          hourHeight: Double(hourHeight),
          minimumHeight: DayframeCalendarDayLayout.labelMinimumHeight(textScale: labelTextScale)
        ) {
          let height = CGFloat(metrics.height)
          DayframeCalendarBracketView(height: height, name: bracket.name, nameWidth: max(0, hourLabelWidth - 6), theme: presentation.theme)
            .frame(width: hourLabelWidth + 4, height: height)
            .position(
              x: (hourLabelWidth + 4) / 2,
              y: CGFloat(metrics.top) + height / 2
            )
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .transition(
              presentation.reduceMotion
                ? .identity
                : .opacity.animation(.easeOut(duration: 0.21))
            )
        }
      }

      ForEach(presentation.entries) { entry in
        if let laidOut = dayLayout[entry.entryId], let entryGeometry = DayframeCalendarEntryGeometryMath.metrics(
          availableWidth: Double(availableWidth),
          hourLabelWidth: Double(hourLabelWidth),
          semanticTop: laidOut.block.top,
          semanticHeight: laidOut.block.height,
          offsetFraction: laidOut.offsetFraction,
          widthFraction: laidOut.widthFraction,
          overlapCount: entry.overlapCount + (laidOut.sharesTarget ? 1 : 0),
          textDensity: entry.textDensity,
          timelineHeight: 24 * Double(hourHeight),
          leadingInset: presentation.entryLeadingInset
        ) {
          let metrics = laidOut.block
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
              labelTextScale: labelTextScale,
              metrics: metrics,
              visualHeight: visualHeight,
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
          // Lane reflow: only the horizontal modifier eases (iOS 17 scoped animation), so the block's
          // heights, hit height, zoom geometry and the running ring's own breathing are untouched.
          .modifier(DayframeCalendarLaneGeometry(
            animation: presentation.reduceMotion ? nil : .easeOut(duration: 0.21),
            width: resolvedWidth,
            x: CGFloat((entryGeometry.hitFrame.minX + entryGeometry.hitFrame.maxX) / 2),
            y: CGFloat(vertical.hitCenterY)
          ))
          // A block that arrives or leaves within the day (a new suggestion, a crowd of Review
          // suggestions forming or splitting) fades. The animation belongs to this transition only,
          // so blocks that stay keep their own geometry rules (model updates arrive unanimated) and
          // nothing else in the timeline eases. Reduce Motion: it simply appears or goes.
          .transition(
            presentation.reduceMotion
              ? .identity
              : .opacity.animation(.easeOut(duration: 0.21))
          )
          .zIndex(Double(laidOut.zIndex))
          .accessibilityLabel(entry.accessibilityLabel)
          .accessibilityHint(entry.isReview ? "Opens Review" : entry.isActive ? "Opens Edit Timer" : "Opens entry editor")
          .accessibilityAddTraits(entry.isActive ? .isSelected : [])
        }
      }

      // Moments (dense-day rules): a finished block of a minute or less is a tick at the gutter's edge
      // with a 44-point target over the hour labels' edge (DayframeCalendarMomentMath), never a block.
      ForEach(presentation.entries.filter(\.isMoment)) { entry in
        if let stoppedAtMs = entry.stoppedAtMs, let top = DayframeCalendarMomentMath.top(
          startedAtMs: entry.startedAtMs,
          stoppedAtMs: stoppedAtMs,
          dayStartMs: presentation.dayStartMs,
          dayEndMs: presentation.dayEndMs,
          hourHeight: Double(hourHeight)
        ) {
          let frame = DayframeCalendarMomentMath.hitFrame(
            top: top,
            hourLabelWidth: Double(hourLabelWidth),
            timelineHeight: 24 * Double(hourHeight)
          )
          Button {
            actions.open(entry.actionTarget)
          } label: {
            DayframeCalendarMomentTick(color: Color(dayframeCSS: entry.color))
              .offset(x: CGFloat(frame.maxX - frame.minX) - 7, y: CGFloat(top - frame.minY) - 3)
              .frame(width: CGFloat(frame.maxX - frame.minX), height: CGFloat(frame.maxY - frame.minY), alignment: .topLeading)
          }
          .buttonStyle(.plain)
          .contentShape(Rectangle())
          .position(x: CGFloat(frame.minX + frame.maxX) / 2, y: CGFloat(frame.minY + frame.maxY) / 2)
          .transition(presentation.reduceMotion ? .identity : .opacity.animation(.easeOut(duration: 0.21)))
          .zIndex(Double(DayframeCalendarDayLayout.reviewZIndexBase * 2))
          .accessibilityLabel(entry.accessibilityLabel)
          .accessibilityHint("Opens entry editor")
        }
      }
    }
    .frame(width: availableWidth, height: 24 * hourHeight, alignment: .topLeading)
  }
}

// Blocks under the dense-day rules (owner, 24 Oct 2026; calendar-dense-mockup v2): a tinted fill with
// a 3-point colour bar and no outline, primary text; the running block adds a breathing ring. A Review
// suggestion is hatched with a dashed bar and a "?". The title always wins; see DayframeCalendarDenseLabelMath.
private struct DayframeCalendarBlockView: View {
  let cornerRadius: CGFloat
  let entry: DayframeCalendarEntry
  let horizontal: DayframeCalendarHorizontalMetrics
  let labelTextScale: Double
  let metrics: DayframeCalendarBlockMetrics
  let visualHeight: CGFloat
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
    let dark = theme.mode == "dark"
    // 20 % light / 30 % dark for blocks, 12 % / 16 % for suggestions (more under Reduce Transparency).
    let tint: CGFloat = entry.isReview
      ? (dark ? 0.16 : 0.12) + (reduceTransparency ? 0.1 : 0)
      : (dark ? 0.30 : 0.20) + (reduceTransparency ? 0.1 : 0)
    let fill = blockColor.dayframeBlended(over: UIColor(dayframeCSS: theme.surface), alpha: tint)
    let label = DayframeCalendarDenseLabelMath.label(
      height: Double(visualHeight),
      width: horizontal.width,
      textScale: labelTextScale
    )
    // The overlap dot keeps its own corner: titles fit beside it, never under it.
    let showsWarning = entry.warningOverlapCount > 0 && horizontal.width >= 22
    let warningRoom = showsWarning ? 12.0 : 0

    ZStack(alignment: .topLeading) {
      shape.fill(Color(uiColor: fill))
      if entry.isReview {
        DayframeCalendarHatch(color: Color(dayframeCSS: theme.textPrimary))
          .opacity(reduceTransparency ? 0.22 : 0.16)
          .clipShape(shape)
      }
      DayframeCalendarColourBar(color: Color(uiColor: blockColor), dashed: entry.isReview)
        .clipShape(shape)
      if entry.isActive {
        DayframeCalendarLiveRing(color: Color(uiColor: blockColor), reduceMotion: reduceMotion, shape: shape)
      }

      if !label.sliver {
        DayframeCalendarDenseText(
          detail: label.detail ? entry.meta : nil,
          isReview: entry.isReview,
          label: label,
          theme: theme,
          title: entry.title,
          titleWidth: max(0, horizontal.width - label.leadingPadding - label.trailingPadding - warningRoom),
          width: max(0, horizontal.width - label.leadingPadding - label.trailingPadding)
        )
        .padding(.leading, CGFloat(label.leadingPadding))
        .padding(.trailing, CGFloat(label.trailingPadding))
        .padding(.top, CGFloat(label.verticalPadding))
      }
    }
    .overlay(alignment: .topTrailing) {
      if showsWarning {
        Circle()
          .fill(Color(dayframeCSS: theme.warning))
          .overlay(Circle().strokeBorder(Color(dayframeCSS: theme.surface), lineWidth: 1))
          .frame(width: 8, height: 8)
          .padding(5)
          .accessibilityHidden(true)
      }
    }
  }
}

/// The 3-point colour bar down a block's leading edge: solid for a block, dashed for a suggestion.
private struct DayframeCalendarColourBar: View {
  let color: Color
  let dashed: Bool

  var body: some View {
    GeometryReader { geometry in
      if dashed {
        Path { path in
          path.move(to: CGPoint(x: 1.5, y: 0))
          path.addLine(to: CGPoint(x: 1.5, y: geometry.size.height))
        }
        .stroke(color, style: StrokeStyle(lineWidth: 3, dash: [4, 3]))
      } else {
        Rectangle().fill(color).frame(width: 3)
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// The title as whole words (DayframeCalendarTitleFit) in the lines the block holds, then the times and
/// length where there is room. Measured with the same fonts it is drawn in, so no word is ever cut.
private struct DayframeCalendarDenseText: View {
  let detail: String?
  let isReview: Bool
  let label: DayframeCalendarDenseLabel
  let theme: DayframeCalendarTheme
  let title: String
  /// The title's lines leave the overlap dot its corner; the time line below has the full width.
  let titleWidth: Double
  let width: Double

  var body: some View {
    let font = UIFont.systemFont(ofSize: CGFloat(label.titleFontSize), weight: .semibold)
    let mark = isReview ? "? " : ""
    let lines = DayframeCalendarTitleFit.lines(
      words: (mark + title).split(whereSeparator: \.isWhitespace).map(String.init),
      maxLines: label.titleLines,
      width: titleWidth,
      measure: { text in Double((text as NSString).size(withAttributes: [.font: font]).width) }
    )
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
        titleLine(index == 0 && isReview ? String(line.dropFirst(mark.count)) : line, mark: index == 0 && isReview && line.hasPrefix("?"))
          .font(.system(size: CGFloat(label.titleFontSize), weight: .semibold))
          .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
          .lineLimit(1)
          .fixedSize(horizontal: true, vertical: false)
          .frame(height: CGFloat(label.titleLineHeight), alignment: .leading)
      }
      // Colour only when no whole word fits: the time line goes too.
      if let detail, !detail.isEmpty, !lines.isEmpty {
        Text(detail)
          .font(.system(size: CGFloat(label.detailFontSize), weight: .medium))
          .monospacedDigit()
          .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(height: CGFloat(label.detailLineHeight), alignment: .leading)
      }
    }
    .frame(width: CGFloat(max(0, width)), alignment: .leading)
    .clipped()
  }

  private func titleLine(_ text: String, mark: Bool) -> Text {
    guard mark else { return Text(text) }
    return Text("? ").foregroundColor(Color(dayframeCSS: theme.warningText)).fontWeight(.bold) + Text(text)
  }
}

/// A named pattern's bracket under the dense-day rules: a thin rail at the hour gutter's edge, from its
/// first part's top to its last part's bottom, with the name written level in the gutter beside it in
/// whole words (an ellipsis only after a whole word). Decorative only: each part's own VoiceOver label
/// says which trip it is part of.
private struct DayframeCalendarBracketView: View {
  let height: CGFloat
  let name: String
  let nameWidth: CGFloat
  let theme: DayframeCalendarTheme

  var body: some View {
    let font = UIFont.systemFont(ofSize: 10, weight: .bold)
    let lines = DayframeCalendarTitleFit.lines(
      words: name.split(whereSeparator: \.isWhitespace).map(String.init),
      maxLines: max(1, Int(floor(Double(max(12, height - 4)) / 12))),
      width: Double(nameWidth),
      measure: { text in Double((text as NSString).size(withAttributes: [.font: font]).width) }
    )
    HStack(alignment: .top, spacing: 0) {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
          Text(line)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(Color(dayframeCSS: theme.textSecondary))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .frame(height: 12, alignment: .leading)
        }
      }
      .padding(.top, 2)
      .frame(width: nameWidth, alignment: .topLeading)
      // Over the hour labels it passes, like the mock-up's gutter label.
      .background(Color(dayframeCSS: theme.background).opacity(lines.isEmpty ? 0 : 1))
      Spacer(minLength: 0)
      RoundedRectangle(cornerRadius: 1)
        .fill(Color(dayframeCSS: theme.textMuted).opacity(0.55))
        .frame(width: 2, height: height)
    }
    .frame(height: height, alignment: .top)
  }
}

/// A moment's tick: a 6-point line with a dot at the gutter's edge, in its activity colour.
private struct DayframeCalendarMomentTick: View {
  let color: Color

  var body: some View {
    ZStack(alignment: .leading) {
      Rectangle().fill(color).frame(width: 6, height: 2)
      Circle().fill(color).frame(width: 6, height: 6).offset(x: -3)
    }
    .frame(width: 6, height: 6, alignment: .leading)
    .accessibilityHidden(true)
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

/**
 * Applies a block's lane width and position. On iOS 17 and later the lane animation is scoped to
 * this modifier alone (`animation(_:body:)`), never the block's content; on iOS 16 lane changes
 * settle at once rather than letting the animation reach vertical geometry.
 */
private struct DayframeCalendarLaneGeometry: ViewModifier {
  let animation: Animation?
  let width: CGFloat
  let x: CGFloat
  let y: CGFloat

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content.animation(animation) { view in
        view.modifier(DayframeCalendarHorizontalGeometry(width: width, x: x, y: y))
      }
    } else {
      content.modifier(DayframeCalendarHorizontalGeometry(width: width, x: x, y: y))
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
