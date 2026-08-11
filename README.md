# Dayframe

Dayframe is a personal time-intelligence app with a Next.js web interface and an Expo iOS app. It combines fast manual tracking with privacy-conscious HealthKit, location, Shortcuts/App Intent, and offline capture.

The core invariant is event-first tracking: newly captured signals become `activity_events` before they derive `time_entries`. Explicit actions and separately approved high-confidence automation may create entries immediately; ambiguous signals become `review_items`.

## Start here

- Product intent: [`docs/PRD.md`](docs/PRD.md)
- Runtime and data ownership: [`docs/architecture.md`](docs/architecture.md)
- Current shipped/watch/decision state: [`docs/feature-fix-tracker.md`](docs/feature-fix-tracker.md)
- Documentation ownership: [`docs/documentation-governance.md`](docs/documentation-governance.md)
- Brand and UI system: [`docs/brand-style-guide.md`](docs/brand-style-guide.md)
- Hosted deployment: [`docs/vercel-supabase-hosting.md`](docs/vercel-supabase-hosting.md)
- Regression contract: [`docs/dayframe-regression-checklist.md`](docs/dayframe-regression-checklist.md)

Dated files under `docs/investigations/` are evidence/history, not current product or delivery state.

## Repository

- `apps/web`: Next.js App Router UI and authenticated API routes.
- `apps/mobile`: Expo Router iOS app, offline stores, HealthKit/location adapters, and targeted native modules.
- `packages/shared`: shared schemas, normalization, palette/theme, timer, tag, time-interval, and Location V2 contracts.
- `packages/db`: ordered local Postgres/PostGIS migrations, seed, setup, and export scripts.
- `supabase/migrations`: ordered hosted Supabase migrations and RLS/security additions.

Exact dependency versions live in the package manifests and lockfile; documentation should not duplicate a “current version” snapshot.

## Requirements

- Node.js and npm compatible with the checked-in lockfile.
- Docker Desktop for local Postgres/PostGIS.
- Full Xcode plus CocoaPods for native iOS work.
- A physical iPhone for HealthKit, background location, App Intent/Live Activity, signed entitlement, and direct-manipulation acceptance checks.

## Local setup

Next.js loads environment files from `apps/web`; the repository-level template is a reference for CLI/local-service variables and is not loaded automatically by the workspace command.

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env
npm run db:up
npm run db:setup
```

Start web and mobile development:

```bash
npm run dev:web
npm run dev:mobile
```

Open web at [http://localhost:3000](http://localhost:3000). For iOS simulator/native work:

```bash
npm run ios:prebuild
npm run ios:xcode
npm run ios
```

`npm run ios` builds, installs, and launches against Metro. For a physical iPhone talking to the local Mac, set `EXPO_PUBLIC_DAYFRAME_API_BASE` in `apps/mobile/.env` to the Mac's LAN URL rather than `localhost`.

Local auth modes and first-user setup are documented in [`docs/local-auth-and-hosting-plan.md`](docs/local-auth-and-hosting-plan.md). Hosted provider auth is documented in [`docs/vercel-supabase-hosting.md`](docs/vercel-supabase-hosting.md).

## Current product surfaces

Web includes:

- one persistent shell-owned timer shared by Dashboard and Timeline;
- Calendar, List, and Timesheet Timeline views;
- Calendar click-to-create, eligible pointer resize, and the shared compact entry editor;
- grouped List editing, intentional-overlap handling, deletion with Undo, reports, search, Review, Categories, Tags, Places, Settings, and export;
- Supabase provider auth with Dayframe app sessions and workspace/user scoping.

iOS includes:

- Today, native Calendar, and Reports tabs;
- optimistic start/stop/edit/delete and shared time-entry sheets;
- offline activity-event fallback and a separate durable Review outbox;
- HealthKit sleep/workout import;
- geofence and Location V2 evidence capture;
- Apple Shortcuts/App Intents, Live Activity, and cross-device timer reconciliation.

Native SwiftUI/UIKit surfaces receive serializable presentation state from React Native and emit semantic actions. React remains the owner of authentication, bootstrap data, routing, API mutations, timer truth, offline reconciliation, and sheets.

## Design system

Dayframe uses Midnight Core: a midnight-navy dark canvas, a designed neutral light companion, restrained fill-led surfaces, coral primary/active states, system typography, and neutral-grey web focus.

Category identity uses the shared 30-colour palette and stable storage keys in `packages/shared/src/palette.ts`. Picker presentation is separate from deterministic fallback order. Tags are user-facing metadata, not category colours, and projects/clients remain legacy compatibility data rather than primary UX.

Motion is part of the feature contract. Navigation, sheets, gestures, layout reflow, status feedback, Undo, and failure rollback follow [`.codex/reference/motion.md`](.codex/reference/motion.md).

## Data, privacy, and rollout

- Web/mobile app APIs require Dayframe sessions; integration tokens are separate and scoped.
- Health and precise location data must not be sent to analytics or ordinary logs.
- Exact Location V2 evidence is user-owned, retained temporarily, exported/deletable, and summarized without coordinates in `activity_events`.
- General event capture, offline Review mutations, and Location V2 evidence use separate durable owners.
- Location V2 supports `v1`, `v2_shadow`, `v2_review`, and narrow `v2_enabled`; the checked-in fallback remains `v2_shadow`.
- Full account/workspace deletion and backup-retention semantics are not complete. See the decision register in the feature tracker.

Production retention and Live Activity retries use protected Vercel cron routes. Staging and production lane details live in the hosting runbook.

## API entry points

Primary authenticated routes include:

- `GET /api/bootstrap`
- `POST /api/events`
- `POST /api/time-entries`
- `PATCH|DELETE /api/time-entries/:id`
- `POST /api/review/:id`
- `POST|DELETE /api/location/evidence`
- `GET /api/review/:id/location-evidence`
- `GET /api/export`

The read-only private integration API is documented in [`docs/integration-api.md`](docs/integration-api.md).

## Validation

For broad changes:

```bash
npm run check:docs
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:brand-assets
git diff --check
```

Use [`.codex/reference/validation-matrix.md`](.codex/reference/validation-matrix.md) to select focused database, SQLite, web, native build, staging, and physical-device checks. Do not treat simulator/source tests as proof of physical HealthKit, location, Live Activity, keyboard, or gesture behavior.

## Known product decisions

The feature tracker holds the active decision register. Current decisions include the production Location V2 mode, automation-accuracy measurement, full deletion/retention semantics, a separate staging iOS identity, native NFC beyond Shortcuts, and wider beta/App Store criteria.
