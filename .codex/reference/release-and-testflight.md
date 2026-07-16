# Release And TestFlight

Use this before saying a mobile/API fix is present or absent in production.

## Version Truth Table

A Dayframe fix may span several independently deployed surfaces:

| Surface | What To Check |
| --- | --- |
| GitHub | PR merged into `main`; commit SHA present locally and on origin |
| Vercel | production deployment commit matches the merged SHA |
| Supabase | migrations and schema match deployed code |
| TestFlight | app version/build contains the mobile commit |
| Runtime app | API base URL points at the intended server |

Do not conclude a fix failed until all relevant surfaces are checked.

## Current Internal TestFlight Lane

As of 2026-07-16, Dayframe uses this internal release lane:

- App: Dayframe Time Tracker
- App Store Connect app id: `6787881096`
- Bundle id: `com.layereight.dayframe`
- Team: `65M773ZG6M`
- Version: `0.1.0`
- Latest verified build: `0.1.0 (43)`
- Group: `Internal Health Debug`
- Latest delivery/build ID: `510b1fd9-05b2-44f5-886c-f32c4b1a6a8b`
- Current release rule: implementation PRs are not done until the merged code is in a verified internal TestFlight build.

Docs-only or planning-only PRs do not require a TestFlight build unless they change build, release, signing, environment, or runtime configuration.

## PR Success Lane

For any Dayframe implementation PR that changes shipped app, API, database, mobile, sync, or release behavior, success means:

1. Sync local `main` with `origin/main`.
2. Check repo status is clean.
3. Check memory, tracker, GitHub PRs/issues, and latest TestFlight state.
4. Confirm PR scope from `docs/feature-fix-tracker.md`.
5. Create a focused `agent/<short-pr-scope>` branch.
6. Implement the change narrowly.
7. Add or update regression tests for the changed behavior.
8. Update `docs/feature-fix-tracker.md` in the PR.
9. Run validation:
   - `npm run test`
   - `npm run typecheck`
   - `npm run lint`
   - `npm run build`
   - `git diff --check`
10. Commit, push, and open the PR with summary and validation notes.
11. Wait for GitHub/Vercel checks; fix failures and rerun validation if needed.
12. Merge to `main` and sync local `main`.
13. Update the tracker after merge if the merged PR number/status/build evidence changed.
14. Run `npm run testflight:preflight`.
15. Temporarily increment the iOS build number for release.
16. Archive with full Xcode from merged `main`.
17. Export and upload the `.ipa` to App Store Connect.
18. Wait for Apple processing to become `VALID`.
19. Set export compliance/encryption answer.
20. Add/update TestFlight notes.
21. Assign or verify the internal testing group.
22. Verify TestFlight state is `IN_BETA_TESTING`.
23. Restore the repo iOS build number back to its default if it was changed only for upload.
24. Tell KB the exact build number, delivery UUID, verification state, and what changed.

Docs-only PR success is narrower: clean branch, docs-only diff, `git diff --check`, PR opened, checks observed, merged, and local `main` synced.

## TestFlight Build Identity

Record these every time a build is uploaded:

- app name
- App Store Connect app id
- bundle id
- version
- build number
- commit SHA
- API base URL baked into the build
- internal or external testing group
- upload time
- delivery UUID
- any upload warnings

## Build Number Rule

Before uploading another TestFlight build, increment the iOS build number. App Store Connect will reject duplicate version/build pairs.

If the app version stays the same, increment build:

```text
0.1.0 (1) -> 0.1.0 (2)
```

Record the new build number in the tracker, PR/release note, and final handoff. The committed iOS `CURRENT_PROJECT_VERSION` should stay at the repo default after release unless the project deliberately changes that convention; previous releases temporarily bumped the build number for archive/upload and restored it afterwards. The app and extension `Info.plist` files should resolve `CFBundleVersion` from `$(CURRENT_PROJECT_VERSION)` so archive validation sees matching build numbers.

## Preflight Before Archive

Run the preflight before spending time on a TestFlight archive/export:

```bash
npm run testflight:preflight
```

The preflight checks the failure points that have disrupted recent Dayframe releases:

- full Xcode is installed
- release commands should pin `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` if `xcode-select` points at Command Line Tools
- `apps/mobile/ios/Podfile.lock` matches `apps/mobile/ios/Pods/Manifest.lock`
- Dayframe has an App Store provisioning profile for team `65M773ZG6M`
- Keychain has an **Apple Distribution** or **iPhone Distribution** signing identity with its private key
- local App Store Connect API-key config exists under `.codex-dayframe-qa/testflight/appstoreconnect/`

Do not start archive/export if the preflight fails. A valid App Store provisioning profile is not enough; TestFlight export also needs the matching distribution signing identity in Keychain. Xcode/browser App Store Connect login may still be present while the CLI export fails if that certificate/private key is missing.

If the distribution identity is missing, the durable fix is to install an Apple Distribution certificate/private key for the Dayframe Apple team in the login keychain, or explicitly authorize creating a new Apple Distribution certificate and profile. Once this passes, use the API-key upload path and verify export compliance/internal testing state before telling KB to test.

## Archive, Export, Upload

Use full Xcode for release work, especially if `xcode-select` points at Command Line Tools:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

The current working pattern is:

1. Set the temporary iOS build number, for example `0.1.0 (13)`.
2. Archive from merged `main` with `xcodebuild archive`.
3. Export the archive with the App Store Connect export options and the Dayframe App Store provisioning profile.
4. Upload the exported `.ipa` with the App Store Connect API key path under `.codex-dayframe-qa/testflight/appstoreconnect/`.
5. Save archive/export/upload logs under `.codex-dayframe-qa/testflight/`.
6. Restore the temporary build-number change before final repo status.

Do not commit `.codex-dayframe-qa/`, archives, exported IPAs, logs, API keys, profiles, or local Xcode state.

## App Store Connect Verification

Before telling KB to test, verify all of these:

- uploaded build exists for the expected version/build
- `processingState=VALID`
- `usesNonExemptEncryption=false`
- TestFlight notes are set for the relevant locale
- build is attached to `Internal Health Debug`
- build beta detail has `internalBuildState=IN_BETA_TESTING`
- external testing is not enabled for the current lane. App Store Connect may report `externalBuildState=READY_FOR_BETA_SUBMISSION` for internal-only builds; treat that as acceptable unless an external lane is explicitly introduced.

If App Store Connect accepts the upload but shows missing compliance, patch the build export-compliance answer before assigning or verifying TestFlight state.

## Production Deployment Check

For Vercel-hosted fixes:

1. Confirm `main` contains the expected commit.
2. Check Vercel production deployment source commit.
3. Check `/api` logs for the affected request path after deployment.
4. If there are DB-related changes, verify Supabase migration state before testing.

If the user says "I merged it", still verify deployment completion and commit SHA.

## Mobile Runtime Check

From the physical iPhone, verify:

- TestFlight shows the expected version/build.
- The app diagnostics or Settings show the expected API base URL.
- Health permissions are granted.
- The current account/workspace matches the server logs being inspected.

Simulator testing is useful for UI and API state, but it cannot validate the user's real Apple Health database.

## Local Artifacts

Keep these out of commits unless explicitly requested:

- `.codex-dayframe-qa/`
- screenshots
- TestFlight archives and export logs
- `.ipa` files
- Health debug JSON exports
- `.env` files
- Xcode local user state

Restore checksum-only CocoaPods or Xcode changes if they are only local build noise.
