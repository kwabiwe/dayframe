# Web Review evidence map and Resolve layout

Status: implementation in progress on `agent/web-review-evidence-layout` from
merged PR #177 baseline `82a15a2`.

## Reported problem

The web Review evidence panel looked broken because its MapLibre surface had no
base-map provider configured. In the supplied endpoint-only commute example,
the API correctly returned a dashed straight-line estimate with zero mapped GPS
samples and zero arrival/departure anchors, but the tile-free canvas did not
explain that distinction. The same panel presented Description, Category,
Start, and End as four large outlined rows instead of the compact fill-led field
language used by Dashboard and Timeline.

The broader app-wide field-border audit remains separate. This change is scoped
to Review evidence/provider states and the Resolve section.

## Root cause and evidence

- `NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL` is absent locally and from Vercel Preview
  and Production, so `LocationEvidenceMap` deliberately created an empty style.
- `GEOAPIFY_API_KEY` is already configured server-side in both hosted lanes for
  authenticated place search. It must stay server-only; it is not safe to reuse
  the unrestricted key in a `NEXT_PUBLIC_` variable.
- The screenshot's dashed line came from `straightLineFallback`, which is the
  intended saved-endpoint estimate when a commute has fewer than two route
  samples. Query logic is therefore not being widened to invent evidence.
- The evidence summary treated “inside the retention window” as though raw
  evidence existed even when `rawEvidenceAvailable` was false.

## Implementation contract

- Reuse the server-only Geoapify key through authenticated same-origin map-style
  and raster-tile routes. The style uses a relative tile template so reverse
  proxy host normalization cannot create a cross-origin request. Browser
  responses never contain the provider key.
- Preserve the optional authorised `NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL`
  override and a usable tile-free fallback when no provider is available.
- Keep provider/data attribution visible. Map tiles are private browser-cacheable
  and every provider response is type/size bounded.
- Distinguish observed route, endpoint estimate, detected area, mapped evidence,
  no mapped evidence, raw-evidence expiry, provider loading, and provider error.
- Keep evidence geometry visible when the base map cannot load. Never replace an
  endpoint estimate with a claimed route.
- Arrange Description, Category, Start, and End in one fill-led Resolve row at
  wide panel widths, two columns at medium widths, and one column only at the
  narrow threshold. Category uses the shared picker and portals its menu outside
  the query container.

## Review follow-up

- Keep normal session authentication on every map-tile request, but pass a
  coordinate-free route template to auth diagnostics. Neither successful nor
  rejected tile requests may persist the requested XYZ values in logs.
- Treat `Content-Length` as an early rejection hint, not the size boundary.
  Read provider bodies incrementally, enforce the 3 MB cumulative limit while
  streaming, and cancel the provider body immediately when it is exceeded.

## Motion contract

- Trigger: the existing View evidence disclosure opens the existing panel.
- Owner: `ReviewInbox` continues to own disclosure; MapLibre owns only map
  interaction. This PR adds no second animation owner.
- Entrance/update/exit: existing row/panel motion is unchanged. Provider status
  updates inside a fixed-height map frame, so loading, ready, fallback, and error
  do not move surrounding content.
- Interruption: closing the panel aborts style discovery and removes the MapLibre
  instance. A late provider response cannot remount it.
- Async outcome: provider failure retains evidence geometry and Resolve controls;
  evidence-fetch failure retains the panel with an in-place Retry action.
- Accessibility: status changes use polite status text; the map is a labelled
  region so its 44px controls remain reachable. Reduced Motion needs no special
  branch because no new travel, scale, or spring is introduced.

## Validation target

- Behavioural tests for map provider routes, authentication, coordinate-free
  diagnostics, bounded chunked responses, coordinate bounds, key
  non-disclosure, evidence-state language, loading/error retry, Category
  selection, and Resolve submission.
- Web typecheck, lint, focused/full tests, production build, docs checks, and
  clean diff checks.
- Rendered desktop/phone and light/dark checks for layout, overflow, provider and
  tile-free states, attribution, focus, MapLibre cleanup, and console errors.
