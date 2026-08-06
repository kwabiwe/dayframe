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

### Auth keyboard continuity follow-up

- **Trigger:** Return-key navigation between auth fields, tapping another auth field, or pressing the password visibility action.
- **Owner:** the mounted React Native `TextInput` remains the single focus owner; UIKit continues to own the keyboard. No replacement accessory view, keyboard animation, or Swift surface is introduced.
- **Entrance / update / exit:** focusing another field changes first responder without intentionally dismissing the keyboard. The reveal action changes only secure masking and its eye/eye-off glyph inside one fixed password-field wrapper. Final submission retains the native keyboard dismissal path.
- **Surrounding layout:** the password wrapper retains the existing 48 pt field height and reserves one fixed 44 pt trailing action slot, so masking and focus changes do not reflow the form.
- **Interruption:** rapid Return presses resolve through the next field's stable ref; rapid reveal presses replace the prior boolean visibility state and never create a second input.
- **Async outcome:** authentication remains owned by the existing guarded submit path. Success clears and re-conceals the password; failure preserves the draft and current visibility state.
- **Accessibility:** focus moves and the `Show password` / `Hide password` VoiceOver action remain available with Reduce Motion, Reduce Transparency, and Dynamic Type. No nonessential animation is added.

The physical-iPhone flicker matches the iOS Password AutoFill/QuickType frame-change failure mode documented in React Native issues [#31722](https://github.com/facebook/react-native/issues/31722) and [#39411](https://github.com/facebook/react-native/issues/39411): a screen containing ordinary and secure fields can receive repeated keyboard-frame changes as the system AutoFill row appears or disappears. Removing Dayframe's custom `InputAccessoryView` exposed that system row again. The mobile auth form therefore opts out of iOS AutoFill classification with the supported `textContentType="none"` / `autoComplete="off"` contract while keeping native secure entry and adding an app-owned visibility action. This is a deliberate tradeoff: stable keyboard geometry is preferred here over Keychain suggestions until iOS/React Native can provide both reliably without a custom accessory.

## Configuration And Device Evidence

- Preview-scoped APNs provider configuration is now present in Vercel. Secret values were not read, printed, or copied into the repository.
- A clean checked-in workspace simulator build passed for the Debug staging configuration.
- A signed Debug staging build passed for the attached `KB's 17`, with bundle ID `com.layereight.dayframe`, team `65M773ZG6M`, and embedded `aps-environment=development`.
- The signed app installed and launched successfully on the attached iPhone after it was unlocked.
- The user subsequently confirmed that Live Activity and Push Notification delivery work with the configured provider credential. That is user-reported acceptance; this repository record does not claim access to the secret value.

## Acceptance State

PASS so far:

- focused primary timer geometry and native contract suites;
- focused token registration, APNs update, APNs end, stale-token, and safe-diagnostics suites;
- `npm run lint` and all mobile, web, and shared TypeScript checks;
- `npm run test`: 1,185 tests (350 mobile, 697 web, 138 shared). The first two full runs exposed one existing Calendar DOM assertion whose default one-second async wait passed in isolation but timed out under full-suite load; its wait is now explicitly bounded at five seconds and the unchanged production behavior passes in the final full run;
- optimized Next.js production build with 33 static pages;
- clean simulator workspace build;
- signed development/sandbox physical-iPhone Debug build and install;
- signed Release-config physical-iPhone build with embedded staging JavaScript, followed by install and launch on `KB's 17`;
- staging diagnostics schema migration and read-only token/environment inspection.

NOT RUN / still requiring hands-on evidence:

- final Dynamic Island normal/large Dynamic Type screenshots;
- the newly installed auth keyboard continuity and password visibility checks across login and signup;
- a captured, redacted APNs response/timing record for the already user-confirmed delivery path.

The APNs credential blocker is resolved. The remaining checks are visual/device evidence, not provider configuration work.

### Required Real Scenarios

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| Web description edit updates locked/backgrounded Live Activity | USER PASS | User confirms Live Activity and push delivery are working after provider configuration. A redacted response/timing capture is not yet recorded here. |
| Web category edit updates name, colour, and dot | USER PASS | Same user-confirmed staging delivery path; final normal/large Dynamic Type screenshots remain outstanding. |
| Web Stop ends and dismisses the Live Activity | USER PASS | User confirms the reverse push path is now working. |
| Live Activity Stop makes staging web idle without opening Dayframe | PASS | Previously completed physical-iPhone acceptance plus the direct native/event-first implementation and focused replay tests. |
| Reopen after each scenario with no stale timer, duplicate event, or duplicate entry | USER PASS | User reports the end-to-end Live Activity path working; controlled idempotent replay remains covered by focused tests. |

No delivery-time or redacted Vercel/APNs response log is claimed because Apple was never contacted without the provider credential.

## Hosted Staging Evidence

- Keyboard-fix runtime commit `624e654a49bad3b193e2efecf6729c878d874e55` produced Ready Preview `dpl_5p7vFsfSLWbXvaPMK7iz9jSrhYEA` at `dayframe-fvu86zkdk-dayframeworkshop.vercel.app`.
- That exact Ready Preview was explicitly assigned to `dayframe-staging.vercel.app`; hosted `/login` returned 200 and anonymous `/api/bootstrap` returned the expected JSON 401 before promotion.
- Preview-scoped Vercel configuration now contains the required APNs provider settings. Values were not printed.
- Staging Supabase has the four diagnostics columns. Historical pre-fix rows remain useful only as evidence of the old environment-classification bug; the user has confirmed the newly configured delivery path works.
- Production was not changed by this follow-up. At the post-promotion check, `dayframe-web.vercel.app` resolved to separate Ready production deployment `dpl_Cm3ztUXiU5798QpuR85N6prQUDmU`.
- PR #160 remained open, draft, and unmerged.

## Remaining Validation

The keyboard runtime is promoted to `dayframe-staging.vercel.app`, the exact embedded staging build is installed and launched, and the draft PR description carries the PASS / FAIL / NOT RUN matrix. Remaining validation is limited to the login/signup keyboard and password-visibility checks on the installed iPhone, final Dynamic Island screenshots, and one redacted APNs status/timing record.
