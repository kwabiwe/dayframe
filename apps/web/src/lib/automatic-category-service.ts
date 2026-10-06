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
};

function starterSpec(key: DayframeStarterActivityKey): AutomaticCategorySpec {
  const starter = starterActivityByKey(key);
  return { name: starter.name, color: starter.color, icon: starter.icon, starterKey: starter.starterKey };
}

export function healthCategorySpecForEventType(
  eventType: string | null | undefined
): AutomaticCategorySpec {
  if (eventType === "health_sleep_import") return starterSpec("sleep");
  return { name: "Health", color: "moss", icon: "health", starterKey: null };
}

export function commuteCategorySpec(): AutomaticCategorySpec {
  return starterSpec("commute");
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
export const AUTOMATIC_STARTER_LOCK_NAMES = ["Commute", "Sleep"] as const;

export async function ensureAutomaticCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  spec: AutomaticCategorySpec
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
    `insert into categories (workspace_id, name, color, is_pinned, icon, starter_key)
     values ($1, $2, $3, false, $4, $5)
     returning id`,
    [session.workspaceId, spec.name, spec.color, spec.icon, spec.starterKey]
  );
  return created.rows[0].id;
}

export async function ensureHealthEventCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  eventType: string | null | undefined
) {
  return ensureAutomaticCategoryId(client, session, healthCategorySpecForEventType(eventType));
}

export async function ensureCommuteCategoryId(
  client: pg.PoolClient,
  session: RequestSession
) {
  return ensureAutomaticCategoryId(client, session, commuteCategorySpec());
}
