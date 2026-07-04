# Dayframe QA Audit - 2026-07-04

Sources used: `docs/PRD.md`, `docs/dayframe-regression-checklist.md`, `.codex/reference/product-model.md`, `.codex/reference/mobile-permissions.md`, and `.codex/reference/database.md`.

## Scope

This pass covered the web app, local API, Postgres-backed timer flows, and the iOS native app in Simulator through the Computer plugin. The invariant checked throughout was event-first tracking with category/task-first UX and optional categories.

## Feature And Function Checklist

| Area | Result | Evidence |
| --- | --- | --- |
| Web dashboard render | Pass | Browser QA on `http://localhost:3000`, no console/runtime overlays. |
| Web manual timer start | Pass | Started an uncategorized timer from the dashboard. |
| Web manual timer stop | Pass | Stopped active timers and verified completed entries in `/api/bootstrap`. |
| Web active timer detail editing | Fixed + pass | Description/category/place edits are patched before stop. |
| Optional category on web timer | Fixed + pass | Timer controls now include `No category`; start is allowed without category. |
| Optional category in web entry dialogs | Fixed + pass | Manual/edit entry dialogs no longer require category. |
| Timeline/calendar entry editing | Fixed + pass | Calendar edit no longer forces category. |
| Route sweep | Pass | `/`, `/timeline`, `/entries`, `/categories`, `/reports`, `/places`, `/automation`, `/review`, `/settings`. |
| Desktop floating surfaces | Fixed + pass | Search, notifications, profile, help, and workspace menus fit the viewport. |
| Mobile-width floating surfaces | Pass | Same surfaces checked at phone width with no horizontal overflow. |
| API bootstrap | Pass | Repeated shape checks in the 24-pass loop. |
| API time-entry start/stop | Fixed + pass | Web route tests cover categorized and uncategorized starts. |
| Event-first timer contract | Pass | Existing event-service tests plus timer API tests stayed green. |
| Mobile dashboard render | Pass | iOS Simulator rendered logo, active timer, start task, categories, summary, settings. |
| Mobile API bootstrap sync | Pass | After Metro reload, simulator matched local API active timer and seeded categories. |
| Mobile timer stop | Pass | Stopped a web-started timer from iOS; backend reflected no active timer. |
| Mobile timer start | Fixed + pass | Started `QA mobile uncategorized start` from iOS; backend stored `source: mobile_app`, `categoryId: null`. |
| Mobile optional category UI | Fixed + pass | Mobile start picker now has an explicit `No category` option and does not auto-select the first category. |
| Mobile offline queue API | Pass | Mobile API tests cover queued event sync behavior. |
| Location permission surface | Pass, limited | Simulator showed friendly permission state; real geofence background movement was not exercised. |
| HealthKit permission surface | Pass, limited | Native build showed HealthKit actions; real HealthKit samples were not available in Simulator. |
| Export path | Pass | `npm run export:workspace -- /tmp/dayframe-export-*.json` wrote a 25 KB backup; artifact removed and not staged. |
| Expo dependency compatibility | Fixed + pass | `npx expo install --check` now reports dependencies up to date. |
| Production build | Pass | `npm run build` completed successfully. |

## Bugs Found And Fixed

| Bug | Fix |
| --- | --- |
| Stopping an active timer could miss last-second detail edits if the debounce had not flushed. | Web timer stop now patches active entry details before issuing the stop action. |
| Product rules say category is optional, but several web/mobile start and edit flows required or auto-selected a category. | Web and mobile timer/manual/edit flows now support explicit uncategorized entries. |
| Profile floating panel could clip above the desktop viewport. | Added constrained max-height and internal scrolling to floating panels. |
| Expo package versions were behind the installed SDK compatibility set. | Updated Expo package versions and lockfile through `expo install`. |

## 24-Pass Regression Loop

Each pass ran:

- `npm run test -w @dayframe/web -- src/app/api/time-entries/route.test.ts`
- `npm run test -w @dayframe/mobile -- src/lib/api.test.ts`
- `curl http://localhost:3000/api/bootstrap` with JSON shape validation

Result: passes 1 through 24 all completed successfully.

## Final Validation

- `npm run lint` - pass
- `npm run typecheck` - pass
- `npm run test` - pass
- `npm run build` - pass
- `cd apps/mobile && npx expo install --check` - pass

## Notes

- The Browser plugin's `domSnapshot()` helper failed in this environment, so browser QA used evaluated DOM metrics, screenshots, locator actions, and console capture instead.
- The iOS simulator initially showed stale hosted data until Metro was forced to reload. After reload it used the local LAN API and mobile/web sync passed.
- npm reported 10 moderate audit findings during dependency installation. I did not run `npm audit fix --force` because that can introduce broad breaking dependency changes unrelated to this functional QA pass.
