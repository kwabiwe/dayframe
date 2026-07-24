# iOS SecureStore Startup Recovery

Date: 2026-07-24

Reported build: internal TestFlight `0.1.0 (64)`

Branch: `agent/ios-securestore-startup-recovery`

Status: merged through PR #105 and shipped in internal TestFlight build `0.1.0 (65)`; physical-device verification pending

## Report

On every app open, the authenticated Today screen displayed a `Dayframe API`
alert containing:

`FunctionCallException: Calling the 'getValueWithKeyAsync' function has failed`

The nested iOS error was:

`KeyChainException: User interaction is not allowed`

## Evidence and hypotheses

The screenshot identifies Expo SecureStore's native
`SecureStoreModule.searchKeyChain` failure. The alert title comes from the
dashboard's initial `fetchBootstrap` catch path, before an HTTP request can be
made.

Two plausible causes were checked:

1. API or bearer-session failure. This is disproved by the native exception
   occurring while `authHeaders` reads the token and by the already-rendered
   authenticated data behind the alert.
2. Keychain accessibility during launch. This is supported by the default
   SecureStore `WHEN_UNLOCKED` accessibility, startup load calls that were not
   gated on active app state, and iOS status `errSecInteractionNotAllowed`
   (`-25308`).

## Root cause

The app read its `v1` bearer token from SecureStore immediately when the
dashboard provider mounted. That could occur while iOS still considered the app
inactive or protected. The transient native Keychain exception escaped through
`fetchBootstrap` and was mislabeled as a Dayframe API error. The token also used
SecureStore's default `WHEN_UNLOCKED` accessibility even though Dayframe has
authorised background capture and sync paths.

## Fix contract

- Gate initial and focus-owned bootstrap work on active app state.
- Retry only the specific transient Keychain interaction-unavailable error.
- Replace a persistent native exception with concise actionable copy.
- Store new session tokens under a `v2` key with
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.
- Migrate a readable legacy `v1` token without signing the user out.
- Clear both token keys on logout or a structured session `401`.
- Do not treat the Keychain failure as an HTTP/API failure or delete the token.

## Validation plan

- Secure-session unit tests for storage options, legacy migration, transient
  retry, persistent friendly error, and clearing both keys.
- Dashboard source contract for active-state startup/focus gating.
- Mobile test and typecheck.
- Full repository test, typecheck, lint and production web build.
- `git diff --check`.
- iOS simulator build because the shipped bundle changes.
- Physical-iPhone/TestFlight launch remains required to close the device-only
  Keychain behaviour.

## Validation evidence

- Focused secure-session, dashboard-startup, and API tests: 57 passed.
- Full mobile suite: 245 tests passed.
- Full repository suite: 749 tests passed.
- Mobile, web, and shared TypeScript checks passed.
- Repository lint passed.
- Optimized web production build passed.
- Brand asset contract and `git diff --check` passed.
- Full Xcode Debug simulator build passed for iPhone 17 Pro Max on iOS 26.5.
- Native build warnings are confined to existing Expo/React Native dependencies.
- PR #105 merged to `main` at
  `0ba4a1d3bad981c8c8de106bb3a13edabf3dcc1a`.
- Signed Release archive and IPA export passed with both the app and Live
  Activity extension stamped `0.1.0 (65)`.
- App Store Connect accepted delivery/build ID
  `208601ee-b584-4c3b-91d7-876636600d1b` with no upload errors.
- Build 65 is `VALID`, export compliance is false, en-GB release notes are set,
  and `internalBuildState=IN_BETA_TESTING` through the all-build
  `Internal Health Debug` group.

## Residual risk

The simulator cannot reproduce a physical iPhone Keychain protection transition.
The implementation remains `Watch` until a new internal TestFlight build is
opened repeatedly from terminated/backgrounded and locked/unlocked states on the
reported device.

## Durable guardrail

Mobile bearer tokens must use explicit Keychain accessibility. Startup code must
not read protected Keychain values or surface native Keychain exceptions while
the app is inactive.
