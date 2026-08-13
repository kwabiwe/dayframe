# Location Review POI ranking

Date: 2026-08-13

## Reported behaviour

Physical-iPhone validation of nearby places inside a large shopping complex
returned three similarly positioned individual shops while more useful context,
including the shopping centre, restaurant, and cinema visible in Apple Maps,
was absent from the three-item list.

The screenshots are evidence of presentation and provider-result quality only.
No account data, precise coordinates, or raw MapKit responses are committed.

## Research findings

- `MKLocalPointsOfInterestRequest` fetches POIs in a circular or rectangular
  area and can include or exclude categories. Apple does not document its
  result order as popularity or expose a public popularity, rating, footfall,
  or containing-venue score.
- `MKMapItem` exposes a result's name, location, address information, and known
  `MKPointOfInterestCategory`. These are suitable transient ranking inputs.
- `MKLocalSearch.Request` accepts a natural-language query plus a region hint;
  on supported releases `regionPriority = .required` keeps a generated
  contextual search local.
- A repeated distinctive token across nearby result names can identify a
  complex-level context such as a shopping centre or leisure site. A single
  bounded contextual search for that token can surface the site-level result
  and provider-associated destinations that the unqualified nearby request did
  not rank highly.

Primary references:

- <https://developer.apple.com/documentation/mapkit/mklocalpointsofinterestrequest>
- <https://developer.apple.com/documentation/mapkit/mklocalsearch/request>
- <https://developer.apple.com/documentation/mapkit/mkmapitem>
- <https://developer.apple.com/documentation/mapkit/mkpointofinterestcategory>

## Implementation contract

- Keep the existing 750-metre search boundary and three-result UI limit.
- Start with the existing `MKLocalPointsOfInterestRequest`.
- Derive at most one contextual query only when two or more distinct nearby
  names share a distinctive, non-locality token. Generic business/type words
  cannot become a context query.
- Merge only results that remain inside 750 metres. Prefer the first contextual
  venue matching the shared token, then a diverse destination slate. Dining
  and activity/leisure results take precedence over another same-site retail
  tenant; parking, transport, toilets, ATMs, petrol, and similar utilities are
  fallback-only when useful destinations are unavailable.
- Preserve Apple order within each semantic group, with distance and name as
  deterministic tie-breakers. Do not describe this as popularity or claim that
  Dayframe inferred the exact venue.
- If contextual search fails, return the normalized base nearby results. If the
  base request fails, retain the existing manual-search and unknown-place
  fallback.
- Keep all MapKit identifiers, categories, addresses, coordinates, generated
  context, and raw responses transient. Selection continues to persist only a
  trimmed one-time label or the existing saved-place record.
- Do not alter Location V2 sampling, evidence, segmentation, server APIs,
  schema, or background power behaviour.

## Motion contract

- Trigger: opening an unmatched stay starts the existing nearby-place load.
- Owner: React Native remains the single owner of visible section presence and
  layout. The native module owns only the base and optional contextual request
  lifetime.
- Entrance/update/exit: the native module resolves the final ranked set before
  one result-list entrance. There is no visible initial list followed by an
  automatic reorder. Typed-search replacement, clearing, selection, and route
  exit retain their existing local transitions.
- Surrounding layout: the established evidence scroll view absorbs the single
  loading-to-results height change; no new scroll, layout, or map-animation
  owner is introduced.
- Interruption: a newer request, query replacement, navigation, cancellation,
  or module teardown invalidates both native searches. Stale callbacks cannot
  publish into a reopened screen.
- Async outcome: contextual failure falls back to base nearby results without
  removing manual search or the draft. Base failure keeps the existing concise
  unavailable state and unknown-place recording.
- Accessibility: final visual and VoiceOver order match. Dynamic Type may wrap
  rows without changing rank. Reduce Motion uses the existing immediate or
  opacity-only section update; no map recenter animation is added.

## Validation plan

- Swift tests for context-token eligibility, locality/generic-word rejection,
  contextual venue promotion, category diversity, utility demotion,
  deduplication, radius enforcement, contextual failure fallback,
  cancellation, and deterministic ordering.
- Existing TypeScript nearby-controller tests for one visible three-result
  publication, stale request rejection, and failure fallback.
- Mobile typecheck, both native Swift packages, documentation checks, iOS
  configuration check, and one full iOS simulator build.
- Signed staging validation on a physical iPhone with the reported shopping
  complex, plus a non-complex unknown visit, offline/failure fallback,
  VoiceOver order, Dynamic Type, Light/Dark/System, and Reduce Motion.

## Validation evidence

Completed on 2026-08-13:

- `swift test` in `apps/mobile/modules/dayframe-place-search`: 19 tests passed.
- Focused mobile place-search and Review contract tests: 22 tests passed.
- Mobile TypeScript typecheck passed.
- `npm run check:docs`, `npm run check:ios-config`, and `git diff --check`
  passed.
- A full Dayframe Debug build for the booted iOS 26.5 simulator succeeded.
  This compiled the CocoaPods-integrated `DayframePlaceSearch` and
  UIKit-dependent `DayframeLocationVisits` targets. The latter package cannot
  run `swift test` as a macOS executable because it imports UIKit, so the iOS
  build is its applicable native compile check.

Still required before merge:

- Promote the selected Ready Preview to staging and install its signed preview
  build on a physical iPhone.
- Recheck the reported shopping-complex visit and one ordinary unknown visit,
  then cover VoiceOver order, Dynamic Type, appearance, Reduce Motion, and the
  offline/manual-search fallback.
