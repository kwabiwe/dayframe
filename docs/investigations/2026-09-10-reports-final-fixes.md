# Reports final acceptance fixes (V3.1)

## V3.2 refinement checkpoint — 11 September 2026

Starting local/PR head: `0a0fe105271ccd62ea2279266b26fcca987eb2e0`;
fetched `origin/main`/base: `439601c64880fe7bc4bc4618920149b0ce85e341`.
The tracked worktree was clean. Existing untracked, network-disabled synthetic
Reports QA harness files under `apps/mobile/scripts/` were preserved. V3.2
supersedes conflicting V3.1/V3 presentation rules; Cancel remains and there is
no Clear or implicit reset-to-Today action. Reports accounting/API/cache and
timer, Review, Health, Location and sync owners remain outside this refinement.

### V3.2 sheet motion contract (recorded before implementation)

- **Trigger:** the existing date-range or category-filter opener creates one
  presentation ID and draft snapshot; handle swipe, Cancel, backdrop, escape,
  Done or Apply requests the terminal outcome.
- **Owner:** the existing `SwipeDismissSheet` exclusively owns sheet/scrim
  entrance, gesture travel, rejected-drag settlement and coordinated exit. The
  host Modal uses `animationType="none"`; Reports adds no second recogniser or
  native fade/slide.
- **Entrance/update/exit:** normal motion slides up using the shared token while
  the scrim progresses with it. Draft edits remain in the mounted sheet without
  moving the Reports page. Every successful terminal path exits through the
  shared owner before the presentation is released.
- **Surrounding layout:** the underlying Reports layout remains fixed. Category
  reorder uses stable category keys and the existing local row/donut transition
  owners; no global layout animation is introduced.
- **Interruption:** rejected handle drags settle to the same draft. A terminal
  outcome is claimed once per presentation; stale completion IDs, double taps,
  Apply-versus-swipe and rapid reopen cannot dismiss or commit a newer sheet.
- **Outcome:** Cancel/backdrop/escape/successful swipe discard. Done/Apply
  synchronously validate and commit the captured draft once, then request exit;
  report loading is not an exit owner and has no rollback coupling.
- **Accessibility:** Reduce Motion keeps the same semantic outcomes using the
  shared fade path. The visible 44-point dismiss handle and Cancel/Done/Apply
  remain alternatives; closing content becomes inert, and focus returns to the
  still-current opener only after the host has closed. Category search keeps its
  existing keyboard/scroll owner and ticking totals are not announced.

Starting PR #194/head: `5e7b546207771575c49be8b95a3b281af94b6bc8`.
Fetched main/base: `439601c64880fe7bc4bc4618920149b0ce85e341`; clean existing
`codex/reports-stage-a` worktree. The owner's final-fixes addendum supersedes
conflicting V3 direct filtering, numeric reservation and calendar layout rules.
Prior code approval did not prove native geometry. Claude review is deferred
until these known fixes and owner physical retests, as requested.

## Reproduction and hypotheses

Calendar: existing data contains 42 correct successive Monday-first dates, but
one percentage-width wrapping row does not guarantee seven rendered columns.
Hypotheses: fractional allocation/wrapping versus narrower/clipped parent.
Measure row/cell frames at 308/363/378/390/418 grid widths before concluding.
The September six-row regression initially FAILS (zero explicit week rows).

Confirmed native cause: at a **390-point grid width**, the baseline percentage-
wrapping grid creates **seven rows of six dates**, while its weekday header still
has seven columns. This is not a date-array error or a missing Sunday. Sunday
6 has `(x:0,y:44,width:55.5,height:44)` (Monday column/second row), and the seventh
row extends past the 264-point frame into following content. At 308/363 points
the baseline did not fail; testing only those widths missed the regression.

Reproduction: iOS 26.5, Dayframe Sheet QA SE Simulator (375-point viewport),
synthetic 390-point grid, system font scale **3.571**, baseline calendar copied
verbatim from `5e7b546207771575c49be8b95a3b281af94b6bc8`. Diagnostic JS SHA-256:
`fb1c71bebcdbbe3eaedfa70e80e2023e1686018b0785cfcaf2bf1b9307060f76`.
The fixture intentionally exceeds this simulator's viewport to exercise the
fractional width; that is not a claim that a production sheet overflows.

