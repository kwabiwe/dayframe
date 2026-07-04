# Dayframe

Dayframe is a first working version of a customizable time intelligence product. It combines fast task tracking with an Expo iOS app that can capture manual actions, quick actions, NFC/Shortcut-style events, geofence events and unknown stays.

The core rule is event-first: every signal becomes an `activity_events` row before it can become a `time_entries` row. High-confidence explicit actions can create entries immediately. Ambiguous signals go to `review_items`.

## Monorepo

- `apps/web`: Next.js App Router, TypeScript, Tailwind, Postgres-backed API routes and operational UI.
- `apps/mobile`: Expo Router React Native app, TypeScript, iOS prebuild, offline event queue, quick actions, geofence/deep-link hooks.
- `packages/shared`: Zod schemas, shared types, event normalization and timer state-machine tests.
- `packages/db`: Postgres/PostGIS migration, seed data and setup script.

## Requirements

- Node.js and npm.
- Docker Desktop for local Postgres/PostGIS.
- Xcode for iOS. This workspace was verified with Xcode 26.5 at `/Applications/Xcode.app/Contents/Developer`.
- CocoaPods for native iOS dependencies. `npm run ios:prebuild` installed it through Homebrew on this machine.

## Setup

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:setup
```

Run the web app:

```bash
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000).

Run the mobile app:

```bash
npm run dev:mobile
```

For iOS simulator/native Xcode work:

```bash
npm run ios:prebuild
npm run ios:xcode
npm run ios
```

`npm run ios` is the safest local simulator path because it builds, installs and opens the app with the correct Metro development URL. If you want to use Xcode directly, run `npm run ios:xcode` instead of opening the workspace by hand; the helper starts Metro before opening Xcode. A Debug build launched without Metro shows React Native's "No script URL provided" red screen because there is no embedded JavaScript bundle in Debug.

`apps/mobile/ios/Dayframe.xcworkspace` is generated and ready for Xcode. The helper script prints the active Xcode developer directory and version before opening the workspace/project.

For a physical iPhone, set `EXPO_PUBLIC_DAYFRAME_API_BASE` in `apps/mobile/.env` to your Mac's LAN URL instead of `localhost`.

## Demo Data

Seed data is fictional and generic:

- Workspaces: Personal, Freelance Studio.
- Categories: Work, Admin, Personal, Health, Family, Learning, Rest, Travel, Client Work.
- Legacy clients/projects remain in seed data only for compatibility and migration testing.
- Tags: billable, manual, automated, needs-review, nfc, geofence, health, calendar.
- Places: Home, Office, Gym, School, Town Centre, Coffee Shop.
- Rules: Gym and School create suggestions, Town Centre creates review, NFC Start Chores starts a timer.

## Design System

Dayframe uses an industrial productivity visual system: mono typography, flat surfaces, 1px borders, tabular timer numerals and lime as the primary brand accent. The app supports light and dark modes with semantic tokens for background, surface, muted surface, border, primary/secondary text, accent, success, warning and danger. Theme mode defaults to the browser/device system setting. Web users can override it in Settings with System, Light or Dark; no theme picker is shown in the main header.

The approved entity/chart palette is shared from `packages/shared` and uses palette keys instead of arbitrary user-selected hex values:

`lime`, `teal`, `sky`, `blue`, `violet`, `rose`, `amber`, `orange`, `red`, `steel`, `moss`, `graphite`.

Categories and tags are created with a swatch selector on web. Legacy clients/projects can still be created for compatibility and migration testing. The API normalizes submitted colors to approved palette keys, and legacy seeded hex values are still resolved into approved colors for compatibility. New seed data stores palette keys directly.

Charts use the same palette resolver on web and mobile. If a report/source/place does not have a stored color, Dayframe cycles through the palette deterministically from the row name so chart colors remain stable. The dashboard time-spent chart and mobile activity summary both render circular donut charts. Web reports use animated bar widths and category-aware timeline marks. The mobile activity summary uses `react-native-svg` to render a donut chart split by category.

