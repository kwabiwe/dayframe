# Location commute, visit, and Review polish

Date: 2026-07-27

## Reported behaviour

A multi-hour visit to a large retail destination produced ordinary pedestrian
movement suggestions labelled as commutes. Commute cards could show no
category, Review actions wrapped into an inconsistent row, and Location
Evidence used a text chevron instead of the established mobile back glyph. A
later departure began around a GPS-poor car park and may have been absent
before or after the destination-finalisation window.

Private coordinates, device identifiers, evidence identifiers, tokens, raw
payloads, and screenshots are deliberately excluded from this investigation.

## Current code path

The iOS location providers enqueue standard, visit, significant-change,
geofence, pause, resume, and provider evidence. Mobile persists and replays the
evidence through the shared `location-v2.0` engine. Server ingestion stores
user-scoped evidence, replays stays and commutes, reconciles still-open
semantic rows, and emits review-first activity events and Review items under
the acknowledged rollout mode.

## Reproduction fixtures

Before implementation, focused regressions were added for:

- a nearby endpoint-only transition;
- a pedestrian retail-site transition with one isolated speed outlier;
- a legacy V2 commute without a category;
- the wrapping four-peer mobile action contract;
- the Location Evidence text-chevron back affordance; and
- V2 category/confirmed-description source contracts.

The baseline failures and final validation evidence are recorded below.

## Root cause and hypotheses

Confirmed:

- commute derivation gated only on duration and, for same-known-place trips,
  the presence of two route samples;
- distance, route efficiency, credible speed distribution, and local looping
  were not qualification gates;
- V2 commute emission had no category context and wrote null;
- V2 direct confirmation could fall back to the generated Review title;
- mobile Review actions were peers in one wrapping row;
- Location Evidence used a local `‹` text glyph.

Synthetic lifecycle findings:

- the GPS-poor car-park sequence produces no commute for the short pedestrian
  move and no commute during the blackout;
- after two credible displaced route samples and a credible destination stay,
  it produces one uncertain possible commute;
- before the existing 10-minute finalisation lag the commute is closed but is
  not semantic output; after the lag it is finalised and eligible;
- the screenshot timing therefore does not prove a post-finalisation missing
  commute, and retained authorised evidence was not available to prove one;
- the recovered start remains bounded by the last credible origin/car-park
  evidence and the first credible displaced sample rather than assigning a
  precise moment inside the blackout; and
- compatible unknown stays can be joined conservatively when visit support,
  local pedestrian route evidence, and the later dwell all agree.

## Commute qualification

Duration remains only a candidate-window guard (`3m` to `6h`). A pure evidence
summary now measures route/speed sample counts, accuracy-filtered speed
distribution, route and endpoint distance, route efficiency, maximum
excursion, endpoint strength, same-place identity, and maximum observation
gap. A separate pure qualifier returns a stable reason and confidence.

The central `LOCATION_ENGINE_V2_CONFIG` values are:

- meaningful endpoint separation: `800m`;
- local endpoint band: less than `450m`;
- meaningful sampled route: `1200m`;
- minimum route efficiency: `0.25`;
- faster movement: at least three credible samples at or above `2.8m/s`,
  with horizontal accuracy no broader than `65m`;
- same-known-place round trip: at least three route samples, `1800m` sampled
  route, `650m` maximum excursion, and robust faster movement.

Different endpoints at least `800m` apart remain possible even in slow traffic.
An endpoint-only journey above that gate remains low-confidence and
uncertain. Between `450m` and `800m`, a candidate needs the sampled-route and
efficiency gates. Movement below `450m` is rejected as local/insufficient, not
retained as a low-confidence commute. Same-place journeys use the stronger
round-trip rule. Confidence reflects endpoints, continuity, distance and
credible movement rather than raw point volume.

## Visit continuity

A pure post-segmentation step can coalesce adjacent unknown stays only when:

- neither side is a saved, learned or ambiguous identity;
- at least one side contains a real visit observation;
- the later dwell already qualified as a stay;
- endpoint separation is at most `450m`;
- the transition is at most `45m`;
- the route is at most `1200m`; and
- at least two accuracy-credible route samples have a 75th-percentile speed no
  faster than `2.5m/s`.

