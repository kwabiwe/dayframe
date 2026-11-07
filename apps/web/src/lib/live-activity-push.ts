import crypto from "node:crypto";
import http2 from "node:http2";
import { paletteColorFor } from "@dayframe/shared";
import { isLockNotAvailableError, query } from "./db";
import type { RequestSession } from "./session";
import { withSyncTransaction } from "./sync-transaction";

export type LiveActivityRegistration = {
  token: string;
  activityId: string;
  activeEntryId: string;
  environment: "development" | "production";
};

export class LiveActivityRegistrationError extends Error {}
export class LiveActivityControlError extends Error {}

export type LiveActivityControl = {
  token: string;
  activityId: string;
  entryId: string;
};

type ApnsEvent = "update" | "end";
type ApnsEnvironment = "development" | "production";

type ActiveTimerRow = {
  id: string;
  description: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  startedAt: string;
};

type DesiredStateSnapshot = {
  active: ActiveTimerRow | null;
  registrations: Array<{ id: string; active_entry_id: string | null; activity_id: string; environment: ApnsEnvironment }> | null;
};

type LiveActivityPayload = {
  aps: {
    timestamp: number;
    event: ApnsEvent;
    "dismissal-date"?: number;
    "content-state": ReturnType<typeof stoppedContentState> | ReturnType<typeof contentState>;
  };
};

type OutboxRow = {
  id: string;
  token: string;
  activityId: string;
  activeEntryId: string | null;
  environment: ApnsEnvironment;
  revision: string;
  leaseUntil: string;
  event: ApnsEvent;
  payload: LiveActivityPayload;
  attemptCount: number;
  expiresAt: string;
};

export type LiveActivityDeliveryFailure = {
  environment: ApnsEnvironment;
  event: ApnsEvent;
  status: number | null;
  reason: string;
  disposition: "retry" | "permanent" | "invalid_token";
};

export type LiveActivityDrainResult = {
  claimed: number;
  delivered: number;
  retryScheduled: number;
  permanentFailures: number;
  invalidatedTokens: number;
  missingConfiguration: string[];
};

type LiveActivityOwnerRow = {
  workspaceId: string;
  userId: string;
};

const MAX_DELIVERY_ATTEMPTS = 8;
const OUTBOX_BATCH_SIZE = 25;
const OUTBOX_LEASE_SECONDS = 30;
const UPDATE_EXPIRY_SECONDS = 60 * 60;
const END_EXPIRY_SECONDS = 24 * 60 * 60;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const INVALID_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "Unregistered"
]);
// The token is fine; this server's APNS_BUNDLE_ID names another app. Invalidating the token on an
// `update` would also revoke the running Activity's Lock Screen Stop, which authenticates with it (staging, 21–24 Oct 2026: every staging token
// was invalidated on its first push, so every Live Activity Stop was refused with 401 and the Activity
// stayed until the app was opened).
const TOPIC_MISMATCH_REASON = "DeviceTokenNotForTopic";
let cachedApnsAuthorization: {
  fingerprint: string;
  createdAt: number;
  value: string;
} | null = null;

export async function registerLiveActivity(
  session: RequestSession,
  registration: LiveActivityRegistration
) {
  const result = await query(
    `with active_target as (
       select te.id
       from time_entries te
       where te.id = $5
         and te.workspace_id = $1
         and te.user_id = $2
         and te.stopped_at is null
         and not exists (
           select 1
           from live_activity_push_tokens conflicting_token
           where conflicting_token.token = $3
             and (
               conflicting_token.workspace_id <> $1
               or conflicting_token.user_id <> $2
             )
         )
     ), invalidated_previous_tokens as (
       update live_activity_push_tokens previous_token
       set invalidated_at = now()
       from active_target
       where previous_token.workspace_id = $1
         and previous_token.user_id = $2
         and (
           (previous_token.activity_id = $4 and previous_token.token <> $3)
           or (
             previous_token.active_entry_id = active_target.id
             and previous_token.activity_id <> $4
           )
         )
         and previous_token.invalidated_at is null
     )
     insert into live_activity_push_tokens (
       workspace_id, user_id, token, activity_id, active_entry_id, environment
     )
     select $1, $2, $3, $4, active_target.id, $6
     from active_target
     on conflict (token) do update set
       activity_id = excluded.activity_id,
       active_entry_id = excluded.active_entry_id,
       environment = excluded.environment,
       last_registered_at = now(),
       invalidated_at = null
     where live_activity_push_tokens.workspace_id = excluded.workspace_id
       and live_activity_push_tokens.user_id = excluded.user_id
     returning id`,
    [
      session.workspaceId,
      session.userId,
      registration.token,
      registration.activityId,
      registration.activeEntryId,
      registration.environment
    ]
  );
  if (!result.rowCount) {
    throw new LiveActivityRegistrationError("The running block is no longer active.");
  }
}

