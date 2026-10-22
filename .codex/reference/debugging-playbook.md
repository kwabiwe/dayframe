# Debugging Playbook

Use this before touching code for screenshots, bug reports, regressions, and confusing production behaviour.

## First Response

1. Restate the observed symptom in concrete terms.
2. Identify the affected surface: web, API, mobile, TestFlight, HealthKit, geofence, database, or deployment.
3. Check the running version before judging the bug:
   - mobile app version and build number
   - mobile `EXPO_PUBLIC_DAYFRAME_API_BASE`
   - latest merged commit on `main`
   - Vercel production deployment commit
   - relevant Supabase migration state
4. Read `AGENTS.md`, the relevant `.codex/reference/*` docs, and any active investigation note.
5. Inspect the relevant code path before forming a fix.

Do not start implementation until the real user/API/data flow has been traced.

## Evidence Ladder

Prefer evidence in this order:

1. User screenshot, screen recording, or exact UI text.
2. In-app diagnostics or debug export.
3. Vercel request logs and structured server logs.
4. Database rows for the affected workspace/user, with sensitive values minimized.
5. Local reproduction with fixtures or a seeded database.
6. Unit/integration tests that encode the failing path.

If evidence is missing, add safe diagnostics before guessing. Health and location payloads must stay local/debug-only and out of commits.

## Hypothesis Rules

For non-trivial issues, write down at least two plausible causes before changing code. For each hypothesis, record:

- what would prove it
- what would disprove it
- which log, DB query, test, or export checks it

Do not stop at the first plausible explanation if another layer could still be broken. Dayframe often has mobile, API, database, and deployment state involved at the same time.

## Common Dayframe Failure Classes

