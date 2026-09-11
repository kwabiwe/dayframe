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

Final-source automated evidence before commit:

- **PASS** focused Reports/range/plot/sheet/shared-swipe/geometry tests under UTC
  and Europe/London: 47 tests in each run.
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
