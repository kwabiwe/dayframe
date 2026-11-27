import type { PoolClient } from "pg";
import type { RequestSession } from "./session";

export async function lockUserTimerState(
  client: PoolClient,
  owner: Pick<RequestSession, "workspaceId" | "userId">
) {
  await client.query(
    "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    [owner.workspaceId, owner.userId]
  );
}
