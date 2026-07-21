# App Review Fixes

## Scope

Implement the Dayframe Trello `Inbox – App Review` fixes after PR #87: learned-place details, place-editor alignment, Review brevity, Sync disclosure consistency, native Calendar compact titles, richer task suggestions, and saved-place/learned-review reconciliation.

## Source-of-truth conflict recorded before implementation

`docs/feature-fix-tracker.md` says `iOS place search, compact location settings, and scroll recovery` is still `In progress` on `codex/mobile-place-search-settings-polish`, starting from PR #86 commit `0b83826`, and its verification snapshot names build 58 as latest. The repository and release evidence disagree: local and remote `main` are at merged PR #87 commit `e70155f`, and PR #87 shipped as TestFlight `0.1.0 (60)`.

Implementation choice: treat merged `main`/PR #87 as the code baseline while preserving the tracker as a documentation bug to correct in this PR. No PR #87 feature will be reimplemented.

## Evidence and hypotheses

The Trello descriptions and screenshots are the primary user evidence. Before changing each path, trace the current mobile/native/web/API implementation and record the root cause and selected behavior here.

## Root causes and implementation

- Learned-place details used the generic tall account-row layout for every evidence value and had no explicit header close action. The sheet now keeps copyable address/coordinates rows, compacts numeric evidence into a two-column grid, and exposes a 44-point close action.
- The place editor used a narrow 16-point row gap and a leading-aligned radius group. It now separates the controls by 28 points and centres the radius label/input group.
- Review rendered Health reprocess diagnostics as a permanent full panel. Diagnostics and educational copy now live behind `About Review`; count, concise purpose, and actionable cards remain permanent.
- Device Sync used changing ellipsis copy without expanded semantics or a chevron. It now matches the established disclosure pattern and exposes expanded state.
- Native Calendar required 38 points before rendering any title and used semibold subheadline text. The title threshold is 24 points with compact medium caption typography; metadata remains gated at 58 points.
- Task suggestion identity previously stopped at description/category even though Tags are entry metadata. Suggestion grouping, API query, display, and application now preserve the sorted tag combination while retaining existing time/day ranking.

Saved-place/learned-review reconciliation remains a separate event-first transaction. It will not be guessed into this visual/data-suggestion patch without a proven review-to-cluster identity and explicit confidence outcome.

## Release evidence

- PR: #88
- Merge commit: `eb688c5`
- TestFlight: `0.1.0 (61)`
- Delivery/build ID: `66577a40-9279-4fd0-add8-8849964871e7`
- App Store Connect: `VALID`, `usesNonExemptEncryption=false`, en-GB notes set
- Internal group/state: `Internal Health Debug` / `IN_BETA_TESTING`
- Runtime API: `https://dayframe-web.vercel.app`
- Trello: shipped cards moved from `Inbox - App Review` to `Watch / Verify`; the unshipped saved-place/pending-review reconciliation card moved to `Planned` with the identity constraint documented.

Physical-iPhone, accessibility, and authenticated web journey verification remain open; release evidence does not imply those checks passed.

## Motion contract

- Trigger: opening/closing learned-place details and expanding/collapsing informational or troubleshooting disclosure content.
- Owner: the existing React Native sheet/disclosure owner; native Calendar remains SwiftUI-owned for its block layout only.
- Entrance/update/exit: reuse the nearest existing Dayframe sheet and disclosure behavior; compact layout changes reflow within the existing owner.
- Surrounding layout: disclosure content expands/collapses in place without introducing another scroll or animation owner.
- Interruption: repeated disclosure taps resolve to the latest boolean state; sheet dismissal remains owned by the established modal.
- Async outcome: copy feedback and data mutations preserve their existing optimistic/error behavior; no new Undo or timeout flow is introduced.
- Accessibility: Reduce Motion removes nonessential travel, while state, VoiceOver labels/expanded state, focus continuity, Dynamic Type, and Reduce Transparency remain intact.