After explicit rows, same native runtime/width/scale: six 44-point rows, 42 cells,
Sunday 6 `(x:334.5,y:0,width:55.5,height:44)` within the first week. Diagnostic
JS SHA-256 `37a513fbe6838a79155e787df8a0e76adf2ad2396bfc3d34268b1a805c6eadf1`.
Before/after geometry: `/tmp/dayframe-r31-simulator-390-before.json` and
`/tmp/dayframe-r31-simulator-390-after.json` (local uncommitted QA artifacts).
**PASS** for reproduced calendar geometry; not physical motion evidence.
Native accessibility-target taps also produced `Selected 2026-9-6` and
`Selected 2026-9-10` for the corresponding full spoken date labels.

Text: hypotheses are parent/line-box constraints versus native text measurement
or rendering at the current OS/font setting. An isolated native probe using the
actual Reports/Today styles renders complete heading/Total glyphs at maximum
text on iOS 26.5 Simulator; this does not reproduce or close the reported iOS 27
beta failure. Native line metrics and parent frames are required. Keep numerical
geometry and role identifiers only; never copy personal activity into fixtures.

iPhone 11 native diagnostic (iOS 27 beta `24A5418b`, 414-point viewport) initially
reported font scale **1**, not maximum accessibility size. Reports/Today heading
frames were 33.5 points high versus 33.414 measured line height; Activity was
21.5 versus 21.480. This normal-size geometry does **not** close maximum-size
glyph clipping. The early Total probe used a 12-point medium proxy, not the real
11-point semibold donut label, so it is not acceptance evidence for that label.
Owner assistance was requested to reproduce the maximum setting on iPhone 11;
iPhone 17 settings have not been changed. No global cap reduction, Text defaults,
dependency upgrade or Pods patch has been made.

### Owner maximum-text screenshots, 20:40

The owner supplied `IMG_0547.PNG` and `IMG_0548.PNG` from the iPhone 11 diagnostic
at maximum accessibility text size. Reports, Today, Activity and the proxy Total
have complete visible glyphs in both scroll positions. Today and the natural-
height reference are deliberately uncapped controls; their enlargement/wrapping
is not the reported crop. Content cut at a viewport edge scrolls into view in the
second image. This is **PASS for the isolated visible text reproduction**, not
acceptance of the actual Reports/Today/Calendar/header layout or donut centre.
The displayed 308-point calendar is also not the failing 390-point fixture.

Screenshot SHA-256 values (images remain local, not committed):
- `IMG_0547.PNG`: `af17ed38562880df32ba1cffee51f4e45688482bcef672d366c8d0db6d594492`
- `IMG_0548.PNG`: `184bacb4c2969d21cb3bf3e3b84e5b3902f51b385e1812367b314585c0aca8bd`

The first geometry export after receiving the screenshots was stale (scale 1).
Restarting only the diagnostic app produced fresh **scale 0.941** geometry, with
Reports/Today line height 31.443 inside a 31.5-point frame. No OS setting was
changed by the agent. This later sample must not be labelled the screenshots'
MAX-text geometry; whether the owner restored text size after capture remains
to be confirmed. Local export: `/tmp/dayframe-r31-iphone11-owner-max-cold.json`.
The evidence weakens a general native text-engine failure hypothesis, but does
not establish the real screens' failing parent/transition constraint.

The owner confirmed they had restored text size after the screenshots, then set
it back to maximum. A fresh diagnostic cold launch at 20:49 captured **scale
3.571** on iPhone 11. Line heights fit their native Text frames: Reports
50.121/50.5pt, uncapped Today 119.322/119.5pt, Activity 32.221/32.5pt, proxy Total
17.184/17.5pt; the three-line reference totals 230.120/230.5pt. Together with the
owner screenshots, this is **PASS for isolated MAX-text glyph/line-box fit on
iOS 27**, including cold-launch measurement. Export:
`/tmp/dayframe-r31-iphone11-confirmed-max.json`. It does not test the real donut
label or production parent/transition constraints. No OS text setting was changed
by the agent; the missing MAX-setting evidence is now collected.

Native numeric probe at scale 3.571, 14-point tabular font capped at 1.2:
`100%` 48 points, `<1%` 38, two-hour-digit duration 73, three 83, four 93,
six 113 (each includes ceil-to-point plus 2-point safety). This proves the
measurement path produces intrinsic widths even inside its zero-size hidden
wrapper. It is not Bold Text or final-row/screen acceptance. Diagnostic JS
SHA-256 `b13c5082ed78423fd67418693299622ceb13aa68a13ca69e9139a8fd51214ab3`;
geometry `/tmp/dayframe-r31-native-numeric-max.json`.