The coalesced segment retains the earliest stay's deterministic ID so replay
updates an open semantic row in place and existing manual-resolution
protection remains effective. It also uses ordered unique evidence IDs, the
earliest start, latest supported stop, outer uncertainty bounds, a
sample-weighted centre, and the lower of the two confidences. Vehicle evidence
prevents the merge. Distinct saved/learned places are never merged, and the
global unknown/saved radii are unchanged.

This improves visit continuity when the existing evidence genuinely supports
one large-site visit. It does not claim external knowledge that a shopping
centre and car park share a site. Without visit support and local pedestrian
evidence, the defensible separate stay boundaries remain; richer grouping
would require user-saved boundaries or place data outside this PR.

## Category and description flow

The existing automatic-category lock/select/insert logic moved unchanged into
`automatic-category-service.ts`. Its transaction-scoped advisory key includes
workspace and lower-case name; it reuses active categories case-insensitively
and creates `Commute` with palette key `sky` only when absent.

V2 semantic emission ensures Commute inside the existing ingest transaction
before writing either row. The resulting ID is assigned to both
`activity_events.suggested_category_id` and
`review_items.suggested_category_id`; PR #115's still-open replay update uses
the same value. Accepted, ignored and manually corrected rows retain their
existing protection. Stay/visit items continue to use only their trusted-place
default, if any.

Confirmation preserves an explicit edited category, otherwise uses the stored
suggestion, and ensures Commute as defence in depth for legacy null-category
rows. Direct, blank and omitted commute descriptions all become null; an
explicit non-empty description is trimmed and preserved. Visit confirmation
keeps its existing title fallback. Read-only bootstrap performs no category
creation.

## Mobile action layout

The approved hierarchy is one full-width evidence action, one full-width
semantic confirm action, then one trailing 44-point overflow trigger. Edit and
Dismiss move into the overlay menu and keep their existing mutations. Labels
are `Confirm commute`, `Confirm visit`, or `Confirm activity`. Legacy
null-category commute cards and edit drafts present Commute semantically while
the next emission or confirmation persists the real ID. An explicit
non-Commute choice is not overwritten.

The focused `OverflowMenu` uses a transparent Dayframe-themed modal, phone-safe
`360pt` maximum width, safe-area bottom padding, 48-point expandable rows,
modal accessibility semantics, outside/back dismissal, and one action lock.
Only one item ID can be open. Refresh, navigation, item removal and resolving
state close stale menus. The card geometry does not change while the menu is
open.

`MobileBackButton` centralises the existing 44-point circular affordance and
20-point chevron geometry. Review and Location Evidence now use the same
component; native route pop remains the navigation owner.

## Overflow-menu motion contract

- Trigger: tap the trailing overflow control on a Review card.
- Owner: one React Native/Reanimated modal overlay.
- Entrance: opacity plus a small upward translation; Reduce Motion uses
  opacity only.
- Update: the Review card and surrounding list geometry do not move.
- Exit: the same owner reverses the short transition before unmounting for
  outside tap, action selection, back, refresh, navigation, or stale target.
- Interruption: the latest requested open card wins; stale callbacks cannot
  reopen or act on a removed card.
- Async outcome: the menu closes before the existing edit or dismiss path.
  The current optimistic card resolution and error handling remain the owner.
- Accessibility: modal semantics, ordered labelled rows, 44-point targets,
  Dynamic Type growth, VoiceOver focus continuity where React Native permits,
  and no translation under Reduce Motion.

## Privacy

Only coordinate-free synthetic evidence and stable diagnostic reason codes are
used in committed tests and documentation. No raw location points are logged
by the qualification helper.

## Database impact

No migration added. Existing boundary columns, suggested-category columns, and
JSON metadata are sufficient for the classification reason and uncertainty
data. The rollout mode and `location-v2.0` algorithm version are unchanged.

## Validation evidence

Failing baseline:

- shared focused run: 26 tests, one failure because a nearby `334m`
  endpoint-only transition became a commute;
- mobile focused run: legacy Commute draft plus the action/back contracts
  failed as expected;
