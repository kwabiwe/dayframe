# Dayframe Agent Rules

## Project Overview

Dayframe is a category-first personal time tracker. It combines fast task/title/description capture, category-based timers, review/edit workflows, and iOS mobile context from Apple Health, location, shortcuts/NFC-style actions, and offline event sync.

The core invariant is **event-first tracking**: mobile/web/health/location signals become `activity_events` before they become `time_entries`. High-confidence explicit actions may create entries immediately. Ambiguous signals should become `review_items`.

Use `docs/PRD.md` as the product source of truth. Use `docs/vercel-supabase-hosting.md` for hosted auth/deployment context.

## Tech Stack

- Monorepo: npm workspaces.
- Web: Next.js App Router, React, TypeScript, Tailwind CSS, route handlers.
- Mobile: Expo Router, React Native, iOS-first, Apple Health native bridge, Expo Location/Task Manager.
- Shared: Zod schemas, palette/theme constants, event normalization.
- Database: Postgres/PostGIS via `pg`; Supabase Postgres/Auth for hosted production.
- Tests: Vitest plus TypeScript checks.

## Commands

Setup:

```bash
npm install
cp .env.example .env
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
- `apps/mobile/src/lib`: API client, offline queue, geofence, Apple Health import bridge, deep links.
- `packages/shared`: Zod schemas, shared types, palette, event normalization.
- `packages/db`: local Postgres/PostGIS migration, seed/setup/import/export scripts.
- `supabase/migrations`: hosted Supabase-only RLS/security migrations.
- `docs`: PRD, hosting, production readiness, regression checklist.

## Architecture Rules

- Preserve the event-first model. Do not bypass `activity_events` for new signal sources.
- Preserve category-first UX. The normal user-facing model is task/title/description plus category, timer, and review/edit.
- Clients and projects are not normal user-facing concepts. Treat existing client/project data only as legacy compatibility or migration input unless the PRD explicitly reintroduces it.
- Keep automatic behavior conservative. Trusted places may auto-start; broad/unknown/Home-like signals should go to review unless the user has configured a rule.
- Keep web and mobile API contracts compatible. Mobile relies on `/api/bootstrap`, `/api/time-entries`, `/api/events`, and bearer app sessions.
- Maintain workspace/user scoping on all data access. API routes must resolve a `RequestSession` before reading or writing workspace data.
- Provider auth uses Supabase Auth for identity and Dayframe app sessions for web/mobile API access. Do not replace the app session token flow without updating mobile.
- Keep integration/ingest tokens separate from user app sessions.
- Treat health and precise location data as sensitive. Avoid logging raw payloads, do not send them to analytics, and preserve export/delete paths.
- Do not add legacy third-party timer-brand wording, imports, scripts, docs, env vars, or hidden integration hooks. Dayframe stands on its own.

## Web Patterns

- API routes live under `apps/web/src/app/api/**/route.ts`.
- Page-level session checks should use `resolvePageSession()` or `getOptionalPageSession()`.
- API/session checks should use `resolveRequestSession()`.
- Database queries should use typed rows with `query<T>()` or `pool.connect()` transactions.
- User-facing source labels should go through formatting helpers; do not expose raw strings like `manual_app` in UI.
- Use palette keys from `packages/shared`; avoid arbitrary hex color pickers.
- For frontend changes, preserve the current Dayframe visual system: restrained, rounded, pastel logo palette, accessible light/dark tokens, compact productivity UI.
- Use lucide icons where practical.
- All floating UI surfaces must be mobile-safe. Popovers, dropdowns, menus, modals, profile panels, workspace switchers, help panels, search palettes, and notification panels must fit within phone viewports without horizontal overflow.
- On narrow screens, desktop popovers should become centered dialogs, full-width sheets, or bottom sheets with `max-width: calc(100vw - 24px)`, `max-height`, internal scrolling, visible close controls, and 44px minimum touch targets.
- Account management and logout must be reachable on mobile wherever they are reachable on desktop.

## Mobile Patterns

- Mobile session tokens live in Expo SecureStore.
- Offline event capture goes through the queue in `apps/mobile/src/lib/api.ts`.
- Geofence tasks must remain defined at module top level.
- Apple Health access is iOS native-build only; do not assume Expo Go can exercise it.
- Keep `EXPO_PUBLIC_DAYFRAME_API_BASE` configurable for hosted Vercel, simulator, and physical iPhone testing.
- When changing sync behavior, test both direct timer actions and queued event sync.
- The mobile dashboard must stay focused on the daily flow only: header, active timer, start task, compact category chips, and Today chart/summary.
- Settings must be a separate pushed screen from a top-right settings/menu icon.
- Location and Apple Health permission flows belong in onboarding and Settings, not on the dashboard. Surface friendly, actionable permission states instead of raw native errors.
- Mobile category chips must be compact, pill-shaped, color-coded, and safe inside the dashboard width.
- Today chart/summary is a core dashboard element and must not be pushed below settings/configuration content.
- Light/dark/system theme changes must apply immediately across the mobile app.
- Logout/account controls belong under profile/account management, not as primary dashboard chrome.

## Database Patterns

- Local schema lives in `packages/db/migrations/001_init.sql`.
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
- Apple Health MVP includes sleep and workout/walking summaries.
- Monetization is out of scope.
- Light/dark/theming is polish, not a reason to destabilize core tracking.

## Validation Expectations

- Always run the narrowest relevant checks after changes; for broad changes run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

- For mobile/native changes, also run the mobile typecheck and, when feasible, an iOS simulator build.
- For timer/auth/sync changes, add or run regression coverage for web start, web stop, mobile start, mobile stop, web/mobile active timer sync, active timer refresh, completed entry persistence, and queued event sync.
- For UI changes, manually validate in simulator/browser using computer-use where available; lint/typecheck alone is not sufficient. Check desktop and mobile widths and watch for console/runtime overlays.
- For app chrome, account, workspace, navigation, settings, or floating-surface changes, explicitly test mobile overlay behavior at phone widths. Do not treat a generic responsive pass as sufficient.
- For auth/deployment changes, verify `DAYFRAME_AUTH_MODE=dev`, `local`, and `provider` code paths where practical.
- For hosted deployment changes, verify the Supabase schema has all columns/indexes used by the deployed code before smoke-testing Vercel.
- Do not claim scripts passed if they were not run.

## Important Files

- `docs/PRD.md`: product requirements and MVP scope.
- `docs/vercel-supabase-hosting.md`: production hosting/auth runbook.
- `docs/dayframe-regression-checklist.md`: feature checklist to avoid regressions.
- `.codex/reference/product-model.md`: category/task-first product rules.
- `.codex/reference/mobile-permissions.md`: iOS permission state rules.
- `.codex/reference/database.md`: schema, RLS, and hosted migration checks.
- `packages/shared/src/index.ts`: schemas, event types, palette, normalization.
- `apps/web/src/lib/event-service.ts`: event processing into entries/review.
- `apps/web/src/lib/ingest-auth.ts`: request/session/token resolution.
- `apps/web/src/lib/auth/supabase.ts`: hosted Supabase Auth adapter.
- `apps/mobile/src/lib/api.ts`: mobile auth, queue, timer sync.
- `apps/mobile/src/lib/geofence.ts`: iOS geofence capture.
- `apps/mobile/src/lib/health.ts`: Apple Health sleep and workout imports through the native health bridge.
- `packages/db/migrations/001_init.sql`: base schema.
- `supabase/migrations/202607020001_dayframe_rls.sql`: hosted RLS policies.

## Git And Artifacts

- Do not stage generated QA screenshots such as `.codex-dayframe-*.png` unless explicitly requested.
- Do not commit secrets, real Supabase keys, session tokens, location exports, Apple Health payload dumps, generated QA screenshots, or local env files.
- Be careful with existing untracked `.codex/` files; they may be local workflow artifacts.
