# Web Place Search Parity

## Scope and baseline

Phase 5 of the Dayframe web-overhaul programme only. This change gives the web
Places flow search-first create, edit and learned-place parity without changing
the mobile place contract, location rollout policy, event-first processing,
database schema, deployment or production environment.

Base: `origin/main` at
`9b5323f94d62db190f2fbbad8c1916391ab20c1b`, confirmed as the exact merge
commit for PR #96.

Branch: `codex/web-place-search`.

## User-reported issue

The web Places experience required people to work directly with latitude,
longitude, radius and priority. It did not offer the search-first place editor
already established on iOS, and create/edit state lived inside the list rather
than at stable routes.

## Current-main reproduction

The untouched PR #96 merge was linted, typechecked, tested, built and opened in
the actual in-app browser at 1440x900 and 390x844 before editing.

- `/places` combined a permanent New place form with the saved and learned
  lists.
- Creating a place exposed Latitude, Longitude, Radius and Priority as the
  primary flow.
- Editing expanded an inline form inside the saved-place row.
- There was no place-search provider, authenticated search route, autocomplete,
  current-location action, map/fallback preview or route-backed editor.
- The list was usable at 390px without horizontal overflow, but the data-entry
  model did not match the current iOS search-first hierarchy.

The programme's old screenshots remain relevant for those Places-specific
problems. Screenshots of pre-Phase-1 controls, pre-Phase-2 navigation and
pre-Phase-4 Reports are outdated and were not reintroduced.

## Root cause

Web Places still used the original generic `EntityForms` implementation. It
predated the iOS place editor and had no server-side provider boundary, so raw
geofence fields became the UI rather than implementation details.

## iOS parity analysis

The iOS implementation established the useful product order: search or choose
a centre, review the Dayframe name and radius, then configure visit
suggestions. React Native continues to own authenticated data and mutations,
while the native module owns MapKit search presentation.

Web now follows the same product order but not the native implementation. React
owns web editor state and existing `/api/places` mutations. An authenticated
Next.js route owns third-party search. MapLibre remains the existing web map
technology. No native module, mobile store or mobile search contract changed.

## Decision and alternatives

Geoapify is the first web provider because the programme selected it and its
autocomplete API supports bounded results plus soft proximity bias. Direct
browser-to-provider requests were rejected because they would expose the key.
A Geoapify-specific response was also not allowed to become a component
contract.

`WebPlaceSearchProvider` is the provider boundary. It returns only normalized
suggestions:

```text
id
title
subtitle
formattedAddress
latitude
longitude
resultType
```

The adapter requests at most six results, times out after 4.5 seconds and maps
provider rejection, failure, timeout and malformed responses to stable internal
errors. The default no-coordinate request uses a soft UK bias, never a country
filter, so an explicit remote search can still return remote results.

## Key security and API route

`GEOAPIFY_API_KEY` is server-only. It is read only by
`apps/web/src/lib/place-search.ts` and is never returned by
`/api/place-search`, rendered into HTML or named with a `NEXT_PUBLIC_` prefix.

`GET /api/place-search`:

- resolves the existing Phase 0 request session before provider work;
- requires a trimmed query from 2 through 160 characters;
- accepts only a complete, finite latitude/longitude bias pair;
- returns normalized suggestions only;
- sets `Cache-Control: private, no-store` for success, validation, auth and
  provider-error responses;
- returns friendly `400`, `503` or `504` errors without upstream URLs, raw
  payloads or configuration names.

## Bias logic

Bias selection is deliberately conservative:

1. a coordinate the person selected in this editor;
2. the existing coordinate while editing;
3. browser location only when permission is already granted;
4. the median centre of valid saved places;
5. no coordinate, leaving the provider's soft UK bias.

Search never prompts for location permission. Only the explicit Current
location button may prompt. Invalid and outlier saved coordinates are ignored.
Bias changes ranking but does not restrict results.

## Privacy and logging

Search text and bias coordinates are ephemeral request data. They are not
stored in Dayframe, added to analytics or logged by the adapter/route. Tests
and browser fixtures use unmistakably synthetic locations. No private home
address, provider payload, API key, route trace or session value was committed.

The existing saved-place mutation remains the only durable write. It stores the
same place/geofence fields as before. Search selection itself does not create
an `activity_event`, `time_entry` or `review_item`.