export async function resolveLiveActivityControlSession(
  control: LiveActivityControl
): Promise<RequestSession> {
  const result = await query<{
    userId: string;
    workspaceId: string;
  }>(
    `select t.user_id as "userId",
            t.workspace_id as "workspaceId"
     from live_activity_push_tokens t
     join time_entries te
       on te.id = t.active_entry_id
      and te.workspace_id = t.workspace_id
      and te.user_id = t.user_id
     where t.token = $1
       and t.activity_id = $2
       and t.active_entry_id = $3
       and t.invalidated_at is null
     limit 1`,
    [control.token, control.activityId, control.entryId]
  );
  const row = result.rows[0];
  if (!row) {
    // Do not reveal whether the token, activity, entry, or timer state failed.
    throw new LiveActivityControlError("Live Activity control is unavailable.");
  }
  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    authMode: "provider",
    scopes: ["events:write"]
  };
}

export async function notifyLiveActivities(session: RequestSession) {
  await enqueueLatestLiveActivityState(session);
  return drainLiveActivityOutbox({ session });
}

export async function notifyLiveActivitiesBestEffort(session: RequestSession) {
  try {
    const result = await notifyLiveActivities(session);
    logDrainResult("mutation", result);
  } catch (error) {
    console.error("Dayframe Live Activity outbox enqueue or delivery failed", {
      source: "mutation",
      name: error instanceof Error ? error.name : "UnknownError"
    });
  }
}

export async function retryLiveActivityDeliveryBestEffort(session: RequestSession) {
  try {
    await enqueueLatestLiveActivityState(session);
    const result = await drainLiveActivityOutbox({ session });
    logDrainResult("reconciliation", result);
  } catch (error) {
    console.error("Dayframe Live Activity outbox reconciliation failed", {
      source: "reconciliation",
      name: error instanceof Error ? error.name : "UnknownError"
    });
  }
}

/**
 * Reconstructs desired state from authoritative timers before the platform
 * cron drains the outbox. This repairs the otherwise-empty outbox left by a
 * failed mutation-side `after` registration or enqueue attempt.
 */
export async function reconcileLiveActivityDesiredState(limit = OUTBOX_BATCH_SIZE) {
  const owners = await query<LiveActivityOwnerRow>(
    `select workspace_id as "workspaceId",
            user_id as "userId"
     from live_activity_push_tokens
     where invalidated_at is null
     group by workspace_id, user_id
     order by max(last_registered_at) desc
     limit $1`,
    [Math.min(Math.max(limit, 1), OUTBOX_BATCH_SIZE)]
  );
  for (const owner of owners.rows) {
    try {
      await enqueueLatestLiveActivityState(owner, { skipBusy: true });
    } catch (error) {
      if (!isLockNotAvailableError(error)) throw error;
      // A contended owner should not prevent other owners or the global due-row drain.
    }
  }
  return drainLiveActivityOutbox();
}

