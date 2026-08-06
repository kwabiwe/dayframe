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

type PushTokenRow = {
  id: string;
  token: string;
  environment: "development" | "production";
};

type ActiveTimerRow = {
  id: string;
  description: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  startedAt: string;
};

type LiveActivityDeliveryFailure = {
  environment: "development" | "production";
  event: "update" | "end";
  status: number | null;
  reason: string;
};

class LiveActivityDeliveryError extends Error {
  constructor(readonly failure: LiveActivityDeliveryFailure) {
    super(`APNs Live Activity delivery failed: ${failure.reason}`);
    this.name = "LiveActivityDeliveryError";
  }
}

class LiveActivityDeliveryAggregateError extends Error {
  constructor(readonly failures: LiveActivityDeliveryFailure[]) {
    super(`${failures.length} APNs Live Activity delivery attempt(s) failed.`);
    this.name = "LiveActivityDeliveryAggregateError";
  }
}

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
       workspace_id = excluded.workspace_id,
       user_id = excluded.user_id,
       activity_id = excluded.activity_id,
       active_entry_id = excluded.active_entry_id,
       environment = excluded.environment,
       last_registered_at = now(),
       invalidated_at = null
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

export async function notifyLiveActivities(session: RequestSession) {
  const configuration = apnsConfiguration();
  if (!configuration.config) {
    console.warn("Dayframe Live Activity APNs delivery skipped", {
      missingConfiguration: configuration.missing
    });
    return;
  }
  const config = configuration.config;

  let authorization: string;
  try {
    authorization = `bearer ${apnsJwt(config)}`;
  } catch {
    throw new LiveActivityDeliveryAggregateError([{
      environment: "production",
      event: "update",
      status: null,
      reason: "InvalidProviderKey"
    }]);
  }

  const [tokensResult, activeResult] = await Promise.all([
    query<PushTokenRow>(
      `select id,
              token,
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
  const results = await Promise.allSettled(
    tokensResult.rows.map((row) => sendTimerState(
      row,
      active,
      config,
      authorization
    ))
  );
  const failures = results.flatMap((result) => {
    if (result.status === "fulfilled") return [];
    if (result.reason instanceof LiveActivityDeliveryError) return [result.reason.failure];
    return [{
      environment: "production" as const,
      event: active ? "update" as const : "end" as const,
      status: null,
      reason: "UnexpectedDeliveryError"
    }];
  });
  if (failures.length) throw new LiveActivityDeliveryAggregateError(failures);
}

export async function notifyLiveActivitiesBestEffort(session: RequestSession) {
  try {
    await notifyLiveActivities(session);
  } catch (error) {
    const failures = error instanceof LiveActivityDeliveryAggregateError
      ? error.failures
      : [{
          environment: "production" as const,
          event: "update" as const,
          status: null,
          reason: "UnexpectedDeliveryError"
        }];
    console.error("Dayframe Live Activity APNs delivery failed", {
      failures
    });
  }
}

async function sendTimerState(
  tokenRow: PushTokenRow,
  active: ActiveTimerRow | null,
  config: ApnsConfiguration,
  authorization: string
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const event = active ? "update" as const : "end" as const;
  const payload = active
    ? {
        aps: {
          timestamp,
          event: "update",
          "content-state": contentState(active, true)
        }
      }
    : {
        aps: {
          timestamp,
          event: "end",
          "dismissal-date": timestamp - 1,
          "content-state": {
            title: "Uncategorized",
            categoryName: null,
            categoryColor: null,
            startedAt: null,
            elapsedSeconds: 0,
            isRunning: false
          }
        }
      };

  const host = tokenRow.environment === "development"
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";
  let response: { ok: boolean; status: number; body: string };
  try {
    response = await sendApnsRequest(host, tokenRow.token, {
      authorization,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
      "apns-topic": `${config.bundleId}.push-type.liveactivity`,
      "content-type": "application/json"
    }, JSON.stringify(payload));
  } catch {
    const failure = {
      environment: tokenRow.environment,
      event,
      status: null,
      reason: "NetworkError"
    };
    await recordDeliveryFailure(tokenRow.id, failure, false);
    throw new LiveActivityDeliveryError(failure);
  }

  if (response.ok) {
    await query(
      `update live_activity_push_tokens
       set last_attempt_at = now(),
           last_delivered_at = now(),
           last_delivery_status = $2,
           last_delivery_reason = null,
           consecutive_failures = 0,
           active_entry_id = $3,
           invalidated_at = case when $3::uuid is null then now() else null end
       where id = $1`,
      [tokenRow.id, response.status, active?.id ?? null]
    );
    return;
  }

  const body = parseApnsBody(response.body);
  const reason = safeApnsReason(body.reason, response.status);
  const shouldInvalidate = response.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered";
  const failure = {
    environment: tokenRow.environment,
    event,
    status: response.status,
    reason
  };
  await recordDeliveryFailure(tokenRow.id, failure, shouldInvalidate);
  throw new LiveActivityDeliveryError(failure);
}

function sendApnsRequest(
  host: string,
  token: string,
  headers: Record<string, string>,
  body: string
) {
  return new Promise<{ ok: boolean; status: number; body: string }>((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    let settled = false;
    const finish = (result: { ok: boolean; status: number; body: string }) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
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
    let status = 500;
    let responseBody = "";
    request.setEncoding("utf8");
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 500);
    });
    request.on("data", (chunk) => {
      if (responseBody.length < 4_096) responseBody += chunk;
    });
    request.once("end", () => finish({ ok: status >= 200 && status < 300, status, body: responseBody }));
    request.once("error", (error) => {
      if (settled) return;
      settled = true;
      client.close();
      reject(error);
    });
    request.end(body);
  });
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
    isRunning
  };
}

async function recordDeliveryFailure(
  rowId: string,
  failure: LiveActivityDeliveryFailure,
  invalidate: boolean
) {
  await query(
    `update live_activity_push_tokens
     set last_attempt_at = now(),
         last_delivery_status = $2,
         last_delivery_reason = $3,
         consecutive_failures = consecutive_failures + 1,
         invalidated_at = case when $4 then now() else invalidated_at end
     where id = $1`,
    [rowId, failure.status, failure.reason, invalidate]
  );
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

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}
