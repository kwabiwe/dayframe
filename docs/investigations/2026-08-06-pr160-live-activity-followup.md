# PR #160 Live Activity And Timer Control Follow-up

Date: 2026-08-06
Status: Draft PR [#160](https://github.com/kwabiwe/dayframe/pull/160), unmerged
Baseline: `2d81660` (`origin/main`, including PR #159)
Branch: `codex/ios-live-activity-sync`

## Reported Regressions

Physical-iPhone review found three follow-ups on the draft branch:

- the 44 pt primary mobile timer controls retained materially smaller optical Play and Stop bounds than the canonical 44 px web controls;
- the expanded Dynamic Island category marker and label were clipped at the bottom edge;
- web-side timer edits and stops did not update or end an existing Live Activity while Dayframe was backgrounded.

The existing Live Activity Stop-to-server path remains event-first: the native App Intent ends the local activity immediately, submits the same idempotent event directly to the configured Dayframe API, and retains the native queue as the offline or lost-response fallback.

## Root Cause And Implementation

### Control geometry

The mobile primary component used nominal 18 pt Play and 14 pt Stop SVG viewports. Because both paths include Lucide-style view-box margins, their optical shapes were smaller than the same-size web references. Primary Play and Stop now use shared 22 pt and 17 pt optical tokens inside the unchanged 44 pt outer control. The idle composer, running composer, and running edit sheet all render the same shared primary glyph component. Today replay remains an intentionally compact 14 pt glyph but uses the same rounded Play path.

### Expanded Dynamic Island

The category row was offset upward by only 3 pt and used fixed point-size text without reserving its scaled vertical extent. The expanded metadata group now has one explicit 10 pt upward lift, top-leading alignment, scaled metrics for title/category text, fixed vertical text sizing, and a category-row minimum height derived from the scaled category size. Compact and minimal regions are unchanged, and the Lock Screen retains its separate layout and offset.

### APNs reverse sync

The Xcode-installed staging app had registered Live Activity rows as `production`, although its development provisioning entitlement requires APNs sandbox delivery. Environment selection was compiled with `#if DEBUG`, which is not a reliable statement of the signed entitlement. Token acquisition also listened only for the first future token update and server delivery used `Promise.allSettled` without surfacing failures.

The signed app now receives `DayframeAPNSEnvironment` from the same `APS_ENVIRONMENT` build setting used by its entitlement, rejects unknown values, checks `Activity.pushToken` immediately, then waits for token updates with bounded retries. Registration invalidates rotated tokens for the same activity. The server selects Apple's sandbox or production endpoint from the registered row, uses the Live Activity topic `${bundleId}.push-type.liveactivity`, sends ActivityKit update/end payloads, invalidates stale tokens, and records safe delivery diagnostics (`last_attempt_at`, status, Apple reason, failure count). Logs contain environment, event, status, and a sanitized reason only; device tokens, provider keys, and sessions are excluded.

Staging inspection before the fix found seven active token rows, all marked `production`, with no successful delivery timestamp and none attached to the then-current running entry. The additive diagnostics migration was applied to the separate staging Supabase database. Production was not queried or changed.

## Motion Contract

This follow-up introduces no new navigation, presentation, gesture, or animation owner. Primary glyph changes are static geometry inside the existing pressable. The Dynamic Island change adjusts the existing system-owned presentation layout without adding transitions. Existing optimistic timer mutation, Live Activity lifecycle, interruption, failure fallback, and Reduce Motion behavior remain owned by their current React Native and ActivityKit paths.

## Configuration And Device Evidence

- Preview-scoped `APNS_TEAM_ID` and `APNS_BUNDLE_ID` were added to Vercel. `APNS_KEY_ID` and `APNS_PRIVATE_KEY` are still absent. The locally available App Store Connect API key is a different credential and was not reused as an APNs provider key.
- A clean checked-in workspace simulator build passed for the Debug staging configuration.
- A signed Debug staging build passed for the attached `KB's 17`, with bundle ID `com.layereight.dayframe`, team `65M773ZG6M`, and embedded `aps-environment=development`.
- The signed app installed successfully on the attached iPhone. Automated launch was denied because the phone was locked; no unlock bypass was attempted.

## Acceptance State

PASS so far:

- focused primary timer geometry and native contract suites;
- focused token registration, APNs update, APNs end, stale-token, and safe-diagnostics suites;
- `npm run lint` and all mobile, web, and shared TypeScript checks;
- `npm run test`: 1,183 tests (348 mobile, 697 web, 138 shared). The first two full runs exposed one existing Calendar DOM assertion whose default one-second async wait passed in isolation but timed out under full-suite load; its wait is now explicitly bounded at five seconds and the unchanged production behavior passes in the final full run;
- optimized Next.js production build with 33 static pages;
- clean simulator workspace build;
- signed development/sandbox physical-iPhone build and install;
- staging diagnostics schema migration and read-only token/environment inspection.

BLOCKED / NOT RUN:

- real APNs delivery for web description edit, category edit, and Stop while the phone is locked;
- redacted Vercel/APNs delivery status and timing evidence;
- final Dynamic Island normal/large Dynamic Type screenshots;
- installed-app launch and hands-on timer/keyboard checks while the attached phone remains locked.

Those checks cannot be marked complete until a genuine APNs provider `APNS_KEY_ID` and `APNS_PRIVATE_KEY` are configured for the Preview environment and the installed app is opened on the unlocked device to register a fresh development token.

### Required Real Scenarios

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| Web description edit updates locked/backgrounded Live Activity | NOT RUN | Preview has no APNs provider key, so no authenticated Apple delivery attempt can be made. |
| Web category edit updates name, colour, and dot | NOT RUN | Same APNs credential blocker. |
| Web Stop ends and dismisses the Live Activity | NOT RUN | Same APNs credential blocker. |
| Live Activity Stop makes staging web idle without opening Dayframe | NOT RUN in this follow-up | The direct native/event-first implementation and focused replay tests pass, but the installed app could not be launched while the iPhone was locked. |
| Reopen after each scenario with no stale timer, duplicate event, or duplicate entry | NOT RUN | Depends on the four device scenarios above. Controlled idempotent replay remains covered by the existing focused tests. |

No delivery-time or redacted Vercel/APNs response log is claimed because Apple was never contacted without the provider credential.

## Hosted Staging Evidence

- Implementation commit `142a4b1e8142194dfb8dfed634c732d7db7b6f16` produced Ready Preview `dpl_ATHUVPSWbkcDe5kLwGWi6Mqh1Rqk` at `dayframe-e0b1hkuby-dayframeworkshop.vercel.app`.
- That exact Ready Preview was explicitly assigned to `dayframe-staging.vercel.app`; hosted `/login` returned 200 and anonymous `/api/bootstrap` returned the expected JSON 401.
- Preview-scoped Vercel configuration contains `APNS_TEAM_ID` and `APNS_BUNDLE_ID`. It does not contain `APNS_KEY_ID` or `APNS_PRIVATE_KEY`; values were not printed.
- Staging Supabase has the four diagnostics columns. Its seven historical Live Activity rows remain active, all are labelled `production`, none has a delivery timestamp, and opening the newly installed development build is still required to register a fresh sandbox row.
- Production was not changed. `dayframe-web.vercel.app` remained on separate Ready production deployment `dpl_RF9WcfxPVZvEBcRGMHtwV22qqVqC`.
- PR #160 remained open, draft, and unmerged.

## Remaining Validation

After this evidence-only documentation update is pushed, promote its exact final Ready Preview to `dayframe-staging.vercel.app`, recheck production remains unchanged, and update the draft PR description with the final head plus exact PASS / FAIL / NOT RUN results.
