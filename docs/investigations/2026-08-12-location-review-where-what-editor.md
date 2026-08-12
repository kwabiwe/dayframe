# Location Review Where/What editor

Date: 2026-08-12

## Product problem

The simplified mobile Review and Location Evidence presentation from PR #169
makes detected time easier to scan, but correcting a suggestion still exposes
several separate technical action panels. Users need one clear place to answer
three ordinary questions before recording the suggestion: where they were,
what they did, and when it happened.

## Scope and decisions

This PR keeps the existing event-first Location V2 pipeline and its atomic
review mutation owner. It changes the mobile Location Evidence correction
surface to:

- show `Where were you?`, `What did you do?`, and `When?` as distinct,
  fill-led sections;
- let a stay use its current match, choose a nearby saved Dayframe place, or
  search Apple MapKit for an address/POI to save and use;
- let the user edit the activity description and choose from the existing
  category catalogue without creating a category from Review;
- let the user adjust start and end dates/times while preserving canonical
  seconds and milliseconds behind the minute-level controls; and
- submit place, activity, category, and time corrections through one atomic
  Location Review action.

Apple MapKit is already the established iOS-only place-search provider in
`apps/mobile/modules/dayframe-place-search`. It requires no additional API key,
billing surface, server proxy, or third-party place store. The native module
continues to expose only opaque result IDs plus serializable title/subtitle and
the selected result. Raw queries, MapKit objects, and coordinates are not
logged. Search is a user-triggered correction aid; this PR does not silently
query POIs for every Review item.

Activity glyphs are presentation-only and are derived from the commute/stay
kind plus familiar category/activity names. Category colour remains the stored
identity. This PR does not add icon fields to categories, exports, APIs, native
Calendar models, or the database.

## Preserved behaviour

- Commutes remain Review-first and are labelled `Commute`.
- Saved-place correction still writes bounded place-match feedback.
- Selecting a new MapKit result explicitly saves a Dayframe place before the
  visit is recorded.
- Manual map-pin save, split, merge, record-once, confirm, and ignore remain
  available.
- Detailed Location Evidence actions remain connectivity-dependent.
- React Native owns authenticated data, draft state, API mutations, routing,
  and feedback. Swift owns only the existing MapKit search implementation.

## Unresolved follow-ups

- Persisted custom category icons need a separate cross-platform contract for
  web, React Native, native Calendar, export, accessibility, and legacy
  clients. The display-only glyph mapping in this PR does not imply that
  schema.
- Proactive no-query nearby-POI ranking needs a separate privacy, relevance,
  attribution, caching, offline, and correction-learning decision. This PR
  keeps search explicitly user-triggered.
- Commute endpoint correction remains a separate Location V2 product/data
  decision. The commute route is shown on the map, but `Where were you?`
  correction applies only to stays.

## Motion contract

- Trigger: typing a place query, selecting or clearing a place, opening or
  closing More options, opening a date picker, or resolving the Review item.
- Owner: Expo Router/native stack owns route push/pop; the existing
  `FloatingDatePicker` owns its overlay; Reanimated owns only local search-result
  and More-options presence/layout. No Swift or second route animation owner is
  introduced.
- Entrance/update/exit: search results and advanced content use the shared
  restrained fade/rise presence treatment. Adjacent content uses the shared
  220 ms local layout transition. Selected place/category/time values update in
  place without decorative movement. The date picker keeps its existing
  coordinated overlay entrance and exit.
- Surrounding layout: one local layout owner reflows the affected correction
  section; the map and route header do not animate or rebuild.
- Interruption: `PlaceSearchController` request generations reject stale
  results and cancel on clear/unmount. A single saving gate disables duplicate
  resolution actions. Rapid disclosure changes resolve to the latest local
  state.
- Async outcome: the draft is not optimistically removed. Success uses the
  existing acknowledgement and route exit; failure retains the complete draft
  for retry. Undo and timeout do not apply.
- Accessibility: Reduce Motion removes spatial travel and keeps restrained
  opacity/immediate layout; every action remains at least 44 points; selection
  has text plus colour/icon cues; VoiceOver labels describe place, category,
  date, and time state; Dynamic Type can wrap text or scroll bounded horizontal
  choices without clipping; Reduce Transparency keeps semantic surface fills.

## Documentation impact

- Product/architecture: no event-first, rollout, ownership, database, or
  automatic-logging policy change.
- API: `change_place_and_confirm` gains an optional existing
  `ReviewEntryEdit` payload so corrected place, activity, category, and time
  commit together.
- UI/motion: update the tracker, component and location-learning references,
  validation matrix, and regression checklist.
- Release: this is mobile JavaScript plus a mobile-consumed API-contract change;
  it needs a staging Preview and preview build before merge, but no new native
  module implementation or CocoaPods change.

## Validation evidence

- Mobile, shared, and web workspace typechecks passed.
- Focused mobile tests passed: 13 tests across the Location Review draft and
  Review action contract files.
- Focused shared schema tests passed: 2 tests for strict atomic saved-place
  correction payloads.
- Focused web tests passed: 11 tests across the Location Review service and
  Review route, including one transaction carrying place, category, activity,
  start, and end changes.
- Web lint passed.
- The optimized Next.js production build passed.
- `npm run check:docs` passed for 105 Markdown files.
- `npm run check:ios-config` passed.
- `git diff --check` is run again after this evidence update before publication.
- Full workspace suites were not repeated; validation stayed deliberately
  focused on the affected mobile presentation, shared schema, and web service
  boundary to avoid a testing loop.
- No Swift, Expo module, Pod, entitlement, native project, or dependency-graph
  source changed, so no new native compile was run. The established
  `dayframe-place-search` module is already in preview builds. Normal/Reduce
  Motion recording, Dynamic Type, VoiceOver, MapKit search, atomic resolution,
  staging alias, and signed preview-iPhone acceptance remain explicit
  pre-merge evidence rather than being inferred from source/tests.
