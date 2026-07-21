# Mobile place search and settings polish

Date: 2026-07-21
Branch: `codex/mobile-place-search-settings-polish`
Base: latest `main` after PR #86 (`0b83826975f0b525fd93828157b71930b6c44cce`)

## Scope

This change adds native iOS Apple MapKit autocomplete to a dedicated place editor, reduces the normal Places & Location settings surface, repairs reused Settings scroll state, and constrains the running-entry category row to one horizontal viewport. It does not change the event-first model, review-first visit semantics, API contracts, database schema, hosted rollout, or production configuration.

## Pre-change evidence and hypotheses

The signed-in simulator loaded the current hosted `/api/bootstrap` response without a server/schema error. The existing Places & Location screen exposed internal rollout, native queue, evidence, and engine details directly in ordinary settings.

The reported blank/stuck Settings state did not reproduce during one controlled Categories -> Settings -> Places & Location pass on the current simulator build. Source inspection still identified three independent ways the shared scroll surface can retain an invalid visual position:

1. The same `ScrollView` instance is reused as `settingsSection` changes, but its offset is not reset.
2. iOS keyboard inset adjustment is enabled for every settings section even though only Categories requires it.
3. Async/disclosure content can shrink without clamping the retained offset to the new `contentHeight - viewportHeight` range.

The running-entry category row is nested in the editor's vertical scroll surface without a fixed-height horizontal viewport or explicit direction/bounce ownership. Vertical gesture leakage and elastic cross-axis movement can therefore move or clip the chip row independently of its intended one-axis layout.

## Implementation guardrails

- Keep saved-place mutations in React Native through the existing Dayframe API client. Swift owns only MapKit completion/search presentation data and emits serializable results.
- Keep autocomplete biased, not geographically locked. The native completer uses `.default` region priority where available.
- Never prompt for location merely to bias search. Cached location is used only after an already-granted foreground permission check.
- Do not serialize or log `MKLocalSearchCompletion`, `MKMapItem`, placemarks, raw queries, or coordinates.
- Keep visit suggestions review-first and preserve existing create/update/delete/learned-place APIs.
- Keep location rollout at `v2_shadow`; do not add a migration, deploy, merge, or run TestFlight.

## Motion contract

### Place editor route

- Trigger: create, edit, or save a learned place from the Places list.
- Owner: Expo Router native stack.
- Entrance/exit: existing native push/pop transition; no competing local transform.
- Interruption: native stack owns an interrupted back gesture.
- Reduce Motion: system/native navigation preference.

### Search suggestions

- Trigger: the current debounced query produces a current-generation result state.
- Owner: the suggestion container only.
- Entrance/update/exit: local layout/presence transition; the text field and keyboard do not move ownership.
- Interruption: a newer request replaces the pending generation; stale events are ignored. Clear/unmount cancels native work immediately.
- Async rollback: failure resolves to friendly inline state without restoring an older list.
- Reduce Motion: content updates without travel animation.

### Advanced coordinates and privacy/troubleshooting disclosures

- Trigger: the corresponding disclosure button.
- Owner: that disclosure's React state and surrounding local layout.
- Entrance/update/exit: one local layout transition; no nested vertical scroll surface.
- Interruption: repeated taps settle on the latest expanded state.
- Async rollback: not applicable; diagnostic refresh stays inside the already-open content.
- Reduce Motion: immediate state change.

### Location information sheet

- Trigger: the circular information button in a Location or Places card.
- Owner: one React Native `Modal`.
- Entrance/exit: fade in normal motion, no travel animation with Reduce Motion.
- Interruption: backdrop, close action, or platform back dismisses the same owner.
- Surrounding layout: fixed viewport-safe modal card with internal scrolling and a visible close action.

### Category chip row

- Trigger: direct horizontal drag or chip selection.
- Owner: the horizontal `ScrollView`; the editor continues to own vertical scrolling outside its fixed viewport.
- Update: direct manipulation only, with horizontal directional lock and vertical bounce disabled.
- Interruption: touch cancellation returns control to the outer editor without translating the chip row vertically.
- Reduce Motion: no automatic travel animation is introduced.

## Documentation state

`docs/feature-fix-tracker.md` still described Location Intelligence V2 as in progress on its former branch when this branch was created. The implementation is now present on `main` through PR #86. The tracker is updated in this change to reflect the merged base while retaining the documented `v2_shadow` rollout and outstanding hosted/physical-device evidence.

## Closure evidence

### UX and native contract

