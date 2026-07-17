# Today swipe-to-delete motion and confirmation

Date: 2026-07-17
Branch: `agent/today-swipe-delete-motion`

## Reported symptoms

- On a physical iPhone, swiping a completed Today row left moves the row text while the red delete action and trash icon appear statically rather than sliding into place.
- Tapping the delete action opens the iOS system alert instead of Dayframe's existing in-app delete confirmation.
- The existing in-app confirmation card has an outline that conflicts with the current fill-led mobile design language.

## Version and evidence

- Screenshot evidence shows TestFlight Today history with the row displaced left and the delete action exposed at the trailing edge.
- PR #74 merged the first swipe implementation as `5ce7528` and shipped it in TestFlight build `0.1.0 (48)`, delivery/build ID `a4fc139a-d664-478f-9343-d6d7bf9a5470`.
- The mobile archive uses API base `https://dayframe-web.vercel.app`; PR #74 and this follow-up are mobile-only and do not require a Vercel or Supabase change.
- At investigation start, `main`/`origin/main` was current at `381a950`.
- The PR #74 code uses the deprecated `Swipeable` component with a fixed 64-point right action and ignores the renderer's gesture progress values.
- The Today callback uses `Alert.alert`, while `ActiveTimerEditSheet` already contains the desired app-owned confirmation treatment.
- Documentation conflict found before implementation: the feature tracker recorded build 48 while the PRD and release reference still recorded build 47. This follow-up aligns those documents to verified build 48.

## Hypotheses and checks

1. The static delete action is caused by a React Native platform limitation.
   - Disproved: the installed Gesture Handler package includes `ReanimatedSwipeable`, which exposes UI-thread shared translation values for animating trailing actions.
2. The action appears to pop because only the foreground row is animated.
   - Proved: `renderRightActions` returned a fixed-width `Pressable` and ignored both gesture progress and translation, so the row moved while uncovering a stationary action layer.
3. The system alert is required for delete confirmation.
   - Disproved: Edit Timer already presents a Dayframe-owned accessible confirmation overlay and routes the confirmed mutation through the same optimistic delete path.

## Implemented correction

- Replaced the deprecated swipe component with `ReanimatedSwipeable` and disabled trailing overshoot.
- Bound the 64-point danger action's horizontal position to the swipe translation so its leading edge remains attached to the moving row and the icon travels with the action.
- Extracted the existing Dayframe delete confirmation into a reusable component and used it from both Edit Timer and Today history.
- Removed the confirmation card border while retaining raised-surface contrast, restrained elevation, semantic danger colour, VoiceOver modal semantics, accessibility escape, and Reduce Motion handling.
- Kept the PR #74 scope rules: only stopped individual rows and expanded group children can swipe; collapsed groups remain aggregate-only; deletion stays optimistic and restores failed mutations.

## Closure criteria

- On a physical iPhone, the red action and trash icon move continuously with the finger and row edge, settle without a pop, and do not interfere with vertical Today scrolling.
- Today history and Edit Timer show the same borderless in-app confirmation; no system delete alert appears.
- Cancel does not mutate the entry. Delete removes it immediately. A failed API deletion restores it and shows the existing friendly error.
- Grouped history retains collapsed aggregate safety and expanded children remain individually editable/deletable.
- Light/dark, Dynamic Type, VoiceOver, Reduce Motion, mobile typecheck/tests, full repository validation, and an iOS native build are checked before release handoff.

## Validation completed on the branch

- `npm run typecheck -w @dayframe/mobile` passed.
- `npm run test -w @dayframe/mobile` passed: 21 files and 171 tests.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run check:brand-assets`, and `git diff --check` passed. The full suite completed 171 mobile, 138 web, and 56 shared tests.
- The first iOS build exposed a local CocoaPods sandbox/lock manifest mismatch. `npx pod-install` refreshed the local sandbox; the resulting checksum-only `Podfile.lock` noise was excluded from the PR.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer EXPO_PUBLIC_DAYFRAME_API_BASE=https://dayframe-web.vercel.app npm run ios -w @dayframe/mobile -- --device 'iPhone 17 Pro' --no-bundler` then passed with zero errors and one existing duplicate-library warning, installed the app, and launched it in the iOS 26.5 simulator.
- The simulator bundle loaded without a React Native runtime overlay and rendered the signed-out app correctly. The simulator had no authenticated Dayframe session, and Mac UI control was unavailable while the host was locked, so the real Today row, confirmation interaction, and swipe feel remain explicit physical-iPhone acceptance checks rather than claimed visual closure.