## Validation checkpoint

### Assembled Reports and native tab clearance follow-up

The owner confirmed that the original clipping screenshots came from **Dayframe
Staging**, not the separate Dayframe installation. Both use repeated build
numbers, so this identifies the app but does not recover the screenshot's bundle
fingerprint. The original clipping remains open pending actual-parent evidence.

An explicit, network-disabled diagnostic bundles the real ReportsTab, chart and
sheets with synthetic Sleep 6h / Work 2h / Travel 1h data and the existing native
tab / SafeAreaView / ScrollView geometry. At 375 points, iOS 26.5, font scale
3.571, Light: Reports, Activity and the real donut Total render complete glyphs;
numeric rows remain one line (48-point percentage, 73-point duration, 6-point
gap). Full category names remain in accessibility labels. Tapping the summary
and donut leaves selection unchanged; filter-sheet Sleep deselection plus Apply
produces 03:00:00 with Work 67% and Travel 33%. These are synthetic simulator
presentation checks, not authenticated-app, Bold Text or physical acceptance.

The initial diagnostic omitted SafeAreaProvider and failed when opening Filters;
adding the provider corrected this **harness-only failure**, not a product bug.
CUA drag/scroll attempts did not move the simulator reliably, so gesture
acceptance is NOT RUN. A dedicated diagnostic action invokes native scrollToEnd
and captures final offset/content/viewport geometry instead.

At maximum extent with the original 20-point parent bottom padding, final axis
labels remain under the expanded native floating tab bar. This **FAIL** is not
transient overlap during scrolling. The contained correction applies the existing
Today 112-point convention once at the Reports dashboard scroll-content owner;
no chart padding, tab owner or lifecycle changes. The regression ownership test
failed before the change. Motion contract: the existing native ScrollView owns
direct scrolling, settling and interruption; this static content inset adds no
animation, async work, rollback or Reduce Motion branch. Physical gesture feel
and the normal authenticated app remain separate checks.

After correction, the same MAX-text simulator shows the final 00/05/09/14/18/23
axis labels completely above the expanded tab bar; the zero-bucket callout and
Previous/Close/Next controls are bounded and reachable. Accessible Next moves
from 00:00 to 01:00 without changing totals. **PASS for synthetic native-container
maximum-extent clearance and these bucket actions**, not gesture/frame-pacing
or normal-app acceptance. Before diagnostic bundle SHA-256:
`39cd7419aa53a8c072da50f4bc620f081e03212c0911d699176f7f6d76119203`;
after: `18fbf7758c248bac1b22ca29feef430e6f3a70e31e6024b700931833a051c461`.
Geometry remains local at `/tmp/dayframe-r31-clearance-after.json`.

Clearance-change validation: full typecheck, lint (the same two existing warnings),
docs (133 files), brand assets and diff whitespace PASS. The full workspace test
run passed web 898 (two skips) and shared 246, but mobile had one unchanged
worklet-compilation test exceed its 5-second timeout while Metro was running
(1,086 passed). A serial mobile rerun with unchanged timeout/assertions passed
all **1,087** tests. Logs: `/tmp/dayframe-r31-clearance-tests.log` and
`/tmp/dayframe-r31-clearance-mobile-rerun.log`. This records the failed attempt,
not a claim that the first full command passed.

- **PASS** full workspace typecheck, including mobile.
- **PASS** lint (two pre-existing web `_values` warnings, no errors), docs
  alignment (133 Markdown files), and `DAYFRAME_AUTH_MODE=dev npm run build`.
- **PASS** full workspace tests with `--maxWorkers=2`: mobile 1,086, web 898
  (two skips), shared 246. Logs: `/tmp/dayframe-r31-final-tests.log`.
- **PASS** focused timezone tests: UTC 46 and Europe/London 46.
- **PASS** disposable localhost aggregate/API SQL tests: 9. Fresh isolated
  PostgreSQL at 127.0.0.1:55495, temporary tables/rollback, server stopped after
  the run. Log: `/tmp/dayframe-r31-sql-final.log`.
