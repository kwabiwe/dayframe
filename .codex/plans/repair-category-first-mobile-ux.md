# Feature: Repair Category-First Mobile UX

The following plan should be complete, but validate documentation and codebase patterns before implementation. Work from the updated category-first PRD and guardrails.

## Feature Description

Repair Dayframe's core iOS timer flow and polish mobile/web category-first UX. The pass focuses on confirmed mobile timer starts, immediate mobile theme updates, a dashboard that contains only the daily workflow, compact category controls, web category alignment, stale product wording removal, and real simulator/browser validation.

## User Story

As a Dayframe user, I want to start and stop category-based timers from iOS and web, edit running timer context, and manage categories without cramped admin UI, so that Dayframe feels like a reliable category-first personal time tracker.

## Problem Statement

Mobile timer starts can appear to fail or queue without becoming a confirmed active timer. Theme changes made in Settings do not update already-mounted screens until the app is restarted. The mobile Settings category and sync rows are cramped, and web still presents clients/projects/tags too prominently. Some user-facing strings still mention old project or native health wording.

## Root-Cause Hypotheses

1. Mobile timer start refresh can be skipped because `apps/mobile/app/index.tsx` uses a `refreshInFlight` guard; after `startTimer()` succeeds, `await load()` may return early while a polling/bootstrap refresh is already running, leaving the dashboard in "No timer" until a later poll or reload.
2. Mobile direct timer start can fall back to the offline queue for any transient API/bootstrap failure, but the UI does not make confirmed vs queued state clear enough.
3. Mobile theme state is duplicated in `index.tsx` and `settings.tsx`; Settings writes AsyncStorage but does not notify the dashboard while it remains mounted.
4. Settings clipping comes from `styles.row` using `justifyContent: "space-between"` with a non-wrapping child and a full-size button inside a narrow card.
5. Web category alignment drift is mostly `EntityForms` and route/page naming/copy still centering legacy clients/projects/tags.

## Solution Statement

Create a shared mobile theme context/provider in the root layout, make dashboard and Settings consume the same preference state, force post-mutation bootstrap refreshes after confirmed timer actions, refine mobile dashboard/category/settings layouts, refactor the web "Projects" management surface into category-first copy/forms, remove stale product wording, add focused tests, and validate through CLI plus simulator/browser where available.

## Feature Metadata

**Feature Type**: Bug Fix + UX Refinement
**Estimated Complexity**: High
**Primary Systems Affected**: `apps/mobile`, `apps/web` components/API tests, shared event tests, docs/search hygiene
**Dependencies**: Existing Expo Router, React Native, lucide icons, `@dayframe/shared`, Next.js API routes

---

## Context References

### Relevant Codebase Files

- `AGENTS.md` - Category-first rules, mobile dashboard invariants, validation expectations.
- `docs/PRD.md` - Product source of truth for task/category/timer/review model.
- `docs/dayframe-regression-checklist.md` - P0 timer, mobile dashboard, settings, theme, hosted checks.
- `.codex/reference/style.md` - Mobile dashboard/category chip/layout rules.
- `.codex/reference/components.md` - Expected mobile component patterns.
- `.codex/reference/testing.md` - P0 manual and automated validation checklist.
- `apps/mobile/app/index.tsx` - Dashboard, timer start/stop, active timer editing, Today summary, current duplicated theme state.
- `apps/mobile/app/settings.tsx` - Settings, category management, health/location, current duplicated theme state and clipped sync row.
- `apps/mobile/app/_layout.tsx` - Root layout location for a shared mobile theme provider.
- `apps/mobile/src/lib/api.ts` - Mobile timer/category/sync API calls and offline queue behavior.
- `apps/web/src/app/api/time-entries/route.ts` - Web/mobile timer start/stop API contract.
- `apps/web/src/lib/event-service.ts` - Event-first conversion into `time_entries`, category update/archive/reorder helpers.
- `packages/shared/src/index.ts` - Event normalization, palette, health mapping names.
- `apps/web/src/components/EntityForms.tsx` - Web category/settings management surface with legacy client/project/tag prominence.
- `apps/web/src/app/projects/page.tsx` - Route currently titled Categories but implemented through old projects mode.
- `apps/web/src/components/LandingPage.tsx` and `apps/web/src/app/settings/page.tsx` - Remaining user-facing project/native-health wording.
- `apps/mobile/src/lib/api.test.ts`, `apps/web/src/app/api/time-entries/route.test.ts`, `packages/shared/test/event-engine.test.ts` - Existing test patterns.

