# Intentional time overlaps

## 2026-07-28 product correction

Production evidence showed that raw timestamp intersections of 26.338 seconds
and 636 milliseconds were presented as `Intentional overlap` beside
minute-rounded times. That wording claimed user intent which Dayframe never
stored, and the raw threshold elevated harmless capture jitter into a product
warning.

The corrected contract is deliberately smaller:

- user-facing copy says `Overlap`, never `Intentional overlap`;
- Dayframe detects overlap automatically and adds no user flag or prompt;
- explicit Add, Edit, and Review actions remain permitted;
- an intersection is meaningful at 60 seconds or longer;
- shorter intersections remain in the original timestamps but do not drive
  markers, warnings, Calendar collision layout, reports, or automatic
  Health/location Review decisions.

The shared analyser owns the 60-second boundary. Automatic ingestion SQL uses
the same boundary so hidden pipeline decisions cannot disagree with History or
Calendar. Raw intersections remain available only as underlying timestamp
truth, not as a second user-facing state.

## Decision

Dayframe preserves intentional overlap when a user explicitly adds, edits, or
confirms time. Overlap is a valid time-model state, not a duplicate.

The canonical interval model is half-open: `[start, end)`. Therefore
`09:00–10:00` and `10:00–11:00` touch but do not overlap. A single running
entry uses one captured `now` for the entire analysis. Reversed, zero-duration,
invalid, and duplicate-ID inputs are ignored deterministically.

This decision does not change these safeguards:

- only one active timer;
- `activity_events.client_event_id` idempotency;
- `time_entries.created_from_event_id` source-event reconciliation;
- Health external sample identity;
- location evidence/segment identity;
- Review mutation receipts and request hashes;
- workspace/user scope on every read and write.

Automatic Health and location behavior stays conservative. A signal that
overlaps confirmed time remains Review-first. An explicit Review action may
then preserve it.

## Baseline and constraints

- Branch baseline: merged PR #124 at
  `7ef736659a737b7b4dcf24fae7ab75cf3c55f725`.
- Branch: `feat/intentional-time-overlaps`.
- No schema migration is required.
- No production deploy, Supabase migration application, Vercel change,
  TestFlight build, merge, or release belongs to this branch.
- Health and precise-location payloads remain excluded from UI telemetry,
  diagnostics, screenshots, and logs.

## Repository-wide overlap audit

The pre-change audit searched application, shared, database, migration, script,
test, and reference files for overlap validation, duplicate handling, active
timer constraints, and interval display logic.

### Incorrect blockers removed

1. `apps/web/src/lib/location/location-review-service.ts` called
   `validateNoConfirmedOverlap` before direct Confirm, Edit-and-confirm,
   Record once, Save place and confirm, Split and confirm, and Merge and
   confirm.
2. `apps/web/src/lib/review-mutation-service.ts` called `validateNoOverlap`
   before generic Edit-and-confirm.
3. `apps/mobile/src/lib/reviewSyncStore.ts` classified every overlap `409` as
   permanent. A legacy overlap response now retries; current APIs do not emit
   one for an explicit Review action.
4. `apps/web/src/components/TimeReviewViews.tsx` clamped Calendar resize against
   adjacent entries.
5. Web and native Calendar renderers had no shared collision-layout intent.
   Native blocks used full width and expanded short-block hit regions in ways
   that could obscure a visible neighbour.
6. Reports and goals used only summed durations, making concurrent work
   ambiguous and allowing goals to double-count clock time.

### Overlap checks deliberately retained

- `apps/web/src/lib/event-service.ts`: automatic Health/event decisions.
- `apps/web/src/lib/location/location-ingest-service.ts`: automatic trusted
  place decisions.
- one-active-timer and replacement-window checks.
- unique/source receipt violations mapped to technical duplicate or
  resolution-conflict errors.

### Database audit

`time_entries` has no exclusion constraint or uniqueness rule on time ranges.
The only time-window constraint requires stop after start. Existing
workspace/user indexes remain appropriate for range reads. Technical identity
indexes and receipt constraints remain unchanged. Consequently no local or
hosted migration is required.

## Shared interval analysis

`packages/shared/src/timeIntervals.ts` is the pure cross-platform owner.

Inputs are clipped to an optional range. The implementation sorts deterministic
start/end points and performs one sweep:

- a segment at concurrency `n >= 1` contributes once to covered time;
- it contributes `n` times to logged time;
- a segment at `n >= 2` contributes once to concurrent coverage;
- per-entry overlap windows are the union of its pairwise intersections;
- all outputs are whole seconds and non-negative.

Canonical range metrics:

```text
Total logged = sum of every clipped entry duration
Time covered = union length of all clipped intervals
Additional overlapping activity = max(0, Total logged - Time covered)
Concurrent coverage = union length where concurrency >= 2
```

`Additional overlapping activity` is the activity-duration surplus. It differs
from `Concurrent coverage` when three or more activities run simultaneously.
For example, three one-hour entries on the same hour produce three logged
hours, one covered hour, two additional overlapping hours, and one concurrent
coverage hour.

Per-entry output includes unique overlap seconds, overlap count, stable peer
IDs, first/last overlap boundaries, and maximum concurrency. Input order does
not affect analysis or layout.

## Hybrid Calendar layout

`layoutTimeIntervals()` produces renderer-neutral layout intent:

- `full`: isolated entry, full usable width;
- `insetOverlay`: exactly two colliding entries where one is contained and no
  more than 60% of the containing duration; the shorter entry begins at an 18%
  inset so the base rail remains visible;
- `lane`: partial overlap, similar-sized containment, identical intervals, or
  a collision group of three or more;
- `compactLane`: dense/narrow lane with text suppressed.

Collision groups are transitive. Lanes use deterministic start, end, and ID
ordering, equal width, bounded offsets, explicit z-order, and width-aware text
density. Duplicate IDs are collapsed deterministically before layout.

Web consumes the layout directly in
`apps/web/src/components/TimeReviewViews.tsx`. React computes the native
presentation model in
`apps/mobile/src/lib/nativeCalendarPresentation.ts`; SwiftUI renders it without
network, session, queue, timer, or second-domain-store ownership.

## Save and Review semantics

The following explicit operations permit an overlap:

- web/mobile manual Add;
- web/mobile completed-entry Edit;
- web Calendar resize;
- generic Review Confirm and Edit-and-confirm;
- location Review Confirm, Edit-and-confirm, Record once, Save place and
  confirm, Split and confirm, and Merge and confirm;
- durable offline Review enqueue, retry, replay, and bootstrap reconciliation.

Validation still rejects malformed or non-increasing windows, invalid
references, source duplicates, receipt reuse with different data, already
resolved Review conflicts, and a second active timer.

Location child operations remain transactional. A split or merge creates all
derived entries and resolves the associated Review/segment state together, or
rolls everything back.

## Product presentation

Warnings are advisory and live beside the interval editor. They show the
Overlap state, unique shared duration, count, and up to two named peer entries
with times. The primary Save/Confirm action stays enabled. Semantic warning
theme roles are used in both themes; overlap is never colour-only.

Timeline, History, Calendar, Timesheet, and report detail rows carry compact
overlap markers. Accessible names include duration/count and, where data is
available, the first peer. Boundary-touching entries show no marker.

Reports use these labels consistently:

- **Total logged**: every entry counts in full and may exceed 24 hours/day.
- **Time covered**: distinct clock time, counting concurrent entries once.
- **Additional overlapping activity**: logged surplus above covered time.

Daily/weekly trend data contains logged, covered, and additional-overlap
values. Category allocation and timesheets divide Total logged, so overlapping
activities count in their own categories. Timesheets disclose overlapping days
and add covered time beside logged totals. Daily and weekly goals use covered
time and therefore do not double-count concurrent work.

## Motion contract

- Trigger: add, edit, confirm, resize, delete, day change, or reconciliation
  changes a collision group.
- Owner: shared TypeScript owns final layout; the current renderer owns only
  interpolation and hit testing.
- Entrance/exit: existing list/sheet owners retain their established presence
  behavior.
- Reflow: only horizontal block offset/width changes animate, using a 210 ms
  ease-out. Time-axis position and block height update immediately.
- Surrounding layout: the axis/day column never reflows for a collision.
- Interruption: new derived geometry replaces the old target; no queued
  transition may restore stale layout.
- Async rollback: restoring the prior entry snapshot recomputes the prior
  geometry.
- Reduce Motion: horizontal interpolation is disabled; state remains clear
  through lanes, inset, borders, text density, and labels.