- Initial **FAIL**: one obsolete month-motion source contract, updated to the
  explicit retained-layer contract plus executable stale-callback tests.
  Default-concurrency runs also hit unrelated Review/web DOM timeouts under
  simultaneous build/simulator load. Both failures are retained in
  `/tmp/dayframe-r31-all-tests.log` and `...-all-tests-rerun.log`; bounded full
  rerun passed. Initial SQL attempts failed because historical disposable
  cluster role names were unknown; the fresh explicitly named QA cluster passed.
- **NOT RUN / still open**: maximum-text/Bold Text iOS 27 clipping reproduction
  and correction on actual Reports/Today/Calendar/header parents, complete
  installed-app bottom scroll clearance, physical VoiceOver/motion/timer/Review/
  sync acceptance, verified Preview backend identity and staging promotion.
  No padding or font-policy guess has been used to label these checks PASS.
- **NOT RUN by owner request**: new Claude whole-PR review. No merge.

The standalone `apps/mobile/scripts/reports-layout-qa-entry.tsx` is explicitly
bundled for local diagnostic runs; expo-router never imports it. It uses synthetic
dates/text, performs no API/authentication or capture operations, and writes only
geometry to its isolated app cache. Its replacement diagnostic JS bundle is not
the final app and is identified separately from a normal signed staging build.

## Motion and ownership contract

Filter Apply alone changes selection. Existing donut arc retention/generation
and row presence/reflow own redistribution; informational rows and slices have
no press actions, hints or removal-triggered focus jumps. Sheet dismissal keeps
the existing focus return. No mutation, rollback or async owner changes.

The shared calendar owns a fixed six-row frame. A month change crossfades within
that frame; retained outgoing visuals immediately become inaccessible and inert.
Only the current month can emit a semantic date selection. Rapid replacement
invalidates old completions; unmount cancels cleanup. Reduce Motion settles the
desired month. Wrappers retain draft/Done or single-date/time preservation.

Numeric and axis measurement are presentation-only, keyed by current label
capacity/style/width and Bold Text. Stale native measurements cannot overwrite
newer geometry; measurements may grow or shrink. Axis/plot/hit-test/tooltip use
the same resulting plot width. Scroll clearance belongs to the existing parent
scroll-content owner; transient content behind a floating tab bar is not failure.

Documentation impact: product interaction, shared UI/motion, validation and a
missing native geometry guardrail. No API, accounting, schema, timer, Review,
Health, Location or sync boundary change is intended. Stage B–D remains excluded.

## V3.2 refinement checkpoint (11 September 2026)

V3.2 started from PR head
`0a0fe105271ccd62ea2279266b26fcca987eb2e0`; the fetched `origin/main` and
GitHub base were `439601c64880fe7bc4bc4618920149b0ce85e341`. The worktree had no
tracked changes. Existing untracked, network-disabled Reports diagnostic harness
files were preserved and remain outside the commit.

The contained refinement changes mobile Reports presentation only. Today and a
custom single day now request one local-day bucket. Week remains seven daily
buckets, Month uses daily buckets, Year uses monthly buckets, and longer custom
ranges keep clipped calendar-week/calendar-month buckets. Explicit axis metadata
selects the one-day, Week, Month, Year or custom label policy; the server request,
accounting, exact-partition cache and active-timer replacement contracts are
unchanged. Future portions of whole presets stay visible but receive zero service
contribution; future custom endpoints remain unavailable.

