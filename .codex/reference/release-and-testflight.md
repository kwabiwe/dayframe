# Release And TestFlight

Use this before saying a mobile/API fix is present or absent in production.

## Hosted Environment Lanes

- PR Preview: per-branch Vercel deployment using the separate staging Supabase project.
- Stable staging: `https://dayframe-staging.vercel.app`, manually assigned to the one PR Preview selected for web/iPhone testing.
- Production: `https://dayframe-web.vercel.app` using production Supabase.
- Mobile `preview`: staging API only. Mobile `production`/TestFlight: production API only.
- Server feature flags can differ by lane. `DAYFRAME_TIMER_TRIP_CHECKS=on` (a timer that ran into a trip asks on its block, location v4 design §7) is set for the staging (Vercel Preview) environment only; production leaves it off until the owner turns it on. Check the lane's flags before calling a staging result a production result.

The staging alias does not move automatically. Before merging an implementation PR, confirm its Preview is Ready, apply migrations to staging, promote that deployment to the stable alias, and complete the relevant hands-on checks. Production credentials and data are not a PR test lane.

Preview and production use separate iOS identities and can be installed together. Preview uses `com.layereight.dayframe.staging`, the `Staging` Xcode configuration, isolated App Group/keychain containers, and the staging API. Production/TestFlight remains `com.layereight.dayframe` with production containers and API. For a local signed Preview build, set `EXPO_PUBLIC_DAYFRAME_API_BASE=https://dayframe-staging.vercel.app` and `EXPO_PUBLIC_DAYFRAME_RELEASE_CHANNEL=preview` before bundling. Verify the compiled API resolver defaults to the staging URL and confirm the visible `STAGING` badge on the device before submitting fixture credentials.

App Group selection must use the same `DAYFRAME_APP_GROUP` setting in the host/extension entitlements and `DayframeSharedAppGroupIdentifier` Info.plist key. Run `npm run check:ios-config`, `bash scripts/validate-ios-shared-storage.sh`, then `npm run check:ios-config -- --built-app <Dayframe.app>` after building. Before device acceptance, run `npm run check:ios-config -- --signed-app <Dayframe.app>` to compare both products' signed App Groups with their baked identities. Missing/unresolved or cross-lane native configuration must fail closed, never fall back to production. Unsigned Simulator products prove configuration/compilation only; verify shared Shortcut queue/catalog and Live Activity Stop hand-off on the signed staging app with both app identities installed.

Xcode 27 source builds require the ExpoModulesJSI SDK 56 setter fix, included in `56.0.13`. CocoaPods raises dependencies with lower iOS deployment targets to the app’s existing minimum. The app’s supported iOS versions and signing configuration stay the same.

iOS 27 enforces the UIKit scene lifecycle for Xcode 27 builds. Verify the built app’s scene manifest with `check:ios-config`, then cold-launch the signed build on an iOS 27 device. Check background and foreground transitions and cold and warm links through the existing router. The launch and linking smoke does not replace the Health or Location background capture checks.

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

## Last Recorded Internal TestFlight Release

The lane configuration is stable, but the build record is only a dated repository fact. `docs/feature-fix-tracker.md` must say when main contains later mobile code.

