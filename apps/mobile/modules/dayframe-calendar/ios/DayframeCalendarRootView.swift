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

    VStack(spacing: 0) {
      VStack(spacing: 10) {
        calendarHeader(presentation: presentation, theme: theme)
          .padding(.horizontal, 18)
        weekStrip(presentation: presentation, theme: theme)
          .padding(.horizontal, 12)
      }
      .padding(.top, 4)
      .padding(.bottom, 4)
      // In List the app sizes this view to its header and week strip, and draws the List under it.
      .background(GeometryReader { geometry in
        Color.clear
          .onAppear { actions.reportHeaderHeight(Double(geometry.size.height)) }
          .onChange(of: geometry.size.height) { height in actions.reportHeaderHeight(Double(height)) }
      })
      // The app owns the Day ↔ List handoff (its List fades over this view), so the timeline switches at once.
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

  // Calendar v3 header (owner, 24 Oct 2026): the month as the screen title and one round view button.
  // Zoom is pinch only (VoiceOver: the timeline's adjustable action), so there is no − / +.
  @ViewBuilder
  private func calendarHeader(
    presentation: DayframeCalendarPresentation,
    theme: DayframeCalendarTheme
  ) -> some View {
    HStack(alignment: .center, spacing: 12) {
      Text(presentation.monthTitle)
        .font(.custom("BricolageGrotesque-Bold", size: 30, relativeTo: .largeTitle))
        .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
      viewMenu(presentation: presentation, theme: theme)
    }
    .dynamicTypeSize(.xSmall ... .xxxLarge)
  }

  /// One round button (Calendar v3; owner item J, 28 Oct 2026): one tap switches between Day and List, and
  /// its icon is always the view it goes to.
  @ViewBuilder
  private func viewMenu(presentation: DayframeCalendarPresentation, theme: DayframeCalendarTheme) -> some View {
    Button {
      playSelectionHaptic()
      actions.changeLayout(presentation.isList ? "grid" : "list")
    } label: {
      DayframeCalendarGlyph(name: presentation.isList ? "view-day" : "view-list", size: 20, followsTextSize: false)
        .foregroundStyle(Color(dayframeCSS: theme.textPrimary))
        .frame(width: 44, height: 44)
        .background(Circle().fill(Color(dayframeCSS: theme.surface)))
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(presentation.isList ? "Show as day" : "Show as list")
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
    .accessibilityHint("Scroll vertically. Pinch, or swipe up or down with one finger, to change how many hours fit on screen. Touch and hold empty time, drag to adjust, then release to add an entry.")
    // No − / + (Calendar v3): VoiceOver zooms with the adjustable action, as the buttons did.
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: model.requestZoom(direction: 1)
      case .decrement: model.requestZoom(direction: -1)
      @unknown default: break
      }
    }
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
          // Calendar v3: the time pill takes the place of the hour label it would cover.
          nowY: presentation.selectedDayKey == presentation.todayKey
            ? min(timelineHeight, max(0, CGFloat(minuteOfDay(milliseconds: presentation.nowMs)) / 60 * hourHeight))
            : nil,
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
          // Centred on the minute, so the line sits exactly where the hour lines would at that time.
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

/// Calendar v3 (owner, 24 Oct 2026; Apple): a red line from the hour lines' start across the day column,
/// centred on the current minute, and the time in a red pill in the hour gutter, where the hour label it
/// covers is hidden. Red is the theme's danger colour, with text that meets AA on it.
private struct DayframeCalendarNowMarker: View {
  let hourLabelWidth: CGFloat
  let label: String
  let theme: DayframeCalendarTheme
  let width: CGFloat

  var body: some View {
    let light = theme.mode == "light"
    // Light: the deeper danger text red under white; dark: the bright danger red under the canvas colour.
    let red = Color(dayframeCSS: light ? theme.dangerText : theme.danger)
    let ink = Color(dayframeCSS: light ? "#FFFFFF" : theme.background)
    ZStack(alignment: .leading) {
      Rectangle()
        .fill(red)
        .frame(width: max(0, width - hourLabelWidth), height: 2)
        .offset(x: hourLabelWidth)
      Text(label)
        .font(.system(size: 11, weight: .bold))
        .monospacedDigit()
        .foregroundStyle(ink)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .padding(.horizontal, 6)
        .frame(height: CGFloat(DayframeCalendarNowPillMath.pillHeight))
        .background(Capsule(style: .continuous).fill(red))
        .frame(width: max(0, hourLabelWidth - 6), alignment: .trailing)
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
  /// Today's now line: an hour label the time pill covers is hidden under it (#255: only then).
  let nowY: CGFloat?
  let theme: DayframeCalendarTheme
  let timelineHeight: CGFloat
  @Environment(\.displayScale) private var displayScale
  /// The hour labels' digit height (caption2 cap height), following Dynamic Type.
  @ScaledMetric(relativeTo: .caption2) private var labelGlyphHeight: CGFloat = 8

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
        // Compared where the label is drawn (clamped inside the day at 00:00 and 24:00), not its line.
        .opacity(nowY.map {
          DayframeCalendarNowPillMath.coversHourLabel(nowY: Double($0), labelCenterY: Double(labelTop), labelGlyphHeight: Double(labelGlyphHeight))
        } == true ? 0 : 1)
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
      textScale: labelTextScale,
      laneWidth: DayframeCalendarEntryGeometryMath.laneWidth(
        availableWidth: Double(availableWidth),
        hourLabelWidth: Double(hourLabelWidth),
        leadingInset: presentation.entryLeadingInset
      )
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

      // Step 17: the Places lane left of the blocks (entryLeadingInset makes room): each
      // place and trip at its time, quiet; one that asks something is hatched with the amber dot and opens its
      // question in the List; any other opens the List on this day. Same fade as a block; none with Reduce Motion.
      ForEach(presentation.placesLane, id: \.id) { item in
        if let span = DayframeCalendarBracketMath.span(
          parts: [(startedAtMs: item.startedAtMs, stoppedAtMs: Optional(item.stoppedAtMs))],
          nowMs: presentation.nowMs,
          dayStartMs: presentation.dayStartMs,
          dayEndMs: presentation.dayEndMs,
          hourHeight: Double(hourHeight),
          minimumHeight: 4
        ) {
          let height = CGFloat(span.height)
          let laneWidth = CGFloat(DayframeCalendarPlacesLane.width) - 6
          Button {
            // Every lane item opens its own sheet (owner item A): React finds it by its "?" or by the item itself.
            actions.open(DayframeCalendarActionTarget(id: item.checkId ?? "lane:\(item.id)", kind: .review))
          } label: {
            DayframeCalendarLaneItemView(item: item, height: height, width: laneWidth, theme: presentation.theme)
          }
          .buttonStyle(.plain)
          .frame(width: laneWidth, height: max(height, 1))
          .contentShape(Rectangle())
          .position(x: hourLabelWidth + 8 + laneWidth / 2, y: CGFloat(span.top) + height / 2)
          .transition(presentation.reduceMotion ? .identity : .opacity.animation(.easeOut(duration: 0.21)))
          .accessibilityLabel(item.accessibilityLabel)
          .accessibilityHint(item.kind == "trip" ? "Opens the trip" : "Opens the place")
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
              nested: laidOut.nested,
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
      let moments = DayframeCalendarMomentLayout.layout(presentation: presentation, hourHeight: Double(hourHeight), hourLabelWidth: Double(hourLabelWidth))
      ForEach(moments, id: \.entry.entryId) { moment in
        let frame = moment.frame
        Button {
          actions.open(moment.entry.actionTarget)
        } label: {
          DayframeCalendarMomentTick(color: Color(dayframeCSS: moment.entry.color))
            .offset(x: CGFloat(frame.maxX - frame.minX) - 7, y: CGFloat(moment.top - frame.minY) - 3)
            .frame(width: CGFloat(frame.maxX - frame.minX), height: CGFloat(frame.maxY - frame.minY), alignment: .topLeading)
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .position(x: CGFloat(frame.minX + frame.maxX) / 2, y: CGFloat(frame.minY + frame.maxY) / 2)
        .transition(presentation.reduceMotion ? .identity : .opacity.animation(.easeOut(duration: 0.21)))
        .zIndex(Double(DayframeCalendarDayLayout.momentZIndex))
        .accessibilityLabel(moment.entry.accessibilityLabel)
        .accessibilityHint("Opens entry editor")
      }
    }
    .frame(width: availableWidth, height: 24 * hourHeight, alignment: .topLeading)
  }
}

// Blocks under Calendar v3 (owner, 24 Oct 2026; calendar-v3-mockup): a translucent tint of the activity
// colour, so hour lines and any block underneath show through, with a solid 3-point colour bar, 5-point
// corners and text in a darker shade of the same hue (lighter in dark mode). The running block adds a
// breathing ring. A Review suggestion is hatched with a dashed bar and a "?". The title always wins;
// see DayframeCalendarDenseLabel.
private struct DayframeCalendarBlockView: View {
  let cornerRadius: CGFloat
  let entry: DayframeCalendarEntry
  let horizontal: DayframeCalendarHorizontalMetrics
  let labelTextScale: Double
  let metrics: DayframeCalendarBlockMetrics
  let nested: Bool
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
    // The mock-up's tint: 18 % light / 28 % dark for blocks; a suggestion is a light fill, 5 % / 8 % (owner
    // item K, 28 Oct 2026). Under Reduce Transparency it is opaque (blended over the surface) and a little stronger.
    let tint: CGFloat = entry.isReview ? (dark ? 0.08 : 0.05) : (dark ? 0.28 : 0.18)
    let fill: Color = reduceTransparency
      ? Color(uiColor: blockColor.dayframeBlended(over: UIColor(dayframeCSS: theme.surface), alpha: tint + 0.1))
      : Color(uiColor: blockColor).opacity(Double(tint))
    // A darker shade of the hue in light mode, a lighter one in dark mode, measured by React to meet AA on
    // every tint (calendarBlockInk); an older bundle's model falls back to the mock-up's own shade.
    let ink = entry.isReview
      ? Color(dayframeCSS: theme.textPrimary)
      : entry.ink.map { Color(dayframeCSS: $0) }
        ?? Color(uiColor: blockColor.dayframeBlended(over: dark ? .white : .black, alpha: dark ? 0.62 : 0.52))
    let label = DayframeCalendarDenseLabelMath.label(
      height: Double(visualHeight),
      width: horizontal.width,
      textScale: labelTextScale
    )
    // Step 16: the leg strip takes the text's first 18 points.
    let showsLegs = !entry.legs.isEmpty && visualHeight >= 44
    let legInset: Double = showsLegs ? 18 : 0
    // Calendar v3: overlapping blocks are drawn side by side or nested, as in Apple Calendar, so no
    // overlap dot; VoiceOver still says "Overlaps N other entries".

    ZStack(alignment: .topLeading) {
      // A nested block lays a canvas wash under its tint: the block underneath still shows through, but
      // never takes the text below AA (calendarBlockInk measures against these bases).
      if nested && !reduceTransparency {
        shape.fill(Color(dayframeCSS: theme.background).opacity(DayframeCalendarConstants.nestedCanvasWash))
      }
      shape.fill(fill)
      // Owner item K: a suggestion's dashed amber edge (no hatching), with the amber dot below.
      if entry.isReview {
        shape.stroke(Color(dayframeCSS: theme.warning).opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
      }
      DayframeCalendarColourBar(color: Color(uiColor: blockColor), dashed: entry.isReview)
        .clipShape(shape)
      // Step 16: a trip block from 44 points tall shows its legs down its leading edge.
      if showsLegs {
        DayframeCalendarLegStrip(entry: entry, height: visualHeight, ink: ink, theme: theme)
          .padding(.leading, 5)
      }
      if entry.isActive {
        DayframeCalendarLiveRing(color: Color(uiColor: blockColor), reduceMotion: reduceMotion, shape: shape)
      }

      if !label.sliver {
        DayframeCalendarDenseText(
          details: entry.isReview ? [] : entry.detailLines,
          ink: ink,
          label: label,
          labelTextScale: labelTextScale,
          title: entry.title,
          titleWidth: max(0, horizontal.width - label.leadingPadding - legInset - label.trailingPadding),
          width: max(0, horizontal.width - label.leadingPadding - legInset - label.trailingPadding)
        )
        .padding(.leading, CGFloat(label.leadingPadding + legInset))
        .padding(.trailing, CGFloat(label.trailingPadding))
        .padding(.top, CGFloat(label.verticalPadding))
      }
    }
    .overlay(alignment: .topTrailing) {
      if entry.isReview {
        Circle().fill(Color(dayframeCSS: theme.warning)).frame(width: 9, height: 9)
          .overlay(Circle().stroke(Color(dayframeCSS: theme.surface), lineWidth: 2))
          .padding(4)
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

/// The title as whole words (DayframeCalendarTitleFit) in the lines the block holds, in bold, then the
/// icon lines (place or trip or Apple Health, tags, times) while they fit. Measured with the same fonts
/// it is drawn in, so no word is ever cut except a first word too wide for any line (Calendar v3).
private struct DayframeCalendarDenseText: View {
  let details: [DayframeCalendarDetailLineRecord]
  let ink: Color
  let label: DayframeCalendarDenseLabel
  let labelTextScale: Double
  let title: String
  let titleWidth: Double
  let width: Double

  var body: some View {
    let font = UIFont.systemFont(ofSize: CGFloat(label.titleFontSize), weight: .bold)
    let wanted = details.filter { !$0.text.isEmpty }
    let titleLines = label.titleLines(detailCount: wanted.count)
    let lines = DayframeCalendarTitleFit.lines(
      words: title.split(whereSeparator: \.isWhitespace).map(String.init),
      maxLines: titleLines,
      width: titleWidth,
      cutFirstWord: true,
      measure: { text in Double((text as NSString).size(withAttributes: [.font: font]).width) }
    )
    // Measured as drawn: the icon lines use monospaced digits (Codex r7 on #580).
    let detailFont = UIFont.monospacedDigitSystemFont(ofSize: CGFloat(label.detailFontSize), weight: .medium)
    let iconSize = CGFloat(11 * DayframeCalendarDayLayout.clampedTextScale(labelTextScale))
    // Colour only when nothing of the title fits: the icon lines go too. Each line wraps to the whole
    // lines left under the title (calendar-v3-mockup), cut after a whole word.
    let shown: [(glyph: String, lines: [String])] = {
      guard !lines.isEmpty else { return [] }
      var left = label.detailLines(titleLines: lines.count, detailCount: Int.max)
      var out: [(glyph: String, lines: [String])] = []
      for detail in wanted where left > 0 {
        let wrapped = DayframeCalendarTitleFit.lines(
          words: detail.text.split(whereSeparator: \.isWhitespace).map(String.init),
          maxLines: left,
          width: width - Double(iconSize) - 4,
          measure: { text in Double((text as NSString).size(withAttributes: [.font: detailFont]).width) }
        )
        guard !wrapped.isEmpty else { break }
        out.append((detail.glyph, wrapped))
        left -= wrapped.count
      }
      return out
    }()
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
        Text(line)
          .font(.system(size: CGFloat(label.titleFontSize), weight: .bold))
          .foregroundStyle(ink)
          .lineLimit(1)
          .fixedSize(horizontal: true, vertical: false)
          .frame(height: CGFloat(label.titleLineHeight), alignment: .leading)
      }
      ForEach(Array(shown.enumerated()), id: \.offset) { _, detail in
        HStack(alignment: .top, spacing: 4) {
          DayframeCalendarGlyph(name: detailGlyph(detail.glyph), size: iconSize, followsTextSize: false)
            .frame(height: CGFloat(label.detailLineHeight))
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(detail.lines.enumerated()), id: \.offset) { _, line in
              Text(line)
                .font(.system(size: CGFloat(label.detailFontSize), weight: .medium))
                .monospacedDigit()
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .frame(height: CGFloat(label.detailLineHeight), alignment: .leading)
            }
          }
        }
        .foregroundStyle(ink)
      }
    }
    .frame(width: CGFloat(max(0, width)), alignment: .leading)
    .clipped()
  }

  private func detailGlyph(_ glyph: String) -> String {
    switch glyph {
    case "place": return "place"
    case "trip", "health", "tag": return glyph
    default: return "time"
    }
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


/// Steps 16–17: the Places lane's width, and its items.
enum DayframeCalendarPlacesLane {
  static let width: Double = 52
}

/// One place or trip in the Places lane: a quiet tinted bar (a trip a thin one), hatched with the amber dot
/// when it asks something.
private struct DayframeCalendarLaneItemView: View {
  let item: DayframeCalendarLaneItemRecord
  let height: CGFloat
  let width: CGFloat
  let theme: DayframeCalendarTheme

  var body: some View {
    let asking = item.checkId != nil
    let barWidth = item.kind == "trip" ? (asking ? 14 : 6) : width
    let shape = RoundedRectangle(cornerRadius: min(5, barWidth / 2), style: .continuous)
    ZStack(alignment: .top) {
      shape.fill(asking ? Color(dayframeCSS: theme.warning).opacity(0.16) : Color(dayframeCSS: theme.textSecondary).opacity(item.kind == "trip" ? 0.34 : 0.14))
      if asking {
        // Owner item K: the same amber dot as the List, on a light fill with a dashed edge (no hatching).
        shape.stroke(Color(dayframeCSS: theme.warning).opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
      }
      if item.kind == "place" && height >= 20 {
        DayframeCalendarGlyph(name: item.glyph, size: 13, followsTextSize: false)
          .foregroundStyle(asking ? Color(dayframeCSS: theme.warningText) : Color(dayframeCSS: theme.textSecondary))
          .padding(.top, 4)
      }
    }
    .frame(width: barWidth, height: max(height, 3))
    .overlay(alignment: .topTrailing) {
      if asking {
        Circle().fill(Color(dayframeCSS: theme.warning)).frame(width: 9, height: 9)
          .overlay(Circle().stroke(Color(dayframeCSS: theme.surface), lineWidth: 2))
          .offset(x: 3, y: -3)
      }
    }
    .frame(width: width, height: max(height, 3))
    .accessibilityHidden(true)
  }
}

/// A trip block's legs (step 16): one segment per leg in proportion to its time, its glyph where it has room,
/// an Unsure leg hatched in amber.
private struct DayframeCalendarLegStrip: View {
  let entry: DayframeCalendarEntry
  let height: CGFloat
  let ink: Color
  let theme: DayframeCalendarTheme

  var body: some View {
    let fromMs = entry.startedAtMs
    let toMs = entry.stoppedAtMs ?? entry.legs.map(\.stoppedAtMs).max() ?? fromMs + 1
    let span = max(1, toMs - fromMs)
    let usable = max(0, height - 4)
    ZStack(alignment: .topLeading) {
      ForEach(Array(entry.legs.enumerated()), id: \.offset) { _, leg in
        let start = max(fromMs, leg.startedAtMs)
        let end = min(toMs, leg.stoppedAtMs)
        if end > start {
          let top = CGFloat((start - fromMs) / span) * usable + 2
          let segment = max(2, CGFloat((end - start) / span) * usable - 1)
          ZStack {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
              .fill(leg.unsure ? Color(dayframeCSS: theme.warning).opacity(0.2) : ink.opacity(0.16))
            if leg.unsure {
              DayframeCalendarHatch(color: Color(dayframeCSS: theme.warningText)).opacity(0.35)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
            if segment >= 15 {
              DayframeCalendarGlyph(name: leg.glyph, size: 11, followsTextSize: false)
                .foregroundStyle(leg.unsure ? Color(dayframeCSS: theme.warningText) : ink)
            }
          }
          .frame(width: 16, height: segment)
          .offset(y: top)
        }
      }
    }
    .frame(width: 16, height: height, alignment: .topLeading)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
