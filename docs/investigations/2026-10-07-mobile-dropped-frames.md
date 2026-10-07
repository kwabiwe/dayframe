# Dropped frames on iPhone — 7 October 2026

Status: In review (frame-pacing PR). Device evidence is pending: the owner's physical-iPhone check on a staging build.

## What the owner saw

On a staging build of Blocks Phase 2 (#237), the owner reported animations "glitching throughout the app", most visibly the running timer card at the top of Today when a timer is stopped: the motion looked like dropped frames.

## Method

Static review of every animation driver and periodic update in `apps/mobile` (app, src and the native Calendar module), then a Simulator check of the Stop path. A Simulator cannot show device frame pacing, so the fixes target causes that are certain from the code, and the owner's phone confirms the result.

## Findings

1. **The only JS-thread animation in the app is the Stop fade on the live card.** `activeTimerExpansion` in `DayframeDashboard.tsx` was an RN `Animated.timing` with `useNativeDriver: false`, so every frame of the 220 ms fade of the elapsed time, start time, Stop and Add past time was computed on the JS thread. Stop is exactly when the JS thread is busiest: it persists the Stop to the outbox, updates the dashboard data, re-renders all three tabs and schedules delivery. Frames of that fade are dropped whenever a render or storage write overruns 16 ms. Every other RN `Animated` value already used the native driver; Reanimated animations already run on the UI thread.
2. **A one-second clock rebuilds work that only changes once a minute.** The dashboard provider ticks `now` every second for the live elapsed time. Every tick also:
   - rebuilt Today's history sections from up to 60 days of entries (`buildHistoryDaySections`) and re-rendered the visible day cards, whose rows show only whole minutes;
   - rebuilt the native Calendar model (`buildNativeCalendarBridgeState`), whose `nowMs` field made the JSON differ every second, so the Swift view re-decoded it and SwiftUI republished the whole timeline every second. The equality guard in `DayframeCalendarViewModel.update` could never skip it. Native tabs stay mounted, so this ran even when Calendar was not on screen, competing with Today's animations and with Calendar's own scrolling and pinch.
3. **`LayoutAnimation` does nothing in this app** (React Native 0.85 with Reanimated 4's legacy layout proxy, see `.codex/reference/motion.md`). Screens that call `scheduleLayoutTransition` expecting an animated reflow (Dashboard start/stop/delete, Settings, Places editor, Review) snap instead. This reads as a glitch rather than dropped frames and is handled separately.
4. Not causes: the Review presentation already throttles its own clock (`projectionNowMs`); sheet and suggestion overlays already use the native driver; the Blocks Today transitions (#237) run on the UI thread.

## Changes (frame-pacing PR)

- `activeTimerExpansion` uses the native driver, so the Stop fade runs on the UI thread whatever the JS thread is doing.
- `minuteClock` (`apps/mobile/src/lib/frameClock.ts`): Today's history sections, the day cards' computations and the native Calendar model read a per-minute clock, so they are rebuilt once a minute (or when data changes) instead of every second. The clock never falls behind the newest start or stop already shown (`newestShownTimestamp`), so a timer started or a short entry stopped earlier in the current minute appears at once, with a positive length, in Today and the Calendar. The Calendar receives a stable model object between real changes, so its JSON is not re-serialised every second. The live block's elapsed time still ticks every second.
- The Stop fade skips the no-op animation when nothing changes (idle mount) and settles at its target if interrupted.
- Guardrails: `framePacing.contract.test.ts` requires `useNativeDriver: true` on every RN `Animated` timing, spring and decay in app, src and modules, and pins the per-minute inputs; Calendar tests prove the model is identical for every second of a minute while a timer runs and that a timer started earlier in the minute appears at once.

## Still open

- Replace the inert `scheduleLayoutTransition` calls with Reanimated owners or remove them (next PR).
- The provider still re-renders all three tabs every second because the context value changes with `now`, and the visible day cards re-render with it (`HistoryDayCard` is not memoised and receives inline callbacks); only their inner computations are skipped. If the phone still shows stutter, memoise `HistoryDayCard` with stable callbacks and isolate the ticking clock into the live block.
- Physical-iPhone check of Stop, Start, Calendar scroll and pinch on a staging build.
