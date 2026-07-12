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
