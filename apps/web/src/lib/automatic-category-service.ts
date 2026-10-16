import type pg from "pg";
import { starterActivityByKey, type DayframeStarterActivityKey } from "@dayframe/shared";
import type { RequestSession } from "./session";

export type AutomaticLoggingCategoryKind = "sleep" | "health" | "commute";

export type AutomaticCategorySpec = {
  name: string;
  color: string;
  icon: string;
  /** Starter activity this category stands for; found by key first so renames keep working. */
  starterKey: DayframeStarterActivityKey | null;
  /** Whether a newly created activity fills the daily goal (Sleep does not). */
  countsTowardGoal: boolean;
};

function starterSpec(key: DayframeStarterActivityKey): AutomaticCategorySpec {
  const starter = starterActivityByKey(key);
  return {
    name: starter.name,
    color: starter.color,
    icon: starter.icon,
    starterKey: starter.starterKey,
    countsTowardGoal: starter.countsTowardGoal
  };
}

export function healthCategorySpecForEventType(
  eventType: string | null | undefined
): AutomaticCategorySpec {
  if (eventType === "health_sleep_import") return starterSpec("sleep");
  return { name: "Health", color: "moss", icon: "health", starterKey: null, countsTowardGoal: true };
}

export function commuteCategorySpec(): AutomaticCategorySpec {
  return starterSpec("commute");
}

/** Travel: the activity a Move suggests when it is not Home ↔ Work (PRD D19, A5). */
export function travelCategorySpec(): AutomaticCategorySpec {
  return starterSpec("travel");
}

export function automaticLoggingCategorySpec(
  kind: AutomaticLoggingCategoryKind
): AutomaticCategorySpec {
  if (kind === "sleep") return healthCategorySpecForEventType("health_sleep_import");
  if (kind === "health") return healthCategorySpecForEventType("health_workout_import");
  return commuteCategorySpec();
}

export function automaticCategoryLockKey(workspaceId: string, name: string) {
  return `dayframe:auto-category:${workspaceId}:${name.toLowerCase()}`;
}

// Starter categories that automatic logging can create. Callers that take more than one of
// these locks take them in this (alphabetical) order.
export const AUTOMATIC_STARTER_LOCK_NAMES = ["Commute", "Sleep", "Travel"] as const;

/**
 * Takes the per-name activity locks automatic creation uses, deduplicated and in one sorted
 * order (the same alphabetical order as AUTOMATIC_STARTER_LOCK_NAMES). Every activity writer
 * that checks a name takes these BEFORE the workspace row lock, so a rename, restore or create
 * serialises with automatic creation of the same name and the lock order never inverts.
 */
export async function lockActivityNames(
  client: Pick<pg.PoolClient, "query">,
  workspaceId: string,
  names: Array<string | null | undefined>
) {
  const keys = [...new Set(names
    .filter((name): name is string => Boolean(name?.trim()))
    .map((name) => name.trim().toLowerCase()))].sort();
  for (const name of keys) {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [automaticCategoryLockKey(workspaceId, name)]
    );
  }
}

export async function ensureAutomaticCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  spec: AutomaticCategorySpec,
  /** Counts a created category (the app's activity list changes). */
  changes?: { count: number }
) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [automaticCategoryLockKey(session.workspaceId, spec.name)]
  );
  if (spec.starterKey) {
    const starter = await client.query<{ id: string }>(
      `select id
       from categories
       where workspace_id = $1
         and starter_key = $2
         and coalesce(is_archived, false) = false
       limit 1`,
      [session.workspaceId, spec.starterKey]
    );
    if (starter.rows[0]) return starter.rows[0].id;
  }
  const existing = await client.query<{ id: string }>(
    `select id
     from categories
     where workspace_id = $1
       and lower(name) = lower($2)
       and coalesce(is_archived, false) = false
     order by created_at asc
     limit 1`,
    [session.workspaceId, spec.name]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await client.query<{ id: string }>(
    `insert into categories (workspace_id, name, color, is_pinned, icon, starter_key, counts_toward_goal)
     values ($1, $2, $3, false, $4, $5, $6)
     returning id`,
    [session.workspaceId, spec.name, spec.color, spec.icon, spec.starterKey, spec.countsTowardGoal]
  );
  if (changes) changes.count += 1;
  return created.rows[0].id;
}

export async function ensureHealthEventCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  eventType: string | null | undefined
) {
  return ensureAutomaticCategoryId(client, session, healthCategorySpecForEventType(eventType));
}

/**
 * Travel, created like Commute when a Move needs it. It takes Commute's name lock first, so a
 * transaction that names Moves in any order keeps the one lock order (Commute, Sleep, Travel) that
 * starter activities use; transaction advisory locks are re-entrant.
 */
export async function ensureTravelCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  changes?: { count: number }
) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [automaticCategoryLockKey(session.workspaceId, commuteCategorySpec().name)]
  );
  return ensureAutomaticCategoryId(client, session, travelCategorySpec(), changes);
}

/** The workspace's Errands activity if it has one (never created): a Move with a stop suggests it. */
export async function findErrandsCategoryId(client: Pick<pg.PoolClient, "query">, session: RequestSession) {
  const errands = starterActivityByKey("errands");
  const result = await client.query<{ id: string }>(
    `select id from categories
     where workspace_id = $1 and coalesce(is_archived, false) = false
       and (starter_key = $2 or lower(name) = lower($3))
     order by (starter_key = $2) desc nulls last, created_at asc
     limit 1`,
    [session.workspaceId, errands.starterKey, errands.name]
  );
  return result.rows[0]?.id ?? null;
}

export async function ensureCommuteCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  changes?: { count: number }
) {
  return ensureAutomaticCategoryId(client, session, commuteCategorySpec(), changes);
}