## Combobox accessibility and request ownership

The editable combobox exposes `combobox`, `listbox` and `option` semantics,
`aria-expanded`, `aria-controls`, `aria-activedescendant` and a live result
count. It supports Arrow Up/Down, Home/End, Enter, Escape, mouse/touch
selection and a 44px clear action.

One `WebPlaceSearchController` owns the 250ms debounce, active request,
`AbortController`, monotonic request sequence, active option and result state.
Rapid input aborts the old request and stale completions cannot replace the
latest result. A selected result is editor state and remains intact if a later
search has no result or fails.

## Editor and list behaviour

`/places/new` and `/places/[id]/edit` are authenticated, force-dynamic server
routes. `/places/new?learnedPlaceId=<id>` reuses the same editor for learned
promotion and rejects a candidate outside the current bootstrap data.

The editor:

- applies a selected suggestion's coordinates and suggests its title until the
  person edits the Dayframe name;
- preserves a manually edited name when a later result changes coordinates;
- supports explicit Current location and Advanced coordinates;
- validates a 25m through 2,000m radius;
- keeps priority out of ordinary UI and always sends `autoStart: false`;
- clears category/activity defaults when Suggest visits here is disabled;
- prevents a duplicate save with a synchronous in-flight ref;
- uses the existing `/api/places` POST/PATCH contract and returns to `/places`
  after success.

The Places page is now a concise saved/learned list with stable Add, Edit,
Delete, details, Save as place, Ignore and Forget actions. Raw coordinates and
priority are absent from the primary list/editor hierarchy.

## Map behaviour and motion contract

The existing MapLibre dependency is reused; no second web map abstraction was
introduced.

- With `NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL`, the editor mounts MapLibre, keeps
  tile attribution enabled, shows a marker/radius polygon and lets a click
  fine-tune the centre.
- Without a configured style, a calm tile-free fallback shows the centre and
  radius while keeping the editor fully saveable.
- Search attribution remains visible in both states.

Motion ownership is local and singular:

- the search controller owns state changes;
- CSS owns only the 140ms result-list opacity/vertical reveal and switch thumb;
- form/list layout reflows without a second animation owner;
- abort/sequence rules own interruption, and failed saves leave editor state in
  place;
- Reduce Motion removes the result animation and switch transitions while
  preserving every state and control.

## Attribution

The editor visibly credits Geoapify and OpenStreetMap beside search. MapLibre
attribution control remains enabled when a tile style is configured. Hosting
documentation records that neither attribution may be removed.

## Database impact

No local SQL or Supabase migration was added or applied. No table, column,
index, RLS policy or rollout flag changed.

Browser QA temporarily inserted synthetic learned-place rows into the existing
local development database so Save as place and Ignore could be exercised.
The saved synthetic places and learned rows were deleted afterward; a final
query confirmed zero Phase 5 QA rows.

## API and mobile compatibility

`/api/places`, `/api/learned-places`, bootstrap DTOs, place/geofence columns and
mobile request payloads are unchanged. `loggingEnabled`,
`defaultCategoryId`, `defaultActivityDescription`, radius, priority and
`autoStart: false` retain the existing server meanings. No project/client UI
was added. `DAYFRAME_LOCATION_ROLLOUT_MODE` and event-first location processing
are untouched.

The complete mobile typecheck and 237-test suite passed after the web change.

## Files changed

- `.env.example`
- `apps/web/src/app/api/place-search/route.ts`
- `apps/web/src/app/api/place-search/route.test.ts`
- `apps/web/src/app/places/page.tsx`
- `apps/web/src/app/places/new/page.tsx`
- `apps/web/src/app/places/[id]/edit/page.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/PlaceEditor.tsx`
- `apps/web/src/components/PlaceMapPreview.tsx`
- `apps/web/src/components/PlaceSearchCombobox.tsx`
- `apps/web/src/components/PlacesManager.tsx`
- `apps/web/src/components/PlacesManager.test.ts`
- `apps/web/src/lib/place-search.ts`
- `apps/web/src/lib/place-search.test.ts`
- `apps/web/src/lib/web-place-editor.ts`
- `apps/web/src/lib/web-place-editor.test.ts`
- `apps/web/src/lib/web-place-search-controller.ts`
- `apps/web/src/lib/web-place-search-controller.test.ts`
- `docs/feature-fix-tracker.md`
- `docs/vercel-supabase-hosting.md`
- `docs/investigations/2026-07-23-web-place-search.md`