export async function drainLiveActivityOutbox(options?: {
  session?: Pick<RequestSession, "workspaceId" | "userId">;
  limit?: number;
}): Promise<LiveActivityDrainResult> {
  const configuration = apnsConfiguration();
  if (!configuration.config) {
    return emptyDrainResult(configuration.missing);
  }
  const config = configuration.config;

  let authorization: string;
  try {
    authorization = apnsAuthorization(config);
  } catch {
    console.error("Dayframe Live Activity APNs provider key is invalid", {
      reason: "InvalidProviderKey"
    });
    return emptyDrainResult([]);
  }

  // The global sweep owns terminal cleanup. Session-scoped post-response
  // reconciliation only claims the authenticated user's due work.
  if (!options?.session) {
    await expireExhaustedOutboxRows();
  }
  const rows = await claimDueOutboxRows(
    options?.session,
    Math.min(Math.max(options?.limit ?? OUTBOX_BATCH_SIZE, 1), OUTBOX_BATCH_SIZE)
  );
  const result = emptyDrainResult([]);
  result.claimed = rows.length;

  const deliveries = await Promise.all(rows.map((row) => deliverOutboxRow(
    row,
    config,
    authorization
  )));
  for (const delivery of deliveries) {
    if (delivery === null) continue;
    if (delivery === "delivered") result.delivered += 1;
    else if (delivery === "retry") result.retryScheduled += 1;
    else if (delivery === "invalid_token") result.invalidatedTokens += 1;
    else result.permanentFailures += 1;
  }
  return result;
}

async function enqueueLatestLiveActivityState(
  session: Pick<RequestSession, "workspaceId" | "userId">,
  { skipBusy = false }: { skipBusy?: boolean } = {}
) {
  const owner = [session.workspaceId, session.userId];
  const eligible = await query(
    `select 1 from live_activity_push_tokens
     where workspace_id = $1 and user_id = $2 and invalidated_at is null
     limit 1`,
    owner
  );
  if (!eligible.rowCount) return;

  await withSyncTransaction("live_activity_enqueue", async ({ client, phase }) => {
    phase("owner_lock");
    // Serialize only desired-state reads and writes. Timer mutations and APNs delivery stay outside.
    const lockKey = `live-activity-outbox:${session.workspaceId}:${session.userId}`;
    if (skipBusy) {
      const lock = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired", [lockKey]
      );
      if (!lock.rows[0]?.acquired) return;
    } else {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
    }
    phase("canonical_read");
    // Read in a fresh statement after acquiring the lock so an older refresh cannot replace a newer Stop.
    const { rows: [snapshot] } = await client.query<DesiredStateSnapshot>(
      `select row_to_json(active) as active, (
         select jsonb_agg(jsonb_build_object(
           'id', t.id, 'active_entry_id', t.active_entry_id,
           'activity_id', t.activity_id, 'environment', t.environment
         ))
         from live_activity_push_tokens t
         where t.workspace_id = $1 and t.user_id = $2 and t.invalidated_at is null
       ) as registrations
       from (select 1) as owner
       left join lateral (
         select te.id,
                te.description,
                c.name as "categoryName",
                c.color as "categoryColor",
                te.started_at as "startedAt"
         from time_entries te
         left join categories c on c.id = te.category_id
         where te.workspace_id = $1
           and te.user_id = $2
           and te.stopped_at is null
         order by te.started_at desc
         limit 1
       ) active on true`,
      owner
    );
    if (!snapshot.registrations?.length) return;
    const { active, registrations } = snapshot;
    const timestamp = Math.floor(Date.now() / 1000);
    const update: LiveActivityPayload | null = active ? {
      aps: { timestamp, event: "update", "content-state": contentState(active, true) }
    } : null;
    const end: LiveActivityPayload = {
      aps: {
        timestamp,
        event: "end",
        "dismissal-date": timestamp - 1,
        "content-state": stoppedContentState()
      }
    };

    phase("effect");
    // Activity attributes are immutable. Only the current entry's registrations
    // may receive updates. End older activities in one owner-scoped write.
    // Only use generations from the timer's snapshot. A newer registration may
    // have arrived since that read and must not inherit an earlier end.
    await client.query(
      `insert into live_activity_delivery_outbox (
         token_id, workspace_id, user_id, event, payload, expires_at
       )
       select t.id, t.workspace_id, t.user_id, desired.event,
              case when desired.event = 'update' then $4::jsonb else $5::jsonb end,
              case when desired.event = 'update' then $6::timestamptz else $7::timestamptz end
       from live_activity_push_tokens t
       join jsonb_to_recordset($8::jsonb)
         as observed(id uuid, active_entry_id uuid, activity_id text, environment text)
         on t.id = observed.id and t.active_entry_id is not distinct from observed.active_entry_id
         and t.activity_id = observed.activity_id and t.environment = observed.environment
       cross join lateral (
         select case when observed.active_entry_id = $3::uuid then 'update' else 'end' end as event
       ) desired
       where t.workspace_id = $1 and t.user_id = $2 and t.invalidated_at is null
       order by t.id
       on conflict (token_id) do update set
         workspace_id = excluded.workspace_id,
         user_id = excluded.user_id,
         revision = live_activity_delivery_outbox.revision + 1,
         event = excluded.event,
         payload = jsonb_set(
           excluded.payload,
           '{aps,timestamp}',
           to_jsonb(greatest(
             coalesce((excluded.payload #>> '{aps,timestamp}')::bigint, 0),
             coalesce((live_activity_delivery_outbox.payload #>> '{aps,timestamp}')::bigint, 0) + 1
           ))
         ),
         status = 'pending',
         attempt_count = 0,
         next_attempt_at = now(),
         expires_at = excluded.expires_at,
         leased_until = null,
         last_attempt_at = null,
         last_delivery_status = null,
         last_delivery_reason = null,
         last_apns_id = null,
         updated_at = now()
       where live_activity_delivery_outbox.event is distinct from excluded.event
          -- A running ActivityKit clock already advances from startedAt. Wall time alone is not a new revision.
          or ((live_activity_delivery_outbox.payload #> '{aps,content-state}') - 'elapsedSeconds')
             is distinct from ((excluded.payload #> '{aps,content-state}') - 'elapsedSeconds')`,
      [
        ...owner,
        active?.id ?? null,
        update && JSON.stringify(update),
        JSON.stringify(end),
        new Date((timestamp + UPDATE_EXPIRY_SECONDS) * 1000).toISOString(),
        new Date((timestamp + END_EXPIRY_SECONDS) * 1000).toISOString(),
        JSON.stringify(registrations)
      ]
    );
  }, { reuseFullCapTimeoutPair: true });
}

