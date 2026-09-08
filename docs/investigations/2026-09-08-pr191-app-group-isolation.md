# PR #191 App Group isolation repair

Scope: repair native shared storage on `codex/location-v2-only-staging`, based on `3345296b760804f593857d160239a2f0831e0535`. No rollout, hosted environment, merge, or release changes are part of this repair.

## Root cause and change

The checked-in Staging host and Live Activity extension already authorize `group.com.layereight.dayframe.staging`; Debug/Release authorize `group.com.layereight.dayframe`. The native shared-container lookup nevertheless hard-coded the production group. This is a repository configuration defect, independent of server schema or deployment state.

Both Info.plist files now expand `DAYFRAME_APP_GROUP` into `DayframeSharedAppGroupIdentifier`, using the exact setting consumed by their App Group entitlements. A shared Swift configuration file is compiled into both targets. It accepts only the configured group matching the exact baked host/extension bundle identity. Missing, non-string, unresolved, unknown-bundle or cross-lane values return no shared container. It does not probe containers or fall back to production. Existing per-process legacy queue fallback and Keychain behavior are preserved.

Documentation impact: native storage ownership and build validation. Architecture, delivery tracker and release reference are updated; no UI/motion, product, schema, API or rollout changes.

## Focused guardrails

- The executable Swift resolver suite covers both host and extension identities and invalid inputs (44 checks).
- `check:ios-config` verifies Debug, Release and Staging host/extension App Group/Keychain settings and exact entitlement/Info.plist wiring.
- `--built-app` checks resolved host/extension bundle and App Group values. `--signed-app` additionally checks the signed App Groups against that identity and supports the staging Keychain suffix.
- CI now compiles Staging rather than Debug and inspects its actual built products, alongside the resolver checks.

## Validation evidence

- Swift resolver: 44 checks passed.
- Mobile Vitest: 104 files, 996 tests passed.
- Mobile TypeScript: passed.
- iOS source configuration and documentation alignment: passed.
- Built-product validator synthetic fixtures: eight passed across both identities and opposite/unresolved/missing group rejection.
- Xcode 26.6 (17F113), unsigned Release Live Activity extension build: passed; built plist resolves `com.layereight.dayframe.DayframeLiveActivity` and `group.com.layereight.dayframe`.
- Full unsigned Staging Simulator build: attempted once, failed in the ReactNativeHealthkit x86_64 static-library write with `errno=28` (disk full). Before failure, its extension product resolved `com.layereight.dayframe.staging.DayframeLiveActivity` and `group.com.layereight.dayframe.staging`. This is not a successful full host build. The task's temporary Derived Data was removed to reclaim disk space.
- CI outcomes are recorded in the task handoff for the exact pushed commit; the full Staging CI build remains required.

## Outstanding staging device evidence

A full unsigned Simulator build cannot prove provisioning or cross-process container access. Before accepting the staging binary on a physical iPhone, validate its signed host/extension entitlements with `--signed-app`, confirm its staging API/identity, then exercise Shortcut queue/catalog and Live Activity Stop hand-off while the production app is also installed. Verify that queues, catalog, authentication and extension state remain isolated, including locked/background invocation and relaunch. Do not infer device completion from a passing resolver test or empty queue.
