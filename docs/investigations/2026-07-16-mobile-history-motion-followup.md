# Mobile history grouping and motion follow-up

Date: 2026-07-16
Branch: `codex/mobile-history-motion-followup`

## Reported symptoms

- Repeated Today entries make each day unnecessarily long.
- Tapping the idle description surface and tapping Play do not feel like the same transition into the running editor.
- Running-timer suggestions appear inconsistently after an empty start.
- Calendar pinch zoom stutters and the focal point does not feel stable.

## Evidence

- User references: Toggl grouped activity and Dayframe Calendar screenshots supplied in the Codex task.
- Local baseline captures:
  - `/tmp/dayframe-history-motion-audit/01-before-today.png`
  - `/tmp/dayframe-history-motion-audit/02-before-calendar.png`
- Current merged baseline: `main` at `5e54cb9` after PR #70.
- The attachment bundle contains two JPEG files and no animated GIF or video.

## Hypotheses and checks

1. Suggestions are timing-sensitive because the running sheet is made visible before the optimistic active entry is committed.
   - Proved by `startTask()` setting `activeEditVisible` before `startTaskWith()` creates the optimistic entry, while `ActiveTimerEditSheet` returns `null` without an entry.
2. Suggestions are reset by persistence reconciliation rather than by a true editor session change.
   - Proved by the initialization effect depending on `entry.id`; replacing the optimistic ID with the persisted ID reruns sheet initialization.
3. Calendar pinch is expensive because each gesture frame updates React state.
   - Proved by `queuePinchZoom()` calling `setCalendarZoom()` from `requestAnimationFrame`, which rebuilds hour labels, blocks, layout metrics, and scroll position throughout the gesture.
4. The stutter is caused only by the outer ScrollView.
   - Disproved as the ScrollView is already locked during pinch; per-frame React layout work remains while locked.

## Planned correction

- Group history entries per day by normalized category plus normalized description; descriptionless entries group by category.
- Keep groups collapsed by default and expose their count as the disclosure control.
- Use one callback and one ordered optimistic transition for both empty-start surfaces.
- Reset suggestion state by visible editor session/start timestamp, not by database ID reconciliation.
- Move live pinch transforms to Gesture Handler/Reanimated shared values and commit React layout once at gesture end.

## Closure criteria

- Group totals equal the sum of child overlaps and expanded children remain individually editable.
- Description surface and Play create one timer and open the same suggestion sheet.
- Suggestions appear on every blank running-editor presentation and remain hidden after manual description focus.
- Calendar pinch has no per-frame React state updates, keeps the focal point anchored, and commits one layout update on release.
- Mobile tests, native build, light/dark simulator QA, and side-by-side design QA pass.

## Implemented correction

- Added normalized per-day grouping by category plus description, with descriptionless entries grouped by category, summed overlap totals, collapsed-by-default disclosure, and individually editable children.
- Moved Quick Actions into the idle composer beneath the description surface as a horizontal scroller, retaining the circular Play and Add time controls.
- Routed both empty-start surfaces through `startBlankTask()`, committed the optimistic running entry before opening the editor, and suppressed the competing active-card layout transition for this path.
- Keyed running-editor initialization to mode plus start timestamp. Optimistic-to-persisted ID replacement no longer resets the editor, late suggestions respect manual Description focus, and the suggestion region is ready before the sheet is painted.
- Replaced per-frame React calendar zoom state with a Gesture Handler pinch and Reanimated UI-thread scale/translation. React hour-height state and anchored scrolling now commit once when the gesture ends.
- Wrapped the app root in `GestureHandlerRootView`, required by the native gesture recognizer.

## Verification and closure

- Grouping unit coverage verifies descriptionless category groups, normalized same-description groups, category separation, and summed durations.
- Gesture unit coverage verifies focal anchoring, min/max clamping, and movement with the touch focal point.
- Running-timer contract coverage verifies the shared empty-start callback, ordered optimistic start, one editor presentation path, stable session key, and no suggestion-apply timer start.
- Simulator accessibility QA verified collapsed/expanded states, individual child edit actions, six suggestion rows, and immediate suggestion removal on Description focus.
- Native iPhone 17 light/dark screenshots and the combined source/implementation comparisons are recorded in `design-qa.md`; no runtime error overlay or horizontal overflow remained.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run check:brand-assets`, and `npm run ios -w @dayframe/mobile` passed. The suite completed 172 mobile, 138 web, and 56 shared tests.
- `npm run testflight:preflight` ran and correctly blocked archive/export because this machine lacks the Apple Distribution identity, App Store provisioning profile, and local App Store Connect API environment file. This is release-environment state rather than an application regression.
- The available simulator automation exposes no true two-finger gesture action. Calendar pinch performance is therefore closed by the removal of per-frame React updates, worklet/unit evidence, successful native rendering, and a documented physical-device acceptance check.