async function expireExhaustedOutboxRows() {
  await query(
    `update live_activity_delivery_outbox
     set status = 'expired',
         leased_until = null,
         last_delivery_reason = case
           when expires_at <= now() then 'Expired'
           else 'RetryLimitExceeded'
         end,
         updated_at = now()
     where status = 'pending'
       and (expires_at <= now() or attempt_count >= $1)`,
    [MAX_DELIVERY_ATTEMPTS]
  );
}

async function claimDueOutboxRows(
  session: Pick<RequestSession, "workspaceId" | "userId"> | undefined,
  limit: number
) {
  const result = await query<OutboxRow>(
    `with due as (
       select o.id
       from live_activity_delivery_outbox o
       join live_activity_push_tokens t on t.id = o.token_id
       where o.status = 'pending'
         and o.next_attempt_at <= now()
         and o.expires_at > now()
         and o.attempt_count < $3
         and (o.leased_until is null or o.leased_until <= now())
         and t.invalidated_at is null
         and ($1::uuid is null or o.workspace_id = $1)
         and ($2::uuid is null or o.user_id = $2)
       order by o.next_attempt_at, o.updated_at
       for update of o skip locked
       limit $4
     )
     update live_activity_delivery_outbox o
     set leased_until = now() + ($5 * interval '1 second'),
         updated_at = now()
     from due, live_activity_push_tokens t
     where o.id = due.id
       and t.id = o.token_id
     returning o.id,
               t.token,
               t.activity_id as "activityId",
               t.active_entry_id as "activeEntryId",
               t.environment,
               o.revision::text as revision,
               o.leased_until::text as "leaseUntil",
               o.event,
               o.payload,
               o.attempt_count as "attemptCount",
               o.expires_at as "expiresAt"`,
    [
      session?.workspaceId ?? null,
      session?.userId ?? null,
      MAX_DELIVERY_ATTEMPTS,
      limit,
      OUTBOX_LEASE_SECONDS
    ]
  );
  return result.rows;
}

