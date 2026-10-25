import { LOCATION_ENGINE_V2_CONFIG } from "@dayframe/shared";
import { query } from "./db";
import { encodeIntegrationTimeCursor } from "./integration-time";
import { timelineLegs } from "./location/location-timeline-service";
import { placeDisplayNameSql } from "./place-display";
import type { RequestSession } from "./session";

/**
 * Read-only location evidence for trusted integrations (`location:read`). Built only from what the
 * location timeline already holds — trips (`commute_segments`) and stays at saved places — never from
 * new inference. Never coordinates, raw payloads or unknown places: a client sees saved place IDs,
 * place names as the interface shows them ("Home"/"Work" for role places), roles, modes and times.
 *
 * A trip is *confirmed* when it is still current (not superseded) and a block made from it is logged
 * (`confirmed`/`accepted`) — logged automatically or accepted from Review. A Review card nobody
 * answered, an ignored card or a deleted block is not confirmed.
 */

export const INTEGRATION_DRIVES_DEFAULT_DAYS = 180;
export const INTEGRATION_DRIVES_MAX_DAYS = 365;
export const INTEGRATION_DRIVES_DEFAULT_LIMIT = 1000;
/** The OpenClaw preheat consumer rejects more than 5,000 samples. */
export const INTEGRATION_DRIVES_MAX_LIMIT = 5000;
export const INTEGRATION_ROUTES_MIN_SAMPLES = 3;
export const INTEGRATION_VISITS_DEFAULT_LIMIT = 100;
export const INTEGRATION_VISITS_MAX_LIMIT = 500;
export const INTEGRATION_VISITS_MAX_RANGE_DAYS = 31;
/** Location observations older than this make the current place stale. */
export const INTEGRATION_LOCATION_FRESH_MS = 30 * 60_000;

const DRIVE_PROVENANCE_PREFIX = "dayframe-location-drive:";
const NON_DRIVE_LEG_MODES = ["running", "cycling", "bus", "train", "underground", "tram"];

/** The same normalisation the preheat consumer applies to route IDs (NFKC, single spaces, lower case). */
export function normaliseRouteName(value: string) {
  return value.normalize("NFKC").replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
}

export function driveRouteId(placeName: string) {
  return `activity:${normaliseRouteName(placeName)}`;
}

type ConfirmedTripRow = {
  id: string;
  startedAt: Date;
  stoppedAt: Date;
  fromPlaceId: string;
  fromName: string;
  fromRole: string | null;
  toPlaceId: string;
  toName: string;
  toRole: string | null;
  travelMode: string | null;
  legs: unknown;
};

/**
 * Current, confirmed trips between two different saved places, newest first. `homeOnly` keeps trips
 * that start at the saved place whose role is Home; `drivingOnly` keeps trips whose mode is driving and
 * whose legs are all driving or walking (a walk to and from the car), never a trip with a stop or a
 * time-away outing. Bounded by `since` and `limit + 1` rows.
 */
async function confirmedTrips(
  session: RequestSession,
  options: { since: string; until: string; limit: number; homeOnly: boolean; drivingOnly: boolean }
) {
  return query<ConfirmedTripRow>(
    `select c.client_segment_id as "id", c.started_at as "startedAt", c.stopped_at as "stoppedAt",
            fp.id as "fromPlaceId", ${placeDisplayNameSql("fp")} as "fromName", fp.role as "fromRole",
            tp.id as "toPlaceId", ${placeDisplayNameSql("tp")} as "toName", tp.role as "toRole",
            c.metadata ->> 'travelMode' as "travelMode", c.metadata -> 'legs' as "legs"
       from commute_segments c
       join stay_segments fs on fs.id = c.from_stay_segment_id and fs.workspace_id = c.workspace_id and fs.user_id = c.user_id
       join stay_segments ts on ts.id = c.to_stay_segment_id and ts.workspace_id = c.workspace_id and ts.user_id = c.user_id
       join places fp on fp.id = coalesce(fs.place_id, c.from_place_id) and fp.workspace_id = c.workspace_id
       join places tp on tp.id = coalesce(ts.place_id, c.to_place_id) and tp.workspace_id = c.workspace_id
      where c.workspace_id = $1 and c.user_id = $2 and c.status <> 'superseded'
        and c.started_at >= $3::timestamptz and c.started_at < $4::timestamptz
        and fp.id <> tp.id
        and coalesce(c.metadata ->> 'qualificationReason', '') <> 'same_place_outing'
        and coalesce(jsonb_array_length(case when jsonb_typeof(c.metadata -> 'stops') = 'array' then c.metadata -> 'stops' end), 0) = 0
        and (not $6::boolean or fp.role = 'home')
        and (not $7::boolean or (
          c.metadata ->> 'travelMode' = 'automotive'
          and not exists (
            select 1 from jsonb_array_elements(case when jsonb_typeof(c.metadata -> 'legs') = 'array' then c.metadata -> 'legs' else '[]'::jsonb end) leg
             where leg ->> 'mode' = any($8::text[]))))
        and exists (
          select 1
            from activity_events ae
            join time_entries te on te.created_from_event_id = ae.id and te.workspace_id = ae.workspace_id and te.user_id = ae.user_id
           where ae.workspace_id = c.workspace_id and ae.user_id = c.user_id
             and ae.raw_payload ? 'clientSegmentId' and ae.raw_payload ->> 'clientSegmentId' = c.client_segment_id
             and ae.event_type = 'commute_detected'
             and te.review_status in ('confirmed', 'accepted'))
      order by c.started_at desc, c.client_segment_id desc
      limit $5`,
    [session.workspaceId, session.userId, options.since, options.until, options.limit + 1,
      options.homeOnly, options.drivingOnly, NON_DRIVE_LEG_MODES]);
}