The editor is search-first: address/POI search is primary, Current location is a compact secondary action, and raw coordinates are collapsed as an advanced fallback. Search, Dayframe name, and the canonical coordinate remain separate state so a manual name is not overwritten and a selected completion cannot silently diverge from the saved centre.

MapKit was selected because Dayframe is iOS-only, already uses local Expo modules, and `MKLocalSearchCompleter` plus `MKLocalSearch.Request(completion:)` provide native address/POI completion without another API key, billing surface, server proxy, or third-party address store. The retained native coordinator exposes only opaque IDs and serializable title/subtitle DTOs, resolves a selected current-generation ID, and clears its registry on replacement, resolution, cancellation, and module teardown.

### Files changed

- Local MapKit Expo service: `apps/mobile/modules/dayframe-place-search/**`.
- TypeScript provider and pure editor state: `apps/mobile/src/lib/placeSearch.ts`, `placeEditorState.ts`, and focused tests.
- Dedicated editor/list flow: `apps/mobile/app/place-editor.tsx`, `places.tsx`, and `_layout.tsx`.
- Compact settings and offset repair: `apps/mobile/app/settings.tsx`, `settingsScroll.ts`, and tests.
- Category viewport: `ActiveTimerEditSheet.tsx` and `mobileTheme.ts`.
- Native integration: `apps/mobile/ios/Podfile.lock`.
- Product state: this record and `docs/feature-fix-tracker.md`.

### Automated validation

Final focused results:

- Mobile TypeScript: 33 files, 235 tests passed.
- Web TypeScript: 36 files, 182 tests passed.
- Shared TypeScript: 5 files, 93 tests passed.
- Total TypeScript: 74 files, 510 tests passed.
- New native Swift package: 8 XCTest cases passed with zero failures.
- Root lint, workspace typecheck, workspace tests, web production build, brand asset check, Expo dependency check, and `git diff --check` passed.
- `npx pod-install ios` failed from the repository root because this monorepo has no root `ios/` directory. The same required integration command passed from `apps/mobile`, installing 113 dependencies / 112 pods and linking `DayframePlaceSearch`.

### Simulator and manual validation

- Simulator: iPhone 17, iOS 26.5, UDID `6933A99B-D5DE-486A-B040-006CC11AFEC4`.
- A clean `xcodebuild` Debug build for that resolved simulator completed with `CODE_SIGNING_ALLOWED=NO` after stale Metro, Simulator, and Xcode processes were stopped.
- `npm run ios -w @dayframe/mobile -- --no-build-cache` then completed a clean locally signed build, installed it, launched it, and connected it to Metro.
- The authenticated app loaded the hosted bootstrap without a route/schema error.
- A public `Edinburgh Castle` query produced six live native suggestions; selecting the current result resolved a map centre, formatted address, and editable Dayframe name. The draft was cancelled and not saved.
- The compact Places & Location screen, both information sheets, closed-by-default troubleshooting disclosure, support actions, list-only Places screen, dedicated editor, coordinate disclosure, and category-keyboard -> location-settings recovery were exercised.
- The active-timer category row rendered as one uncropped horizontal 44pt chip row in its fixed viewport. A draft category changed during a simulator drag and was explicitly cancelled, so no timer mutation was persisted.

The clean unsigned artifact built successfully, but its first direct install was not accepted as runtime proof because the dev runtime reported several unrelated pre-existing native modules missing together. The clean locally signed Expo build immediately restored those modules and supplied the successful launch/MapKit evidence above.

### Database, rollout, privacy, and remaining limitations

No migration added. No address/search-history column or new persistence path is required. Search text and native completion payloads remain ephemeral; coordinates are returned only after explicit selection; no query, result, coordinate, placemark, or raw provider error is logged or sent to analytics.

The server-controlled location rollout remains `v2_shadow`. No hosted migration, flag change, Vercel deploy, TestFlight upload, merge, or production action was performed.

No physical iPhone validation was performed. Nearby Chelmsford ranking, POI selection, rapid typing on-device, offline behaviour, all permission/Precise Location cases, name/radius/search save matrices, learned-place acceptance, light/dark/system, Dynamic Type, and the required diagonal-swipe category stress test remain release-blocking physical checks. The original blank/stuck Settings state was not reproduced pre-change, so the repair is source-backed plus simulator-regression-checked rather than a physical before/after reproduction.

Rollback is a code-only revert of this branch: remove the local module/editor/provider, restore the inline Places editor and prior Settings/category-scroller code, run pod install to remove the local pod, and rebuild the native app. No data rollback is required.