### New Files To Create

- `apps/mobile/src/lib/theme.tsx` - Shared mobile theme preference/provider/hook so dashboard and Settings update immediately.

### Relevant Documentation

- No external browsing required. Use local Dayframe docs and existing package APIs.

### Patterns To Follow

- React Native styles are local `StyleSheet.create` functions.
- Mobile API helpers throw `AuthRequiredError` on 401 and keep SecureStore session tokens.
- Category colors use `paletteColorFor` and palette keys, not arbitrary colors.
- Web entity forms use server-backed fetch POST/PATCH/DELETE and `router.refresh()`.
- Commit guidance requires explicit staging, no generated screenshots/env files.

---

## Implementation Plan

### Phase 1: Mobile Theme Foundation

- Create a mobile theme provider in `apps/mobile/src/lib/theme.tsx`.
- Move `ThemePreference`, `MobileTheme`, `THEME_PREFERENCE_KEY`, `createMobileTheme`, AsyncStorage persistence, and `useColorScheme()` resolution into the provider.
- Wrap the Expo Router `Stack` in `MobileThemeProvider` and use resolved theme for stack content/header colors.
- Update `index.tsx` and `settings.tsx` to consume `useMobileTheme()` instead of independent state.

### Phase 2: Mobile Timer And Dashboard Repair

- Update `load()` in `index.tsx` to support forced post-mutation refreshes or wait for in-flight refresh completion so confirmed starts/stops cannot skip bootstrap reload.
- In `beginStart()`, keep separate `starting`/`queued` states, clear task draft only after confirmed backend success, call forced refresh after success, and do not fake an active timer on failed backend start.
- Change empty timer copy to exactly `Start task below`.
- Keep dashboard sections to header, active timer, start task, category chips, Today summary; remove any remaining dashboard sync notice/clutter or keep only non-admin state if needed.
- Replace horizontal chip scroller with wrapping compact color-tinted pills so multiple categories fit per row.
- Make category pill tap start immediately with current task text.
- Ensure active timer editing remains available while running.
- Improve Today zero-state so it shows no misleading `General 100% 0m`.

### Phase 3: Mobile Settings Category/Layout Repair

- Redesign Settings category rows: compact name/color/pin/edit/archive icon row, no `Available`, no up/down sorting arrows.
- Add category color palette selection in edit mode and new category creation.
- Add explicit Save and Cancel actions in edit mode.
- Confirm destructive archive/delete.
- Make pin state visually clear on the row; pinned categories sort first through existing bootstrap ordering.
- Fix Device sync row with wrapping layout and full-width/safe button behavior.
- Keep Apple Health and Location in Settings with friendly copy and one primary Connect Apple Health action.

### Phase 4: Web Category Alignment And Copy Cleanup

- Refactor the old "Projects" management surface into a category-first settings area.
- Keep legacy clients/projects only in a demoted compatibility section if they must remain visible.
- Put category creation/editing first and ensure category color/pin fields remain available on web.
- Update landing/settings copy to say category and Apple Health/Health data.
- Search and remove old branded timer references, project-first copy, and user-facing native health wording where practical without renaming technical functions in this pass.

### Phase 5: Tests And Validation

- Add/adjust tests for forced mobile refresh/start behavior where feasible.
- Add API/event-service tests verifying category-only mobile explicit starts create start candidates and category update supports color/pin.
- Run required commands: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, plus mobile-specific checks.
- Use simulator/browser/manual validation with computer-use or available local tooling. Capture observations in final report; do not stage screenshots.
- Commit using `.codex/prompts/commit.md`.

---

## Step-By-Step Tasks

### CREATE `apps/mobile/src/lib/theme.tsx`

- **IMPLEMENT**: Shared mobile theme provider, `useMobileTheme()`, `ThemePreference`, `MobileTheme`, `setThemePreference`.
- **PATTERN**: Mirror existing `createMobileTheme` tokens from `index.tsx`/`settings.tsx`.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`.

### UPDATE `apps/mobile/app/_layout.tsx`

- **IMPLEMENT**: Wrap `Stack` with `MobileThemeProvider`; use current theme for content/header colors.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`.