async function deliverOutboxRow(
  row: OutboxRow,
  config: ApnsConfiguration,
  authorization: string
): Promise<"delivered" | "retry" | "permanent" | "invalid_token" | null> {
  const host = row.environment === "development"
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";
  const apnsId = crypto.randomUUID();
  let response: ApnsResponse;
  try {
    response = await sendApnsRequest(host, row.token, {
      authorization,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
      "apns-topic": `${config.bundleId}.push-type.liveactivity`,
      "apns-collapse-id": row.activityId,
      "apns-expiration": String(Math.floor(new Date(row.expiresAt).getTime() / 1000)),
      "apns-id": apnsId,
      "content-type": "application/json"
    }, JSON.stringify(row.payload));
  } catch {
    return recordOutboxFailure(row, failureFor(row, null, "NetworkError", "retry"), null, apnsId);
  }

  if (response.ok) {
    const settled = await settleOutboxDelivery(row, {
      status: "delivered",
      nextAttempt: null,
      httpStatus: response.status,
      reason: null,
      apnsId: response.apnsId ?? apnsId,
      invalidate: row.event === "end"
    });
    return settled ? "delivered" : null;
  }

  const reason = safeApnsReason(parseApnsBody(response.body).reason, response.status);
  const disposition = classifyApnsFailure(response.status, reason);
  const result = await recordOutboxFailure(
    row, failureFor(row, response.status, reason, disposition), response.retryAfter, response.apnsId ?? apnsId
  );
  if (result && reason === TOPIC_MISMATCH_REASON) {
    console.error("Dayframe Live Activity APNs topic does not match the app: check APNS_BUNDLE_ID", {
      environment: row.environment,
      event: row.event
    });
  }
  return result;
}

async function recordOutboxFailure(
  row: OutboxRow,
  failure: LiveActivityDeliveryFailure,
  retryAfter: string | null,
  apnsId: string
) {
  const retry = failure.disposition === "retry" && row.attemptCount + 1 < MAX_DELIVERY_ATTEMPTS;
  // A topic mismatch keeps the running Activity's Lock Screen Stop available.
  const invalidate = failure.disposition === "invalid_token" ||
    (failure.reason === TOPIC_MISMATCH_REASON && row.event === "end");
  const settled = await settleOutboxDelivery(row, {
    status: retry ? "pending" : "permanent_failure",
    nextAttempt: new Date(Date.now() + retryDelayMs(row.attemptCount + 1, retryAfter)).toISOString(),
    httpStatus: failure.status,
    reason: failure.reason,
    apnsId,
    invalidate
  });
  if (!settled) return null;
  return failure.disposition === "retry" && !retry ? "permanent" : failure.disposition;
}

