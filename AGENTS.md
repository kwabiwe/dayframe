# Dayframe Agent Rules

## Project Overview

Dayframe is a personal time-intelligence app. It combines fast manual task tracking with iOS mobile capture from HealthKit, geofences, shortcuts/NFC-style actions, and offline event sync.

The core invariant is **event-first tracking**: mobile/web/health/location signals become `activity_events` before they become `time_entries`. High-confidence explicit actions may create entries immediately. Ambiguous signals should become `review_items`.

Use `docs/PRD.md` for product direction, `docs/architecture.md` for runtime/data ownership, and `docs/feature-fix-tracker.md` for current shipped/watch/decision state before deciding what is next. Use `docs/documentation-governance.md` to resolve conflicting guidance and `docs/vercel-supabase-hosting.md` for hosted auth/deployment context. Dated files under `docs/investigations/` are evidence/history, not current product or delivery state.

## Tech Stack

- Monorepo: npm workspaces.
- Web: Next.js App Router, React, TypeScript, Tailwind CSS, route handlers.
- Mobile: Expo Router and React Native with targeted Swift/SwiftUI native modules for iOS-specific interaction surfaces, plus HealthKit and Expo Location/Task Manager.
- Shared: Zod schemas, palette/theme constants, event normalization.
- Database: Postgres/PostGIS via `pg`; separate Supabase Postgres/Auth projects for hosted staging and production.
- Tests: Vitest plus TypeScript checks.

## Commands

Setup:

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env
npm run db:up
npm run db:setup
```

Development:

```bash
npm run dev:web
npm run dev:mobile
npm run ios
```

Validation:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:docs
```

Database/export:

```bash
npm run export:workspace -- ./dayframe-backup.json
```

## Repository Structure

- `apps/web`: Next.js web UI and API routes.
- `apps/web/src/lib`: database, auth, session, queries, event processing, formatting, exports.
- `apps/web/src/components`: dashboard, timer, timeline/review, reports, entity forms, shell UI.
- `apps/mobile`: Expo iOS app, routes, native config, mobile UI.
- `apps/mobile/src/lib`: API client, offline queue, geofence, HealthKit, deep links.
- `packages/shared`: Zod schemas, shared types, palette, event normalization.
- `packages/db`: local Postgres/PostGIS migration, seed/setup/import/export scripts.
- `packages/location-quality`: local location scoring harness against a private Google Timeline answer key (inputs and outputs stay outside Git).
- `supabase/migrations`: hosted Supabase-only RLS/security migrations.
- `docs`: PRD, hosting, production readiness, regression checklist.

## Architecture Rules

- Preserve the event-first model. Do not bypass `activity_events` for new signal sources.
- Preserve category/task-first UX. Users track a title/description with an optional category and user-facing tags; projects/clients are legacy/internal compatibility until explicitly reintroduced.
- Log automatically only when the evidence is clear. Two kinds are live, both user settings: Stays at saved places with Log automatically on (PRD D17), and Moves between known places with a clear mode while the user's Log trips automatically is on (default on; PRD D19). Later location v4 kinds (for example trips with an unknown end) are not built and are on hold; nothing is built but switched off. Unknown places, unclear trips and trips with a stop become Review items, asked as a "?" in Calendar › List (list-first: there is no Review page or screen since location v4 step 15; the Review API routes and the iPhone Review outbox stay, because the List's answers use them). Trips are titled Commute (Home ↔ Work), Trip (with a stop) or Getting around, never by a mode; a trip with a stop of 3–10 minutes suggests the Errands activity when the workspace has it (from 10 minutes an unknown place is its own Stay). Names the user types become suggestions, never rules.
- A timer that ran into a trip (`location_timer_trip_clash`) asks on its own block, never as an ordinary "?" row, and counts only while that block is loaded. The server check is gated by `DAYFRAME_TIMER_TRIP_CHECKS`: on for the Vercel Preview (staging) scope only; production stays off until the owner decides. Clashes past the bootstrap cap come through the Review presentation read's `timerTripClash` field behind the `timer-trip-clash` feature header.
- Keep web and mobile API contracts compatible. Mobile relies on `/api/bootstrap`, `/api/time-entries`, `/api/events`, and bearer app sessions.
- Maintain workspace/user scoping on all data access. API routes must resolve a `RequestSession` before reading or writing workspace data.
- Provider auth uses Supabase Auth for identity and Dayframe app sessions for web/mobile API access. Do not replace the app session token flow without updating mobile.
- Keep integration/ingest tokens separate from user app sessions.
- Treat health and precise location data as sensitive. Avoid logging raw payloads, do not send them to analytics, and preserve export/delete paths.
- Do not add legacy third-party timer-brand wording, imports, scripts, docs, env vars, or hidden integration hooks. Dayframe stands on its own.
- Any user-facing feature with navigation, presentation, gestures, layout changes, feedback, Undo, or other visible movement must follow `.codex/reference/motion.md`. Motion is part of the feature contract, not optional polish.
- Anything that runs often (clocks and per-second state, looping animation, background capture, per-sample or per-pass storage work, sync and recovery passes, bootstrap or network frequency) must stay within `.codex/reference/performance.md`'s budgets: Today in front ≤ 10 % of a core on the iPhone 17, background near idle, memory slope ≤ 2 MB per minute, no per-frame Reanimated commits for looping motion, no unbounded journal reads. Fill the PR template's "Performance impact" section, and take the release-gate reading before every TestFlight upload.

