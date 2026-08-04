# Native iOS Calendar long-press creation

Date: 2026-08-04

Branch: `codex/mobile-calendar-long-press-create`

Base: `fea966516e5705f43dd264ec1f7b4b932e4c2578` (merged PR #157)

Status: implementation, automated/local build validation, draft PR and stable
staging promotion complete; EAS preview, physical-iPhone and authenticated staging
evidence pending

## Scope and non-goals

This final Calendar programme slice adds one-finger touch-and-hold creation on
genuinely empty native iOS Calendar time. Swift recognises the gesture, resolves
the selected day and a floored 15-minute slot, rejects entry-owned semantic hit
frames, and emits `dayKey` plus `startMinute`. React creates a local 30-minute
draft, presents the existing `ActiveTimerEditSheet` in Add mode, persists through
`createManualTimeEntry`, and refreshes canonical bootstrap.

It does not add tap/double-tap/drag creation, duration selection, resize changes,
a native editor, a fake native/persisted draft block, Suggestions, Plus-route
changes, a second gesture/scroll owner, Swift networking, web Calendar changes,
offline manual-entry queueing, an API/schema migration, a bundle-identity change,
production deployment, or TestFlight.

## Documentation reconciliation

The pre-flight source is `main` at `fea9665`, which contains merged PR #157. The
older tracker snapshot still named `a7f0cf7` and called PR #157 `In progress`.
This PR corrects that stale status to merged/Watch and records long press as PR 5
in progress. No required product, component, style, motion, hosting, overlap, or
native-Calendar reference conflicts with the approved long-press behaviour.

## Baseline architecture and behaviour

- `DayframeCalendarScrollCoordinator` already owns the timeline `UIScrollView`,
  native pinch, horizontal day pan, pull-to-refresh and retained zoom/offset.
- `DayframeCalendarRootView` renders entry Buttons from
  `DayframeCalendarBlockMath`, `DayframeCalendarHorizontalMath`,
  `DayframeCalendarVerticalMath`, and `DayframeCalendarBlockVisualMath`.
- Isolated short entries keep a 44-point Button target. Overlap entries keep
  semantic-height targets. PR #157's one-point gap is painted geometry only.
- Swift actions previously covered day/week navigation, entry/review opening and
  refresh. There was no empty-time creation recognizer or callback.
- `DayframeDashboard` owns bootstrap, selected day, the Plus route,
  `manualDraftEntry`, the Add sheet, save state, mutation and canonical refresh.
- Plus still opens the active editor when a timer is running. Calendar creation
  deliberately bypasses that helper and creates a separate completed draft.
- Add mode starts from the supplied entry, exposes Category, Description, tags,
  Start and Finish, and does not focus Description unless explicitly requested.
  Failure already keeps the sheet open; success already waits for refresh before
  dismissal.

Pre-change `swift test` passed 22 tests. Source/contract inspection confirmed
entry taps, vertical/pinch/horizontal/refresh ownership and the absence of long
press. Rendered pre-change interaction capture remains NOT RUN; no reliable UI
automation evidence was substituted for touch behaviour.

## Native recognizer and gesture contract

`DayframeCalendarScrollCoordinator` retains exactly one
`UILongPressGestureRecognizer`. Named configuration is:

```text
minimumPressDuration: 0.50 seconds
allowableMovement: 11 points
numberOfTouchesRequired: 1
cancelsTouchesInView: true after recognition
dispatch state: .began only
```

The recognizer is configured once, attached and removed beside the existing
pinch/horizontal recognizers, and reset on detach, selected-day change, or layout
change. There is no free-running timer, SwiftUI `onLongPressGesture`, React Native
Gesture Handler owner, or second scroll view.

Failure and simultaneity contract:

- long press never recognises simultaneously with vertical pan, horizontal pan,
  or pinch;
- the existing pinch simultaneity rule remains only for non-long-press pairs;
- movement lets the native scroll/day-pan recognizer begin before the long-press
  threshold and prevents creation;
- a second received touch resets the pending long press; pinch remains native;
- dragging/deceleration, active pull-to-refresh, negative refresh offset, active
  pinch/day pan, invalid model/layout, blank/stale selected day, hour axis,
  outside-day content and entry hit frames reject recognition;
- `.changed` and `.ended` never dispatch;
- one `UISelectionFeedbackGenerator` selection haptic fires only after a valid
  `.began` revalidation and immediately before the one semantic event.

Physical-iPhone scroll/swipe/pinch/refresh competition remains mandatory; UIKit
source ordering and unit tests are not treated as touch-feel evidence.

## Timeline layout, slot and semantic hit geometry

The exact `GeometryReader` width and Dynamic-Type-resolved hour-label width are
passed to the existing hidden scroll resolver as one immutable
`DayframeCalendarTimelineLayout`. The resolver still locates the same ancestor
`UIScrollView`; no hosting controller or scroll view is rebuilt.

The scroll-attached recognizer reports a content-coordinate point, so current
vertical offset is already included. Pure slot math rejects non-finite/negative
values, calculates `contentY / hourHeight * 60`, floors by 15, and clamps to
`0...1425`. The same logical point therefore resolves identically at 48, 72 and
128 points per hour. Swift does not create a timestamp.

`DayframeCalendarEntryGeometryMath` is now the shared owner used by both the
Button renderer and long-press rejection. It derives:

```text
usable block width = availableWidth - hourLabelWidth - 18
minX = hourLabelWidth + 8 + horizontal offset
maxX = minX + horizontal width
minY = vertical hit centre - hit height / 2
maxY = minY + hit height
```

The calculation consumes the same block, horizontal and vertical metrics as the
visible Button. It never consumes `visualHeight`. Consequently:

- a tall, active or Review block owns its actual semantic Button frame;
- an isolated short block owns the complete centred 44-point target;
- an overlapping block owns semantic height only, avoiding adjacent-lane theft;
- the one-point painted gap remains inside the preceding semantic frame;
- contained, partial and dense entries reject only their actual x/y lanes;
- empty horizontal lane space can still create;
- continuation frames remain entry-owned through their visible day slice.

## Bridge and React draft

`DayframeCalendarActions`, `DayframeCalendarExpoView`, the Expo module and the
TypeScript wrapper add one `onRequestCreateEntry` event. Its complete payload is:

```json
{ "dayKey": "2026-08-04", "startMinute": 615 }
```

No timestamp, entry, category, tag, database, session or mutation data crosses
this event. Native presentation remains model version 3.

`calendarManualEntry.ts` validates an exact local `YYYY-MM-DD`, finite minute and
clock input; floors/clamps the minute again; constructs local Start at second 0;
adds exactly 1,800,000 elapsed milliseconds; and verifies both Start and Finish
round-trip through the existing sheet's minute-precision local constructor. The
draft is blank, Uncategorized, tag-free, place-free and legacy-metadata-free, with
`durationSeconds: 1800` and a unique local Calendar draft ID.

For spring-forward gaps, a requested nonexistent Start fails its local component
round-trip. For repeated hours, JavaScript's deterministic earlier occurrence is
accepted only when both exact instants can round-trip through the existing Add
sheet; a pair that would collapse to another repeated-hour instant fails closed.
The accessible alert is `Unable to add time` with the approved clock-change copy.
Future drafts are allowed into the existing sheet and remain subject to its
current future Start/Finish validation.

Dashboard rejects an event whose `dayKey` no longer matches the selected native
day. A valid event sets only `manualDraftEntry`; it does not call the Plus helper,
open the active editor, touch timer state, or prefill metadata. Add mode keeps its
default non-focused presentation.

## Save and active-timer preservation

The existing `saveManualEntry` calls `createManualTimeEntry` once with selected
Category or null, trimmed Description or null, Start, Finish and selected tags.
A synchronous ref closes the pre-render rapid-Save window while the existing
`manualEntrySaving` state disables visible controls. The mobile API now serializes
explicit null Category/Description and an explicit empty tag array for the blank
draft.

Save success awaits silent canonical bootstrap before returning true to the sheet
dismissal owner. Failure returns false and retains the same React draft and form
state. There is no optimistic persisted/native entry. The handler performs no
timer start, stop, replace, split, delete, Live Activity, or active-editor action;
the canonical refresh is the only normal reconciliation of an already-running
timer.

## Motion, haptic and accessibility contract

- Trigger: valid one-finger long press on empty native timeline space.
- Owners: the existing scroll coordinator owns recognition; pure Swift owns slot
  and hit math; Expo transports intent; Dashboard owns the draft; the existing Add
  sheet owns presentation/editing; API/bootstrap owns persistence/canonical entry.
- Entrance: one subtle native selection haptic and the existing Add-sheet entrance.
  No provisional block, Calendar animation, zoom change or reflow is added.
- Update: existing controlled sheet fields only. Calendar gesture state is not
  copied into React.
- Exit: Cancel persists nothing; success dismisses after refresh; failure retains
  the exact sheet/draft.
- Interruption: movement, competing gestures, refresh, second finger, invalid
  geometry and day/layout invalidation cancel before dispatch. One `.began` emits
  once; no delayed callback can outlive navigation.
- Async outcome: canonical refresh owns success; exact local state owns failure;
  the active timer remains unchanged.
- Reduce Motion: recognition and haptic remain; the existing sheet owns its current
  reduced-motion path. VoiceOver retains Plus/Add time as the explicit alternative.
  The timeline hint now mentions touch-and-hold without adding slot focus stops.

## Files changed

Runtime and tests currently include the native Calendar core/model/root/coordinator,
Expo view/module/TypeScript wrapper, Dashboard, mobile manual-entry/API helpers,
Swift/TypeScript tests, and the focused regression/reference documentation. No
web Calendar, migration, EAS profile, bundle ID, entitlement, URL scheme, native
module manifest, or production configuration file is changed.

## Validation evidence

Completed during implementation:

- baseline `swift test`: PASS, 22 tests;
- final `swift test`: PASS, 31 tests after pure slot/layout/hit coverage;
- focused mobile draft/presentation/native-contract/API tests: PASS, 4 files /
  80 tests;
- `npm run typecheck -w @dayframe/mobile`: PASS;
- `npm run lint -w @dayframe/mobile`: NOT RUN because that workspace defines no
  `lint` script; root `npm run lint` is the supported gate and PASSed;
- `npm run typecheck`: PASS across mobile, web and shared;
- `npm run test`: PASS, mobile 45 files / 328 tests, web 96 / 659, shared
  8 / 138;
- `npm run build`: PASS for the production Next.js build;
- `npm run check:brand-assets`: PASS;
- `git diff --check`: PASS;
- DayframeCalendar simulator static-library build with Xcode 26.6 / iOS 26.5:
  first attempt failed on an incorrect long-press touch-count property, then the
  corrected `numberOfTouchesRequired = 1` build PASSed before and after the final
  second-touch cancellation delegate;
- clean isolated checked-in `Dayframe` workspace/scheme Debug build for iPhone 17
  Pro Max / iOS 26.5 with `CODE_SIGNING_ALLOWED=NO` and the staging API base:
  PASS. Output contains existing third-party dependency warnings only;
- the exact built simulator app installed, its development URL opened, and Metro
  bundled 2,041 modules: PASS. Computer Use then reported that the Mac was locked,
  so no screen, layout, gesture, haptic or runtime-overlay claim is made.

Pending: rendered simulator matrix, EAS preview, physical iPhone, and authenticated
staging compatibility.

## Hosted, device and release evidence

- Draft PR: [#158](https://github.com/kwabiwe/dayframe/pull/158).
- Implementation commit: `98dd89c69c09b272d6b7dbd9d7b4baab9c0eec88`.
- Initial Ready Vercel Preview for that commit:
  `dpl_8XM9Van6xEb9ms1PxN7NariRP9fj` /
  `https://dayframe-cu8a1ekde-dayframeworkshop.vercel.app`.
- Stable staging alias: promotion PASS; `https://dayframe-staging.vercel.app`
  resolved to that exact deployment after assignment. Root and Login returned 200;
  unauthenticated `/api/auth/me` correctly returned 401. This evidence-only doc
  commit creates a successor Preview, whose immutable ID and final alias promotion
  are recorded on the PR and in the final handoff instead of recursively changing
  the head again.
- EAS `preview` build: BLOCKED; `npx --yes eas-cli@21.5.0 whoami` returned
  `Not logged in`, so no build was started.
- Paired device discovery: `KB's 17`, iPhone 17 Pro, available. Preview installation
  was NOT RUN because there is no EAS artifact and the Mac is locked.
- Physical iPhone matrix: NOT RUN.
- Authenticated staging web/mobile matrix: NOT RUN.
- Database migration: none.
- Production/TestFlight: intentionally unchanged and NOT RUN.

Before any preview installation, the handoff must state that preview and TestFlight
share `com.layereight.dayframe`, so preview may replace the installed
production/TestFlight app. That warning was surfaced before considering device
installation; no preview installation occurred. This PR does not implement the
deferred staging bundle identity.

## Remaining acceptance and self-review

The direct-manipulation closure criteria require a physical iPhone. Simulator,
source contracts and deterministic math cannot prove recognizer competition,
haptic feel, duplicate suppression, frame pacing, or actual 44-point/lane touch
ownership. Every unperformed device/staging item will remain `NOT RUN`; the draft
PR must remain unmerged for review.