- Mobile build contains a fix but production API does not.
- Production API contains a fix but TestFlight build does not.
- Supabase schema is behind the deployed code.
- Review item is no longer open but still visible due to query or mobile filtering.
- Auto-log is blocked by overlap, stale open timer, disabled preference, threshold, invalid time, duplicate event, or DB lock contention.
- Manual confirm fails due to expected validation but returns an unstructured error.
- Sleep stages are treated as separate time entries instead of one sleep session.
- Local simulator passes but physical iPhone HealthKit data has a different shape.
- JavaScript contains a native-view fix but the installed iOS binary predates the Swift/module change, or CocoaPods/autolinking did not include the updated module.
- A hybrid Calendar bug appears visual but is actually a stale prop/event contract, a recreated hosting controller, or competing React Native and native scroll/gesture owners.
- A web style looks dropped but the local Next dev server is still serving the stylesheet compiled before a `globals.css` edit (same chunk URL and size). Restart the dev server and compare the rule against a fresh `npm run build` before diagnosing a bundling defect.
- An iPhone Review card the server resolved days ago still shows, or its action lands in Sync help as `resolution_conflict`: compare the phone's Sync help export with production `review_items` (status, `ignored_scope`, notes) before suspecting the network. Location replay supersedes open items continuously; the phone must evict what reads no longer list and settle 409/404 for moments decided elsewhere (investigation 2026-10-12).
- A CSS declaration reads a custom property that does not exist (`var(--text)` instead of `--text-primary`): with no fallback the whole declaration drops out at computed-value time, so a fill or outline silently disappears while other properties still apply (the Calendar drag ghost showed only its label, 13–14 Oct 2026). `cssCustomProperties.contract.test.ts` fails on any undefined `var()` without a fallback; check the computed style in a real browser (`getComputedStyle`) when something renders invisibly.
- A button that changes its `type` in its own click handler (`type={active ? "button" : "submit"}`) can submit its form after a real click: React re-renders between the click listeners and the browser's default action, so a Stop button that becomes a submit Start re-starts the timer (web timer bar, 1 Sep–13 Oct 2026: every Stop created a junk block ~100 ms later, visible in `activity_events` as a `web-timer-stop:` followed by a `timer_start` with no client id). Keep such buttons `type="button"` and submit explicitly (`form.requestSubmit()`). jsdom runs the default action before React re-renders, so it cannot reproduce this; guard the invariant in tests and confirm with a real click in a browser.
- A server-rendered client component reads the clock (`new Date()`, `Date.now()`) during render, so a running timer's derived values differ between the server HTML and hydration. Render from the server's `renderedAt` until hydrated (`useHydrationSafeNow`) and cover it with a hydrate-later DOM test.
- A server-rendered client component formats a browser-local date or clock time (`formatTime`, `formatDate`, `Intl.DateTimeFormat` without a fixed `timeZone`). Vercel renders in UTC, so the text differs from the browser's first render (React #418, `args[]=text`), as Reports' block rows did. Gate that text on `useIsHydrated()` and cover it with a `renderToString` + `hydrateRoot` DOM test. To find the text in production, fetch the page HTML and diff its text nodes against the live DOM.
- The same applies to anything derived from local days or hours, not just text: `getHours`/`getDate`/`setHours(0…)` day boundaries, which entries fall on a day, block `top`/`height`, "is today" classes and totals. React does not patch mismatched attributes or styles in production, so a block positioned in UTC can stay misplaced after hydration even without a #418. Keep the server render and hydration pass identical (draw the frame; add positioned content after `useIsHydrated()`), as Calendar and List do. Test it near midnight with different zones on each side: render under `process.env.TZ = "UTC"` and hydrate under `"Europe/London"`, re-importing the modules for each side (`vi.resetModules()` and dynamic `import()` of react, react-dom and the component) because module-level `Intl.DateTimeFormat`s keep the zone they were created in; also assert the server HTML is identical under both zones (`timelineHydrationTimeZone.dom.test.tsx`).
- Server-side day maths (report buckets, a default date) must use the viewer's zone, not the process's: read it with `getViewerTimeZone()` / `viewerTimeZoneForRequest()` (the `dayframe_tz` cookie, validated, UTC fallback) and turn date keys into instants with `zonedStartOfDay` (`zonedWallHour` for an hour of the day). Code shared with the iPhone (the bootstrap) takes the zone only when the cookie was sent (`getViewerTimeZoneIfSent()` / `viewerTimeZoneIfSentForRequest()`), so mobile behaviour never changes. Reproduce locally with `TZ=UTC npm run dev:web` and a browser in another zone, between local midnight and the UTC offset.
- An iPhone crash report with termination `RUNNINGBOARD` code `0xdead10cc` (3735883980) means iOS suspended the app while it held a file or SQLite lock in the App Group container. Find the thread inside a lock (TestFlight 124: the `turbomodulemanager` queue in `DayframeNativeShortcutQueue.pendingDictionaries`, which held its `flock` through `UserDefaults.removeObject` → `RCTSettingsManager.userDefaultsDidChange` → `convertIdToFollyDynamic` of every default). Build-matched symbols need the archive's dSYM; without one, map the app-binary offsets by call shape (a TurboModule method → NSLock closure → lock closure → UserDefaults). Every native lock must go through `DayframeSharedFileLock` (AGENTS.md Mobile Patterns).
- An iPhone freeze with no hang report: ask for Sync help › "Copy details for support" from the same iPhone. Its `freezes` section lists every pause of 3 s or more while Dayframe was in front (main or JS thread, start time, length, `recovered` or `left` — `left` means the person left Dayframe during it, as a force-close does — and the labelled JS tasks then running), and MetricKit's hang, crash, CPU and disk-write reports (summaries, plus the newest three in full; Apple delivers these up to a day later). A JS-thread pause with main still answering means taps were dropped by a busy JS thread; a main-thread pause is native.

## Before A Fix Branch

1. Confirm the working tree and branch.
2. Pull latest `main`.
3. Create a focused branch named for the root cause or investigation.
4. Keep screenshots, exports, archives, and logs under local untracked QA folders.
5. Create or update an investigation note under `docs/investigations/` for the active issue.

## During Implementation

- Keep changes scoped to one root cause.
- Preserve the event-first model.
- Preserve the category/task-first UX.
- Add structured errors for expected failure modes.
- Add tests for the user-visible failed path, not just helper functions.
- Prefer diagnostics and explicit reason fields over silent fallback.

## Completion Gate

Before reporting a fix as done:

1. Show the exact commit, branch, PR, TestFlight build, and Vercel deployment status involved.
2. Run the relevant validation commands from `validation-matrix.md`.
3. Manually validate the same journey the user reported, where feasible.
   - For Calendar pinch/scroll reports, use a physical iPhone and capture repeated zoom-in, zoom-out, pan, entry-tap, and day-change evidence. Simulator screenshots alone cannot close a multi-touch performance issue.
4. Update the investigation note with root cause, fix, evidence, and residual risks.
5. Add one sentence to the relevant reference doc if the bug exposed a missing guardrail.