- Day navigation: the existing direction-aware day transition remains the
  single owner.

Native hit testing uses the same bounded horizontal geometry as the visible
block. A short block may retain a minimum vertical target only when that target
cannot cover another colliding entry; compact collisions use visual height so
the intended visible block receives the tap.

## Privacy and observability

The analyzer receives entry IDs and timestamps only. UI presentation may use
already-authorized task/category labels. It introduces no analytics event, raw
Health payload, coordinate, geocoder object, or new log field. Exports continue
to contain the entries themselves; covered/overlap metrics are derived.

## Automated validation matrix

Shared analyzer/layout tests cover empty/single intervals, boundary touch,
containment, partial and chained overlap, identical/dense triples, separated
clusters, running entries, clipping, cross-midnight, UK spring/fall DST days,
invalid/reversed values, duplicate IDs, order stability, layout bounds, text
density, and canonical two-/three-way metrics.

Service/contract tests cover manual create/edit, generic Review
Edit-and-confirm plus receipt persistence, all location explicit-action names
with no overlap validator, legacy mobile overlap retry, automatic
Health/location Review-first behavior, technical duplicate protection, and
one-active-timer behavior.

Presentation tests cover warning computation, markers, report SQL/aggregation,
goal-covered semantics, web layout intent, native serialization, native
layout/hit geometry, model version failure, horizontal-only animation, semantic
warning colors, and Reduce Motion.

## Validation evidence (2026-07-27)

The focused overlap suites passed with 81 web, 69 mobile, and 17 shared tests.
The complete repository run passed lint, typecheck, all 903 tests (483 web,
296 mobile, and 124 shared), the optimized Next.js build, brand-asset checks,
and `git diff --check`.

Disposable local validation used a fresh PostGIS database named
`dayframe_overlap_test`. Base setup/seed, Review mutation receipt validation,
location V2 validation, Review SQLite replay validation, and location SQLite
validation all passed. No hosted database was contacted and no migration was
added or applied.

Browser validation used safely seeded development entries. Timeline and Reports
were exercised without document-level horizontal overflow at 1440, 1280, 1024,
768, and 390 CSS pixels. The seeded day showed 12h 26m logged, 9h 06m covered,
and 3h 20m additional overlapping activity. Contained, lane, and compact-lane
blocks rendered with stable selection; the edit warning named its peer and
left Save enabled. The phone dialog stayed within the viewport. Light and Dark
warning roles were checked, the responsive browser console had no warning or
error entries, and the clean-cache production build passed. System-theme,
200%-zoom, full keyboard traversal, and every explicit Review action remain in
the approval matrix rather than being inferred from automated coverage.

Native validation passed CocoaPods/autolinking, 13 Swift package tests under
the full Xcode toolchain, and a full Debug build for the iPhone 17 Pro Max
simulator. The built `com.layereight.dayframe` app installed successfully on
the booted simulator. The build emitted dependency warnings from React Native,
Expo, maps, SVG, Reanimated, and HealthKit packages, but no Dayframe build
error.

Physical-iPhone validation was **not run**. Xcode listed KB's iPhone as offline,
so gesture, hit-target, VoiceOver, Dynamic Type, Reduce Motion, offline replay,
and real Health/location behavior remain mandatory before approval. A
physical-iPhone result must never be inferred from simulator, unit, screenshot,
or build evidence.

## Manual acceptance matrix

At desktop and phone widths, in System/Light/Dark:

1. create a boundary-touch pair and verify no warning/marker;
2. create a contained pair and verify inset overlay and correct tap target;
3. create partial/similar and three-plus collisions and verify lanes/compact
   labels, stable z-order, and correct selection;
4. save overlaps through Add, Edit, Calendar resize, direct Review Confirm,
   Edit-and-confirm, Record once, Save place, Split, and Merge;
5. enqueue an offline Confirm/Edit-and-confirm, restart, reconnect, and verify
   one durable replay with no duplicate entry;
6. compare Total logged, Time covered, daily/weekly trend, timesheet/category
   language, and covered-time goal progress;
7. repeat Calendar reflow with Reduce Motion and verify immediate horizontal
   updates without vertical interpolation;
8. verify Dynamic Type/200% zoom, VoiceOver/keyboard labels, 44 pt/px controls,
   no horizontal overflow, and no runtime/console overlay.