## Web Patterns

- API routes live under `apps/web/src/app/api/**/route.ts`.
- Page-level session checks should use `resolvePageSession()` or `getOptionalPageSession()`.
- API/session checks should use `resolveRequestSession()`.
- Database queries should use typed rows with `query<T>()` or `pool.connect()` transactions.
- User-facing source labels should go through formatting helpers; do not expose raw strings like `manual_app` in UI.
- Use palette keys from `packages/shared`; avoid arbitrary hex color pickers.
- For frontend changes, preserve the current Dayframe Midnight Core visual system: midnight-navy dark canvas, designed light companion, restrained rounded surfaces, coral for the primary action and live recording, unchanged colour logo artwork, accessible semantic tokens, and compact productivity UI. Surfaces migrated to the approved Dayframe Blocks direction follow its section in `docs/brand-style-guide.md`; do not mix Blocks and earlier treatments inside one surface.
- Dayframe keyboard focus styling is neutral grey throughout the web UI. Use the shared neutral focus/control-border treatment for fields, buttons, links, compound controls, icon actions, menus and options; never use blue `info`/accent colours for focus. Keep selected/active/accent state independent, and preserve a separate danger cue on invalid focused fields.
- Icons (owner decision UIA-212, option c): anything that stands for a Dayframe thing or action — navigation, activities, start/stop, pin, edit, delete, places, tags, Review, export — draws its glyph from the shared registry (`DayframeIcon`, `packages/shared` glyphs); `lucide-react` stays allowed for generic controls (close, chevrons, check, add, search, show/hide, theme). `apps/web/src/components/iconRule.contract.test.ts` guards it.
- All floating UI surfaces must be mobile-safe. Popovers, dropdowns, menus, modals, profile panels, workspace switchers, help panels, search palettes, and notification panels must fit within phone viewports without horizontal overflow.
- On narrow screens, desktop popovers should become centered dialogs, full-width sheets, or bottom sheets with `max-width: calc(100vw - 24px)`, `max-height`, internal scrolling, visible close controls, and 44px minimum touch targets.
- Account management and logout must be reachable on mobile wherever they are reachable on desktop.
- List-first on the web (location v4 step 15): no Review page, nav entry or G then R. Old `/review` links redirect to Calendar › List (`check=<id>` opens that "?", `check=first` today's first); the Calendar nav always opens today. Do not add Review page copy; say unclear items are asked in Calendar.

## Mobile Patterns

- Mobile session tokens live in Expo SecureStore.
- General offline event capture goes through the queue in `apps/mobile/src/lib/api.ts`. Health capture first commits its backend/workspace/user-owned source journal in `apps/mobile/src/lib/healthSyncStore.ts`, then hands the immutable event to that queue without changing its ID or payload. Location timeline corrections (place and trip sheets) use their own durable account-owned queue (`src/lib/timelineCorrectionOutbox.ts`) and show on the List at once; "?" answers use the Review outbox (`src/lib/reviewSyncStore.ts`).
- Mobile connectivity has one process-wide NetInfo owner and one root presentation/VoiceOver owner. Each primary tab places the same fixed 44-point icon slot immediately after the shared Dayframe wordmark, so state changes never move the header. The slot shows only confirmed offline (a neutral cloud-slash) and, for about two seconds after a live return from confirmed offline, "back online" (a neutral cloud-check); otherwise it is visually empty and it is never a button. Saving and syncing stay silent: no sync arrows and no "synced" check, whatever is waiting or retrying. Permanent timer Stop or time-entry Edit/Delete rejection badges the account avatar on every primary tab; while the badge shows, the avatar opens Settings > Sync help, and a new rejection is announced once to VoiceOver. A permanently rejected Stop must restore server timer truth and expose owned Retry/Discard controls. Never replace durable queues, clear pending work, infer completion from reachability/pass outcome, or disable an offline-capable action solely because reachability reports offline. Project only retryable queued Start/Edit/Delete/Stop work over every cached or fetched Dashboard bootstrap. Validate network transitions, layout and timer convergence on a physical iPhone; Simulator and unit results are not device evidence.
- Already-started durable timer Start/Switch/Stop/Edit/Delete delivery may hold one shared finite iOS background assertion only while immediate timer work is transmitting. Native code owns the UIKit identifier and exact-once expiry cleanup; logout, account replacement, cancellation, settlement and teardown release it without deleting queued work. This is best-effort process time, not guaranteed connectivity or force-quit completion. Review, Location Intelligence and ordinary bootstrap remain foreground-owned.
- Apple Health background sync (`modules/dayframe-health-background`, `src/lib/healthBackgroundSync.ts`): an iOS HealthKit delivery or background app refresh wake holds its own finite background window only until one bounded Health pass (capped capture, then `eventScope: "health"` upload of Health events only) finishes, 25 s at most. It never sends other queued work, reprocesses Review or reloads the Dashboard; those stay foreground-owned. See `.codex/reference/health-review-pipeline.md`.
- Never hold a file or SQLite lock in the App Group container while iOS can suspend the process: iOS kills it with 0xDEAD10CC (TestFlight 124, 22 Oct 2026). Native file locks go only through `DayframeSharedFileLock` (a granted finite background assertion around a bounded wait; an expiry releases the lock before the assertion ends); while locked, do only file I/O, never UserDefaults, bridge calls or network. Reads of atomically written shared files take no lock. Keep SQLite databases in the app's own container. `sharedContainerLock.contract.test.ts` guards it.
- Do not use React Native's `Settings` module: once loaded, its `RCTSettingsManager` serialises every standard `UserDefaults` default to JS on every write, on the writing thread. Mirror values natively (as `DayframeShortcutCatalogStore.set` does) and write only when the value changes.
- Geofence tasks must remain defined at module top level.
- Departure/arrival accuracy bursts (card K, `src/lib/location/accuracyBurst.ts`) are a local-only 14-day trial (days 0–6 on, 7–13 off) with a kill switch: a day's measured best-accuracy time over 20 minutes, or two failed restores, turns it off for good and Sync help says why. A relaunch never resumes a burst; check background energy near idle across a relaunch during a burst on the TestFlight build.
- HealthKit access is iOS native-build only; do not assume Expo Go can exercise it.
- Keep `EXPO_PUBLIC_DAYFRAME_API_BASE` configurable for hosted Vercel, simulator, and physical iPhone testing.
- When changing sync behavior, test both direct timer actions and queued event sync.
- The mobile dashboard should stay focused on the primary flow: logo/header, active timer, start task, quick category actions, and Today summary.
- List-first (location v4 step 15): the iPhone has no Review screen or card deck. Every "?" is answered in Calendar › List (its row, its place or trip sheet), and every way in — "N to check", Today's chip and hatched ribbon blocks, the evening reminder, Grid "?" blocks and old `dayframe://review…` links (`app/+native-intent.tsx`) — goes through the Dashboard's one check request. The Calendar badge is a count only: the tab always opens today (`openCalendarToday`, PRD D23). Do not add a Review route, nav entry or "waits in Review" copy; say unclear items are asked in Calendar. A timer-into-trip question asks on its block (`asksOnItsBlock` in `src/lib/review.ts`), never as its own row, Grid block or Today span.
- Timer mutations on mobile should feel immediate. Do not show spinners or progress bars for normal start, stop, edit, delete, or suggestion-apply actions; update the UI optimistically and reconcile in the background. Keep visible spinners for deliberate pull-to-refresh only.
- The mobile Play orb: a tap with nothing running starts one bare block and opens the entry sheet; a tap while a timer is running stops it. Press and hold opens the bloom; releasing on an activity starts it (or switches the running block to it) without opening the sheet, and releasing on the activity already running opens its editor instead. The orb never starts a duplicate timer. Suggestions still enrich the running entry inside the entry sheet.
- iOS surfaces should follow the current fill-led design language: use canvas/surface/inset contrast, circular icon actions, pill text actions, compact divider-based lists, and avoid outline-heavy rounded rectangles unless the relevant reference doc says otherwise.
- Before implementing any feature with navigation, presentation, gestures, list reflow, feedback, Undo, or other visible movement, read `.codex/reference/motion.md` and define its motion contract. The trigger, single animation owner, entrance/update/exit states, surrounding layout, interruption, async rollback, and Reduce Motion path must be explicit.
- Targeted native iOS views must preserve the existing React Native ownership boundary: React owns authenticated bootstrap data, mutations, routing, and sheets; Swift receives a serializable presentation model and emits semantic user actions. Native views must not call Dayframe APIs or maintain a second timer/data store.
- For Calendar zoom, use one native gesture/scroll owner for the whole timeline. A SwiftUI surface may wrap `UIScrollView` through `UIViewRepresentable` when that is required for continuous focal-point-preserving zoom; do not hand off from a temporary visual scale to a separately rebuilt React layout on gesture release.
- Location and HealthKit permission flows belong in onboarding and Settings, not on the dashboard. Surface friendly, actionable permission states instead of raw native errors.
- Logout/account controls belong under profile/account management, not as primary dashboard chrome.

## Database Patterns

- Local schema history lives in the ordered files under `packages/db/migrations`; setup applies every SQL migration in filename order before seed data.
- Hosted Supabase security/RLS additions live in `supabase/migrations`.
- Tables with user data should include `workspace_id`; most event/entry tables also include `user_id`.
- Use transactions when an operation writes events plus derived entries/review items.
- Use PostGIS/geography fields for geofence centers.
- Add indexes for workspace-scoped time, event, review, and active timer queries.
- Before deploying hosted auth/timer/event changes, verify all required Supabase migrations have run against the hosted database.

## Product Scope Rules

- Personal productivity tracker first; no team/billing workflows unless explicitly requested.
- MVP is iOS-only.
- Non-iOS mobile support is out of scope and should not be added, documented, or configured unless explicitly requested.
- HealthKit MVP includes sleep and workout/walking summaries.
- Monetization is out of scope.
- Light/dark/theming is polish, not a reason to destabilize core tracking.

## Validation Expectations

- Always run the narrowest relevant checks after changes; for broad changes run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:docs
```

- For mobile/native changes, also run the mobile typecheck and, when feasible, an iOS simulator build.
- For Swift/SwiftUI native-view changes, reinstall CocoaPods/autolinked modules as needed, run a full native iOS build, and validate multi-touch or background behaviour on a physical iPhone when the simulator cannot reproduce it.
- For timer/auth/sync changes, add or run regression coverage for web start, web stop, mobile start, mobile stop, active timer refresh, completed entry persistence, and queued event sync.
- For UI changes, validate in a browser at desktop and mobile widths and check for console/runtime overlays.
- For mobile UI/timer changes, read `docs/feature-fix-tracker.md`, `docs/brand-style-guide.md`, `.codex/reference/components.md`, `.codex/reference/style.md`, and `.codex/reference/validation-matrix.md` before implementation. Record any conflict between old docs and current tracker state in the PR instead of silently choosing one.
- For features that introduce or change movement, also read `.codex/reference/motion.md`. Validate the complete transition rather than only its trigger: entrance, state/layout update, exit, cancellation, rapid repeat, timeout/Undo/failure rollback where applicable, and the Reduce Motion path.
- For app chrome, account, workspace, navigation, settings, or floating-surface changes, explicitly test mobile overlay behavior at phone widths. Do not treat a generic responsive pass as sufficient.
- For auth/deployment changes, verify `DAYFRAME_AUTH_MODE=dev`, `local`, and `provider` code paths where practical.
- For hosted deployment changes, verify the Supabase schema has all columns/indexes used by the deployed code before smoke-testing Vercel.
- Every implementation PR receives a Vercel Preview backed by the staging Supabase project. Never use production credentials or production data for PR testing.
- Before merge, promote the selected Ready Preview to `dayframe-staging.vercel.app`, apply required migrations to staging, and complete the relevant browser/mobile smoke checks. The stable alias does not move automatically between PRs.
- Mobile `preview` builds must use `https://dayframe-staging.vercel.app` with `com.layereight.dayframe.staging`; production/TestFlight builds must use `https://dayframe-web.vercel.app` with `com.layereight.dayframe`. Their App Groups, Keychain groups, URL schemes, Live Activity extensions, and on-device state are isolated. Verify the signed identities and shared-container hand-off before treating a staging build as device evidence.
- Merge only after automated checks and hands-on staging validation pass. After merge, verify the production Vercel deployment and apply production migrations in the documented safe order.
- Do not claim scripts passed if they were not run.
- Before diagnosing screenshots or production regressions, use `.codex/reference/debugging-playbook.md` to verify build, deployment, schema, and runtime state before changing code.
- When a bug exposes a missing recurring guardrail, update the relevant `.codex/reference/` doc or investigation note as part of the fix.
- Before every PR, classify documentation impact using `docs/documentation-governance.md`. Update the canonical source in the same PR or state why no documentation change is needed; do not leave merged work marked `In progress` in the tracker.

## Important Files

- `docs/PRD.md`: product requirements and MVP scope.
- `docs/architecture.md`: canonical runtime, data, authentication, mobile ownership, and deployment boundaries.
- `docs/documentation-governance.md`: canonical document ownership and pre-PR documentation impact gate.
- `docs/brand-style-guide.md`: canonical logo usage, Midnight Core tokens, typography, component states, charts, and accessibility.
- `docs/vercel-supabase-hosting.md`: staging/production hosting, auth, Preview and alias-promotion runbook.
- `docs/dayframe-regression-checklist.md`: feature checklist to avoid regressions.
- `.codex/reference/product-model.md`: category/task-first product rules.
- `.codex/reference/mobile-permissions.md`: iOS permission state rules.
- `.codex/reference/database.md`: schema, RLS, and hosted migration checks.
- `.codex/reference/debugging-playbook.md`: screenshot/regression investigation workflow.
- `.codex/reference/motion.md`: canonical motion ownership, continuity, accessibility, and PR evidence requirements.
- `.codex/reference/performance.md`: CPU, memory and render budgets, the device measurement method, automated guards and the release gate.
- `.codex/reference/health-review-pipeline.md`: HealthKit import, Review, auto-log, and diagnostics flow.
- `.codex/reference/release-and-testflight.md`: TestFlight, Vercel, Supabase, and runtime version checks.
- `.codex/reference/validation-matrix.md`: feature-specific validation commands and manual checks.
- `.codex/reference/process-improvement.md`: lightweight self-review and guardrail update loop.
- `docs/investigations/`: active issue notes, evidence trails, and closure criteria.
- `packages/shared/src/index.ts`: schemas, event types, palette, normalization.
- `apps/web/src/lib/event-service.ts`: event processing into entries/review.
- `apps/web/src/lib/ingest-auth.ts`: request/session/token resolution.
- `apps/web/src/lib/auth/supabase.ts`: hosted Supabase Auth adapter.
- `apps/mobile/src/lib/api.ts`: mobile auth, queue, timer sync.
- `apps/mobile/src/lib/geofence.ts`: iOS geofence capture.
- `apps/mobile/src/lib/health.ts`: HealthKit sleep and workout imports.
- `packages/db/migrations/001_init.sql`: base schema.
- `supabase/migrations/202607020001_dayframe_rls.sql`: hosted RLS policies.

## Git And Artifacts

- Do not stage generated QA screenshots such as `.codex-dayframe-*.png` unless explicitly requested.
- Do not commit secrets, real Supabase keys, session tokens, location exports, or HealthKit payload dumps.
- Be careful with existing untracked `.codex/` files; they may be local workflow artifacts.
