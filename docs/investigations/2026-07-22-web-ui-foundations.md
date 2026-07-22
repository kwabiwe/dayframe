# Web UI Foundations

## Scope

Phase 1 of the Dayframe web overhaul programme only. This change establishes shared web interaction primitives and migrates the explicitly named existing surfaces without redesigning the timer, Dashboard, Reports, Places or Settings. Phase 2 navigation and layout work is out of scope.

Base: `origin/main` at `f036c5c0c9775db923e4b4a98dfa719a7fc5a685`, the merge commit for PR #92.

Branch: `codex/web-ui-foundations`.

## Current-main reproduction

The current app was reproduced in the actual in-app browser from the exact Phase 0 merge base before implementation.

Still present on current main:

- Keyboard focus used the shared purple `#7564E8` outline. Segmented controls retained `overflow: hidden`, so the two-pixel offset outline could be clipped. Several local selectors also added their own focus shadows or outline overrides.
- List table icon actions were 44 by 44 pixels, but the button was laid out as `display: block` with eight pixels of padding. The SVG centres measured 6.5 pixels left of the button centres.
- Entry edit, profile, workspace and other custom overlay scrims used a four-pixel backdrop blur.
- The entry edit dialog left focus on its background trigger, did not close on Escape, did not restore focus and left document scrolling enabled. Profile and workspace panels similarly left focus outside and did not lock scrolling.
- Destructive confirmation had a useful internal initial focus and accessible name/description, but still used the blurred custom scrim, did not lock scrolling and did not share the same interaction owner as other dialogs.

Outdated or partially outdated screenshot evidence:

- At 390 by 844, the current entry edit dialog measured 366 pixels wide and stayed within the viewport.
- At the same viewport, the profile panel measured 366 pixels wide, was internally scrollable and stayed within the viewport.
- The workspace panel measured 366 pixels wide and 350 pixels high and stayed within the viewport.
- Destructive actions already had 44-pixel targets and comparable Cancel/Delete widths. Their remaining defect was behaviour and ownership, not the older size mismatch.

## Root cause

Equivalent controls and overlays had been implemented independently. Global element rules, older Swiss component rules and a late fill-led override layer all competed for focus, padding, radius and button layout. Overlays were div/section compositions rather than a common modal owner, so focus entry, Escape, focus restoration, scroll locking and mobile sizing varied by surface. Icon buttons inherited content-oriented padding instead of using a centred icon-only box.

## Implementation plan

1. Define a small shared primitive layer for buttons, icon buttons, fields, segmented controls, disclosures, settings rows, native modal dialogs and modal popover panels.
2. Establish one semantic focus token and one global two-pixel focus rule, with no secondary glow and no clipping.
3. Migrate only the Phase 1 surfaces: login, edit/manual-entry/start-time forms, entry and tag/category confirmations, profile/workspace/notification panels, search/help, timeline view controls, table icon actions and existing Settings rows.
4. Delete superseded dialog, popover and action CSS instead of appending a competing override section.
5. Validate contracts automatically and run the exact desktop/tablet/phone browser matrix in light, dark, system, keyboard-only and reduced-motion states.

## Architecture and decisions

- `ModalDialog` owns a native HTML `dialog` opened with `showModal()`. The browser supplies the modal top layer and focus containment; the primitive supplies initial focus, Escape cancellation, focus restoration, document scroll lock, accessible labelling and busy-state close protection.
- `PopoverPanel` reuses the same modal behaviour. Existing profile/workspace/notification content and positions remain; this is consistency work, not navigation redesign.
- `IconButton` requires an accessible label and uses a 44-pixel inline grid with zero padding and `line-height: 0`, so table and chrome icons share exact centring.
- `Field`, `TextField` and `SelectField` share 44-pixel controls and 12-pixel horizontal padding. Existing form data, submit handlers and API calls remain unchanged.
- The programme's non-purple focus requirement supersedes the earlier purple focus row in the brand guide. The shared semantic focus token is now blue in both appearances and has a three-to-one non-text contrast guard on relevant surfaces. No current mobile source consumes this shared token.
- The new CSS is located with the foundational global control rules. Superseded Swiss overlay/dialog/action blocks and their late overrides are removed.