export type IntegrationDriveSample = {
  routeId: string;
  departedAt: string;
  arrivedAt: string;
  confirmed: true;
  mode: "driving";
  homeOrigin: true;
  /** Dayframe holds no calendar: there is no genuine event start, so this is always null. */
  eventStartedAt: null;
  provenance: string;
  durationSeconds: number;
  drivingSeconds: number | null;
  destination: { placeId: string; name: string; role: string | null };
};

export type IntegrationDrivesResponse = {
  ok: true;
  serverNow: string;
  range: { from: string; to: string };
  samples: IntegrationDriveSample[];
  truncated: boolean;
  coverage: { sampleCount: number; routeCount: number; latestDepartedAt: string | null };
};

/** Driving seconds of a trip's driving legs, or null when the trip holds no legs. */
function drivingSeconds(legs: ReturnType<typeof timelineLegs>) {
  if (!legs.length) return null;
  return Math.round(legs.filter((leg) => leg.mode === "automotive")
    .reduce((sum, leg) => sum + Math.max(0, Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)), 0) / 1000);
}

export async function getIntegrationDrives(
  session: RequestSession,
  options: { days: number; limit: number; now?: Date }
): Promise<IntegrationDrivesResponse> {
  const now = options.now ?? new Date();
  const until = now.toISOString();
  const since = new Date(now.getTime() - options.days * 86_400_000).toISOString();
  const result = await confirmedTrips(session, { since, until, limit: options.limit, homeOnly: true, drivingOnly: true });
  const samples = result.rows.slice(0, options.limit).flatMap((row): IntegrationDriveSample[] => {
    const legs = timelineLegs(row.legs);
    // A trip's stored legs must agree it was a drive: at least one driving leg when it has legs at all.
    if (legs.length && !legs.some((leg) => leg.mode === "automotive")) return [];
    if (row.fromRole !== "home" || !row.toName.trim()) return [];
    const departedAt = new Date(row.startedAt).toISOString();
    const arrivedAt = new Date(row.stoppedAt).toISOString();
    return [{
      routeId: driveRouteId(row.toName),
      departedAt,
      arrivedAt,
      confirmed: true,
      mode: "driving",
      homeOrigin: true,
      eventStartedAt: null,
      provenance: `${DRIVE_PROVENANCE_PREFIX}${row.id}`,
      durationSeconds: Math.round((Date.parse(arrivedAt) - Date.parse(departedAt)) / 1000),
      drivingSeconds: drivingSeconds(legs),
      destination: { placeId: row.toPlaceId, name: row.toName, role: row.toRole }
    }];
  });
  return {
    ok: true,
    serverNow: until,
    range: { from: since, to: until },
    samples,
    truncated: result.rows.length > options.limit,
    coverage: {
      sampleCount: samples.length,
      routeCount: new Set(samples.map((sample) => sample.routeId)).size,
      latestDepartedAt: samples[0]?.departedAt ?? null
    }
  };
}

