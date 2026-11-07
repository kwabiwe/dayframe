import type { TimerStateFingerprint } from "@dayframe/shared";
import { isUndefinedTableError, missingRequiredColumnError, query } from "./db";
import type { RequestSession } from "./session";

const completedEntryRevisionSql = `coalesce((
  select revision::text from dayframe_sync.completed_entry_revisions
  where workspace_id = $1 and user_id = $2
), '0') as "completedEntryRevision"`;

export async function getCompletedEntryRevision(session: RequestSession): Promise<string> {
  try {
    const { rows } = await query<{ completedEntryRevision: string }>(
      `select ${completedEntryRevisionSql}`,
      [session.workspaceId, session.userId]
    );
    return rows[0].completedEntryRevision;
  } catch (error) {
    if (isUndefinedTableError(error, "dayframe_sync.completed_entry_revisions")) {
      throw missingRequiredColumnError(
        "dayframe_sync.completed_entry_revisions", "revision",
        "supabase/migrations/202611070001_completed_entry_revisions.sql", error
      );
    }
    throw error;
  }
}

export async function getTimerState(
  session: RequestSession
): Promise<TimerStateFingerprint> {
  const { rows } = await query<{
    activeEntryId: string | null;
    updatedAt: Date | null;
    completedEntryRevision: string;
  }>(
    `select active.id as "activeEntryId", active.updated_at as "updatedAt", ${completedEntryRevisionSql}
     from (select 1) as probe
     left join lateral (
       select id, updated_at
       from time_entries
       where workspace_id = $1 and user_id = $2 and stopped_at is null
       order by started_at desc
       limit 1
     ) active on true`,
    [session.workspaceId, session.userId]
  );
  const state = rows[0];
  return {
    activeEntryId: state.activeEntryId,
    updatedAt: state.updatedAt?.toISOString() ?? null,
    completedEntryRevision: state.completedEntryRevision,
    serverNow: new Date().toISOString()
  };
}