## Automated tests

All required commands passed with the repository's bundled native Node runtime:

- `npm run lint`
- `npm run typecheck`
- `npm run test`: 92 files and 639 tests total
  - mobile: 33 files, 237 tests
  - web: 54 files, 308 tests
  - shared: 5 files, 94 tests
- `npm run build`
- `npm run check:brand-assets`
- `git diff --check`
- web lint, typecheck, 54-file/308-test suite and production build
- mobile typecheck and 33-file/237-test suite

The 37 focused Phase 5 tests cover provider normalization/limits, soft remote
bias, missing key, 4xx/5xx, timeout, malformed data, route auth/validation,
private caching, safe errors, two-character threshold, debounce, abort/stale
results, selection retention, keyboard state, clear/Escape, no results,
offline/unavailable copy, bias priority, permission non-prompting, coordinate
validation, name preservation, visit-default clearing, route/list contracts,
attribution, map fallback, duplicate saves and the absence of project/client
controls.

Existing place, learned-place, bootstrap, session, mobile API, geofence and
location-rollout tests remained green.

## Browser validation

The actual in-app browser exercised both the normal no-key server and a
temporary synthetic Geoapify transport that intercepted only the server's
outbound provider request. The transport and key were outside the repository
and were not returned to the browser.

Passed:

- `/places` and `/places/new` at 1440x900, 1280x720, 1024x768 and 390x844 in
  System, Light and Dark: 24 route/appearance/viewport combinations, zero
  horizontal overflow and zero runtime overlays;
- direct edit URL, hard refresh, Back, Forward and Cancel;
- mouse actions, keyboard-only search/selection and 390px touch layout;
- Cherwell, nearby school/church/sports-centre style queries, Heathrow Airport,
  Edinburgh Castle, a synthetic postcode, explicit remote search, no result,
  rapid typing, clear/retype and provider unavailable;
- result count announcement, Arrow selection, Enter selection, name suggestion,
  manual-name retention and selected-result retention after no results;
- create from search, create from Advanced coordinates, edit, rename without
  moving the coordinate, radius edit, visit-suggestion toggle, default
  category/activity, learned-place Save as place and Ignore;
- duplicate-save protection (one row after one save), long-name wrapping,
  map-unavailable fallback and denied Current location;
- offline search after stopping the local server, with the friendly fallback
  rather than a raw network error;
- Geoapify/OpenStreetMap attribution, no synthetic key/raw provider field in
  rendered source and no browser console warning/error;
- Reduced Motion emulation matched, removed list animation and collapsed switch
  motion; emulation and explicit viewport overrides were reset afterward.

## Vercel preview state

No Vercel Preview or Production deployment was created during implementation.
The draft PR may receive the repository's normal Preview. That Preview must
receive a server-only `GEOAPIFY_API_KEY` and be redeployed before live-provider
smoke testing. Production deployment and Production secret changes remain
separately authorised.

## Not run

- live Geoapify browser queries, because no real provider key exists in this
  checkout;
- authenticated Vercel Preview/provider smoke testing;
- a successful allowed browser-geolocation capture (the actual browser covered
  denial; the success path is covered by the extracted helper test);
- a configured third-party MapLibre style/tile load (the actual browser covered
  the required no-style fallback and source/build checks cover the configured
  path);
- an actual empty saved-place workspace in the browser (the empty-list contract
  is covered by the component and source tests);
- Production deployment, Production secret changes, migration, merge or Phase
  6 work.

## Remaining limitations

Provider relevance, quota, real address labelling and configured-map
attribution still need a key-enabled Preview smoke test. Browser geolocation
success depends on real permission/device accuracy. Those checks can affect
release confidence but do not require a schema or mobile contract change.

## Rollback

Revert the Phase 5 PR. Remove `GEOAPIFY_API_KEY` from any Preview configured
only for this work. There is no database rollback, data backfill, mobile
rollback or rollout-flag change.

## PR

Draft PR pending.
