# Dayframe Integration API

Dayframe exposes a small versioned, read-only API for trusted first-party or private integrations
(today: OpenClaw, the owner's assistant "Major"). It is not a public platform surface; keep clients
server-side and token-protected. Every endpoint is a `GET` under `/api/integrations/v1/`, answers
JSON with `Cache-Control: no-store`, and never writes data. Use the normal authenticated app APIs for
user-driven edits.

## Tokens and scopes

Send a bearer integration token:

```http
Authorization: Bearer <integration-token>
```

Integration tokens are separate from app sessions. A token belongs to one workspace and reads as that
workspace's owner; every read is restricted to that workspace and user. The database stores only the
SHA-256 hash (`integration_tokens.token_hash`) and the token's `scopes`; a token is revoked by setting
`revoked_at`, after which every request answers `401`. The local development `DAYFRAME_INGEST_TOKEN`
grants every integration scope.

| Scope | Grants | Sensitivity |
| --- | --- | --- |
| `time:read` | `time/current`, `time/entries`, `time/summary`, `context` (its time part) | Logged time |
| `location:read` | `location/drives`, `location/routes`, `location/visits`, `context.location` | Saved-place names and times; never coordinates |
| `review:read` | `review/summary`, `context.review` | Counts only |

An app session (web cookie or iPhone bearer) holds `time:read` but never `location:read` or
`review:read`, so location and Review reads are integration-token only. Grant each integration only
the scopes it needs; give a location consumer its own token so it can be revoked alone.

Manage tokens with the script (it prints a new token once; store it in the client's secret file):

```bash
npm run integration-token -- list <workspace-id>
```

The same script takes `create <workspace-id> "<name>" <scope,scope>`, `scopes <token-id> <scope,scope>`
and `revoke <token-id>`, against the database in `DATABASE_URL`. Creating, re-scoping or revoking a
hosted token is a hosted data change: it needs the owner's approval, staging first.

## Errors

| Status | Body | Meaning |
| --- | --- | --- |
| `400` | `{ "error": "<plain reason>" }` | A parameter is missing, malformed or out of bounds. |
| `401` | `{ "error": "...", "code": "integration_token_invalid" }` (or a session reason code) | Unknown or revoked token. |
| `403` | `{ "error": "...", "code": "insufficient_scope" }` | The token lacks a required scope. |
| `500` | `{ "error": "Unable to load …" }` | Server or database failure; no SQL or payload is echoed. Retry with backoff. |

## Freshness and polling

Dayframe's location data reaches the server when the iPhone syncs (foreground, background location
wakes, or a Health/timer background window), so the newest trip or stay can be minutes to hours old.
Times are ISO-8601 UTC. Every reply carries `serverNow`; compute elapsed or "how long ago" from it,
not from the client clock.

| Endpoint | Changes | Suggested polling |
| --- | --- | --- |
| `context` | Timer: on Start/Stop. Location: on sync. | Every 5–15 minutes; once a minute only while a decision is due |
| `time/current` | On Start/Stop | Same as `context` (prefer `context`) |
| `time/summary` | As entries are logged | Hourly, or at the end of a day/week |
| `time/entries` | As entries are logged | On demand |
| `review/summary` | As cards arrive or are answered | Hourly (prefer `context`) |
| `location/drives`, `location/routes` | When trips are confirmed (a few a day) | At most every 30 minutes; cache between |
| `location/visits` | On sync | On demand |

## Current timer

```http
GET /api/integrations/v1/time/current
```

Scope `time:read`. The running entry (or `null`) and today's tracked seconds in the London day
(every entry, a running one counted up to now).

```json
{
  "ok": true,
  "serverNow": "2026-07-12T11:00:00.000Z",
  "workspaceId": "00000000-0000-4000-8000-000000000010",
  "activeEntry": {
    "id": "10000000-0000-4000-8000-000000000001",
    "description": "School pickup",
    "startedAt": "2026-07-12T10:30:00.000Z",
    "stoppedAt": null,
    "elapsedSeconds": 1800,
    "source": "mobile_timer",
    "confidence": "high",
    "reviewStatus": "confirmed",
    "project": null,
    "category": {
      "id": "20000000-0000-4000-8000-000000000001",
      "name": "Family",
      "color": "rose"
    },
    "place": null,
    "tags": [],
    "updatedAt": "2026-07-12T10:30:00.000Z"
  },
  "todaySeconds": 5400,
  "updatedAt": "2026-07-12T10:30:00.000Z"
}
```

Render elapsed time locally from `serverNow`, `activeEntry.startedAt` and `activeEntry.elapsedSeconds`.

## Logged time entries

```http
GET /api/integrations/v1/time/entries?from=<ISO-8601>&to=<ISO-8601>&limit=50&cursor=<opaque>
```

Scope `time:read`.

- `from` and `to` are required. The range uses overlap semantics, so entries crossing either boundary
  are included. One request may cover at most 90 days.
- `limit` defaults to 50 and may be 1–100.
- Pass the opaque `nextCursor` unchanged to retrieve the next page. Do not construct or inspect cursors.
- Results are newest-first. Running entries may appear with `stoppedAt: null`.

```json
{
  "ok": true,
  "serverNow": "2026-07-24T22:00:00.000Z",
  "workspaceId": "00000000-0000-4000-8000-000000000010",
  "range": { "from": "2026-07-20T00:00:00.000Z", "to": "2026-07-25T00:00:00.000Z" },
  "entries": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "description": "Vibe coding",
      "startedAt": "2026-07-24T19:00:00.000Z",
      "stoppedAt": "2026-07-24T20:30:00.000Z",
      "elapsedSeconds": 5400,
      "source": "manual_app",
      "confidence": "high",
      "reviewStatus": "confirmed",
      "project": null,
      "category": { "id": "20000000-0000-4000-8000-000000000001", "name": "Coding", "color": "rose" },
      "place": null,
      "tags": ["Cubic"],
      "updatedAt": "2026-07-24T20:30:00.000Z"
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

`category.color` and legacy `project.color` are stored compatibility strings. Current category rows
normally return a stable key from `packages/shared/src/palette.ts`; older rows may still return a
legacy HEX value, so clients should use Dayframe's shared resolver rather than assume one representation.

## Time summary

```http
GET /api/integrations/v1/time/summary?period=day|week&date=YYYY-MM-DD
```

Scope `time:read`. Logged time in the Europe/London day, or the Monday-to-Sunday week, holding `date`
(default: today). Each logged entry counts its time inside the period; a running entry counts up to
now. Entries awaiting Review or ignored are left out (so this can be lower than `todaySeconds`).
Uncategorised time is the row with `id: null`. `date` in the reply is the period's first day.

```json
{
  "ok": true,
  "serverNow": "2026-10-25T12:00:00.000Z",
  "workspaceId": "00000000-0000-4000-8000-000000000010",
  "period": "day",
  "timeZone": "Europe/London",
  "date": "2026-10-25",
  "range": { "from": "2026-10-24T23:00:00.000Z", "to": "2026-10-26T00:00:00.000Z" },
  "totalSeconds": 5400,
  "entryCount": 2,
  "running": true,
  "categories": [
    { "id": null, "name": null, "color": null, "seconds": 3600, "entryCount": 1 },
    { "id": "20000000-0000-4000-8000-000000000001", "name": "Family", "color": "rose", "seconds": 1800, "entryCount": 1 }
  ]
}
```

`400` for a `period` other than `day`/`week` or a `date` that is not a real calendar date.

## Review summary

```http
GET /api/integrations/v1/review/summary
```

Scope `review:read`. Open Review cards counted as Review shows them (an outing's Moves fold into its
Stay card), by kind, with the oldest and newest card's creation time. Counts only: no titles, places,
times or evidence.

```json
{
  "ok": true,
  "serverNow": "2026-10-25T12:00:00.000Z",
  "workspaceId": "00000000-0000-4000-8000-000000000010",
  "openCards": 2,
  "byKind": { "place": 0, "trip": 1, "health": 1, "other": 0 },
  "oldestOpenAt": "2026-10-20T08:00:00.000Z",
  "newestOpenAt": "2026-10-22T08:00:00.000Z"
}
```

## Context (one poll)

```http
GET /api/integrations/v1/context
```

Scope `time:read`; adds `location` with `location:read` and `review` with `review:read`. A section the
token cannot read is `null` and named in `omitted`. Prefer this over polling the individual endpoints.

```json
{
  "ok": true,
  "serverNow": "2026-10-25T12:00:00.000Z",
  "workspaceId": "00000000-0000-4000-8000-000000000010",
  "activeEntry": null,
  "todaySeconds": 5400,
  "location": {
    "place": { "id": "30000000-0000-4000-8000-000000000001", "name": "Home", "role": "home" },
    "since": "2026-10-25T09:00:00.000Z",
    "travelling": false,
    "observedAt": "2026-10-25T11:50:00.000Z",
    "stale": false
  },
  "review": { "openCards": 2, "byKind": { "place": 0, "trip": 1, "health": 1, "other": 0 }, "oldestOpenAt": "2026-10-20T08:00:00.000Z" },
  "omitted": []
}
```

`activeEntry` and `todaySeconds` are as in `time/current`. `location.place` is the open stay at a saved
place (`null` at an unknown place, between stays, or while `travelling`); `observedAt` is the newest
location reading the server holds from the last day (`null` if none) and `stale` is true when it is
older than 30 minutes or missing. Never act on a `stale` location as if it were current.

## Driving evidence

```http
GET /api/integrations/v1/location/drives?days=180&limit=1000
```

Scope `location:read`. Confirmed home-origin drives to saved places, newest first: the evidence
OpenClaw's Tesla preheat uses to learn a route's journey time. Both parameters are optional (the
consumer calls the bare path): `days` 1–365 (default 180), `limit` 1–5000 (default 1000). `truncated`
is true when more drives exist in the window than `limit`.

A sample is a trip from Dayframe's location timeline that is all of:

- **confirmed** — not superseded, and a block made from it is logged (automatically, or accepted from
  Review); an unanswered or ignored card, a deleted block or a trip without a block never counts;
- **driving** — the trip's mode is driving and its legs are driving or walking (to and from the car),
  with at least one driving leg when it has legs; a bus, train, cycle or run leg excludes it;
- **from Home** — it leaves the saved place whose role is Home;
- **to a different saved place**, direct — no stop on the way, never a time-away outing; unknown and
  learned destinations are left out.

Stays are never treated as drives, and nothing is inferred beyond the timeline Dayframe already shows.

```json
{
  "ok": true,
  "serverNow": "2026-10-25T12:00:00.000Z",
  "range": { "from": "2026-04-28T12:00:00.000Z", "to": "2026-10-25T12:00:00.000Z" },
  "samples": [
    {
      "routeId": "activity:riverside pool",
      "departedAt": "2026-10-05T08:40:00.000Z",
      "arrivedAt": "2026-10-05T09:00:00.000Z",
      "confirmed": true,
      "mode": "driving",
      "homeOrigin": true,
      "eventStartedAt": null,
      "provenance": "dayframe-location-drive:6f1c…",
      "durationSeconds": 1200,
      "drivingSeconds": 1080,
      "destination": { "placeId": "30000000-0000-4000-8000-000000000002", "name": "Riverside Pool", "role": null }
    }
  ],
  "truncated": false,
  "coverage": { "sampleCount": 1, "routeCount": 1, "latestDepartedAt": "2026-10-05T08:40:00.000Z" }
}
```

- `routeId` is `activity:` plus the destination's name as the interface shows it, normalised as the
  consumer normalises it (NFKC, single spaces, trimmed, lower case). A calendar event matches the route
  when its location normalises to the same name, so name saved places as the calendar names them.
- `departedAt`/`arrivedAt` are the trip's door-to-door start and end (including a walk to or from the
  car); `drivingSeconds` is the driving legs alone (`null` for older trips without legs).
- `eventStartedAt` is always `null`: Dayframe holds no calendar, so it has no genuine event start.
  A consumer that needs an arrival buffer must take the event start from its own calendar.
- `provenance` is an opaque, stable trip reference; do not parse it.

## Route estimates

```http
GET /api/integrations/v1/location/routes?days=180&minSamples=3
```

Scope `location:read`. Typical journey times between two saved places by mode, from the same
confirmed, direct trips (any origin, any mode). A route appears only with at least `minSamples`
trips (3–50, default 3). Seconds are door to door; `p80Seconds` is the nearest-rank 80th percentile,
a sensible "leave by" allowance. Estimates use at most the 5,000 most recent trips (`truncated`).

```json
{
  "ok": true,
  "serverNow": "2026-10-25T12:00:00.000Z",
  "range": { "from": "2026-04-28T12:00:00.000Z", "to": "2026-10-25T12:00:00.000Z" },
  "minSamples": 3,
  "routes": [
    {
      "routeId": "30000000-…-0001:30000000-…-0002:driving",
      "from": { "placeId": "30000000-0000-4000-8000-000000000001", "name": "Home", "role": "home" },
      "to": { "placeId": "30000000-0000-4000-8000-000000000002", "name": "Riverside Pool", "role": null },
      "mode": "driving",
      "sampleCount": 3,
      "medianSeconds": 1020,
      "p80Seconds": 1200,
      "minSeconds": 900,
      "maxSeconds": 1200,
      "latestDepartedAt": "2026-10-05T08:40:00.000Z"
    }
  ],
  "truncated": false
}
```

Modes: `driving`, `walking`, `running`, `cycling`, `bus`, `train`, `underground`, `tram`.

## Known-place visits

```http
GET /api/integrations/v1/location/visits?from=<ISO-8601>&to=<ISO-8601>&limit=100&cursor=<opaque>
```

Scope `location:read`. Stays at saved places overlapping the range, newest first; stays at unknown or
learned places are left out. `from`/`to` are required, at most 31 days apart; `limit` 1–500 (default
100); paginate with `nextCursor` as for `time/entries`. An open stay has `stoppedAt: null` and its
`durationSeconds` runs to `serverNow`.

```json
{
  "ok": true,
  "serverNow": "2026-10-25T12:00:00.000Z",
  "range": { "from": "2026-10-24T00:00:00.000Z", "to": "2026-10-26T00:00:00.000Z" },
  "visits": [
    {
      "id": "40000000-0000-4000-8000-000000000001",
      "place": { "id": "30000000-0000-4000-8000-000000000001", "name": "Home", "role": "home" },
      "startedAt": "2026-10-25T09:00:00.000Z",
      "stoppedAt": null,
      "durationSeconds": 10800
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

## Privacy

Integration replies never carry coordinates, distances along a route, raw location or Health payloads,
Review titles or evidence. Place names are the user's own (role places read "Home"/"Work"). The server
does not log reply bodies; failures log only an error class.

## Connecting OpenClaw (Major)

1. **Token.** Use a token per purpose. The existing production token (in OpenClaw's
   `.secrets/dayframe-cockpit.token`) holds `time:read`. For the Tesla preheat, add `location:read`
   to it, or better create a separate `location:read` token, with the owner's approval (see *Tokens
   and scopes*). Add `review:read` only if Major should see Review counts.
2. **Base URL.** Production `https://dayframe-web.vercel.app`; staging
   `https://dayframe-staging.vercel.app` (staging data, a staging token).
3. **Tesla preheat.** Set `TESLA_PREHEAT_DAYFRAME_DRIVING_PATH=/api/integrations/v1/location/drives`.
   `/preheat diagnostic` then reports the sample count. The plugin also needs at least three
   arrival buffers per route; `eventStartedAt` is always `null` (Dayframe has no calendar), so
   school/activity trips stay suppressed until the plugin derives buffers from its own calendar events.
4. **Proactive suggestions.** Poll `context` every 5–15 minutes; fetch `time/summary` for daily or
   weekly reflections, `location/routes` for "leave by" estimates, and `review/summary` to nudge when
   cards pile up. Respect `stale` and `serverNow`.
5. **Revocation.** `npm run integration-token -- revoke <token-id>` (hosted: owner approval) stops a
   token at once.

## Proposals (not shipped)

- **Change feed or webhook** (`/changes?since=`), so Major can wake on a confirmed trip, a Stop or a
  new Review card instead of polling.
- **Upcoming-journey hint**: the open trip's origin and mode while travelling, for "running late" nudges.
- **Goal progress** in `time/summary` (category goals and weekly targets already exist in the app).
- **Health summaries** (sleep and workout totals) behind a separate `health:read` scope.
- **Self-service tokens** in web Settings (create, scope, revoke, last used) instead of the script.