export type IntegrationRouteEstimate = {
  routeId: string;
  from: { placeId: string; name: string; role: string | null };
  to: { placeId: string; name: string; role: string | null };
  mode: string;
  sampleCount: number;
  medianSeconds: number;
  p80Seconds: number;
  minSeconds: number;
  maxSeconds: number;
  latestDepartedAt: string;
};

/** Route estimates come from at most this many recent confirmed trips. */
const ROUTE_TRIP_READ_LIMIT = 5000;

export async function getIntegrationRoutes(
  session: RequestSession,
  options: { days: number; minSamples: number; now?: Date }
) {
  const now = options.now ?? new Date();
  const until = now.toISOString();
  const since = new Date(now.getTime() - options.days * 86_400_000).toISOString();
  const result = await confirmedTrips(session, { since, until, limit: ROUTE_TRIP_READ_LIMIT, homeOnly: false, drivingOnly: false });
  const groups = new Map<string, { rows: ConfirmedTripRow[]; mode: string }>();
  for (const row of result.rows.slice(0, ROUTE_TRIP_READ_LIMIT)) {
    const mode = publicMode(row.travelMode);
    // A trip whose legs name another vehicle than its own mode is not a sample of that mode.
    if (!mode || timelineLegs(row.legs).some((leg) => leg.mode !== row.travelMode && leg.mode !== "walking")) continue;
    const key = `${row.fromPlaceId}|${row.toPlaceId}|${mode}`;
    const group = groups.get(key) ?? { rows: [], mode };
    group.rows.push(row);
    groups.set(key, group);
  }
  const routes: IntegrationRouteEstimate[] = [];
  for (const { rows, mode } of groups.values()) {
    if (rows.length < options.minSamples) continue;
    const seconds = rows.map((row) => Math.round((new Date(row.stoppedAt).getTime() - new Date(row.startedAt).getTime()) / 1000))
      .sort((a, b) => a - b);
    const first = rows[0];
    routes.push({
      routeId: `${first.fromPlaceId}:${first.toPlaceId}:${mode}`,
      from: { placeId: first.fromPlaceId, name: first.fromName, role: first.fromRole },
      to: { placeId: first.toPlaceId, name: first.toName, role: first.toRole },
      mode,
      sampleCount: rows.length,
      medianSeconds: percentile(seconds, 0.5),
      p80Seconds: percentile(seconds, 0.8),
      minSeconds: seconds[0],
      maxSeconds: seconds[seconds.length - 1],
      latestDepartedAt: new Date(first.startedAt).toISOString()
    });
  }
  routes.sort((a, b) => b.sampleCount - a.sampleCount || a.routeId.localeCompare(b.routeId));
  return {
    ok: true as const,
    serverNow: until,
    range: { from: since, to: until },
    minSamples: options.minSamples,
    routes,
    truncated: result.rows.length > ROUTE_TRIP_READ_LIMIT
  };
}

