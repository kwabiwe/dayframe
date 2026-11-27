import { hashSessionToken } from "./auth/local";
import { pool, query } from "./db";
import { dispatchOverdueTimerReminder } from "./forgotten-timer-reminders";
import { prepareForgottenTimerAlert } from "./live-activity-push";
import type { RequestSession } from "./session";
import { lockUserTimerState } from "./timer-owner-lock";

type Device = { token: string; environment: "development" | "production" };
type RegisteredTimer = Device & { sessionId: string; workspaceId: string; userId: string; entryId: string };

export async function isForgottenTimerDeviceRegistered(session: RequestSession, sessionToken: string) {
  const current = await query(
    `select 1 from dayframe_sync.forgotten_timer_devices d
     join public.auth_sessions s on s.id = d.session_id and s.user_id = d.user_id and s.workspace_id = d.workspace_id
     where d.workspace_id = $1 and d.user_id = $2 and s.token_hash = $3
       and s.revoked_at is null and s.expires_at > statement_timestamp()`,
    [session.workspaceId, session.userId, hashSessionToken(sessionToken)]
  );
  return current.rowCount === 1;
}

export async function registerForgottenTimerDevice(session: RequestSession, sessionToken: string, device: Device) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockUserTimerState(client, session);
    const authenticated = await client.query<{ id: string }>(
      `select id from public.auth_sessions
       where token_hash = $1 and workspace_id = $2 and user_id = $3
         and revoked_at is null and expires_at > statement_timestamp()
       for share`,
      [hashSessionToken(sessionToken), session.workspaceId, session.userId]
    );
    const ownerSession = authenticated.rows[0];
    if (!ownerSession) {
      await client.query("rollback");
      return false;
    }
    // Rebinding the same device to another login removes its previous subscription.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `dayframe:forgotten-timer:${device.environment}:${device.token}`
    ]);
    await client.query(
      `delete from dayframe_sync.forgotten_timer_devices
       where environment = $1 and token = $2 and (workspace_id, user_id) <> ($3, $4)`,
      [device.environment, device.token, session.workspaceId, session.userId]
    );
    await client.query(
      `insert into dayframe_sync.forgotten_timer_devices (workspace_id, user_id, session_id, token, environment)
       values ($1, $2, $3, $4, $5)
       on conflict (workspace_id, user_id) do update
         set session_id = excluded.session_id, token = excluded.token, environment = excluded.environment`,
      [session.workspaceId, session.userId, ownerSession.id, device.token, device.environment]
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function unregisterForgottenTimerDevice(session: RequestSession, sessionToken: string) {
  await query(
    `delete from dayframe_sync.forgotten_timer_devices d
     using public.auth_sessions s where d.session_id = s.id and s.token_hash = $1
       and d.workspace_id = $2 and d.user_id = $3`,
    [hashSessionToken(sessionToken), session.workspaceId, session.userId]
  );
}

export async function sendDueForgottenTimerReminders() {
  const due = await query<RegisteredTimer>(
    `select e.id as "entryId", d.workspace_id as "workspaceId", d.user_id as "userId",
            d.session_id as "sessionId", d.token, d.environment
     from public.time_entries e
     join dayframe_sync.forgotten_timer_devices d
       on d.workspace_id = e.workspace_id and d.user_id = e.user_id
     join public.auth_sessions s on s.id = d.session_id and s.workspace_id = d.workspace_id and s.user_id = d.user_id
     where e.stopped_at is null and e.started_at <= statement_timestamp() - interval '8 hours'
       and s.revoked_at is null and s.expires_at > statement_timestamp()
       and not exists (select 1 from dayframe_sync.forgotten_timer_reminders r where r.entry_id = e.id)
     order by e.started_at, e.id
     limit 32`
  );

  let delivered = 0;
  let failed = 0;
  for (const timer of due.rows) {
    const initiate = prepareForgottenTimerAlert(timer);
    if (!initiate) break;
    try {
      const result = await dispatchOverdueTimerReminder(timer, timer.entryId, initiate, async (client) => {
        const current = await client.query(
          `select 1 from dayframe_sync.forgotten_timer_devices d
           join public.auth_sessions s on s.id = d.session_id and s.workspace_id = d.workspace_id and s.user_id = d.user_id
           where d.workspace_id = $1 and d.user_id = $2 and d.session_id = $3
             and d.token = $4 and d.environment = $5
             and s.revoked_at is null and s.expires_at > statement_timestamp()
           for share of d, s`,
          [timer.workspaceId, timer.userId, timer.sessionId, timer.token, timer.environment]
        );
        return current.rowCount === 1;
      });
      if (result?.ok) delivered += 1;
      else if (result) failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { delivered, failed };
}