- web focused run: emission category, shared category helper, and
  confirmation-description contracts failed as expected.

Focused corrected runs:

- `npm run typecheck -w @dayframe/shared` — passed;
- `npm run test -w @dayframe/shared -- test/location-v2.test.ts` — 34/34
  passed;
- `npm run typecheck -w @dayframe/web` — passed;
- web automatic-category/location-review focused tests — 10/10 passed;
- `npm run typecheck -w @dayframe/mobile` — passed;
- mobile Review helper/source-contract tests — 19/19 passed;
- `git diff --check` — passed at the focused checkpoint.

Broad corrected runs:

- `npm run test -w @dayframe/shared` — 5 files, 104/104 tests passed;
- `npm run test -w @dayframe/web` — 77 files, 469/469 tests passed;
- `npm run test -w @dayframe/mobile` — 39 files, 281/281 tests passed;
- workspace total — 854 tests passed;
- `npm run validate:location-v2-sqlite` — passed;
- `npm run validate:location-v2-db` against a fresh disposable PostGIS
  database — passed, including concurrent automatic-category ensure,
  event/Review assignment, replay repair and protection, description
  semantics, repeated confirmation, and workspace isolation;
- `npm run lint` — passed;
- `npm run typecheck` — passed for shared, web, and mobile;
- `npm run build` — passed, including the 30-page Next.js production build;
- `npm run check:brand-assets` — passed; and
- `git diff --check` — passed.

iOS dependency and build evidence:

- `npx expo install --check` reported pre-existing Expo patch-version drift
  (`expo`, linking, location, modules-core, router, task-manager, and screens);
  dependency upgrades are explicitly outside this PR and no package or lock
  update is included;
- `pod install` completed with 113 dependencies and 112 pods;
- a clean DerivedData build initially reached the app target but CocoaPods
  rejected the repository's older tracked checksum values against the freshly
  installed sandbox;
- after `pod install` synchronized the local sandbox, the freshly cleaned
  Debug simulator build passed, and a second ad-hoc-signed simulator build
  passed so SecureStore could run; and
- the generated `Podfile.lock` checksum-only changes were restored and are not
  part of this branch.

Simulator record:

- device: iPhone 17 Pro Max simulator;
- iOS: 26.5;
- source: `codex/location-review-commute-quality` based on `f15cd440`;
- API: `http://localhost:3000`, backed by a disposable synthetic PostGIS
  database removed after validation;
- bootstrap: `authMode=dev`, `locationRolloutMode=v2_shadow`;
- location/Precise Location: not requested or exercised;
- appearance: in-app Light preference, default Dynamic Type, Reduce Motion
  off;
- Review list: passed with one synthetic commute plus one visit; Commute
  category, full-width equal-height evidence/semantic-confirm actions,
  trailing overflow, multiple-card scrolling, and no horizontal wrap were
  visually confirmed;
- overflow: open overlay passed at the bottom viewport edge with unchanged
  card geometry, correct row order, separator, quiet danger treatment,
  dimmed/inert-looking background, and no clipping;
- Location Evidence: shared 44-point circular back affordance and complete
  evidence layout rendered correctly; and
- no simulator images or recordings are committed.

The Mac was locked during the run, so pointer/keyboard interaction, repeated
outside dismissal, action selection, VoiceOver focus, large Dynamic Type, and
Reduce Motion animation could not be exercised. Switching the simulator
system appearance to Dark left Dayframe in its explicitly stored Light
preference, so Dark and System app-theme passes remain outstanding. Pure menu
state/contract tests cover deterministic toggle, one-open-item ownership,
disabled/duplicate-action blocking, stale-target reconciliation, callback
mapping, and source action order, but they do not replace the physical checks.

## Still required before merge

- Physical-iPhone local-walk, genuine-journey, and GPS-poor departure watch
  after destination dwell and finalisation.
- Physical-iPhone overflow-menu VoiceOver, Dynamic Type, Reduce Motion, theme,
  edge placement, rapid-repeat, and frame-pacing checks.
- Simulator or physical-device interactive recording of menu entrance,
  outside dismissal, Edit/Dismiss selection, and Reduce Motion behaviour.
