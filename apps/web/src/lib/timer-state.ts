import type { TimerStateFingerprint } from "@dayframe/shared";
import { query } from "@/lib/db";
import type { RequestSession } from "@/lib/session";

export async function getTimerState(
  session: RequestSession
): Promise<TimerStateFingerprint> {
  const result = await query<{
    activeEntryId: string;
    updatedAt: Date;
  }>(
    `select id as "activeEntryId",
            updated_at as "updatedAt"
     from time_entries
     where workspace_id = $1
       and user_id = $2
       and stopped_at is null
     order by started_at desc
     limit 1`,
    [session.workspaceId, session.userId]
  );
  const active = result.rows[0];
  return {
    activeEntryId: active?.activeEntryId ?? null,
    updatedAt: active?.updatedAt.toISOString() ?? null,
    serverNow: new Date().toISOString()
  };
}
