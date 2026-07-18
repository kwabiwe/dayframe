# Categories keyboard and palette follow-up

Date: 18 July 2026
Branch: `agent/categories-keyboard-palette`
Status: implementation complete; authenticated UI validation blocked by the locked Mac

## Reported evidence

Physical-iPhone screenshots from the current TestFlight lane show two related Categories problems:

- focusing `New category` leaves the field behind the keyboard instead of revealing the complete creation flow above it;
- new-category creation exposes no colour choice, while editing an existing category does;
- the 12 shared swatches contain visually close pairs, particularly Mint/Teal, Sky/Blue, Amber/Orange/Coral, and Steel/Graphite.

The repository baseline is `main`/`origin/main` at `9d07e9b`, after PR #80 merged as `04aa708`; the latest tracked TestFlight build is `0.1.0 (53)`. The screenshots are consistent with the source shipped in that lane. No API, database, or deployment state participates in this presentation defect.

## Hypotheses checked

1. The Settings list does not adjust or scroll for the iOS keyboard. Confirmed: its `ScrollView` has no automatic keyboard inset, interactive keyboard dismissal, focus reveal, or keyboard-frame response.
2. A colour picker exists for creation but is only obscured. Disproved: the new-category row calls `nextCategoryColor` during submission and renders no creation palette at all; only the existing-category editor maps the shared palette.
3. The similar swatches are local styling drift. Disproved: mobile and web both resolve the same shared `DAYFRAME_PALETTE`, whose current display values contain the close pairs seen in the screenshot.

## Required outcome

- Focusing `New category` expands one in-place creation editor without replacing the focused input.
- The Settings scroll owner applies the native keyboard inset and reveals the complete editor above the keyboard, including all 12 swatches and create controls.
- Creation saves the explicitly selected stable palette key; existing automatic unused-colour selection remains the initial default only.
- Cancel returns to the compact row; API failure retains the draft and selected colour.
- All 12 display colours are perceptually distinct in both Light and Dark while stable keys, deterministic order, stored values, and legacy HEX resolution remain compatible.

## Motion contract

- Trigger: focus on `New category`, Cancel, or successful creation.
- Single owner: iOS owns keyboard movement; the Settings `ScrollView` owns focused-content reveal; one local Reanimated presence/layout transition owns compact-to-expanded creator geometry.
- Entrance/update/exit: the existing input remains mounted while colour choices and actions appear below it; swatch selection updates only the colour cue; Cancel or successful creation removes the extra controls continuously.
- Surrounding layout: the Categories panel reflows locally and the adjusted scroll viewport keeps the full creator above the keyboard.
- Interruption: repeated focus does not reset a chosen colour; opening an existing category editor closes the creation expansion without creating data.
- Async outcome: success clears the draft and collapses; failure preserves the entered name, pin choice, selected colour, and visible error alert.
- Reduce Motion: keyboard/focus and state changes remain; local travel/layout animation becomes immediate or opacity-only through the shared motion helpers.

## Validation required

- Focused mobile tests and shared palette tests.
- Mobile/shared typecheck plus full repository validation and native iOS simulator build.
- Authenticated iPhone-size Categories checks for compact/expanded creation, keyboard reveal, all swatches, Cancel, Create, existing-category edit, light/dark, Dynamic Type, VoiceOver, and Reduce Motion.
- Physical-iPhone confirmation before declaring the keyboard behavior settled.

## Validation record

Automated validation completed on 18 July 2026:

- `npm run typecheck -w @dayframe/mobile` — passed.
- `npm run test -w @dayframe/mobile` — passed, 25 files and 195 tests.
- `npm run typecheck -w @dayframe/shared` — passed.
- `npm run test -w @dayframe/shared` — passed, 3 files and 58 tests.
- `npm run typecheck -w @dayframe/web` — passed.
- `npm run test -w @dayframe/web -- --run src/app/theme-contract.test.ts` — passed, 1 file and 3 tests.
- Full `npm run lint && npm run typecheck && npm run test && npm run build && npm run check:brand-assets && git diff --check` — passed; the workspace test run covered 396 tests and the Next production build generated 20 static pages.
- `xcodebuild -workspace apps/mobile/ios/Dayframe.xcworkspace -scheme Dayframe -configuration Debug -destination 'platform=iOS Simulator,id=CF4A2B85-B714-4985-B9AA-8CE669BA78F6' build` — passed with `** BUILD SUCCEEDED **`. No CocoaPods install was required because native dependency and autolinking state did not change.

The iPhone 17 Pro simulator is booted, but both Computer Use attempts returned: `The Mac is locked and automatic unlock could not unlock it.` Authenticated visual, keyboard, Dynamic Type, VoiceOver, Reduce Motion, appearance, recording, and physical-iPhone checks therefore remain unclaimed and blocking for settlement.
