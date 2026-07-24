# Web Calendar Readability And Start Again

Date: 2026-07-24

Branch: `codex/web-calendar-readability-restart`

Base: `a7e8ba81a638ca4aa68d8a6c27dde5a2aabc56e3` (`origin/main`, merged PR #102)

Status: Ready for draft review

## Scope

This focused PR owns Calendar-block readability, density, running contrast, safe
interaction semantics, Start again, compact entry details, and the minimum-height
policy for direct resize.

It does not group Timeline List entries, redesign Reports filters, broaden Search,
change the persistent timer strip, touch mobile source, add a migration, deploy, or
merge.

## PDF Findings

The Calendar annotation in `DF web 2.pdf` shows short blocks whose labels disappear
or clip and asks for a simple Play action on hover. The useful product hierarchy is:

1. task title;
2. duration;
3. category or place context;
4. tags.

Category colour remains an accent rail/data cue. Readable text uses the Midnight
Core semantic foreground rather than the raw category colour.

## Current-Main Reproduction

The exact base was built with `npm run build -w @dayframe/web` and run with
`DAYFRAME_AUTH_MODE=dev` against the disposable local PostGIS database
`dayframe_calendar_readability_qa_test`. No existing or hosted data was altered.

Fixtures covered 5, 8, 10, 15, 20, 30, 45, and 60 minutes; three hours; a running
entry; a cross-midnight continuation; Uncategorized; a 120+ character description;
a long category; a long place; and six long tags.

At 1-hour zoom:

- 5, 8, 10, and 15-minute entries were inflated to 18px and showed no text;
- the 20-minute entry was 21px and showed no text;
- the 30-minute entry was 32px and showed only the title;
- the 45-minute entry was 48px but attempted title, context, and duration, visibly
  clipping the content;
- every completed block exposed both resize buttons, including 18px blocks;
- the block was a `role="button"` wrapper containing those buttons;
- the running block used whole-block `opacity: 0.72`;
- selecting a tiny block at 390px exposed no details or action;
- the document stayed 390px wide while Calendar correctly owned internal
  horizontal scroll.

At 30-minute zoom, the 15-minute entry was 23px and still blank while the 20-minute
entry reached 31px and gained a title. At 15-minute zoom, the 5 and 8-minute entries
were both 32px but remained blank because the duration threshold overrode available
rendered height.

The base DOM contained 11 `role="button"` elements with descendant buttons. Resize
controls were in normal Tab order despite having no keyboard resize implementation.

## Root Causes

1. Duration-first thresholds hid titles even when a rendered block could fit a line.
2. Block padding and two 12px resize hit areas consumed the same vertical space as
   short-block content.
3. The running treatment reduced opacity on the entire block.
4. Selection/edit lived on an interactive wrapper while descendant buttons owned
   resize.
5. Inflated minimum-height blocks could visually cover the next chronological block.

## Final Readability Contract

Density now derives primarily from the rendered block height:

| Rendered height | Inline content/actions |
| --- | --- |
| 18–23px | one title line; no duration, metadata, Play, or direct resize |
| 24–33px | one title line with short-block spacing |
| 34–39px | title, then duration |
| 40–47px | title, duration, and hover/focus/selected Play; no direct resize |
| 48–57px | title, duration, Play, and direct resize |
| 58–77px | add category/place context |
| 78px+ | add tags where present |

The minimum block height remains the larger of 18px and one 15-minute zoom unit.
Greedy visual collision lanes split only the width of rendered overlaps, preventing
minimum-height blocks from covering one another without changing their time
position.

At 1-hour zoom the 5/8/10/15-minute entries are 18px and retain titles; the 20-minute
entry is 21px and retains its title; 30/45/60-minute and multi-hour entries
progressively add duration, context, and tags. At 30-minute and 15-minute zoom the
same entries recompute from their new rendered heights rather than carrying a
duration-based stale density.

## Final Interaction Semantics

- A positioned `article` owns layout and visual state but is not interactive.
- One sibling primary button owns selection, details, accessible naming, keyboard
  focus, and desktop double-click Edit.
- Enter on the primary button opens the details/action surface and focuses its first
  action. Space performs the primary button selection.
- A separate inline Play button exists only on completed blocks at least 40px high.
  It appears on hover, keyboard focus, or persistent selection.
- Tiny and short blocks use the same details surface for Start again and Edit rather
  than placing multiple controls inside the block.
- Pointer-only resize handles are non-interactive `span` siblings. They never enter
  the Tab order and mount only for blocks at least 48px high.
- Escape closes details and restores primary-button focus without reopening the
  surface. Only one details surface is present.
- Zoom changes recompute density and re-anchor an open details surface without
  changing Timeline URL state.

## Details, Keyboard, And Touch

The single portalled details surface shows the full title, date, clipped day time
range, clipped duration, category, optional place, tags, continuation status,
Running state, Start again, and Edit.

Desktop positions it within 12px of the viewport and above or below its anchor.
At 640px and below it becomes a fixed bottom surface, 12px from each edge, with
internal scrolling and 44px actions. The inline Play button is absent for
hoverless/touch layouts. Selecting a block at 390x844 exposed a 366px-wide action
surface from `left: 12px` to `right: 12px` without document overflow.

Keyboard verification covered primary focus, Enter, Start again focus, Escape,
focus restoration, and the absence of resize handles from Tab order. Screen-reader
names use `Start [task title] again`.

## Start Again Architecture

`AppShellRuntime` now exposes `startEntryAgain(entry)`. It:

1. refuses to replace an existing active timer;
2. rejects a meaningless entry with neither description nor category;
3. copies only category, trimmed description, and tags;
4. delegates exactly once to the existing `startTimer`;
5. inherits the shell mutation gate, optimistic persistent-timer update, refresh,
   structured-auth handling, and rollback.

Timeline List and Calendar both call this shared function. Neither owns an API
client, mutation queue, active-entry store, or direct POST.

A delayed 1.4-second proxy test sent a rapid double activation. The UI immediately
showed the optimistic timer and disabled both action routes; the trace contained
exactly one `POST /api/time-entries`, and the database gained exactly one row.
An active-timer attempt preserved the running task and returned:
`A timer is already running. Stop it before starting another task.`

With the server unavailable, the shell returned to its exact idle snapshot and
showed `Unable to start right now. Check your connection and try again.` No entry
was persisted.

## Running, Focus, Selection, And Resize

- Running text keeps computed opacity `1`.
- Running uses a dashed non-colour boundary plus an explicit Running label; it has
  no Start again action.
- Hover uses restrained elevation without focus styling.
- Keyboard focus uses the shared focus colour and a 2px offset.
- Selection uses the accent outline and persists the details/action surface.
- When focus and selection coincide, focus owns the one visible outline.
- Resizing elevates the block, suppresses Play/details, preserves the 6px drag
  threshold, and clears its draft on cancel/failure.
- Continuation edges retain square clipped corners and expose text explaining
  whether the entry comes from the previous day or continues into the next.

Direct resize is available only from 48px rendered height and only on a real visible
edge. A manual production-build drag extended the 60-minute fixture to 75 minutes,
persisted exactly once, and was then restored in the disposable database. Smaller
entries remain editable from the action surface.

## Contrast And Long Content

System, Light, and Dark were inspected with every category fixture. Text continues
to use `var(--foreground)` on a restrained colour-mixed surface; category colour is
an inset rail, not the text colour. Running adds a label/boundary rather than relying
on colour. Focus and selection use semantic tokens.

The long fixture displayed a safely truncated block title and, in details, the full
description, long category, long place, and all six tags. Its floating surface
remained within the 1440x900 viewport. No fixture created document-level horizontal
overflow or a framework runtime overlay.

## Motion Contract

- Trigger: hover, focus, selection, Enter, Escape/dismissal, resize drag, async
  success, and async failure.
- Owner: `CalendarReview` owns the one details surface and anchor; the existing
  pointer-capture path owns resize; `AppShellRuntime` owns timer mutation.
- Entrance/update/exit: details use restrained 140ms opacity/translation; block
  state updates in place without changing Calendar geometry.
- Interruption: a new target replaces the prior target; leave uses a short bridge
  so pointer travel into the surface does not dismiss it; rapid mutation is gated.
- Async rollback: failed timer start restores the runtime snapshot; failed resize
  clears the draft and leaves persisted time unchanged.
- Reduce Motion: translation is removed and surface cleanup becomes immediate while
  state, focus, error, and action semantics remain available.

## Files Changed

- `apps/web/src/components/TimeReviewViews.tsx`
- `apps/web/src/components/AppShellRuntime.tsx`
- `apps/web/src/components/EntriesTable.tsx`
- `apps/web/src/components/calendarReadabilityRestart.contract.test.ts`
- `apps/web/src/components/persistentTimerShell.contract.test.ts`
- `apps/web/src/lib/time-block-display.ts`
- `apps/web/src/lib/time-block-display.test.ts`
- `apps/web/src/lib/timer-runtime.ts`
- `apps/web/src/lib/timer-runtime.test.ts`
- `apps/web/src/app/globals.css`
- `.codex/reference/components.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- this investigation

## CSS Consolidated

The owning Calendar rules now replace duration-first child selectors, whole-block
running opacity, short Calendar resize overrides, and the late
`[aria-pressed]` wrapper override. Primary content, state outlines, inline Play,
pointer resize handles, anchored details, phone details, and Reduce Motion each have
one scoped owner. No timer-strip, Reports, Search, or grouped-list CSS was changed.

## Database, API, And Mobile Impact

There is no schema or Supabase migration. QA mutations used only the disposable
database and the 12-entry fixture set was restored after each mutation pass.

The authenticated `POST /api/time-entries` contract is unchanged. The shared
runtime still sends category, description, and tags. Place/project/client remain
outside the timer contract. No mobile source or bearer-session contract changed;
mobile typecheck and its full test suite remain green.

## Automated Validation

- `npm run lint`: passed.
- `npm run typecheck`: passed for mobile, web, and shared.
- `npm run test`: 105 files and 741 tests passed:
  - mobile: 33 files, 237 tests;
  - web: 66 files, 410 tests;
  - shared: 5 files, 94 tests.
- Focused Calendar/runtime set: 4 files, 23 tests passed.
- `npm run build`: optimized Next.js build passed with 26 generated route entries.
- `npm run lint -w @dayframe/web`: passed.
- `npm run typecheck -w @dayframe/web`: passed.
- `npm run test -w @dayframe/web`: 66 files and 410 tests passed.
- `npm run build -w @dayframe/web`: optimized Next.js build passed.
- `npm run typecheck -w @dayframe/shared`: passed.
- `npm run test -w @dayframe/shared`: 5 files and 94 tests passed.
- `npm run test -w @dayframe/mobile`: 33 files, 237 tests passed.
- `npm run typecheck -w @dayframe/mobile`: passed.
- `npm run check:brand-assets`: passed.
- `git diff --check`: passed.

## Optimized Browser Matrix

The final optimized build was checked at 1440x900, 1280x720, 1024x768, 768x1024,
390x844, and a 720x450 CSS-viewport equivalent for 200% desktop zoom. All six sizes
were repeated in System, Light, and Dark.

- The document width always equalled the viewport width.
- At narrower widths only Calendar's intentional internal scroller exceeded its
  client width (`980px` content inside 876/620/350/680px clients).
- All 12 fixtures rendered once and exposed titles.
- Running opacity remained `1`.
- No nested control or focusable resize handle remained.
- The 390px details surface stayed within 12px edges with two 44px actions.
- Direct URL and hard refresh reconstructed the selected date/scope/view.
- Zoom remained local and did not change the URL.
- All three Calendar zooms recomputed title-first density and action/resize
  thresholds. An open 45-minute entry kept one details surface, which re-anchored
  after zoom.
- A delayed 1.4-second Start again accepted one rapid activation, produced one
  optimistic timer and exactly one POST/row.
- Offline, 403, and 500 simulations rolled back to idle, retained the Timeline, and
  re-enabled actions without raw errors or unexpected logout.
- A structured 401 followed the existing replacement path; local dev auth then
  normalized `/login` back to `/`, so provider Preview remains a manual check.
- Dashboard/Timeline navigation, Back/Forward, refresh, and a second browser tab
  retained or reconciled the shell-owned timer state.
- Desktop double-click opened one existing Edit dialog. A direct 60-to-75-minute
  resize persisted once and was restored in the disposable database.
- Browser console errors and Next.js runtime overlays: zero after a clean reload.

Screenshots are under `tmp/calendar-readability-qa/` and remain untracked.

## First Review

Compared directly with the PDF and acceptance list.

Fixed now:

- Escape focus restoration initially reopened details; a one-frame focus suppression
  now returns focus while keeping the surface closed.
- One conflict error was rendered in two Calendar locations; the details alert is
  now the single Calendar owner.
- Raw offline `Failed to fetch` copy was replaced with calm connection guidance.
- Minimum-height collisions were still capable of covering a following block; visual
  lanes now preserve both labels.
- Zoom could move an anchor without re-running details positioning; zoom is now part
  of the position layout key.

Intentionally different:

- Direct resize is unavailable below 48px instead of shrinking two handles into a
  tiny block. Edit remains available.
- Tiny blocks keep one title line because the tested 18px minimum can render it; the
  full details route remains available if content is truncated.

Deferred:

- repeated-entry grouping to the grouped Timeline List PR;
- Reports filter popovers to the Reports overlay PR;
- historical Search to the Search PR.

## Second Independent Review

Reviewed the final diff as another developer, including the state/outline matrix,
semantics, timer ownership, CSS cascade, continuation math, failure paths, and
fixture screenshots.

Fixed now:

- Pointer-only resize controls were still represented as hidden buttons. They are
  now non-interactive spans, removing blank accessible controls entirely.
- An open details surface needed an explicit zoom re-anchor dependency; this was
  added and covered by the contract test.

Verified with no further code finding:

- title-first degradation and no half-lines;
- normal-opacity Running plus a non-colour label/boundary;
- inline Play reserves right padding and is absent on short/touch blocks;
- keyboard and touch routes do not require hover;
- focus and selection have one distinct outline owner;
- Start again and resize are separate siblings with no event nesting;
- one rapid action produces one mutation;
- active timers are not replaced;
- no Timeline URL, timer-strip layout, List grouping, Reports, or Search drift;
- new CSS changes the existing Calendar owners rather than adding a late override
  patch.

## Deferred Items

- grouped Timeline List;
- Reports filter popovers;
- global historical Search;
- timer-strip layout;
- Dashboard redesign;
- new Calendar views;
- project/client UI.

## Limitations And Manual Checks Before Merge

- The in-app browser used a 720x450 CSS viewport as the 200% zoom equivalent; repeat
  once with actual browser zoom.
- Reduced Motion is guarded in source/CSS and contract tests; repeat with the OS
  preference enabled.
- Repeat real hardware mouse hover to confirm the pointer bridge from block to
  details, because the browser automation backend cannot reliably expose CSS
  `:hover`.
- Repeat with VoiceOver/NVDA to confirm dialog announcement and focus order.
- Repeat the 390px action path on a touch device and confirm internal Calendar
  horizontal scroll feels natural.
- In a hosted provider-auth Preview, verify a real expired structured 401 redirects
  once; local coverage uses the existing structured-auth tests and disposable
  response simulation.

## Rollback

There is no data rollback. Revert the focused PR to restore the preceding Calendar
markup, density rules, CSS, runtime continuation helper, and documentation.
