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
- any upload warnings

For the current Health debug build:

- App: Dayframe Time Tracker
- App Store Connect app id: `6787881096`
- Team: `65M773ZG6M`
- Version/build: `0.1.0 (1)`
- Group: `Internal Health Debug`
- Purpose: Health debug export and PR #23 validation

## Build Number Rule

Before uploading another TestFlight build, increment the iOS build number. App Store Connect will reject duplicate version/build pairs.

If the app version stays the same, increment build:

```text
0.1.0 (1) -> 0.1.0 (2)
```

Record the new build number in the investigation note and PR.

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
