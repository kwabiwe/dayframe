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

| No synchronous locationd call on main: Location status answers from cached delegate state, `locationServicesEnabled()` runs on a background queue, and a CoreLocation callback appends one journal line off main without waiting for the store | `nativeMainThreadBlocking.contract.test.ts`, `validate-ios-location-signals.sh` |
A new hot path adds its guard here in the PR that creates it.

## Release gate

Before every TestFlight upload, take the 5-minute Today reading (foreground method above) on a Staging build of the exact release commit. Record it, with its baseline, in `.codex/reference/release-and-testflight.md`. After the TestFlight build is installed, repeat it on production data when the owner can leave the phone untouched. A reading over budget stops the release unless the owner accepts it.

## Pull requests

Every implementation PR fills the template's "Performance impact" section. It applies when the PR touches anything listed at the top of this document:
- Name the budget rows it could affect.
- Name the automated guard that covers it.
- Say whether a device reading was taken, and its numbers.

Otherwise write `Not applicable` with the reason.
