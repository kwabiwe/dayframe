# Dayframe Integration API

Dayframe exposes a small versioned API for trusted first-party or private integrations. It is not a public platform surface yet; keep clients server-side and token-protected.

## Authentication

Use a bearer integration token:

```http
Authorization: Bearer <integration-token>
```

Tokens are scoped. Persisted tokens live in `integration_tokens.scopes`; the local development `DAYFRAME_INGEST_TOKEN` also grants the internal integration scopes.

## Current Timer

```http
GET /api/integrations/v1/time/current
```

Required scope: `time:read`

Returns:

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
      "color": "#ff453a"
    },
    "place": null,
    "tags": [],
    "updatedAt": "2026-07-12T10:30:00.000Z"
  },
  "todaySeconds": 5400,
  "updatedAt": "2026-07-12T10:30:00.000Z"
}
```

Clients should render elapsed time locally from `serverNow`, `activeEntry.startedAt`, and `activeEntry.elapsedSeconds`, then poll moderately.

## Logged Time Entries

```http
GET /api/integrations/v1/time/entries?from=<ISO-8601>&to=<ISO-8601>&limit=50&cursor=<opaque>
```

Required scope: `time:read`

- `from` and `to` are required ISO-8601 timestamps. The range uses overlap
  semantics, so entries crossing either boundary are included.
- One request may cover at most 90 days.
- `limit` defaults to 50 and may be 1–100.
- Pass the opaque `nextCursor` unchanged to retrieve the next page. Do not
  construct or inspect cursors.
- Results are newest-first and restricted to the token owner and active
  workspace. Running entries may appear with `stoppedAt: null`; use
  `serverNow` when displaying their elapsed time.

Returns:

```json
{
  "ok": true,
  "serverNow": "2026-07-24T22:00:00.000Z",
  "workspaceId": "00000000-0000-4000-8000-000000000010",
  "range": {
    "from": "2026-07-20T00:00:00.000Z",
    "to": "2026-07-25T00:00:00.000Z"
  },
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
      "category": {
        "id": "20000000-0000-4000-8000-000000000001",
        "name": "Coding",
        "color": "#ff453a"
      },
      "place": null,
      "tags": ["Cubic"],
      "updatedAt": "2026-07-24T20:30:00.000Z"
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

This is a read-only integration surface. Use the normal authenticated app APIs
for user-driven edits; do not expose integration bearer tokens to browser or
mobile client code.