/** Nearest-rank percentile of ascending values. */
function percentile(sorted: readonly number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

const PUBLIC_MODES: Record<string, string> = {
  automotive: "driving", walking: "walking", running: "running", cycling: "cycling",
  bus: "bus", train: "train", underground: "underground", tram: "tram"
};
function publicMode(mode: string | null) {
  return mode ? PUBLIC_MODES[mode] ?? null : null;
}

export type IntegrationPlaceVisit = {
  id: string;
  place: { id: string; name: string; role: string | null };
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
};

type VisitRow = {
  rowId: string;
  placeId: string;
  name: string;
  role: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
};

export type IntegrationVisitsCursor = { startedAt: string; id: string };

/** Stays at saved places overlapping [from, to), newest first; unknown and learned places are left out. */
export async function getIntegrationVisits(
  session: RequestSession,
  input: { from: string; to: string; limit: number; cursor: IntegrationVisitsCursor | null; now?: Date }
) {
  const now = input.now ?? new Date();
  const lookback = new Date(Date.parse(input.from) - LOOKBACK_STAY_MS).toISOString();
  const result = await query<VisitRow>(
    `select s.id as "rowId", p.id as "placeId", ${placeDisplayNameSql("p")} as name, p.role, s.started_at as "startedAt", s.stopped_at as "stoppedAt"
       from stay_segments s
       join places p on p.id = s.place_id and p.workspace_id = s.workspace_id
      where s.workspace_id = $1 and s.user_id = $2 and s.status <> 'superseded' and s.client_segment_id is not null
        and s.started_at < $4::timestamptz
        and (s.started_at >= $9::timestamptz or s.stopped_at is null or s.stopped_at - s.started_at > interval '31 days')
        and coalesce(s.stopped_at, $5::timestamptz) > $3::timestamptz
        and ($6::timestamptz is null or (s.started_at, s.id) < ($6::timestamptz, $7::uuid))
      order by s.started_at desc, s.id desc
      limit $8`,
    [session.workspaceId, session.userId, input.from, input.to, now.toISOString(),
      input.cursor?.startedAt ?? null, input.cursor?.id ?? null, input.limit + 1, lookback]);
  const hasMore = result.rows.length > input.limit;
  const rows = result.rows.slice(0, input.limit);
  const last = rows.at(-1);
  return {
    ok: true as const,
    serverNow: now.toISOString(),
    range: { from: input.from, to: input.to },
    visits: rows.map((row): IntegrationPlaceVisit => {
      const startedAt = new Date(row.startedAt).toISOString();
      const stoppedAt = row.stoppedAt ? new Date(row.stoppedAt).toISOString() : null;
      return {
        id: row.rowId,
        place: { id: row.placeId, name: row.name, role: row.role },
        startedAt,
        stoppedAt,
        durationSeconds: Math.max(0, Math.round(((stoppedAt ? Date.parse(stoppedAt) : now.getTime()) - Date.parse(startedAt)) / 1000))
      };
    }),
    nextCursor: hasMore && last ? encodeIntegrationTimeCursor(new Date(last.startedAt).toISOString(), last.rowId) : null,
    hasMore
  };
}

/** Visits are read from stays started at most this long before `from`, plus open and longer stays (as the timeline reads them). */
const LOOKBACK_STAY_MS = 31 * 86_400_000;

export type IntegrationCurrentPlace = {
  place: { id: string; name: string; role: string | null } | null;
  since: string | null;
  travelling: boolean;
  /** The newest accepted location observation, or null when none in the last day. */
  observedAt: string | null;
  stale: boolean;
};

/**
 * Where the person is now, as far as the timeline knows: the open stay at a saved place (unknown places
 * read as `place: null`), whether a journey is in progress, and how fresh the newest observation is.
 */
export async function getIntegrationCurrentPlace(session: RequestSession, now = new Date()): Promise<IntegrationCurrentPlace> {
  const nowIso = now.toISOString();
  const [stay, observed] = await Promise.all([
    query<{ placeId: string | null; name: string | null; role: string | null; startedAt: Date; open: boolean; openTrip: boolean }>(
      `select p.id as "placeId", ${placeDisplayNameSql("p")} as name, p.role, s.started_at as "startedAt", s.stopped_at is null as "open",
              coalesce((s.metadata -> 'openTrip' ->> 'lastObservedAt')::timestamptz
                >= $3::timestamptz - make_interval(secs => $4::double precision / 1000), false) as "openTrip"
         from stay_segments s
         left join places p on p.id = s.place_id and p.workspace_id = s.workspace_id
        where s.workspace_id = $1 and s.user_id = $2 and s.status <> 'superseded' and s.client_segment_id is not null
          and s.started_at <= $3::timestamptz
        order by s.started_at desc, s.id desc
        limit 1`,
      [session.workspaceId, session.userId, nowIso, LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs]),
    query<{ observedAt: Date | null }>(
      `select max(occurred_at) as "observedAt" from location_evidence
        where workspace_id = $1 and user_id = $2 and accepted
          and occurred_at >= $3::timestamptz - interval '1 day' and occurred_at <= $3::timestamptz`,
      [session.workspaceId, session.userId, nowIso])
  ]);
  const row = stay.rows[0];
  const observedAt = observed.rows[0]?.observedAt ? new Date(observed.rows[0].observedAt).toISOString() : null;
  const stale = !observedAt || now.getTime() - Date.parse(observedAt) > INTEGRATION_LOCATION_FRESH_MS;
  const travelling = Boolean(row?.openTrip);
  const atPlace = row && row.open && !travelling ? row : null;
  return {
    place: atPlace?.placeId && atPlace.name ? { id: atPlace.placeId, name: atPlace.name, role: atPlace.role } : null,
    since: atPlace ? new Date(atPlace.startedAt).toISOString() : null,
    travelling,
    observedAt,
    stale
  };
}