async function settleOutboxDelivery(row: OutboxRow, outcome: {
  status: "delivered" | "pending" | "permanent_failure";
  nextAttempt: string | null;
  httpStatus: number | null;
  reason: string | null;
  apnsId: string;
  invalidate: boolean;
}) {
  // Claim identity includes the exact lease as text, preserving PostgreSQL's
  // microseconds. A delayed response must not settle a re-claimed revision.
  const result = await query(
    `with settled as (
       update live_activity_delivery_outbox
       set status = $4,
           attempt_count = attempt_count + 1,
           next_attempt_at = coalesce($5::timestamptz, next_attempt_at),
           leased_until = null,
           last_attempt_at = now(),
           last_delivery_status = $6,
           last_delivery_reason = $7,
           last_apns_id = $8,
           updated_at = now()
       where id = $1 and revision = $2::bigint and leased_until = $3::timestamptz
         and status = 'pending'
       returning token_id, workspace_id, user_id, event, status
     )
     update live_activity_push_tokens t
     set last_attempt_at = now(),
         last_delivered_at = case when s.status = 'delivered' then now() else t.last_delivered_at end,
         last_delivery_status = $6,
         last_delivery_reason = $7,
         consecutive_failures = case when s.status = 'delivered' then 0 else t.consecutive_failures + 1 end,
         active_entry_id = case when s.status = 'delivered' and s.event = 'end' then null else t.active_entry_id end,
         invalidated_at = case when $9 then now() else t.invalidated_at end
     from settled s
     where t.id = s.token_id and t.workspace_id = s.workspace_id and t.user_id = s.user_id
       and t.activity_id = $10
       -- Deleting the stopped entry can clear its foreign key while End is in flight.
       and (t.active_entry_id is not distinct from $11::uuid or (s.event = 'end' and t.active_entry_id is null))
       and t.environment = $12 and t.invalidated_at is null`,
    [
      row.id, row.revision, row.leaseUntil, outcome.status, outcome.nextAttempt,
      outcome.httpStatus, outcome.reason, outcome.apnsId, outcome.invalidate,
      row.activityId, row.activeEntryId, row.environment
    ]
  );
  return result.rowCount === 1;
}

type ApnsResponse = {
  ok: boolean;
  status: number;
  body: string;
  retryAfter: string | null;
  apnsId: string | null;
};

function sendApnsRequest(
  host: string,
  token: string,
  headers: Record<string, string>,
  body: string
) {
  return new Promise<ApnsResponse>((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    let settled = false;
    let status = 500;
    let responseBody = "";
    let retryAfter: string | null = null;
    let apnsId: string | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      client.close();
      resolve({
        ok: status >= 200 && status < 300,
        status,
        body: responseBody,
        retryAfter,
        apnsId
      });
    };
    client.once("error", (error) => {
      if (settled) return;
      settled = true;
      client.close();
      reject(error);
    });
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      ...headers
    });
    request.setTimeout(10_000, () => {
      request.close(http2.constants.NGHTTP2_CANCEL);
      if (settled) return;
      settled = true;
      client.close();
      reject(new Error("APNs request timed out."));
    });
    request.setEncoding("utf8");
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 500);
      retryAfter = headerString(responseHeaders["retry-after"]);
      apnsId = headerString(responseHeaders["apns-id"]);
    });
    request.on("data", (chunk) => {
      if (responseBody.length < 4_096) responseBody += chunk;
    });
    request.once("end", finish);
    request.once("error", (error) => {
      if (settled) return;
      settled = true;
      client.close();
      reject(error);
    });
    request.end(body);
  });
}

function headerString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function parseApnsBody(body: string) {
  try {
    return JSON.parse(body) as { reason?: string };
  } catch {
    return {};
  }
}

function safeApnsReason(reason: string | undefined, status: number) {
  if (reason && /^[A-Za-z0-9_-]{1,64}$/.test(reason)) return reason;
  return `HTTP_${status}`;
}

export function classifyApnsFailure(
  status: number | null,
  reason: string
): LiveActivityDeliveryFailure["disposition"] {
  if (status === 410 || INVALID_TOKEN_REASONS.has(reason)) return "invalid_token";
  if (status === null || status === 429 || status >= 500) return "retry";
  return "permanent";
}

export function retryDelayMs(attempt: number, retryAfter: string | null, now = Date.now()) {
  const serverDelay = parseRetryAfterMs(retryAfter, now);
  if (serverDelay !== null) return Math.min(serverDelay, MAX_RETRY_AFTER_MS);
  const exponential = Math.min(1_000 * (2 ** Math.max(0, attempt - 1)), 15 * 60 * 1000);
  const deterministicJitter = Math.round(exponential * 0.2 * ((attempt % 3) / 2));
  return exponential + deterministicJitter;
}

