# Reports Revision 2 implementation evidence

Revision 2 supersedes the Revision 1 design and acceptance evidence for PR #194.
Starting head: `09e7e2012ea440dc9b0847e4edf45f4b2135079c`; fetched main:
`439601c64880fe7bc4bc4618920149b0ce85e341`. Worktree initially clean.

## Scope and decisions before implementation

- Preserve the extracted Reports tab, stable donut identity and authenticated
  Dashboard projection. No timer, Review, Health, Location or sync ownership changes.
- Replace the R1 summary cards, coverage calculations, Pie/Bars switch and fixed
  week chart. Reports totals count concurrent confirmed entries independently.
- A bounded, personal authenticated aggregate read serves every range. Bootstrap
  remains bounded and is not a year-history transport. Reports-only R1 coverage
  metadata is removed. No schema, native dependency or durable cache is required.
- The aggregate includes a minimal active-entry contribution (identity, category,
  start and bucket seconds), enabling Reports to replace that contribution with
  the existing projected timer without introducing a timer owner or polling loop.
- Exact-range results live only in the mounted account-keyed Reports owner.
  An uncached failed read never borrows a different range's totals.
- Current canonical staging identity is `com.layereight.dayframe.staging`, not the
  obsolete shared-identity wording in earlier instructions. Older merge-first
  release checklist wording does not override pre-merge signed staging acceptance.

## Motion contract

The existing Reports owner consumes first populated foreground/focused entrance
once. Donut slices own numeric arc interpolation and selected opacity; the centre
owns its short opacity reveal. Stable category IDs survive filters and ticks.
Rows own local layout changes; no global LayoutAnimation or screen remount.
Each bucket owns current-to-next height. Tooltip presence is local opacity, one
latest selected bucket, dismissed on filter/range/outside press. Modal owns picker
entrance/exit, with immediate selected-day fills. Cancel preserves the committed
range/filter. Requests are abortable and generation/session checked; old results
cannot replace a new range or account. Reduce Motion settles geometry immediately
and disables nonessential entrance/reflow. Background/unfocus settles the chart.

## Validation

## Recorded implementation checkpoint

At `129b4fddf6d2c90dd174d78b959a15d53f31d745`:

- PASS: repository typecheck, lint (two existing `_values` warnings in web
  event-service tests), web build, documentation alignment and diff whitespace.
- PASS: complete rerun with `TZ=Europe/London` and disposable localhost database:
  mobile 111 files / 1,035 tests; web 131 files / 899 tests, with one existing
  skipped test; shared 15 files / 246 tests.
- One intervening broad run failed the unrelated CategoryPicker Writing-option
  assertion under concurrent native compilation. Its isolated rerun passed all
  six tests and the complete subsequent run passed. Do not erase this history.
- PASS: disposable PostgreSQL summary and route checks (2 files / 9 tests),
  including shared-workspace users, foreign workspace, overlap, Review exclusion,
  active midnight clipping and fractional category/bucket/Total reconciliation.
  Fixtures used temporary tables inside a rolled-back transaction, not staging or
  production records. The disposable cluster is under `/tmp`, outside the repo.
- PASS: full unsigned Simulator and signed physical-device-target Staging builds.
  Built-app and signed-app configuration checks passed. Signed bundle identity:
  `com.layereight.dayframe.staging`, build 1. Compilation/signing is not installation
  or physical acceptance; later source corrections require a refreshed bundle.
- PASS: exact Ready Preview `https://dayframe-l1nvxibso-dayframeworkshop.vercel.app`
  rejects anonymous summary POST with 401 `session_cookie_missing`; `/reports`
  redirects to login and no console warning/error was captured on the public page.
- NOT RUN: authenticated desktop/phone Reports browser checks (staging sign-in
  required), stable-alias promotion, installed STAGING badge/runtime API checks,
  simulator motion recording, physical iPhone acceptance and device performance.
- Independent review attempt: OpenClaw invoked Claude Sonnet against the full
  Revision 2 plan and frozen head, but the parent 600-second deadline expired
  before a verdict. This is not an approval or completed review.

Follow-up corrections cover the stale API coverage bullet, outside-chart tooltip
dismissal, zero-to-populated centre fade, filter draft universe refresh, preserved
idle clock behaviour and coalesced same-range fetches. The PR records final-head
revalidation and the fresh independent review result; earlier checkpoints do not
substitute for them. Revision 1 approvals are historical only.

## Owner acceptance still required before merge

Independent OpenClaw → Claude Sonnet review of `732cc9e` returned REQUEST CHANGES:
the idle clock could truncate up to 59 seconds immediately after Stop, DST tests
could silently skip outside London, and the filter/calendar sheets lacked direct
interaction coverage. The follow-up keeps the exact clock while a cached active
contribution still needs replacement, makes London DST assertions unconditional
and self-contained (also run from `TZ=UTC`), and tests actual sheet taps, tri-state,
search, zero Apply, reverse/same-day selection, future/366-day limits and dismissal.
The filter now uses its selected fill for subset/none; category numbers can wrap.
A stale non-active running row cannot replace an aggregate contribution. These
changes require another frozen-head independent review; its verdict belongs in
the PR evidence, not an assumed approval here.

Recurring guardrail: test optimistic Stop with non-zero seconds while aggregate
refresh is deferred. Compare exact bucket sums, not rounded duration labels.

Use the exact Ready Preview promoted to the stable staging alias and a freshly
signed staging app with verified bundle, App Groups, STAGING badge and baked API.
Check Today/Week/Month/Year; inclusive/reversed/same-day custom ranges and 366-day
limit; all/some/none and unavailable categories; overlap/running timer; >8 rows;
hour/day/week/month tooltips, zero bars and DST; Light/Dark/System; default, large
and MAX Dynamic Type; VoiceOver; normal and Reduce Motion; warm/offline/resume and
account replacement. Measure representative Year and many-category interactions.
Then check timer Start/Stop/Switch/Edit/Delete/Undo, Today categories/tags, Calendar,
one safe Review action, Health, Location, Settings and reconnect. Record each as
PASS/FAIL/NOT RUN with exact device/build/SHA. No production configuration or data,
no automatic merge, and no claim that signing/unit tests prove device behaviour.
