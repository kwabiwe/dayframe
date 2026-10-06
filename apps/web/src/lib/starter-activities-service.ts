import type pg from "pg";
import { DAYFRAME_STARTER_ACTIVITIES, type DayframeStarterActivity } from "@dayframe/shared";
import { pool } from "./db";
import type { RequestSession } from "./session";

type StarterRow = { id: string; name: string; starterKey: string };

async function insertStarters(
  client: pg.PoolClient,
  workspaceId: string,
  starters: readonly DayframeStarterActivity[],
  { keepDefaultPins }: { keepDefaultPins: boolean }
): Promise<StarterRow[]> {
  if (starters.length === 0) return [];
  const params: unknown[] = [workspaceId];
  const values = starters.map((starter) => {
    const base = params.length;
    params.push(starter.name, starter.color, keepDefaultPins && starter.isPinned, starter.icon, starter.starterKey);
    return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  const result = await client.query<StarterRow>(
    `insert into categories (workspace_id, name, color, is_pinned, icon, starter_key)
     values ${values.join(", ")}
     returning id, name, starter_key as "starterKey"`,
    params
  );
  return result.rows;
}

/** Every starter activity, for a workspace that is being created. */
export async function insertStarterActivities(client: pg.PoolClient, workspaceId: string) {
  return insertStarters(client, workspaceId, DAYFRAME_STARTER_ACTIVITIES, { keepDefaultPins: true });
}

/**
 * Adds the starters an existing workspace is missing. An active activity that already has
 * a starter's name (ignoring case and spaces) is linked to it instead of duplicated; nothing
 * is renamed, recoloured, re-iconed or re-pinned, and added starters are not pinned.
 */
export async function addMissingStarterActivities(session: RequestSession) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from workspaces where id = $1 for update", [session.workspaceId]);
    const existing = await client.query<{ id: string; name: string; starterKey: string | null }>(
      `select id, name, starter_key as "starterKey"
       from categories
       where workspace_id = $1 and is_archived = false`,
      [session.workspaceId]
    );
    const presentKeys = new Set(existing.rows.map((row) => row.starterKey).filter(Boolean));
    const unlinkedByName = new Map(
      existing.rows
        .filter((row) => !row.starterKey)
        .map((row) => [row.name.trim().toLowerCase(), row.id] as const)
    );

    const linked: Array<{ id: string; starterKey: string }> = [];
    const missing: DayframeStarterActivity[] = [];
    for (const starter of DAYFRAME_STARTER_ACTIVITIES) {
      if (presentKeys.has(starter.starterKey)) continue;
      const sameNameId = unlinkedByName.get(starter.name.toLowerCase());
      if (sameNameId) {
        await client.query(
          "update categories set starter_key = $1 where id = $2 and workspace_id = $3 and starter_key is null",
          [starter.starterKey, sameNameId, session.workspaceId]
        );
        linked.push({ id: sameNameId, starterKey: starter.starterKey });
      } else {
        missing.push(starter);
      }
    }

    // The workspace already has its own pins, so added starters arrive unpinned.
    const added = await insertStarters(client, session.workspaceId, missing, { keepDefaultPins: false });
    await client.query("commit");
    return { added, linked };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
