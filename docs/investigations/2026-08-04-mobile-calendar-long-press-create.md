# Native iOS Calendar long-press creation

Date: 2026-08-04

Branch: `codex/mobile-calendar-long-press-create`

Base: `fea966516e5705f43dd264ec1f7b4b932e4c2578` (merged PR #157)

Status: draft PR #158 follow-up implemented; focused and repository-wide tests,
the native target build, and the checked-in app simulator build/install/bundle
pass. Updated Preview/staging evidence remains pending the final push. EAS is
blocked on authentication; rendered simulator, physical-iPhone and authenticated
staging evidence remain not run. The PR remains draft and unmerged.

## Scope and non-goals

This Calendar programme slice uses one continuous one-finger UIKit long press on
genuinely empty native iOS Calendar time. Recognition creates an ephemeral native
30-minute block beneath the finger. Dragging the same finger moves the whole block
through 15-minute Start slots. Releasing clears the block and emits the existing
`dayKey`/`startMinute` request exactly once; only then does React construct its
DST-safe draft and open the existing Add-time sheet. Cancellation or interruption
clears native interaction state without a request or sheet.

This follow-up does not add duration resize handles, top/bottom grab points,
tap/double-tap creation, a native editor, native networking/persistence, an
intermediate bridge event, a second gesture/scroll owner, a second hosting
controller, web Calendar changes, a migration, a bundle-identity change,
production configuration/deployment, or TestFlight.

## Apple and UIKit interaction research

Apple's current iPhone Calendar guide documents touch-hold-drag for moving an
existing event while retaining its duration, and an empty-time touch/hold flow in
which release opens New Event for a copied event:
`https://support.apple.com/en-ca/guide/iphone/iph3d110f84/ios`.

UIKit documents `UILongPressGestureRecognizer` as a continuous recognizer, and
the gesture-recognizer state machine defines the possible/began/changed/ended and
cancelled/failed paths used here:
`https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer`
and
`https://developer.apple.com/documentation/uikit/about-the-gesture-recognizer-state-machine`.
`UISelectionFeedbackGenerator` supplies the discrete activation and changed-slot
feedback:
`https://developer.apple.com/documentation/uikit/uiselectionfeedbackgenerator`.

These sources inform the interaction shape; Dayframe's exact ownership, snapping,
overlap, sheet and persistence contract remains the authority.

## Root cause of the immediate-sheet behaviour

The first PR #158 implementation treated `.began` as the terminal semantic action:
after empty-space revalidation it fired one selection haptic and called
`actions.requestCreateEntry(request)`. The Expo callback immediately reached
`DayframeDashboard`, which created `manualDraftEntry`; that state presents the
existing `ActiveTimerEditSheet` in Add mode. `.changed` and `.ended` had no creation
work, so native code had neither a retained drag session nor renderable provisional
state.

The follow-up preserves the public event and React handler but moves the single
dispatch to the terminal `.ended` path.

## Final ownership boundary

- `DayframeCalendarScrollCoordinator` owns recognition, creation-drag state,
  captured grab offset, haptics, gesture suppression, edge-autoscroll intent and
  the one retained `CADisplayLink`.
- `DayframeCalendarViewModel` owns the session-tokened ephemeral preview that
  SwiftUI observes. It is not decoded or serialized.
- `DayframeCalendarRootView` renders the preview separately above canonical entry
  Buttons.
- Expo continues to transport exactly one semantic `dayKey`/`startMinute` request.
- `DayframeDashboard` and the existing Add-time sheet own the post-release local
  draft, editing, validation, overlap warning, save and canonical refresh.
- The existing API/event-first runtime owns persistence. Swift never creates a
  timestamp, API request, activity event, time entry or timer mutation.

The native presentation remains model version 3. `creationPreview` never enters
`modelJSON`, `presentation.entries`, totals, overlap/lane allocation or bootstrap.
A same-day `now`, active-timer, category, tag or bootstrap presentation update
preserves a valid preview. Day change, incompatible layout/model reset, refresh,
app inactivity, resolver detachment or token mismatch clears it.

## Continuous state machine

The retained recognizer keeps the original named pre-recognition configuration:

```text
minimumPressDuration = 0.50 seconds
allowableMovement = 11 points
numberOfTouchesRequired = 1
cancelsTouchesInView = true
```

The pure `DayframeCalendarCreationDragReducer` protects semantic ordering:

```text
possible
  -> began: create native session + preview; activation haptic; no request
  -> changed*: update preview only on a changed snapped slot; per-slot haptic
  -> ended: clear session/preview/gesture lock; emit exactly one final request

possible/began/changed
  -> cancelled/failed/interrupted: clear everything; emit nothing
```

At `.began`, the coordinator revalidates selected day, layout, current scroll and
refresh state, the one-finger requirement, timeline body, hour axis and the exact
semantic entry hit frames. A failed revalidation produces no activation haptic,
preview, event or sheet. A valid start publishes the preview synchronously and
locks normal vertical pan, horizontal day pan and pinch until completion.

At `.changed`, only the active session's fixed day/layout is accepted. The
coordinator does not re-run persisted-entry hit rejection: Dayframe permits an
intentional final overlap. Horizontal movement does not affect scheduling.

At `.ended`, one last content-coordinate update is applied, edge autoscroll stops,
the reducer captures the final Start, model preview clears synchronously, normal
gestures restore, and only then does `actions.requestCreateEntry` emit. The React
sheet therefore cannot be visible while the preview is active.

At `.cancelled`/`.failed`, on second touch, refresh, day/layout invalidation, model
reset, app resignation, resolver detachment or hosting removal, cleanup is
idempotent and request-free. A monotonically increasing preview session token
prevents stale cleanup from clearing a newer interaction.

## Grab offset and 15-minute movement

The initial point continues to use the existing 15-minute floor helper. The new
pure drag math captures where the finger landed within the first snapped region:

```text
rawMinute = contentY / hourHeight * 60
grabOffsetMinutes = clamp(rawMinute - initialStartMinute, 0...15)
anchoredMinute = rawMinute - grabOffsetMinutes
startMinute = floor(anchoredMinute / 15) * 15
startMinute = clamp(startMinute, 0...1425)
```

Because every `.changed` location is read in the scroll view's content coordinate
space and subtracts that fixed offset, the block does not jump so that its top
replaces the touched point. Start changes are discrete and immediate at 15-minute
boundaries at the minimum, default and maximum hour heights. Duration is always
30 minutes. A final `23:45` Start renders `23:45–00:15`; the current-day portion is
clipped at midnight with the existing continuation corner rules.

## Provisional visual design

`DayframeCalendarCreationPreviewLayer` is a separate, high-z-index, non-interactive
overlay above `DayframeCalendarEntriesLayer`. It uses:

- the shared nominal 8pt block radius;
- a real 1pt dashed accent/semantic blended boundary;
- an accent-derived translucent fill that strengthens under Reduce Transparency;
- the existing 1pt visual-only bottom gap except for next-day continuation;
- the existing square continuation edge at midnight;
- `New entry` and a monospaced `HH:mm–HH:mm` range when height permits.

It deliberately has no category, tags, Play action, overlap warning dot, hatch,
resize handle, hit target or accessibility focus stop. It does not reflow the grid,
entries or lanes and has no broad presentation animation; 15-minute updates and
exit are immediate. The Calendar accessibility hint directs users to touch, hold,
drag and release, while Plus/Add time remains the explicit VoiceOver route.

## Edge autoscroll

The coordinator owns one optional retained `CADisplayLink`; no repeating `Timer`
exists. The pure edge math defines a 52pt top/bottom activation zone. Direction
follows the entered edge, speed grows linearly with depth and caps at 420pt/s.
Each frame:

1. revalidates the active session, selected day, layout and recognizer state;
2. clamps frame delta and the proposed content offset to the 24-hour timeline;
3. calls `setContentOffset(..., animated: false)`;
4. recomputes the finger in content coordinates after that offset;
5. feeds the normal snapped-drag reducer.

The display link stops when the finger leaves the zone, a day boundary prevents
movement, the gesture releases/cancels/fails, the session/layout/day becomes stale,
refresh starts, the app resigns active, or the view detaches. Haptics still occur
only when the reducer crosses a snapped quarter hour.

## Gesture competition and occupancy

Before recognition, the original competition rules remain conservative: ordinary
movement beyond 11pt lets scroll/swipe win; active scrolling/deceleration, pinch,
horizontal pan, pull-to-refresh, a second touch, negative refresh offset, invalid
geometry, the hour axis and any entry-owned point reject creation. Long press does
not recognize simultaneously with the pan or pinch owners.

After a valid `.began`, creation owns the finger. Normal vertical pan, horizontal
day swipe, pinch and entry taps are disabled until end/cancel; only the display
link may change the vertical scroll offset. Their previous enabled states are
restored deterministically.

Initial rejection consumes the same `DayframeCalendarEntryGeometryMath` frames as
the visible Buttons: isolated short entries own 44pt, overlapping entries own
semantic height, and lanes/continuations retain their true x/y geometry. The 1pt
paint gap remains inside the preceding semantic target, while genuinely empty
horizontal lane space stays eligible. Once valid empty activation occurs, the
preview may cross any persisted entry. Release opens the existing Add sheet, whose
existing overlap warning and user decision remain authoritative.

## Bridge, React draft and active-timer preservation

The final native event remains exactly:

```json
{ "dayKey": "2026-08-04", "startMinute": 615 }
```

No per-drag native event is added. No Finish, duration, timestamp, Description,
Category, tags, place, entry or session data crosses the boundary.

The unchanged React helper revalidates the selected day, floors/clamps defensively,
constructs local Start with DST round-trip checks, adds exactly 1,800 elapsed
seconds, and builds a unique blank, Uncategorized, tag-free draft. The unchanged
Add sheet opens without focusing Description or Suggestions. One Save uses
`createManualTimeEntry`; failure retains the exact draft and success waits for
canonical refresh before dismissal.

Calendar creation never calls the Plus helper, start/stop timer actions or Live
Activity ownership. An existing running timer, its ID, Start, metadata, tags, place
and one-active-timer status remain untouched while the native preview is active and
after a separate completed entry is saved.

## Motion, haptic and accessibility contract

- Trigger: valid empty-space one-finger long press.
- Owner: coordinator recognition/drag/autoscroll/haptic; model preview; root
  rendering; React sheet/save only after release.
- Entrance: immediate preview at `.began`, no scale/bounce, one activation
  selection haptic.
- Update: immediate 15-minute top changes, no grid/entry reflow, continuous edge
  scroll, one selection haptic only for each changed snapped slot.
- Exit: `.ended` clears preview then opens the existing sheet;
  `.cancelled/.failed` clears with no sheet.
- Interruption: day/layout/refresh/model/app/view lifecycle invalidation clears and
  restores normal gestures; stale tokens cannot clear a newer preview.
- Reduce Motion: updates/dismissal stay immediate with no required spatial
  animation. System haptic settings remain authoritative.
- Accessibility: preview is hidden and non-interactive; no empty-slot focus stops;
  existing entry labels/taps and the explicit Plus route remain unchanged.

## Files changed by this follow-up

- `apps/mobile/modules/dayframe-calendar/ios/DayframeCalendarCore.swift`
- `apps/mobile/modules/dayframe-calendar/ios/DayframeCalendarModel.swift`
- `apps/mobile/modules/dayframe-calendar/ios/DayframeCalendarRootView.swift`
- `apps/mobile/modules/dayframe-calendar/ios/DayframeCalendarScrollCoordinator.swift`
- `apps/mobile/modules/dayframe-calendar/Tests/DayframeCalendarCoreTests.swift`
- `apps/mobile/src/lib/nativeCalendar.contract.test.ts`
- `.codex/reference/components.md`
- `.codex/reference/validation-matrix.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- this investigation record.

The existing Expo event declaration, TypeScript wrapper, Dashboard/manual-entry
helper, API path, EAS profiles, native module manifest, bundle identity, web code,
database schema and production configuration are unchanged by the follow-up.

## Validation evidence

Completed for this follow-up:

- baseline native Swift package: PASS, 31 tests;
- updated native Swift package: PASS, 42 tests, including behavioral reducer,
  drag/grab-offset, fixed/cross-midnight preview and edge-autoscroll math;
- focused native presentation/manual-entry/native-contract mobile tests: PASS,
  3 files / 29 tests;
- `npm run lint`: PASS;
- `npm run typecheck`: PASS across mobile, web and shared;
- `npm run test`: PASS, mobile 45 files / 330 tests, web 96 / 659, shared
  8 / 138 (1,127 total);
- `npm run build`: PASS for the optimized Next.js production build;
- `npm run check:brand-assets`: PASS;
- `git diff --check`: PASS;
- `DayframeCalendar` generic iOS Simulator target build with
  `CODE_SIGNING_ALLOWED=NO`: PASS. Output contains existing third-party dependency
  warnings only.
- clean checked-in `Dayframe` workspace/scheme Debug build with Xcode 26.6 for the
  booted iPhone 17 Pro Max / iOS 26.5 simulator, staging API base, fresh derived
  data and `CODE_SIGNING_ALLOWED=NO`: PASS. The exact app installed, the Expo
  development URL opened, and Metro bundled 2,053 modules: PASS. The installed
  app container resolves to the newly installed artifact.
- Computer Use rendered inspection: NOT RUN because macOS is locked and automatic
  unlock failed. No layout, touch, haptic, animation, console-overlay or runtime
  visual claim is made.
- EAS authentication/build attempt: BLOCKED. `npx --yes eas-cli@21.5.0 whoami`
  returned `Not logged in`; no build was started.

Still pending:

- updated immutable Vercel Preview and stable staging alias promotion;
- EAS login and `preview` build;
- physical-iPhone matrix and screen recording;
- authenticated staging web/mobile compatibility.

No unrun item is inferred from source, simulator stills or prior-build evidence.

## Hosted, device and release evidence

- Draft PR: [#158](https://github.com/kwabiwe/dayframe/pull/158), kept draft and
  unmerged.
- Pre-follow-up implementation head: `f3b6fac4d4c8aa61e3b61504f005f7da2f6c2069`.
- Follow-up head: pending commit/push.
- Updated Vercel Preview/deployment ID: pending final push.
- Stable staging alias: pending repoint to the updated exact Ready Preview.
- EAS `preview`: BLOCKED; CLI is not authenticated. No build ID or URL exists. A
  future build must use the checked-in `preview` profile targeting
  `https://dayframe-staging.vercel.app`.
- Physical iPhone: NOT RUN because no updated EAS preview artifact exists and the
  locked Mac prevents device UI operation.
- Physical gesture matrix/screen recording: NOT RUN.
- Authenticated staging web/mobile matrix: NOT RUN; no credentials were supplied
  and no authenticated device artifact is available.
- Database migration: none.
- Production/TestFlight: intentionally unchanged and NOT RUN.

Preview and TestFlight still share `com.layereight.dayframe`; installing an EAS
preview may replace the installed production/TestFlight app. That warning must be
surfaced before any device installation. This PR does not implement the deferred
staging bundle identity.

Because putting an exact final deployment ID into a commit creates another Vercel
deployment, immutable post-push deployment/alias evidence may be finalized in the
PR evidence ledger and handoff rather than recursively changing the head.

## Remaining acceptance and self-review

The direct-manipulation acceptance criteria require a new EAS preview on a physical
iPhone. Simulator/source/unit evidence cannot prove recognizer competition,
haptic feel, edge-scroll controllability, frame pacing, actual hit ownership,
VoiceOver behavior, Live Activity continuity or duplicate suppression under real
touch. Every unavailable item remains explicitly `NOT RUN`; this draft must not be
merged until the user accepts or completes that evidence.
