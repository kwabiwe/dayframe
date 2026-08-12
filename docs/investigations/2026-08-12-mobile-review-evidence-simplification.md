# Mobile Review and Location Evidence simplification

Date: 2026-08-12

## Reported behaviour

The mobile Review screen gives diagnostic metadata and warnings similar visual
weight to the detected activity and time. Individual commute suggestions sit
inside one large Review surface, so adjacent items blend together. Location
Evidence repeats raw technical summaries, retention details, boundary language,
and millisecond-origin timestamps after the user has already chosen to inspect
one suggestion. Commute resolution also inherits the generated title
`Possible journey` instead of naming the activity as a commute.

The supplied screenshots are the primary visual evidence. They contain no raw
coordinates, tokens, or identifiers and are not committed to the repository.

## Current code path

- `apps/mobile/app/review.tsx` owns the Review summary, cards, overlap copy,
  confidence presentation, actions, and the established Reanimated card
  presence/layout transitions.
- `apps/mobile/app/review/[id].tsx` owns the mobile Location Evidence route and
  resolution actions.
- `apps/mobile/src/components/location/LocationEvidenceMap.tsx` renders the map
  plus its current diagnostic legend and textual summary.
- `apps/web/src/lib/location/location-ingest-service.ts` generates the title for
  new Location V2 commute Review items.
- Review mutations, offline receipts/outbox behaviour, event-first derivation,
  overlap permission, Location V2 thresholds, rollout mode, and API schemas are
  unchanged by this presentation PR.

## Product scope

This PR:

- keeps the concise Review purpose copy and removes Health reprocess diagnostics
  from the ordinary Review disclosure;
- gives each Review item its own fill-led card and prioritises activity plus time;
- replaces raw confidence text with an accessible five-dot indicator;
- reduces overlap to one compact inline notice while preserving explicit
  confirmation;
- reduces the primary Location Evidence presentation to activity, time range,
  and map, while retaining the existing correction and resolution actions; and
- names generated and legacy commute presentation as `Commute` instead of
  `Possible journey`.

Lifecycle-style Where/What editing, nearby-POI correction design, new activity
icons/categories, and automatic commute policy changes remain separate PRs.
No product decision is inferred for those later changes.

## Unresolved product decisions

- PR3 must decide whether `Where were you?` is limited to saved/learned places
  or includes an external nearby-POI provider, including provider cost, privacy,
  attribution, fallback, and correction-learning behaviour.
- PR3 must define the first-party activity/icon catalogue, whether icon and
  colour are category metadata, and how custom activity icons degrade across
  web, React Native, native Calendar, export, and accessibility.
- PR4 must define the confidence threshold for automatic commute logging, the
  overlap policy, user-visible audit/Undo behaviour, false-positive recovery,
  and the staged rollout gate. PR2 does not infer any of these policies from
  the existing confidence labels.

## Motion contract

- Trigger: expanding About Review, resolving/dismissing an item, or navigating
  to and from Location Evidence.
- Owner: About Review and Review card presence/reflow keep the existing
  React Native/Reanimated owners; route push/pop remains owned by Expo Router's
  native stack. No new animation owner is introduced.
- Entrance/update/exit: Review cards retain the existing local presence and
  layout transitions. Restyling and confidence/overlap content are stable card
  layout, not separately animated. Location Evidence uses the existing native
  route transition.
- Surrounding layout: card removal and adjacent-item reflow continue through
  the existing keyed layout transition. About Review expands/collapses through
  its existing local layout transition.
- Interruption: existing stable item IDs, review mutation locks, menu handover
  tokens, and route ownership remain unchanged. Rapid actions cannot install a
  second transition owner.
- Async outcome: existing offline acknowledgement, waiting-to-sync state,
  canonical server reconciliation, and failure retention remain unchanged. No
  new Undo or timeout path is added.
- Accessibility: Reduce Motion continues to remove nonessential local travel;
  the five-dot indicator has a textual and VoiceOver value; card actions retain
  44-point targets; Dynamic Type may wrap copy without shrinking targets; map
  details remain available through a concise map accessibility label.

## Documentation impact

- Product intent: reviewed; no event-first, privacy, or automation-policy change.
- Architecture/API/schema: no ownership, contract, migration, or hosted-schema
  change.
- User-visible UI and motion: update the feature tracker, component/location
  references, validation matrix, and regression checklist in this PR.
- Release: mobile JavaScript changes require a new verified mobile binary before
  they are described as released; TestFlight is not part of the pre-merge PR
  implementation handoff unless explicitly requested.

## Validation evidence

- `npm run lint`: passed, including documentation and iOS configuration checks.
- Workspace typechecks: passed for mobile, shared, database, and web.
- Focused mobile Review tests: 28 passed across two files.
- Focused web Location V2 tests: 9 passed across two files.
- Full mobile suite: 629 passed across 65 files.
- Full shared suite: 152 passed across 10 files.
- Full web suite: 757 passed and one unrelated `CategoryPicker` DOM timing test
  failed while waiting for the create-category dialog in the parallel run. The
  unchanged test file passed 6 of 6 on its single targeted rerun; no
  `CategoryPicker` code is in this PR.
- `npm run build`: passed for the Next.js production build.
- `npm run check:docs`: passed before this evidence update and is rerun as the
  final documentation guard before publication.
- One cold Debug iOS Simulator build compiled all Pods and reached the Dayframe
  app target, then stopped at `[CP] Check Pods Manifest.lock` because the
  generated CocoaPods sandbox contains three current dependency checksums while
  the committed `Podfile.lock` intentionally remains unchanged. No PR2 source
  compile error was reported. Per the bounded-validation instruction, the
  dependency state was recorded without a second pod-install/build cycle.
- PR #169's exact Ready Preview deployment from commit `71edfaa` was assigned to
  `dayframe-staging.vercel.app`; `/login` returned `200` and anonymous
  `/api/bootstrap` returned the expected JSON `401`.
- After regenerating the CocoaPods sandbox, one generic signed Staging build
  succeeded with the staging API base and preview release channel. The signed
  app and Live Activity extension passed `check-ios-build-config.mjs`; the app
  used the development APNs entitlement required by the direct Staging lane.
- Dayframe `0.1.0 (1)` installed and launched on the attached `KB's 17`
  (iPhone 17 Pro, iOS 27.0 beta). Developer Disk Image services reported the
  image compatible and usable after the phone was unlocked. Installing this
  preview replaced the existing app sharing `com.layereight.dayframe`.
- Hands-on Review/Evidence acceptance, Dynamic Type, VoiceOver, and Reduce
  Motion checks remain required before merge. Production/TestFlight was not
  changed or claimed.