export function parseRetryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function failureFor(
  row: OutboxRow,
  status: number | null,
  reason: string,
  disposition: LiveActivityDeliveryFailure["disposition"]
): LiveActivityDeliveryFailure {
  return {
    environment: row.environment,
    event: row.event,
    status,
    reason,
    disposition
  };
}

function contentState(active: ActiveTimerRow, isRunning: boolean) {
  const startedAt = new Date(active.startedAt);
  const description = active.description?.trim();
  const categoryName = active.categoryName?.trim() || null;
  return {
    title: description || categoryName || "No activity",
    categoryName,
    categoryColor: categoryName
      ? paletteColorFor(active.categoryColor ?? categoryName, categoryName, "dark")
      : null,
    // The light-palette fill; the Live Activity follows the phone's appearance.
    categoryColorLight: categoryName
      ? paletteColorFor(active.categoryColor ?? categoryName, categoryName, "light")
      : null,
    // Swift's default Codable Date representation is seconds since 2001-01-01.
    startedAt: startedAt.getTime() / 1000 - 978_307_200,
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)),
    isRunning,
    canStop: isRunning
  };
}

function stoppedContentState() {
  return {
    title: "No activity",
    categoryName: null,
    categoryColor: null,
    categoryColorLight: null,
    startedAt: null,
    elapsedSeconds: 0,
    isRunning: false,
    canStop: false
  };
}

function emptyDrainResult(missingConfiguration: string[]): LiveActivityDrainResult {
  return {
    claimed: 0,
    delivered: 0,
    retryScheduled: 0,
    permanentFailures: 0,
    invalidatedTokens: 0,
    missingConfiguration
  };
}

function logDrainResult(source: "mutation" | "reconciliation", result: LiveActivityDrainResult) {
  if (result.missingConfiguration.length) {
    console.warn("Dayframe Live Activity APNs delivery deferred", {
      source,
      missingConfiguration: result.missingConfiguration
    });
    return;
  }
  if (result.retryScheduled || result.permanentFailures || result.invalidatedTokens) {
    console.warn("Dayframe Live Activity outbox delivery summary", {
      source,
      claimed: result.claimed,
      delivered: result.delivered,
      retryScheduled: result.retryScheduled,
      permanentFailures: result.permanentFailures,
      invalidatedTokens: result.invalidatedTokens
    });
  }
}

type ApnsConfiguration = {
  bundleId: string;
  keyId: string;
  privateKey: string;
  teamId: string;
};

function apnsConfiguration(): { config: ApnsConfiguration | null; missing: string[] } {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim();
  const missing: string[] = [];
  if (!keyId) missing.push("APNS_KEY_ID");
  if (!teamId) missing.push("APNS_TEAM_ID");
  if (!privateKey) missing.push("APNS_PRIVATE_KEY");
  if (!bundleId) missing.push("APNS_BUNDLE_ID");
  return {
    config: keyId && teamId && privateKey && bundleId
      ? { bundleId, keyId, privateKey, teamId }
      : null,
    missing
  };
}

function apnsJwt(config: ApnsConfiguration) {
  const encodedHeader = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const encodedPayload = base64Url(JSON.stringify({
    iss: config.teamId,
    iat: Math.floor(Date.now() / 1000)
  }));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363"
  });
  return `${unsigned}.${base64Url(signature)}`;
}

function apnsAuthorization(config: ApnsConfiguration) {
  const now = Date.now();
  const fingerprint = crypto.createHash("sha256")
    .update(`${config.teamId}:${config.keyId}:${config.privateKey}`)
    .digest("hex");
  if (
    cachedApnsAuthorization?.fingerprint === fingerprint &&
    now - cachedApnsAuthorization.createdAt < 50 * 60 * 1000
  ) {
    return cachedApnsAuthorization.value;
  }
  const value = `bearer ${apnsJwt(config)}`;
  cachedApnsAuthorization = { fingerprint, createdAt: now, value };
  return value;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}
