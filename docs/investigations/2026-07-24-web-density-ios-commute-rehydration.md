# Web Density And iOS Commute Rehydration

Date: 2026-07-24

Branch: `codex/web-density-ios-commute-fix`

Status: PR [#104](https://github.com/kwabiwe/dayframe/pull/104) merged at
`25d2c06300d8739d3c261edc53b7d4f2389a5c37`; iOS fix shipped in internal
TestFlight build `0.1.0 (64)`

## Report

- At 100% browser zoom, the web app felt oversized compared with 80% zoom and
  Calendar typography used visibly inconsistent sizes.
- Hovering or selecting a Calendar block opened a floating details surface even
  though Play on hover and double-click to edit are sufficient.
- Commute tracking had stopped on iOS while its Settings toggle remained enabled.

## Root causes

The web app had a 16px root size, 44px desktop controls, a 232px sidebar and
generous panel/shell spacing. Component-local text also mixed several adjacent
pixel sizes. Calendar retained the portalled details surface from PR #103.

Location Intelligence V2 suppresses the legacy commute candidate path in
`v2_review` and `v2_enabled`. When an already-enabled account rehydrated,
`refreshGeofencesForPlaces` restarted Expo continuous updates but did not restart
the native `CLVisit` and significant-change monitor. The explicit Settings-toggle
path did start it, so the UI could say learning was on while the native evidence
source remained off after an upgrade or lifecycle reset.

## Fix

- Apply compact desktop density tokens at widths above 760px: 14px root type,
  38px pointer controls, smaller radii/gaps/panel padding, a 208px sidebar and
  tighter shell/page spacing. Mobile retains 44px touch controls.
- Standardise Calendar block title, duration, context and running status to an
  11px/1.2 inline scale.
- Remove the Calendar details portal. Hover/focus reveals only Play; double-click
  or keyboard Enter edits; a single click keeps a block selected.
- Restart native iOS visit/significant-change monitoring whenever enabled
  location learning rehydrates, not only when the toggle changes.

## Motion contract

- Trigger: pointer hover or keyboard focus on a completed Calendar block.
- Owner: existing Calendar CSS transition.
- Entrance/update/exit: only the Play control fades/translates in and out; no
  details panel is mounted.
- Interruption: rapid hover/focus changes are handled by the existing CSS state.
- Async outcome: timer continuation retains the shell-owned busy/error handling.
- Accessibility: Enter opens Edit, focus reveals Play, and Reduce Motion keeps the
  existing global near-instant transition rule.

## Evidence

- Web and mobile TypeScript checks pass.
- Calendar contract tests pass.
- All 19 mobile geofence tests pass, including enabled-learning rehydration
  restarting native monitoring.
- Local browser automation could not navigate to the localhost/LAN target because
  the browser policy blocked local navigation. The Ready Vercel preview was then
  checked but redirected the isolated browser to Vercel Authentication. Rendered
  checks therefore remain required on the authenticated production web app.
- TestFlight preflight, signed Release archive, App Store export and upload passed
  from merged `main`, with production API base `https://dayframe-web.vercel.app`.
- App Store Connect delivery/build ID
  `ee8a2a5f-f6b8-42fe-a9a9-f376fb83ea75` is `VALID`, export compliance is false,
  en-GB notes are set, and the build is `IN_BETA_TESTING` through the all-build
  `Internal Health Debug` group.
