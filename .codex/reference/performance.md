# Performance

Canonical budgets and measurement method for Dayframe's CPU, memory and render cost on iPhone, and the guards that keep them. Read it before changing anything that runs often:
- clocks, intervals and per-second state, especially at provider level above the native tabs;
- looping or per-frame animation;
- background capture (location, Motion & Fitness, Health);
- per-sample or per-pass SQLite/AsyncStorage work;
- sync and recovery passes, and bootstrap or network frequency.

Owner decision 14 Oct 2026, after the freeze, memory and CPU investigation (`docs/investigations/2026-10-12-iphone-review-stale-items.md`).

## Budgets

Measured on the owner's iPhone 17 with production data, unless a row says otherwise. Baselines are TestFlight 0.1.0 (119).

| Scenario | Budget | Baseline (119, 14 Oct) |
| --- | --- | --- |
| Today in front, a block running, phone untouched, 5 min | ≤ 10 % of one core | 6.8 % (26.3 s CPU in about 389 s) |
| Memory slope in that window | ≤ 2 MB per minute | about 1.3 MB per minute |
| Background, normal movement, 30 min | ≤ 2 % of one core on average, aiming at idle | 1.8 % (33 s CPU in about 1,812 s) |
| Background CPU per stored location sample | set from the first after-measurement of the location-write batch (#398, #399, #401) | to be counted once that window's evidence is uploaded |
| Long-run footprint | ≤ 500 MB after about 3 hours of normal use | 422–431 MB after about 2.5–3 hours |
| Looping motion (the live block's ring, rolling digits, anything that repeats) | no per-frame view-tree commits: React Native's native driver or Core Animation, never a Reanimated loop | Reanimated per-frame commits were 54–88 % of main-thread time before #392 |
| Location energy (location v4 §10, B9) | all of Dayframe's location work under 2 % of battery a day on average, and under 20 minutes a day at best accuracy | from MetricKit's daily counts in Sync help › Location energy (7-day average) once TestFlight 129 has reported a week; checked against Settings › Battery over the same 7 days |
| Web `/api/timer-state` polling, per tab | 10 s while visible and focused (about 360 an hour), 60 s while visible but not focused (about 60 an hour), none while hidden; one immediate poll on focus, on a return to visibility and after the user's own timer action, never beside one in flight; errors back off 20 → 40 → 80 → 120 s and reset on success; one poll chain per tab | 3 s while visible, about 1,200 an hour per tab, the largest share of staging traffic (before 30 Oct 2026) |
| Per-sample and per-pass storage queries | index lookups only: no full table scans, no unbounded journal reads | retention went from about 37 ms to about 0.7 ms per sample (#398, Mac: one indexed delete and two indexed counts) |

A budget is breached when a measurement made by the method below exceeds it. A PR that knowingly exceeds a budget needs an owner decision recorded in the tracker.

## Measurement method

Activity Monitor CPU totals, not Time Profiler totals. Device Time Profiler recordings over Wi-Fi were cut to about 1.5 s (13 Oct), so they are only for per-thread shape.

1. Build: name the build (TestFlight number, or a Staging build of an exact commit) and whether it ran on production or staging data.
2. Scene:
   - Foreground: Today in front, a block running, phone untouched and unlocked for the whole window. Auto-lock must not end it.
   - Background: Dayframe not opened during the window; using the phone otherwise and moving around is fine.
3. Sample: take an Activity Monitor sample of the Dayframe process at both ends of the window: `xctrace` Activity Monitor template, `cpu-total`, `memory-physical-footprint`, `memory-real` and `idle-wakeups`. `DAYFRAME_DEVICE=<UDID or name> [DAYFRAME_BUNDLE=com.layereight.dayframe.staging] scripts/perf/device-activity-window.sh <seconds>` finds the app's process from its bundle container and does this (the bundle defaults to production). Send no other device commands during the window.
4. Compute: CPU % = 100 × Δ`cpu-total` (seconds) ÷ elapsed seconds between the two printed sample times (for example 100 × 26.3 ÷ 389 ≈ 6.8 %). Memory slope = Δ footprint (MB) ÷ elapsed minutes. After a fresh launch, take a 5-minute warm-up window first and gate on the next one: memory swings in the first minutes.
5. Check the scene held:
   - Foreground: the wakeup rate should match an in-front window (about 180–190 per second on 119), and the phone still unlocked at the end.
   - Background: a falling `memory-real` confirms the app was suspended or compressed.
   - Otherwise repeat the window.
6. Per stored sample (background): divide the background CPU seconds by the location evidence production received for the window. This is a read-only count once the phone has uploaded the window, which happens on its next foreground pass.

The Simulator can compare two builds of the same JavaScript (Debug app, Today in front, a 10 s Time Profiler, sample counts per thread), but it is never device evidence.

## Automated guards

These run in CI, so a regression fails the PR before a device measurement is needed:
- `npm run test`: unit, DOM and real-SQLite tests.
- `npm run validate:location-v2-db`: PostGIS.

| Guard | Where |
| --- | --- |
| The Dashboard re-renders whole seconds only while they are on screen; the live block keeps its own clock | `idleClock.contract.test.ts`, `LiveTimerResume.render.test.tsx` (#384, #390) |
| No clock ticks while backgrounded; the first foreground frame shows the right time | `LiveTimerResume.render.test.tsx` (#377, #384) |
| Looping motion uses the native driver, not Reanimated | `idleClock.contract.test.ts`, `blocksMotion.test.tsx` (#392) |
| Per-sample location retention uses indexes | `store.sqlite.test.ts` query-plan test (#398) |
| A recovery pass's own location evidence never queues another pass | `connectivityRecovery.test.ts` (#383) |
| Location writes do not refresh durable work in the background | `durableLocationRefreshGate.test.ts` (#399) |
| A location pass reloads the Dashboard only when a replay changed something shown (a server without the change count still reloads, deliberately) | `store.sqlite.test.ts`, `validate:location-v2-db` (#401) |
| Render counts: over two minutes the Dashboard renders only at minute boundaries with Today, Calendar or Settings in front (or nothing running), at most once a second with Reports, a running entry's sheet or its Calendar editor open, never in the background; the live block once a second (plus at most two minute-boundary renders over the two minutes), never per frame | `renderBudgets.render.test.tsx` (#405) |
| No per-call `Intl` formatters: dates go through `formatLocaleDate` / `localeDateFormatter`, or a module-level constant | `intlFormatters.contract.test.ts` (#404) |
| Every journal and upload-outbox statement in the location store searches an index, never scans the table | `store.sqlite.test.ts` query-plan guard (#398, #406) |
| An Apple Health wake runs one bounded pass: at most four query pages per kind, capture stopped at 12 s, the pass at 20 s, both from the wake's arrival (native finishes the wake at 25 s), wakes during capture join the pass, and only Health events upload in the background | `healthBackgroundSync.test.ts`, `health.test.ts` page cap, `api.test.ts` Health scope, `DayframeHealthWakeLedgerTests` (`swift test` in the module) |
| The freeze watchdog costs nothing in the background: JS answers native once a second and native probes the main thread only while Dayframe is in front; long JS work is named by a fixed `withJsTask` label (new long JS work adds one) | `stallWatchdog.test.ts`, `jsTasks.test.ts`, `diagnosticsNative.contract.test.ts`, `validate-ios-diagnostics.sh` |
| Accuracy bursts (card K, #619) stay within the location energy budget: on saved-place geofence exits and entries and fresh iOS Visit departures and arrivals, during a 14-day trial (days 0–6 on, 7–13 off); at most 6 bursts and 18 minutes a day at best accuracy, one at a time, a 5-minute cooldown, 3 minutes each, only on the trial's on days, a Visit never taking the day's last one, only for a Visit reported within 10 minutes; stopping capture ends one; the next reading or a timer after 3 minutes restores normal capture, and 5 minutes past them updates stop outright; best accuracy runs only under this process's in-memory lease, and an admission guard on every wake and capture entry lowers inherited best-accuracy options to normal; a day measured past 20 minutes, or a second failed restore, turns the trial off for good | `accuracyBurst.test.ts`, `geofence.test.ts`, `runtime.test.ts` (card K) |
| No synchronous locationd call on main: Location status answers from cached delegate state, `locationServicesEnabled()` runs on a background queue, and a CoreLocation callback appends one journal line off main without waiting for the store | `nativeMainThreadBlocking.contract.test.ts`, `validate-ios-location-signals.sh` |
| Calendar › List requests per trigger: an edit reads at most the 3 weeks and 15 days around the List's top day, the edited blocks' own weeks and days (at most 4 and 8) and 2 empty edge weeks; a scroll or jump reads at most the destination's 3 weeks and 15 days plus 2 passed-over stale empty weeks and 2 place-less days; an edit never retries reads already in flight (a read or first load begun before a mark is read once more only if it settles inside the current window); a running clock and repeated store changes read nothing; the clash reader reads at most once a minute; a stale week or day stays stale until a successful read; iPhone scoped Review items keep their array when unchanged | `calendarListRequestBudget.dom.test.tsx` (web), `calendarListRequestBudget.render.test.tsx` (iPhone) (request-storm fix, 30 Oct 2026; Codex r1 on #634) |
| Web timer-state polling: about 60 polls in 10 focused minutes, about 10 unfocused, none hidden; immediate polls on focus, visibility and once after the user's actions (after the last queued action's own reload, which no poll supersedes; deduped); a superseded, old-workspace or 30 s-stalled action never holds polls off; a poll's reload supersedes other loads only once it succeeds, and a failed one keeps the old fingerprint so the next poll retries; the 20/40/80/120 s backoff and its reset; one chain across rerenders and StrictMode, none after unmount, an account change dropping the answer in flight | `timerStatePolling.runtime.dom.test.tsx`, `calendarDataOwner.runtime.dom.test.tsx` (WEB-UI-4) |
A new hot path adds its guard here in the PR that creates it.

Network reads (request-storm fix, 30 Oct 2026): a view that loads history as it scrolls (Calendar › List and its places) bounds the requests of each trigger, whatever it has loaded: initial loads, then reads only for days not loaded, an edit, a deliberate refresh, a return to the app, or a visit to days marked stale. A refresh never re-reads everything loaded; it reads what is near the view (and what the edit itself touched, capped) and marks the rest stale, to be read when visited, and a mark clears only after a read that started after it succeeds. Rows with no heading (empty weeks, place-less days) get a capped discovery read when scrolled past, and a failed refresh shows its old copy with a quiet out-of-date line and Try again, never silently as current. The bound is per trigger, not per session: revisiting history after a refresh reads it again. A fetch keyed on an object (`useEffect` deps, a refresh key) needs that object to change only when its content does, so a store that re-reads into a fresh array keeps the previous one when nothing changed. Each such view has a fake-timer test that counts fetches by URL over several minutes, scrolls, jumps and re-renders against fixed bounds, and asserts freshness (a changed row shows after its read, a failed read is retried).

## Release gate

Before every TestFlight upload, take the 5-minute Today reading (foreground method above) on a Staging build of the exact release commit. Record it, with its baseline, in `.codex/reference/release-and-testflight.md`. After the TestFlight build is installed, repeat it on production data when the owner can leave the phone untouched. A reading over budget stops the release unless the owner accepts it.

## Pull requests

Every implementation PR fills the template's "Performance impact" section. It applies when the PR touches anything listed at the top of this document:
- Name the budget rows it could affect.
- Name the automated guard that covers it.
- Say whether a device reading was taken, and its numbers.

Otherwise write `Not applicable` with the reason.