### UPDATE `apps/mobile/app/index.tsx`

- **IMPLEMENT**: Consume shared theme; force post-start/post-stop load; clean empty timer copy; compact wrapping category pills; keep active timer edit; Today zero-state.
- **GOTCHA**: Do not display an unconfirmed active timer after direct backend failure.
- **VALIDATE**: `npm run test -w @dayframe/mobile`.

### UPDATE `apps/mobile/app/settings.tsx`

- **IMPLEMENT**: Consume shared theme; compact category rows; color palette edit/create; pin state, edit icon, trash icon, Save/Cancel; remove sort arrows and Available copy; fix Device sync clipping.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`.

### UPDATE web category surfaces

- **IMPLEMENT**: Category-first page/copy/forms; demote legacy compatibility UI; update landing/settings copy.
- **FILES**: `apps/web/src/app/projects/page.tsx`, `apps/web/src/components/EntityForms.tsx`, `apps/web/src/components/LandingPage.tsx`, `apps/web/src/app/settings/page.tsx`.
- **VALIDATE**: `npm run typecheck -w @dayframe/web`.

### UPDATE tests

- **IMPLEMENT**: Add/adjust tests for category-only mobile start/event normalization, category color/pin update payloads, and stale copy where reasonable.
- **VALIDATE**: `npm run test`.

### RUN search hygiene

- **COMMANDS**:
  - `rg -n "Toggl|toggl|TOGGL" . --glob '!apps/mobile/ios/**'`
  - `rg -n "HealthKit|choose the project|Projects|Clients|Project name|Client name|Available|without a category" apps README.md docs packages --glob '!apps/mobile/ios/**'`
- **GOTCHA**: Technical native health function names may remain if not user-facing; final report must distinguish technical from user-facing results.

### RUN full validation and manual QA

- **COMMANDS**: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, mobile-specific test/typecheck.
- **MANUAL**: Open simulator/browser where available; test dashboard, Settings, theme, category create/edit/color/pin/archive/cancel, mobile timer start/stop, web timer start/stop, web/mobile sync, clipped controls.

---

## Testing Strategy

### Unit Tests

- Mobile API tests for category update color/pin and timer payloads.
- Shared event normalization tests for category-only mobile explicit timer starts.
- Web API route tests for category-first timer payloads already exist; extend if contract changes.

### Integration/Manual Tests

- Simulator: dashboard order, compact chips, Settings screen, theme updates, category controls, no clipped Device sync button, start/stop timer.
- Browser: web timer start/stop and category management.

### Edge Cases

- Start while bootstrap refresh is already in flight.
- Start with category only.
- Start with text plus category.
- Play start with text and no visible uncategorized option.
- Failed direct start queues event but does not fake active timer.
- Theme change while dashboard remains mounted behind Settings.
- Narrow phone width Settings rows and buttons.

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run typecheck -w @dayframe/mobile
npm run test -w @dayframe/mobile
rg -n "Toggl|toggl|TOGGL" . --glob '!apps/mobile/ios/**'
```

Manual validation must include the mobile and web flows listed in the user brief.

---

## Acceptance Criteria

- [ ] Mobile category pill starts immediately.
- [ ] Mobile text + category starts with that text.
- [ ] Compact play button starts using current text/category state.
- [ ] Mobile active timer appears only after backend success.
- [ ] Mobile stop works.
- [ ] Web start/stop still works.
- [ ] Web stop reflects on foreground mobile within 2-5 seconds.
- [ ] Theme changes apply immediately on dashboard and Settings and persist.
- [ ] Dashboard contains only header, active timer, start task, category chips, Today summary/chart.
- [ ] Settings controls do not clip off-screen.
- [ ] Category edit includes color, Save, Cancel, clear pin state, and destructive archive confirm.
- [ ] Web leads with categories rather than clients/projects/tags.
- [ ] No relevant branded timer references remain.
- [ ] No user-facing native health framework wording remains.

---

## Notes

- No schema migration is expected. If implementation discovers schema drift, stop and add/update Supabase migration docs/checks before proceeding.
- Keep screenshots out of git.
- Confidence score: 8/10. Highest risk is manual simulator availability and whether hosted/local API state reproduces the mobile start failure.
