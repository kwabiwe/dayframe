# Native iOS Calendar block visual system

Date: 2026-08-04

Branch: `codex/mobile-calendar-block-visual-system`

Base: `a7f0cf7030166d2ed999c094f82fafcc842c9af3` (`origin/main`, merged PR #156)

Implementation head: `aacaed02007b7f545d246a88364962e7d8dab9c4`; this
evidence update advances the draft PR head without changing runtime code

Status: implementation, local validation, draft PR, and staging Preview promotion
complete; EAS, authenticated staging, and physical-device validation remain blocked

## Scope and non-goals

This PR changes only native iOS Calendar block presentation: one compact radius,
a subtle semantic/category border, and a one-point rendered separation between
touching time intervals. It preserves the existing native Calendar, React-to-Swift
presentation boundary, retained hosting controller, scroll/pinch owner, overlap
layout, content-density rules, tags, callbacks, editors, Review flow, timer
mutations, APIs, and stored time values.

It does not add long press, empty-space creation, drag-to-create, resize, Play,
inline editing, a callback, networking, a model-version bump, a database migration,
a second native implementation, a bundle-identity change, or a production/TestFlight
deployment.

## Visual reference and diagnosis

The supplied dark-mode iPhone screenshot was reviewed from the file beside the
execution brief. It shows the short `Vibe coding` block using capsule-like corners
and sequential blocks visually merging. The screenshot remains an untracked input;
no personal Calendar data is copied into the repository.

The live implementation audit found:

- `DayframeDashboard` renders `DayframeCalendarView`; no legacy React Calendar
  renderer remains.
- `DayframeCalendarExpoView` retains one `UIHostingController` and updates one
  observable presentation model.
- `DayframeCalendarRootView` is the live block renderer and
  `DayframeCalendarCore` owns the pure geometry.
- `DayframeCalendarBlockMath.metrics().height` is semantic time geometry.
- `DayframeCalendarHorizontalMath` owns horizontal overlap geometry and hit height.
- isolated short blocks retain a 44 pt target; overlapping blocks use semantic
  height so hidden targets do not steal neighbouring lanes.
- title/meta visibility is driven by semantic height and horizontal text density.
- the live shape used `min(13, rect.height / 2)`, deliberately turning short blocks
  into capsules.
- every block painted its full semantic height, so exact sequential intervals had
  no visible Calendar surface between them.
- confirmed/active blocks used the full category colour for their one-point stroke.
- active and Review dashes, Uncategorized hatch, overlap dot, tags, continuation
  flags, z-order, and semantic callback targets were already present.

No required document prescribed a competing native radius or capsule rule. The
general fill-led guidance says outlines are not a default grouping mechanism, but
the approved Calendar boundary is a narrow semantic-data exception consistent with
the same guides' use of hairlines for Calendar/data structure.

## Implemented geometry contract

`DayframeCalendarBlockVisualMath` is a pure native visual helper. For every valid
semantic block emitted by `DayframeCalendarBlockMath`:

```text
nominal corner radius = 8 pt
normal visual gap = 1 pt
continuation-to-next-day visual gap = 0 pt
visual height = semantic height - visual gap
minimum visual height = 1 pt
```

Semantic top, height, timestamps, displayed duration, totals, current-time line,
overlap classification, lane allocation, z-index, and model serialization do not
consume visual height. The Button remains centred and sized from semantic/hit
geometry; the painted fill, hatch, stroke, text, tags, and overlap dot are placed in
a visual-height frame aligned to the top of the semantic frame. The transparent
one-point remainder exposes the Calendar surface without moving the next entry.

Malformed direct helper inputs that are non-finite or below one point clamp to a
finite one-point semantic/visual fallback with no gap. Production semantic block
math already guarantees a minimum four-point height, so valid geometry is never
clamped by this safety path.

The shape uses one 8 pt nominal token for normal, short, and tiny entries. Its
effective path radius is `min(8 pt, width / 2, visual height / 2)` because a valid
corner cannot exceed the available rectangle. That mathematical safety clamp is
not a density-specific design rule and does not change during ticks, refresh,
overlap reflow, or zoom.

Entries continuing into the next day keep their full semantic height, square bottom
corners, and no artificial midnight gap. Entries beginning on the previous day keep
square top corners and receive the normal bottom gap only at their actual visible
stop. Multi-day middle slices remain square at both edges with no visual gap.

## Fill, border, and semantic states

The existing fill treatment is retained. Confirmed and active category boundaries
use a real 1 pt stroke produced by blending the category cue over `theme.border` at
`0.42`. Active keeps the same dash pattern. Review continues to use
`theme.borderStrong` with its dashed semantic boundary rather than category colour.
Uncategorized keeps its neutral identity and hatch, using `theme.border` normally
and `theme.borderStrong` under Reduce Transparency. No raw colour, new bridge field,
left rail, selected outline, or desktop hover affordance was added.

## Content, overlap, and tap preservation

Title/meta/tag thresholds remain based on semantic height and existing horizontal
text density. The overlap marker remains inside the painted frame. Shared
`layoutTimeIntervals` inputs, lane fractions, horizontal positions, z-index, and
animation values are unchanged.

Hit-height math now names its input `semanticHeight` explicitly. Isolated short
blocks still resolve to at least 44 pt; overlapping blocks still resolve to their
semantic height. The one-point paint inset never enters hit testing or collision
math. Existing active/completed/Review callback routing remains unchanged.

## Motion contract

- Trigger: initial render, selected-day change, bootstrap refresh, active-timer
  tick, optimistic reconciliation, pinch zoom, or horizontal overlap reflow.
- Owner: `DayframeCalendarRootView` draws blocks;
  `DayframeCalendarCore` owns semantic/visual geometry;
  `DayframeCalendarScrollCoordinator` retains scroll/pinch ownership; React retains
  data, mutation, routing, and sheet ownership.
- Entrance/update/exit: no new block entrance or exit animation. Radius, border,
  and gap update immediately from current metrics. The existing selected-day
  transition and horizontal-only 210 ms collision reflow are unchanged.
- Surrounding layout: no semantic time or timeline reflow; block top and semantic
  centre remain exact throughout pinch.
- Interruption: stable IDs and the retained native view continue to absorb ticks,
  refreshes, and rapid zoom/reflow updates without a reset or stale callback.
- Async outcome: not applicable; Swift owns no mutation or rollback.
- Accessibility: Reduce Motion continues to remove day/reflow motion while keeping
  the visual contract. Reduce Transparency strengthens the neutral Uncategorized
  boundary. VoiceOver labels, Dynamic Type thresholds, and callback actions are
  unchanged.

## Files changed

- `apps/mobile/modules/dayframe-calendar/ios/DayframeCalendarCore.swift`
- `apps/mobile/modules/dayframe-calendar/ios/DayframeCalendarRootView.swift`
- `apps/mobile/modules/dayframe-calendar/Tests/DayframeCalendarCoreTests.swift`
- `apps/mobile/src/lib/nativeCalendar.contract.test.ts`
- `.codex/reference/components.md`
- `.codex/reference/validation-matrix.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- this investigation

## Validation evidence

Completed:

- baseline `swift test`: PASS, 13 tests.
- focused native `swift test`: PASS, 19 tests after the change.
- focused mobile presentation/contract tests: PASS, 2 files / 15 tests.
- `npm run typecheck -w @dayframe/mobile`: PASS.
- `npm run test -w @dayframe/mobile`: PASS, 44 files / 315 tests.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run test`: PASS, 148 files / 1,112 tests across mobile, web, and shared.
- `npm run build`: PASS, Next.js production build.
- `npm run check:brand-assets`: PASS.
- `git diff --check`: PASS.
- `apps/mobile/ios/Podfile.lock` and `apps/mobile/ios/Pods/Manifest.lock` match;
  no dependency or native manifest changed, so CocoaPods reinstall was not required.
- full checked-in workspace build: PASS with Xcode 26.6 / iOS 26.5 on the
  iPhone 17 Pro Max simulator destination. Both the initial compile-only build and
  the normal locally signed incremental build completed with `BUILD SUCCEEDED`.
- simulator launch: PASS for the normal signed app. Metro bundled successfully;
  with the local web/API process running, the existing dev session loaded
  `/api/bootstrap` and `/api/timer-state` successfully and rendered the populated
  Today surface without a runtime overlay. The expected ungranted simulator
  HealthKit warnings were unrelated to this PR.

Not run locally:

- the fixture-level rendered Calendar matrix, tap routing, pinch/scroll, appearance,
  Dynamic Type, VoiceOver, Reduce Motion, and Reduce Transparency checks. The Mac
  UI session was locked, so computer-use could not activate the Calendar tab; CLI
  screenshots proved app/data startup but are not substituted for interaction
  evidence.
- physical-iPhone validation. Xcode reported the available iPhones and iPad as
  offline, so no real-device install or gesture/display-scale check was possible.
- EAS preview build. `eas-cli whoami` returned `Not logged in`; no interactive
  credential flow was started and no build/artifact ID exists.
- authenticated staging web/mobile compatibility. No staging test-account session
  was available, and no preview binary could be created without EAS authentication.

## Draft PR, Vercel Preview, and staging

- Draft PR: [#157](https://github.com/kwabiwe/dayframe/pull/157), intentionally
  left draft and unmerged.
- The GitHub Vercel check passed for exact implementation head `aacaed0`.
- Exact Ready deployment: `dpl_t4Zn2VqXF8U8NbcSENfVeyPm8MKK`, target `preview`,
  with branch alias
  `dayframe-web-git-codex-mobile-calendar-bf5c05-dayframeworkshop.vercel.app`.
- Vercel lists encrypted Preview-scoped deployment-environment, provider-auth,
  public Supabase, database, and location-rollout variables. Pulled values were
  returned only as `[SENSITIVE]`, so independent staging-versus-production project
  reference comparison was NOT RUN; no value was printed or retained.
- The exact Ready Preview was assigned to `https://dayframe-staging.vercel.app`.
  Vercel inspection resolved the stable alias back to the same Preview deployment;
  staging `/login` returned 200 and anonymous `/api/bootstrap` returned 401.
- Production remained unchanged on separate Ready production deployment
  `dpl_3vHmHCMZp7vUcrUwFcurFot2TuTD`. No production alias, configuration,
  credential, data, or deployment mutation was performed.

## EAS preview and staging compatibility

The checked-in `preview` profile bakes
`EXPO_PUBLIC_DAYFRAME_API_BASE=https://dayframe-staging.vercel.app`, uses internal
distribution, and identifies the release channel as `preview`. Preview and
TestFlight still share `com.layereight.dayframe`; installing a future preview may
replace the production/TestFlight app until the deferred staging identity lands.

`npx --yes eas-cli@21.5.0 whoami` returned `Not logged in`, so the authorized
preview build could not be submitted. No production profile, TestFlight upload, or
credential mutation was attempted. The anonymous hosted matrix passed for staging
web/login and fail-closed bootstrap; provider-authenticated web and mobile parity,
Calendar data refresh, edits, timer sync, Review sync, overlap continuity, and
cross-surface checks remain NOT RUN.

## Migration and production safety

Database migration: none expected. No database migration, API, web Calendar,
production Vercel/Supabase variable, EAS production profile, TestFlight, bundle
identifier, entitlement, or URL-scheme file is in the implementation diff.

Hosted validation, if credentials are available, will use only the selected PR
Preview, staging Supabase, `dayframe-staging.vercel.app`, and an EAS `preview`
internal build. The preview and production profiles intentionally share the iOS
bundle identity; installing preview may replace the existing TestFlight app. This
PR does not change that deferred limitation.

## Limitations and self-review

The supplied screenshot establishes the original visual issue, while the locally
signed binary proves that this source compiles, launches, connects to the local API,
and consumes live presentation data. Unit/source tests prove geometry and ownership,
but the locked Mac UI and offline physical devices mean the rendered Calendar
fixture matrix, physical touch, display-scale hairline appearance, pinch frame
pacing, and real-device Light/Dark/Reduce Transparency rendering remain explicitly
NOT RUN until recorded later in this note and the draft PR.
