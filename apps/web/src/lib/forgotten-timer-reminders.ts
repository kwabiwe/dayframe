import type { PoolClient } from "pg";
import { pool } from "./db";
import type { RequestSession } from "./session";
import { lockUserTimerState } from "./timer-owner-lock";

type Owner = Pick<RequestSession, "workspaceId" | "userId">;

const overdueLatestTimer = `
  select e.id
  from public.time_entries e
  where e.workspace_id = $1 and e.user_id = $2 and e.id = $3
    and e.stopped_at is null
    and e.started_at <= statement_timestamp() - interval '8 hours'
    and exists (
      select 1 from public.workspace_members membership
      where membership.workspace_id = e.workspace_id and membership.user_id = e.user_id
    )
    and not exists (
      select 1 from public.time_entries newer
      where newer.workspace_id = e.workspace_id and newer.user_id = e.user_id
        and newer.stopped_at is null
        and (newer.started_at, newer.id) > (e.started_at, e.id)
    )
`;

/** Share the owner lock with timer Start, Stop and Switch. */
async function withTimerOwner<T>(owner: Owner, action: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockUserTimerState(client, owner);
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function keepOverdueTimerRunning(owner: Owner, entryId: string) {
  return withTimerOwner(owner, async (client) => {
    const result = await client.query(
      `insert into dayframe_sync.forgotten_timer_reminders (entry_id, kept_at)
       select eligible.id, statement_timestamp() from (${overdueLatestTimer} for update) eligible
       on conflict (entry_id) do update
         set kept_at = coalesce(forgotten_timer_reminders.kept_at, excluded.kept_at)`,
      [owner.workspaceId, owner.userId, entryId]
    );
    return result.rowCount === 1;
  });
}

/**
 * Commit a single delivery claim before initiating transport. An ambiguous transport result consumes
 * the alert rather than risking a second notification. A final check under the timer's owner lock
 * suppresses a Stop, Switch, or Keep running committed in the meantime.
 *
 * initiate must enqueue the provider request synchronously and return its response promise.
 * The owner lock is released before awaiting the provider response.
 */
export async function dispatchOverdueTimerReminder<T>(
  owner: Owner,
  entryId: string,
  initiate: () => Promise<T>
): Promise<T | null> {
  const claimed = await withTimerOwner(owner, async (client) => {
    const result = await client.query(
      `insert into dayframe_sync.forgotten_timer_reminders (entry_id, attempted_at)
       select eligible.id, statement_timestamp() from (${overdueLatestTimer} for update) eligible
       on conflict (entry_id) do nothing`,
      [owner.workspaceId, owner.userId, entryId]
    );
    return result.rowCount === 1;
  });
  if (!claimed) return null;

  const response = await withTimerOwner(owner, async (client) => {
    const pending = await client.query(
      `select 1 from (${overdueLatestTimer} for update) eligible
       join dayframe_sync.forgotten_timer_reminders r on r.entry_id = eligible.id
       where r.kept_at is null`,
      [owner.workspaceId, owner.userId, entryId]
    );
    if (pending.rowCount !== 1) return null;
    const delivery = initiate();
    // The provider can fail before the database transaction releases the owner lock.
    void delivery.catch(() => {});
    return { delivery };
  });
  return response ? response.delivery : null;
}
