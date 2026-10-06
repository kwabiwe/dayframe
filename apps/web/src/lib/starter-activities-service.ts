import type pg from "pg";
import { DAYFRAME_STARTER_ACTIVITIES, type DayframeStarterActivity } from "@dayframe/shared";
import { AUTOMATIC_STARTER_LOCK_NAMES, automaticCategoryLockKey } from "./automatic-category-service";
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
    // Same locks, in the same order, as automatic Sleep/Commute creation, so neither path can
    // insert a starter the other is about to insert.
    for (const name of AUTOMATIC_STARTER_LOCK_NAMES) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        automaticCategoryLockKey(session.workspaceId, name)
      ]);
    }
    // NO KEY UPDATE still serialises with other starters/create calls but, unlike FOR UPDATE, does
    // not wait on transactions that merely reference the workspace (location replay inserts),
    // which may later want the Commute lock this call already holds.
    await client.query("select id from workspaces where id = $1 for no key update", [session.workspaceId]);
    const existing = await client.query<{ id: string; name: string; starterKey: string | null }>(
      `select id, name, starter_key as "starterKey"
       from categories
       where workspace_id = $1 and is_archived = false
       order by created_at asc, id asc`,
      [session.workspaceId]
    );
    const presentKeys = new Set(existing.rows.map((row) => row.starterKey).filter(Boolean));
    const normalized = (name: string) => name.trim().toLowerCase();
    // Every active name, so a starter never returns as a duplicate of a renamed activity.
    const activeNames = new Set(existing.rows.map((row) => normalized(row.name)));
    // The oldest unlinked activity per name, matching what automatic categories already prefer.
    const unlinkedByName = new Map<string, string>();
    for (const row of existing.rows) {
      if (!row.starterKey && !unlinkedByName.has(normalized(row.name))) unlinkedByName.set(normalized(row.name), row.id);
    }

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
      } else if (!activeNames.has(starter.name.toLowerCase())) {
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