At 375 points and ordinary text, the real Reports row pitch changed from **56
points** (44-point row plus the surface's 12-point sibling gap) to **38 points**
(38-point row, zero list gap). Percentage/duration widths measured 41/63 points
with a 6-point numeric gap and 179 points remaining for the name. At native MAX
font scale 3.571, row pitch remains 38 points because its capped natural lines fit:
name/numeric line boxes measured 22.554/20.048 points; percentage/duration widths
were 48/73, the gap 6 and name capacity 162 points. Complete numbers remain
visible and only the long name ellipsises. These are synthetic iOS 26.5 Simulator
measurements, not physical/Bold Text acceptance. Geometry exports remain local at
`/tmp/dayframe-r32-after-scale1.json` and
`/tmp/dayframe-r32-after-scale-max.json`.

The shared date-picker geometry now derives a 349-point inner calendar from the
reference 361-point shell and 6-point insets. The Reports date sheet centres that
same 349-point maximum; a 320-point host yields exactly 308 points, or seven
44-point columns. The preset row has four equal targets at least 44 points high
with 34-point visible fills and 6-point gaps. The final network-disabled QA bundle
is `/tmp/dayframe-r32-final-qa.iRpwka/main.hbc`, SHA-256
`247a19a644a80d48231b9d99dc331af85685fe762515e6bb27327a929d081dd7`.
Its native accessibility tree contains Close, a separate **Dismiss sheet** handle,
Cancel, all four presets, 42 date controls and Done; there is no Clear action.

Both Reports modals now use the existing `SwipeDismissSheet` as the sole normal
slide/scrim owner. A backwards-compatible handle-only gesture seam keeps calendar,
search and list interaction outside the pan recogniser. Each opening owns a fresh
presentation ID and one terminal commit/discard outcome. Apply/Done commits once,
while Cancel, successful swipe, backdrop, escape and native close discard. The
parent retains the presentation until the coordinated exit callback and ignores
stale callbacks; closing content becomes inert and focus returns only to a still-
active Reports owner. Reduce Motion uses the shared fade path. Physical swipe feel,
keyboard transitions, interruption and focus still require device acceptance.

Final-source automated evidence:

- **PASS** focused Reports/range/plot/sheet/shared-swipe/geometry tests under UTC
  and Europe/London: seven files and 82 tests in each run.
- **PASS** mobile typecheck.
- **PASS** full workspace tests with `--maxWorkers=2`: mobile 1,099; web 898
  (two skipped); shared 246.
- **PASS** full workspace typecheck; lint with the same two pre-existing web
  `_values` warnings and no errors; documentation alignment (133 Markdown files),
  iOS config, brand assets and diff whitespace.
- **PASS** `DAYFRAME_AUTH_MODE=dev npm run build`: 39 Next routes.
- **PASS** disposable localhost Reports aggregate/API tests: nine, including a
  one-day partition and future entries/buckets. The isolated PostgreSQL server at
  127.0.0.1:55496 was stopped; no hosted data was used.
- **PASS** clean iOS 26.5 Simulator Staging build at
  `/tmp/dayframe-r32-sim-build.P6Adnl/Build/Products/Staging-iphonesimulator/Dayframe.app`.
  Config check identifies `com.layereight.dayframe.staging`, display name
  `Dayframe Staging` and `https://dayframe-staging.vercel.app`; embedded bundle
  SHA-256 is
  `ac1805c07a5b0aabd0025ef6cf00b39d2372622baf79f62f27379560cba8a0ab`.
- **NOT RUN** physical iPhone 11 V3.2 acceptance, Bold Text, VoiceOver and motion
  recording. An exact signed build must be produced from the pushed final commit.
- **NOT VERIFIED** the stable staging deployment's redacted Vercel/Supabase
  database identity. A staging URL and successful login are not proof of database
  isolation, so no Preview promotion or hosted mutation is claimed here.
- **NOT RUN by workflow** Claude whole-PR review and merge. No merge is authorised.

## Owner sheet-polish checkpoint (11 September 2026)

Owner screenshots from the signed V3.2 staging build show the Reports date and
filter sheets stopping above the native tab-bar region, a Cancel accessory beside
the drag handle, full-width Done/Apply actions, and (for filters) a scrolling
title/search field plus a visible scroll indicator. The owner now explicitly
supersedes V3.2's visible Cancel requirement: Reports retains discard through the
shared handle/swipe, backdrop, accessibility escape, native close, account change
and lifecycle invalidation, but exposes no Cancel or Clear/reset action.

Two causes were checked before implementation. First, the Cancel accessory
selects `SwipeDismissSheet`'s accessory-row handle geometry and Reports supplies
`theme.textMuted`, while Edit Entry uses the accessory-free centred handle and
`theme.borderStrong`; removing the accessory and using the established token
proved the handle mismatch was local styling. Second, the Reports modal was
owned inside a native-tab screen whereas Edit Entry is mounted by the dashboard
provider outside `NativeTabs`; the matching bottom gap in the network-disabled
native-tab harness confirmed native tab presentation ownership rather than
safe-area padding: public window and screen metrics both remained 667 points
while the sheet stopped 52 points above the viewport.

Motion contract for this refinement:

- **Trigger and owner:** the existing Reports range/filter actions publish one
  sheet to the app-root portal. Its iOS full-window overlay is static;
  `SwipeDismissSheet` remains the sole slide/scrim/handle-pan owner, matching Edit
  Entry. The portal hides native tab chrome without a competing animation.
- **Entrance/update/exit:** entrance and exit retain the shared sheet timing;
  search text and category checks update in place. Done/Apply still commits once;
  handle swipe, backdrop, escape/native close and invalidation discard once.
- **Surrounding layout:** the surface is anchored through the bottom viewport and
  the compact centred action is laid out inside it. The filter search remains in a
  fixed header while only category rows scroll; no list mutation reflows the
  sheet shell.
- **Interruption/async:** rejected swipes restore the current draft; accepted
  swipes, backdrop/escape and rapid reopen keep the existing presentation-ID and
  stale-callback guards. There is no async mutation inside either sheet.
- **Accessibility:** the handle remains a named 44-point dismiss control; removing
  visible Cancel removes that focus stop but not accessibility escape. Dynamic
  Type caps, keyboard handoff, VoiceOver focus restoration and the shared Reduce
  Motion fade path remain unchanged. Physical gesture feel and focus still need
  identified-device validation.

Implemented presentation boundary: Reports still owns every draft, selection,
commit and discard decision. The app root only hosts the current React sheet and
reports whether one is present so `NativeTabs` can hide its bar until the shared
exit callback finishes. The iOS full-window overlay extends its backdrop and
sheet motion by the identified native-tab reservation; matching bottom padding
keeps calendar/filter content and the centred actions in their original positions
while the material continues to the screen edge. No CocoaPods or
`react-native-screens` source patch remains.

Final isolated simulator evidence uses **Dayframe Sheet QA SE**, iPhone SE (3rd
generation), iOS 26.5, 375×667 points, ordinary text, Light, synthetic 6h/2h/1h
category data and networking disabled. Baseline sheet exposure was **52 points**;
the corrected date and filter sheets both measure **0 points**. The date capture
shows the 42-cell calendar, 16-point calendar-to-action gap and centred 160-point
Done action. The filter capture shows no title or visible Cancel, the fixed search
above the row scroller, no scroll indicator and a fully visible centred 160-point
Apply action. Accessibility exposes the named Dismiss sheet handle, backdrop
close, dates/checkboxes and Done/Apply; full long category names remain spoken.

Local evidence (not committed):

- `/tmp/dayframe-pr194-final-date-sheet.png`, 750×1334 pixels, SHA-256
  `f6bbced4885f5a65aec398289108376a696de782a7942c72ccc2f8745ac6e64a`.
- `/tmp/dayframe-pr194-final-filter-sheet.png`, 750×1334 pixels, SHA-256
  `9b42e97bafae394e878f2f3deb67001c1f4cb6c8245b4d09fbd1ef2a8ce43119`.
- Clean-dependency Staging simulator build log:
  `/tmp/dayframe-pr194-final-sheet-qa-padding.log`; synthetic embedded bundle
  SHA-256 `f537b88e521b6613b2fa995c957e7707cf6fedf6ab6378996171e810146db54c`.

Focused post-fix tests pass in both UTC and Europe/London: four files and 36
tests per run. This closes the synthetic bottom-geometry regression only.
Authenticated staging, physical iPhone motion/VoiceOver/Bold Text and timer /
Review / sync acceptance remain NOT RUN until the signed final-head build is
installed and tested.

Repository validation after the sheet fix: **PASS** lint (the same two existing
web `_values` warnings, zero errors), full workspace typecheck, documentation
alignment (133 Markdown files), iOS configuration, brand assets, diff whitespace
and `DAYFRAME_AUTH_MODE=dev npm run build` (39 generated routes). The bounded
full test run passed mobile 1,101, web 898 (two skipped) and shared 246. Expanded
Reports-focused coverage passed 13 files / 112 tests in both UTC and
Europe/London; a final UTC rerun after portal cleanup also passed 13 / 112.
One unbounded repeat recorded an unrelated 5-second timeout in the existing web
`calendarClickCreate.dom.test.tsx`; mobile and shared passed in that attempt. The
unchanged failing file then passed 9 / 9 alone, and correctly forwarded
`--maxWorkers=2` workspace reruns passed mobile 1,101, web 898 (two skipped) and
shared 246. The first repeat remains FAIL evidence rather than being relabelled.

## Whole-PR review corrections after `b85c7f7`

Claude's independent whole-PR review of exact head
`b85c7f78c56431269b8210a775adcd089a770094` reported no Blockers and two
Important findings: tooltip dismissal still depended on a screen-root bubbled
touch revision, and first-entrance lifecycle tests were absent. The second
finding exposed a real implementation defect as well as missing coverage. A
donut eagerly mounted and settled while its native tab was hidden already held
its final arc angles; changing `animateEntrance` on first focus therefore timed
the final angles to themselves and produced no visible sweep.

The focused correction keeps tooltip selection local to `ReportActivityChart`
but splits its invalidation inputs by meaning. Dedicated title/summary presses
emit an outside-press dismissal, while range/filter/focus/background changes use
a semantic context key. The screen root no longer observes or increments every
bubbled touch, and the chart no longer depends on `stopPropagation()` to protect
selection. Plot selection, Previous/Next, live timer values, theme updates and
vertical scroll gestures retain the active bucket; an explicit outside press or
semantic context change clears it.

Each donut slice now edge-detects its first visible entrance. When a hidden eager
mount was settled, that edge collapses the slice to its start angle before the
260 ms sweep. The edge is consumed once, so asynchronous first data enters but
subsequent timer/theme/filter changes use the normal local update duration;
background and Reduce Motion settle immediately. Existing generation-guarded
exit cleanup remains unchanged. Focused component coverage also proves the
inverse sheet race: a committed Apply cannot be duplicated or undone by a stale
swipe/presentation callback.

Initial focused validation for this correction: **PASS**, four files and 36
tests plus the mobile TypeScript check. Full repository, clean Simulator,
signed staging and physical-device evidence must be recorded against the final
follow-up SHA; the earlier installed `b85c7f7` binary does not validate these
new motion/dismissal changes.

## Final fixed-sheet layout contract (12 September 2026)

The last owner pass makes the range sheet structurally non-scrolling. Its four
presets, range caption, shared month header, weekday headings and all six fixed
44-point calendar rows are one fixed body; Done is a sibling below that body.
On a 667-point window the sheet reduces only its surrounding gaps and top
padding. It does not reduce calendar rows or 44-point targets and does not grow
the shared 349-point calendar cap. The filter structure is the inverse: Search
and Apply are fixed siblings and its category-row region is the only vertical
`ScrollView`, with the indicator hidden.

The root-hosted geometry diagnosis now distinguishes the NativeTabs control
from the home-indicator safe area. The earlier 375×667 iPhone SE probe correctly
measured a 52-point reservation because that device has a zero bottom safe-area
inset. Home-indicator devices reserve that same 52-point control plus their
reported bottom safe area. Reports now derives one compensation value from both,
uses it once for surface translation and backdrop coverage, and adds it once to
content padding. Subtracting the surface translation from content padding leaves
exactly the normal safe-area/keyboard inset, so Done/Apply rests above the home
indicator rather than 52 points too high, and the surface reaches the viewport
bottom. Modal-hosted compatibility consumers receive no NativeTabs correction.

Focused source evidence covers the fixed/non-scrolling ownership, six calendar
rows, fixed Search/Done/Apply regions, 667-point compact spacing, zero-indicator
category scroller, zero-offset modal case, 34-point home-indicator case and both
commit-before-swipe and swipe-before-commit terminal races.

The actual root-hosted NativeTabs fixture also passed on **Dayframe Reports QA
17**, iPhone 17 Simulator, iOS 26.5, 402×874 points, 34-point bottom safe area,
ordinary text and synthetic network-disabled data. XCTest accessibility frames
measured all six calendar rows at 349×44 points, the fixed date body at
390×413.33, and Done at 160×48 ending at y=840. The filter measured Search at
370×44, the sole category scroller at 370×236 and Apply at 160×48 ending at
y=840. Both actions therefore preserve exactly the 34-point safe-area inset;
both sheet surfaces cross the clipped window bottom, leaving **0 points** of
exposed Reports background. The first probe caught the shorter filter shell
retaining the NativeTabs content-height anchor (Apply ended at y=790); applying
the same full-height anchoring constraint as the date sheet moved it down exactly
50 points, and the repeated native test passed. Evidence log:
`/tmp/dayframe-pr194-final-ui-qa17-tests-rerun.log`.

Signed staging identity and physical VoiceOver/Dynamic Type/Reduce Motion
acceptance must still be recorded against the final commit and must not be
inferred from simulator or structural tests.
