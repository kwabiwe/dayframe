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

export async function registerLiveActivity(
  session: RequestSession,
  registration: LiveActivityRegistration
) {
  const result = await query(
    `insert into live_activity_push_tokens (
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
  if (!apnsConfiguration()) return;

  const [tokensResult, activeResult] = await Promise.all([
    query<PushTokenRow>(
      `select token, environment
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
  await Promise.allSettled(tokensResult.rows.map((row) => sendTimerState(row, active)));
}

export async function notifyLiveActivitiesBestEffort(session: RequestSession) {
  try {
    await notifyLiveActivities(session);
  } catch (error) {
    console.error("Dayframe Live Activity sync failed", error);
  }
}

async function sendTimerState(tokenRow: PushTokenRow, active: ActiveTimerRow | null) {
  const config = apnsConfiguration();
  if (!config) return;
  const timestamp = Math.floor(Date.now() / 1000);
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
  const response = await sendApnsRequest(host, tokenRow.token, {
    authorization: `bearer ${apnsJwt(config)}`,
    "apns-push-type": "liveactivity",
    "apns-priority": "10",
    "apns-topic": `${config.bundleId}.push-type.liveactivity`,
    "content-type": "application/json"
  }, JSON.stringify(payload));

  if (response.ok) {
    await query(
      `update live_activity_push_tokens set last_delivered_at = now()
       where token = $1`,
      [tokenRow.token]
    );
    if (!active) await invalidateToken(tokenRow.token);
    return;
  }

  if (response.status === 400 || response.status === 410) {
    const body = parseApnsBody(response.body);
    if (response.status === 410 || body.reason === "BadDeviceToken" || body.reason === "Unregistered") {
      await invalidateToken(tokenRow.token);
    }
  }
  throw new Error(`APNs Live Activity delivery failed with ${response.status}.`);
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
    let status = 500;
    let responseBody = "";
    request.setEncoding("utf8");
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 500);
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
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

async function invalidateToken(token: string) {
  await query(
    `update live_activity_push_tokens set invalidated_at = now() where token = $1`,
    [token]
  );
}

type ApnsConfiguration = {
  bundleId: string;
  keyId: string;
  privateKey: string;
  teamId: string;
};

function apnsConfiguration(): ApnsConfiguration | null {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || "com.layereight.dayframe";
  return keyId && teamId && privateKey ? { bundleId, keyId, privateKey, teamId } : null;
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