Motion is intentionally restrained: panels ease in, buttons show press feedback, timer state color changes are immediate, report bars animate their widths, and the mobile donut draws once when the summary period first appears.

## Time Review Views

The web Timeline page has three Dayframe review modes:

- Calendar: a week/day grid with time blocks placed by start and stop time, daily totals and category color accents.
- List: a chronological, grouped list of entries with filters for category, tag, source, confidence and review state. Entries can be edited, continued or deleted inline.
- Timesheet: a weekly table grouped by category/activity, with days as columns, cell totals and weekly totals.

The selected review mode is stored locally in the browser. Calendar drag and resize are not implemented in v1; click/inspect and List editing are the current editing path.

## Event Flow

1. Web, mobile, NFC, Shortcut, geofence, calendar and health signals post to `/api/events`.
2. The API inserts `activity_events`.
3. `packages/shared` normalizes the event into a candidate activity.
4. Explicit starts close the previous active timer and create a new `time_entries` row.
5. Broad geofences, Home, unknown stays and calendar hints create `review_items`.
6. Review actions can accept, ignore once, always ignore a source, or create a rule.

## API Routes

- `GET /api/bootstrap`: app bootstrap data for web/mobile.
- `POST /api/events`: event-first signal ingestion.
- `POST /api/time-entries`: start, stop or create manual entries.
- `PATCH /api/time-entries/:id`: edit an entry.
- `DELETE /api/time-entries/:id`: delete an entry.
- `POST /api/entities`: create categories, tags, places, rules and legacy compatibility entities.
- `POST /api/review/:id`: accept, ignore or create a rule from a review item.
- `GET /api/export?kind=workspace_json`: workspace backup JSON.
- `GET /api/export?kind=time_entries_csv`: time-entry CSV export.

## Production Readiness Foundations

This repo now has explicit local-dev auth/session configuration, scoped ingest-token foundations, geofence exit handling and HealthKit sleep/workout adapters for native iOS builds. See [docs/production-readiness.md](docs/production-readiness.md) for setup, scope and remaining work.

For DB-backed local login/signup sessions, use `DAYFRAME_AUTH_MODE=local` and see [docs/local-auth-and-hosting-plan.md](docs/local-auth-and-hosting-plan.md).

For hosted Vercel/Supabase setup, use `DAYFRAME_AUTH_MODE=provider` and see [docs/vercel-supabase-hosting.md](docs/vercel-supabase-hosting.md).

Useful commands:

```bash
npm run export:workspace -- ./dayframe-backup.json
```

## Privacy Model

- Raw event payloads are stored in `activity_events.raw_payload`.
- Known places and processed stays are modeled separately from raw samples.
- Places include `raw_location_retention_days`, seeded to 7 days.
- Home does not auto-start by default.
- Broad places create review items unless the user defines a rule.
- The schema is prepared for Supabase-style row-level security with workspace/user ownership columns, but RLS policies are not enabled in v1.
- Account export and deletion are design notes for the next phase: export should include entries, events, review history, places, rules and integrations; deletion should hard-delete user/workspace data and clear raw payloads.

## Verification

```bash
npm run typecheck
npm test
npm run build -w @dayframe/web
cd apps/mobile && npx expo install --check
```

Database:

```bash
npm run db:up
npm run db:setup
```

Mobile-to-web sync path:

1. Start the web app on port 3000.
2. Start the Expo app.
3. Tap a quick action in mobile.
4. The mobile queue posts to `/api/events`.
5. The web dashboard/timeline picks up the new active or stopped timer without a manual refresh.

## Known Limitations

- No billing or team management.
- Review split/merge and saved-place correction flows are documented but not fully implemented.
- Calendar drag/drop and resize are not implemented yet; use the List view to edit start and stop times.
- HealthKit sleep and workout imports are implemented behind a native iOS adapter; they require a development build/device and still route through activity events/review.
- NFC is represented as an event/deep-link pathway; full native NFC scanning should be added with a development build.
- Local demo auth uses fixed demo user/workspace IDs.
- Docker Desktop must be running before `npm run db:up`.
