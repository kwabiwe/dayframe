import crypto from "node:crypto";
import http2 from "node:http2";
import { paletteColorFor } from "@dayframe/shared";
import { query } from "./db";
import type { RequestSession } from "./session";

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

type PushTokenRow = {
  id: string;
  token: string;
  activityId: string;
  activeEntryId: string | null;
  environment: ApnsEnvironment;
};

type ActiveTimerRow = {
  id: string;
  description: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  startedAt: string;
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
  tokenId: string;
  token: string;
  activityId: string;
  environment: ApnsEnvironment;
  revision: string;
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

const MAX_DELIVERY_ATTEMPTS = 8;
const OUTBOX_BATCH_SIZE = 25;
const OUTBOX_LEASE_SECONDS = 30;
const UPDATE_EXPIRY_SECONDS = 60 * 60;
const END_EXPIRY_SECONDS = 24 * 60 * 60;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const INVALID_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "Unregistered"
]);
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
    `with invalidated_previous_tokens as (
       update live_activity_push_tokens
       set invalidated_at = now()
       where workspace_id = $1
         and user_id = $2
         and activity_id = $4
         and token <> $3
         and invalidated_at is null
     )
     insert into live_activity_push_tokens (
       workspace_id, user_id, token, activity_id, active_entry_id, environment
     )
     select $1, $2, $3, $4, te.id, $6
     from time_entries te
     where te.id = $5
       and te.workspace_id = $1
       and te.user_id = $2
       and te.stopped_at is null
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
    throw new LiveActivityRegistrationError("The running timer is no longer active.");
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
    const result = await drainLiveActivityOutbox({ session });
    logDrainResult("reconciliation", result);
  } catch (error) {
    console.error("Dayframe Live Activity outbox reconciliation failed", {
      source: "reconciliation",
      name: error instanceof Error ? error.name : "UnknownError"
    });
  }
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

  // The global sweep owns terminal cleanup. Authenticated timer-state polls only
  // need to claim their user's due work and should stay lightweight.
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
    if (delivery === "delivered") result.delivered += 1;
    else if (delivery === "retry") result.retryScheduled += 1;
    else if (delivery === "invalid_token") result.invalidatedTokens += 1;
    else result.permanentFailures += 1;
  }
  return result;
}

async function enqueueLatestLiveActivityState(session: RequestSession) {
  const [tokensResult, activeResult] = await Promise.all([
    query<PushTokenRow>(
      `select id,
              token,
              activity_id as "activityId",
              active_entry_id as "activeEntryId",
              environment
       from live_activity_push_tokens
       where workspace_id = $1
         and user_id = $2
         and invalidated_at is null`,
      [session.workspaceId, session.userId]
    ),
    query<ActiveTimerRow>(
      `select te.id,
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
       limit 1`,
      [session.workspaceId, session.userId]
    )
  ]);

  const active = activeResult.rows[0] ?? null;
  const timestamp = Math.floor(Date.now() / 1000);
  await Promise.all(tokensResult.rows.map((token) => {
    // Activity attributes are immutable. Only the Activity registered for the
    // canonical running entry may receive its updates; every older run must be
    // ended rather than repurposed to display a newer timer with a stale Stop
    // control.
    const shouldUpdate = Boolean(active && token.activeEntryId === active.id);
    const event: ApnsEvent = shouldUpdate ? "update" : "end";
    const payload: LiveActivityPayload = shouldUpdate
      ? {
          aps: {
            timestamp,
            event,
            "content-state": contentState(active!, true)
          }
        }
      : {
          aps: {
            timestamp,
            event,
            "dismissal-date": timestamp - 1,
            "content-state": stoppedContentState()
          }
        };
    const expiresAt = new Date(
      (timestamp + (event === "end" ? END_EXPIRY_SECONDS : UPDATE_EXPIRY_SECONDS)) * 1000
    ).toISOString();

    return query(
      `insert into live_activity_delivery_outbox (
       token_id, workspace_id, user_id, event, payload, expires_at
     ) values ($1, $2, $3, $4, $5::jsonb, $6)
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
       updated_at = now()`,
      [
        token.id,
        session.workspaceId,
        session.userId,
        event,
        JSON.stringify(payload),
        expiresAt
      ]
    );
  }));
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
               o.token_id as "tokenId",
               t.token,
               t.activity_id as "activityId",
               t.environment,
               o.revision::text as revision,
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
): Promise<"delivered" | "retry" | "permanent" | "invalid_token"> {
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
    const failure = failureFor(row, null, "NetworkError", "retry");
    await recordOutboxFailure(row, failure, null, apnsId);
    return row.attemptCount + 1 < MAX_DELIVERY_ATTEMPTS ? "retry" : "permanent";
  }

  if (response.ok) {
    await Promise.all([
      query(
        `update live_activity_push_tokens
         set last_attempt_at = now(),
             last_delivered_at = now(),
             last_delivery_status = $2,
             last_delivery_reason = null,
             consecutive_failures = 0,
             active_entry_id = case when $3 = 'end' then null else active_entry_id end,
             invalidated_at = case when $3 = 'end' then now() else invalidated_at end
         where id = $1`,
        [row.tokenId, response.status, row.event]
      ),
      query(
        `update live_activity_delivery_outbox
         set status = 'delivered',
             attempt_count = attempt_count + 1,
             leased_until = null,
             last_attempt_at = now(),
             last_delivery_status = $3,
             last_delivery_reason = null,
             last_apns_id = $4,
             updated_at = now()
         where id = $1 and revision = $2::bigint`,
        [row.id, row.revision, response.status, response.apnsId ?? apnsId]
      )
    ]);
    return "delivered";
  }

  const reason = safeApnsReason(parseApnsBody(response.body).reason, response.status);
  const disposition = classifyApnsFailure(response.status, reason);
  const failure = failureFor(row, response.status, reason, disposition);
  await recordOutboxFailure(row, failure, response.retryAfter, response.apnsId ?? apnsId);
  if (disposition === "retry" && row.attemptCount + 1 >= MAX_DELIVERY_ATTEMPTS) {
    return "permanent";
  }
  return disposition;
}

async function recordOutboxFailure(
  row: OutboxRow,
  failure: LiveActivityDeliveryFailure,
  retryAfter: string | null,
  apnsId: string
) {
  const nextAttempt = new Date(
    Date.now() + retryDelayMs(row.attemptCount + 1, retryAfter)
  ).toISOString();
  const nextStatus = failure.disposition === "retry" && row.attemptCount + 1 < MAX_DELIVERY_ATTEMPTS
    ? "pending"
    : "permanent_failure";
  const invalidate = failure.disposition === "invalid_token";

  await Promise.all([
    query(
      `update live_activity_push_tokens
       set last_attempt_at = now(),
           last_delivery_status = $2,
           last_delivery_reason = $3,
           consecutive_failures = consecutive_failures + 1,
           invalidated_at = case when $4 then now() else invalidated_at end
       where id = $1`,
      [row.tokenId, failure.status, failure.reason, invalidate]
    ),
    query(
      `update live_activity_delivery_outbox
       set status = $3,
           attempt_count = attempt_count + 1,
           next_attempt_at = $4,
           leased_until = null,
           last_attempt_at = now(),
           last_delivery_status = $5,
           last_delivery_reason = $6,
           last_apns_id = $7,
           updated_at = now()
       where id = $1 and revision = $2::bigint`,
      [row.id, row.revision, nextStatus, nextAttempt, failure.status, failure.reason, apnsId]
    )
  ]);
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
    title: description || categoryName || "Uncategorized",
    categoryName,
    categoryColor: categoryName
      ? paletteColorFor(active.categoryColor ?? categoryName, categoryName, "dark")
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
    title: "Uncategorized",
    categoryName: null,
    categoryColor: null,
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