## Motion contract

- Trigger: activating an existing search, help, profile, workspace, notification, edit, manual-entry or confirmation trigger.
- Single owner: native `dialog` presentation through `ModalDialog`; no nested custom scrim animation owner.
- Entrance: the modal enters the browser top layer and focus moves to the explicit initial control or first interactive fallback.
- Update: async form state remains owned by the existing feature component; the primitive only blocks unsafe closure while busy.
- Exit: Escape, close, Cancel or permitted backdrop activation unmounts the surface and restores focus to the opener.
- Surrounding layout: document scrolling is locked while at least one modal is open; dialog content owns overflow within the viewport.
- Interruption and rapid repeat: existing AppShell state remains the single source of which panel is open; native top-layer focus containment prevents background interaction.
- Failure and rollback: existing feature error states remain visible; destructive confirmations do not close while their mutation is pending.
- Reduce Motion: no new entrance or exit animation is introduced; the disclosure chevron transition is disabled.

## Data, API, security and privacy

No database migration, API contract, session flow, event-first tracking path, analytics payload, location data or HealthKit data changes. Workspace and user scoping are unchanged. The entry-delete confirmation calls the existing delete endpoint only after explicit confirmation.

## Files and migration surface

- Shared primitives: `apps/web/src/components/ui/Primitives.tsx`
- Foundation and consolidated styling: `apps/web/src/app/globals.css`
- Migrated surfaces: `AuthForm`, `AppShell`, `DashboardRealtime`, `EditTimeEntryDialog`, `DestructiveConfirmationDialog`, `EntriesTable`, `TimeReviewViews`, and existing Settings rows.
- Shared semantic focus token and tests: `packages/shared/src/theme.ts` and `packages/shared/src/theme.test.ts`
- Documentation: brand guide, feature/fix tracker and this investigation.

## Validation

All required automated checks passed on 2026-07-22 using the bundled arm64 Node runtime:

- `git diff --check`
- web lint, typecheck, test (41 files, 212 tests) and production build
- shared typecheck and test (5 files, 94 tests)
- mobile typecheck and test (33 files, 237 tests)
- full workspace lint, typecheck, test (79 files, 543 tests), production build and brand-asset contract

Actual in-app browser validation passed at 1440 by 900, 1280 by 720, 1024 by 768 and 390 by 844 across Dashboard, Timeline List, Reports, Places and Settings. Each of the 20 route/viewport combinations was captured and measured with zero horizontal overflow and no runtime overlay. Local-auth login was separately exercised at 390 by 844.

Behavioural evidence:

- Light uses blue `#2563EB` focus, dark/system-dark uses `#71C5F4`; system, light and dark were exercised through the actual theme state.
- Keyboard focus shows one two-pixel ring and no box shadow; the segmented-control focus parent now has visible overflow.
- Nine Timeline table icon actions measured 44 by 44 pixels with zero horizontal and vertical SVG-centre error.
- Entry edit focus enters the dialog; the backdrop reports `backdrop-filter: none`; document overflow is hidden; Escape closes; focus returns to the exact Edit trigger.
- Entry delete is an `alertdialog`, initially focuses Cancel, locks scroll, closes on Escape and restores focus to Delete.
- At 390 by 844, entry edit, profile, workspace and search remained within the viewport. Profile measured 366 by 799 pixels and workspace measured 366 by 342 pixels; each received focus internally.
- Login email/password controls measured 44 pixels high with 12-pixel leading padding; password reserves 52 pixels for its centred 44-pixel icon button; the submit target is 44 pixels high.
- Reduced Motion media emulation matched and the path introduced no modal motion; browser back, forward and hard refresh retained the expected Reports/Places route state.
- The browser console contained no errors or warnings. Only development HMR and React DevTools informational messages were present.

No hosted/provider preview was created or inspected during local implementation. The draft PR may receive normal CI/preview checks after push; production deployment remains explicitly out of scope.

## Release and rollback

No production deployment, Supabase migration, TestFlight build or merge is authorised. Rollback is the draft PR revert: the change is limited to React/CSS/theme/documentation and contains no durable data mutation.

## PR

Pending draft PR after validation.