- App: Dayframe Time Tracker
- App Store Connect app id: `6787881096`
- Bundle id: `com.layereight.dayframe`
- Team: `65M773ZG6M`
- Version: `0.1.0`
- Last repository-recorded verified build: `0.1.0 (153)` (2026-11-16)
- Group: `Internal Health Debug`
- App Store Connect build ID: `8e21edca-8ea5-4a72-8fcb-8c5d7b83b251`
- Archived commit: `24b3ff37ea2f72f7a0362aac528a1f32160ab95f` (#737), built in a detached worktree pinned to that SHA.
- Apple upload delivery UUID `8e21edca-8ea5-4a72-8fcb-8c5d7b83b251`. App Store Connect recorded the upload at 21:55:18 UTC on 16 Nov 2026. The distribution-signed app and Live Activity extension use production shared containers and `https://dayframe-web.vercel.app`.
- The exact signed Staging build passed sign-in, Calendar List logging for a trip and named and unknown places, Undo, Reports Month and Week, and a running Today timer on the wired iPhone 11. The server confirmed one saved block for each Calendar test. Cleanup restored the previous Staging app and alias and removed the disposable fixture and runner.
- The warm-up measured 6.7725% CPU and +2.9394 MB/min over 316.132 s. The warmed gate measured 6.8133% CPU and +1.1212 MB/min over 317.616 s against the iPhone 11 limits of 15.1% CPU and 2 MB/min. The same visible timer advanced 650 s across 650 s of capture time.
- App Store Connect verified `VALID`, export compliance, en-GB notes and `IN_BETA_TESTING` in Internal Health Debug. Installed TestFlight 153 checks are pending.
- Release rule: mobile/native/runtime-configuration changes require a verified internal build before their device behavior is called released. Web-only work does not require a TestFlight build unless it changes a mobile-consumed contract or the user defines TestFlight as the success criterion.

Docs-only or planning-only PRs do not require a TestFlight build unless they change build, release, signing, environment, or runtime configuration.

Build 152 from `9f51bebe` was verified in Internal Health Debug on 16 Nov 2026. Delivery `3da7e8eb-dffc-4907-8f0c-5314911886fe`. It includes local Sync help diagnostics (#736). The warmed iPhone 11 Staging gate measured 6.8095% CPU and −0.1881 MB/min. The installed app exposed Export diagnostics. Verification of the installed JSON export is pending.

Build 151 was verified in Internal Health Debug on 16 Nov 2026.

- App Store Connect build ID: `09a9429e-1981-4b3d-aaa6-a22ed904e11d`
- Archived commit: `3850b6c1173c5414b4676029aca9a8bfde10387a`, built in a detached worktree pinned to that SHA.
- Apple upload delivery UUID `09a9429e-1981-4b3d-aaa6-a22ed904e11d`. App Store Connect recorded the upload at 15:12:46 GMT on 16 Nov 2026. The distribution-signed app and Live Activity extension use the production shared containers and `https://dayframe-web.vercel.app`.
- On the wired iPhone 11, exact signed Staging passed sign-in, Today Switch and Cancel, Calendar day navigation, Reports Week and Month, the keyboard visibility of Description and Apply, and the time shortcuts in Running block, Add past time and Edit block. Both rounding actions saved the expected end time on the standard and 128-point dial. The compact dial's end knob remained draggable. Cleanup removed the disposable fixture and runner and restored the prior Staging app and alias.
- The warm-up measured 6.6930% CPU and +2.2275 MB/min over 347.978 s. The warmed gate measured 6.7800% CPU and +0.9540 MB/min over 334.364 s against the 15.1% CPU and 2 MB/min iPhone 11 limits. The same Today timer advanced 718 s across 718 s between captures.
- App Store Connect verified `VALID`, export compliance, en-GB notes and `IN_BETA_TESTING` in Internal Health Debug. Build 151 includes repeat-visit descriptions and wider sparse nearby search (#732), inline place options, stable trip logging and simplified mobile Reports filters (#733), and matching text-only time shortcuts in the block editors (#734). Installed TestFlight 151 checks are pending.

Build 150 was verified in Internal Health Debug on 16 Nov 2026.

- App Store Connect build ID: `d105d184-5326-469d-8c0d-6e14183bd2c1`
- Archived commit: `f4d85879b055abe390c08d99e4acbad5c2e85170`, built in a detached worktree pinned to that SHA.
- Apple upload delivery UUID `d105d184-5326-469d-8c0d-6e14183bd2c1`. App Store Connect recorded the upload at 08:53:37 GMT on 16 Nov 2026. The distribution-signed app and Live Activity extension use the production shared containers and `https://dayframe-web.vercel.app`.
- On the wired iPhone 11, exact signed Staging passed sign-in, Switch suggestions and Cancel, Calendar day navigation, Reports Week and Month, and the description filter with the keyboard open. The field and Apply stayed visible with a populated filter list. Cleanup removed the disposable fixture and runner and restored the prior Staging app and alias.
- The warm-up measured 6.7672% CPU and +2.8384 MB/min over 335.147 s. The warmed gate measured 6.7206% CPU and +0.5555 MB/min over 335.237 s against the 15.1% CPU and 2 MB/min iPhone 11 limits. The same Today timer advanced 706 s across 706 s between captures.
- App Store Connect verified `VALID`, export compliance, en-GB notes and `IN_BETA_TESTING` in Internal Health Debug. Build 150 includes the aligned block editors and iPhone task suggestions (#728), per-day Calendar review indicators and trip logging (#729), and Reports filters and donut deselection (#730). Installed TestFlight 150 checks are pending.

Build 149 was verified in Internal Health Debug on 15 Nov 2026.

- App Store Connect build ID: `20c6de28-4853-47d9-858b-0d4a9b86bdba`
- Archived commit: `7fcc7a04f6aeea1aee3ea9119da73c1883ebcb12`, built in a detached worktree pinned to that SHA.
- Apple upload delivery UUID `20c6de28-4853-47d9-858b-0d4a9b86bdba`. App Store Connect recorded the upload at 10:06:56 GMT on 15 Nov 2026. The Apple Distribution-signed app and Live Activity extension use the production shared containers and `https://dayframe-web.vercel.app`.
- The wired iPhone 11 passed exact signed Staging sign-in, Today Switch and Cancel, Calendar date navigation and completed-block editing, and Reports Week and Month. The warm-up measured 6.7705% CPU and +2.2380 MB/min over 363.489 s. The warmed gate measured 6.7796% CPU and +0.4357 MB/min over 334.976 s against the 15.1% CPU and 2 MB/min iPhone 11 limits. The same visible timer advanced 734 s across 734 s between captures. Cleanup verified removal of the disposable fixture and runner, and restoration of the prior signed app and Staging alias.
- App Store Connect verified `VALID`, export compliance, en-GB notes and `IN_BETA_TESTING` in Internal Health Debug. Build 149 includes distinct pinned activity states (#720), new and recent iPhone task switching (#724), a clearer neutral Calendar block edge (#725), and completed-block move and resize with Undo (#726). Installed TestFlight 149 checks are pending.

Build 148 was verified in Internal Health Debug on 9 Nov 2026.

- Delivery/build ID: `a1be64bb-9ab1-4495-9e77-bd76b1791344`
- Archived commit: `a7556906abeb11b70347437d2f7bb55fcb5888d1`, built in a detached worktree pinned to that SHA.
- App Store Connect recorded the upload at 16:31:20 GMT on 9 Nov 2026. The Apple Distribution-signed app and Live Activity extension use the production shared containers and `https://dayframe-web.vercel.app`.
- Exact signed Staging passed on the wired iPhone 11. The 309.415 s warm-up measured 6.7050% of one core and +2.6783 MB/min. The warmed 309.456 s gate measured 7.5485% and +1.9219 MB/min. The same Today timer advanced 638 s across 638 s between captures. The disposable timer, fixture and runner were removed, and the prior app, alias and protected state were verified.
- App Store Connect verified `VALID`, export compliance, en-GB notes and `IN_BETA_TESTING` in Internal Health Debug. Build 148 contains the iPhone activity picker (#712), editor Actions and Last stop (#714), Location permission and replay handling (#696), and running Split with Undo (#608). Installed 148 passed the editor, picker, Last stop, offline Running Split and Today performance checks.
- On 9 Nov 2026, the wired iPhone 11 verified Actions, the Split minute wheel and Keep as one, historical and empty-day Last stop, running-editor activity search and Cancel, and Calendar activity search, Cancel, selection and Clear. Offline Undo restored the original running Start. A second Split and Stop survived a cold launch and reconnect, leaving two adjacent completed blocks, one canonical Split and one exact Stop. The original Calendar visit stayed unlinked, its Review stayed open, and no corrections were written. The same Today timer advanced 667 s over 666 s. The 309.373 s warmed installed repeat measured 5.1443% of one core and +0.7213 MB/min. Airplane Mode returned Off, the phone signed out, the runner was removed and all 16 scoped production counts were zero. The installed Location permission follow-up remains open.

Build 147 came from `0f5ff1a95b6aab92cdadf86e49f5dbcfebd4fe92` and adds finished-block Split and Duplicate (#707). App Store Connect verified build `fbffb528-b302-4d38-9349-713aed715243` in Internal Health Debug after the 09:51:42 GMT upload on 8 Nov 2026. The signed wired iPhone 11 Staging gate measured 6.7855% CPU and +0.9950 MB/min. Installed 147 verified Keep as one, Split and offline Duplicate through cold relaunch and reconnect. The warmed installed window measured 5.0389% CPU and +0.8673 MB/min. The separate installed background Live Activity check verified a web edit, web Stop, three delivered APNs revisions and token retirement. Both runs passed scoped cleanup.

Build 146 came from `c063214e0a1369ddd70b854934671f0317ad9d6c` and includes completed-block sync between web and iPhone (#705). App Store Connect verified build `c15c091a-c4ab-4fe0-8c06-359ae929f8c6` in Internal Health Debug after the 23:45:32 GMT upload on 7 Nov 2026. Exact signed Staging on the wired iPhone 11 measured 6.7232% of one core and +1.8742 MB/min in the 307.365 s warm-up, then 6.7967% and +0.8536 MB/min in the warmed 307.472 s gate. The same timer advanced 631 s over 631 s between screenshots. Staging cleanup removed the fixture and runner and restored the prior app and alias. Installed 146 passed two-way foreground add, edit and delete and an offline edit that reached the same block on reconnect. The warmed Today repeat measured 4.7643% and +0.3807 MB/min over 307.288 s. The displayed timer advanced 660 s over 659.607 s between capture timestamps. The original wrapper recorded the first timestamp after OCR. The iPhone signed out, Airplane Mode returned Off, and all nine disposable production counts were zero.

Build 145 came from `20851581fc78530a4241503210be944336c80cbb` and includes Calendar Day pinch and named-trip labels from #702. App Store Connect verified build `c529745c-f57f-4138-8e61-a097a332e768` in Internal Health Debug after the 21:26:09 GMT upload on 7 Nov 2026. On the wired iPhone 11, exact signed Staging passed pinch, separate tap, scroll and VoiceOver. The 307.462 s warm-up measured 6.7490% of one core and +1.2182 MB/min. The warmed 307.342 s gate measured 6.6773% and +0.4990 MB/min. The same timer advanced 633 s over 632 s between screenshots, and cleanup restored the previous signed Staging app at Log in.

Installed 145 passed staggered pinch release over a block and the Places lane, a separate tap, scrolling and VoiceOver for all three named-trip parts. The warmed 307.257 s production window measured 7.1383% of one core and +0.7551 MB/min. The 307.384 s warm-up measured 7.0646% and +3.8121 MB/min. The same timer advanced 723 s over 723 s. Cleanup removed the disposable timer, production fixture and runner, and the app returned to Log in.

Build 144 came from `847dceb9` and includes the Calendar List place-filter fix from #698. Its signed Staging gate measured 6.8912% of one core and +1.0038 MB/min over 307.503 s on the wired iPhone 11. Installed 144 on the wired iPhone 11 passed Day → List and Today → Calendar with Reduce Motion off and on. The ordinary block held at 411.5 pt at the first XCTest observation and after settling. The first sign-in case missed the immediate owned Today row. Both Calendar cases verified that row after relaunch before changing preferences. The original Calendar and iOS settings were restored, sign-out passed, and scoped production cleanup found zero remaining fixture records.

Build 143 came from `9430cd58`. The wired iPhone 11 passed the warmed signed Staging gate at 6.851% of one core and +0.3741 MB/min. Installed 143 passed Calendar day-strip, Reports range, the Unknown place picker, description-only logging and the off-day linked editor. The owner confirmed a staggered finger lift held Calendar Day position and ordinary vertical scrolling worked. The warmed installed Today repeat measured 6.748% of one core and +0.9622 MB/min over 307.53 s with the same disposable timer visible at both endpoints.

Build 142 came from `76a7762b`. Its warmed signed staging gate passed at 6.7727% of one core and +0.6428 MB/min. The wired iPhone 11 passed installed Calendar day-strip switching and Reports Week → Month → Week. The warmed production repeat measured 6.5255% of one core and +0.926 MB/min over 385.381 s, using a recaptured end sample from the same process and timer after Instruments timed out.

Build 141 came from `bb2440ec` and remains verified in Internal Health Debug. Its signed staging gate measured 5.26% of one core and +1.56 MB/min over 308.3 s on the wired iPhone 17 Pro. Installed 141 passed Calendar List day-strip switching and Reports Week → Month → Week. The production Today repeat on the same phone measured 6.74% of one core and −0.003 MB/min over 307.2 s after warm-up. Today and the running timer were visible at both endpoints.

Build 140 came from `99f1a6c7` and remains verified in Internal Health Debug. Installed 140 passed Calendar day-strip switching, Reports range switching and the Today performance repeat at 5.47% of one core and +0.54 MB/min over 306.7 s. The installed web-to-iPhone timer refresh repeat remains open.

Build 139 came from `3cf432dd` and is also verified in `Internal Health Debug`. The exact staging gate on the wired iPhone 11 measured 15.37% and 15.50% of one core with +0.44 and +1.32 MB/min. The owner accepted the CPU overage for build 139 only. Installed build 139 still needs its own smoke. Earlier release history is in Git history and dated investigations.

Swift/SwiftUI native-view changes require a new binary. JavaScript/OTA or Vercel deployment evidence cannot prove that an updated native Calendar module is present.

## Development and release validation

Follow the delivery defaults in `AGENTS.md`. Fetch and commit from a current, clean checkout. Preserve the shared checkout and use a separate detached worktree when it is busy, stale, or pinned for a release. Direct updates to `main` must be fast-forwards. If a PR is needed for risk or protection, use [the exact-head merge gate](process-improvement.md#merge-gate). Run targeted checks per change and follow up on asynchronous CI while unrelated work continues.

Batch full regressions, hosted staging smoke and signed iPhone QA on a pinned commit. Capture the relevant feature checks and any pending device requirements in one release checklist. Do the necessary staging, migration and rollback checks before any high-risk change reaches production. Keep the staging identity and disposable data isolated from production. Documentation-only changes use `npm run check:docs` and `git diff --check` when those documents change.

When preparing a TestFlight release, use the following checks and upload steps:

1. Create a detached git worktree pinned to the release SHA (`git worktree add --detach <path> <sha>`) and build the staging app and the release archive there, never in the shared main checkout: the shared checkout moved mid-archive once (TestFlight 134).
2. Take the release-gate performance reading (`.codex/reference/performance.md`): 5 minutes of Today in front with a block running on a Staging build of the exact release commit, on the physical iPhone. Take it on a fresh launch of that build (force-quit, then launch), after the warm-up window: on 29 Oct 2026 a TestFlight 134 process that had been used for a while read +4.43 MiB a minute, a false fail, and a clean relaunch passed. Record it below against the baseline; a reading over budget stops the release unless the owner accepts it.
3. Run `npm run testflight:preflight`.
4. Temporarily increment the iOS build number for release.
5. Archive with full Xcode from the pinned worktree.
6. Export and upload the `.ipa` to App Store Connect.
7. Wait for Apple processing to become `VALID`.
8. Set export compliance/encryption answer.
9. Add/update TestFlight notes.
10. Assign or verify the internal testing group.
11. Verify TestFlight state is `IN_BETA_TESTING`.
12. Restore the repo iOS build number back to its default if it was changed only for upload.
13. Record the release, then complete the storage cleanup below.
14. Tell KB the exact build number, delivery UUID, verification state, what changed, and remaining free space.

## Storage cleanup after each release

Complete this cleanup in the same session after the upload and internal testing group have been verified. Use temporary worktrees outside the Projects folder, leaving the main checkout in place.

1. Save the release record and evidence in the main checkout's git-ignored `.codex-dayframe-qa/testflight/build-<number>/` directory. Keep the commit SHA, upload receipt, App Store Connect state, smoke and performance results, exported IPA, signed archive and dSYMs. Keep signing credentials and local environment files private.
2. Check active chats, build processes and each worktree's tracked, untracked and ignored files before removing anything. Keep worktrees used by active work or an open PR. Preserve unsaved source changes. If an obsolete worktree has local changes, archive its files and Git base in `.codex-dayframe-qa/storage-cleanup-<date>/`, verify the archive, and preserve the commit before removing the worktree.
3. Remove completed worktrees with `git worktree remove`. Preserve local branches that contain work. Use `--force` only after inspecting and preserving every local file it would remove. Prune stale worktree registrations afterward.
4. Remove generated caches belonging to the completed release and its retired worktrees, including Xcode DerivedData, archive and Staging build intermediates, test-runner products, duplicate `node_modules`, CocoaPods sandboxes, Swift `.build` directories and Next.js caches. Check that no running process owns them. Keep shared caches used by other projects and the release artifacts retained in step 1.
5. Check that the main checkout and preserved work are intact, record the removed paths, and report remaining disk space. A future device check can rebuild its Staging app from the saved release SHA.

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

A build containing `dayframe-motion-activity` sends Motion & Fitness evidence once the user allows it: the target server environment must already have `202610050001_location_motion_activity.sql` (see the database reference). Check the archive's `Info.plist` carries Dayframe's `NSMotionUsageDescription`.

When a PR adds or changes a local Expo native module, run CocoaPods installation/autolinking and a clean-enough full Xcode build before archive. Because Dayframe checks in and customizes its native iOS project, do not run `expo prebuild --clean` unless the PR explicitly audits and preserves every custom native target, entitlement, App Intent and Live Activity file.

The preflight checks the failure points that have disrupted recent Dayframe releases:

- the Xcode selected for the archive provides a working `xcodebuild` and can resolve the project's release build settings
- set the same `DEVELOPER_DIR` for preflight and archive when using a specific Xcode installation. A selection that only provides Command Line Tools fails preflight
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
2. Archive from the detached worktree pinned to the merged release SHA with `xcodebuild archive`.
   When a copied dependency tree brings an Expo Modules JSI cache from another worktree, the SwiftShims compiler error names the old cache path. Move aside only the generated `node_modules/expo-modules-jsi/apple/.DerivedData` in the pinned release worktree, then rebuild from the same SHA.
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

For pre-merge checks, use staging instead: verify the branch Preview commit, staging schema, stable-alias promotion, provider login, anonymous `401` behavior, and the feature-specific browser/mobile matrix before approving merge.

## Mobile Runtime Check

From the physical iPhone, verify:

- TestFlight shows the expected version/build.
- The app diagnostics or Settings show the expected API base URL.
- Health permissions are granted.
- The current account/workspace matches the server logs being inspected.
- For native Calendar releases, repeated pinch-in/pinch-out, vertical pan, day/week navigation, active/completed/review entry taps, theme changes, Dynamic Type, VoiceOver, Reduce Motion, and Reduce Transparency all use the updated native surface without a release-time zoom snap.

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
