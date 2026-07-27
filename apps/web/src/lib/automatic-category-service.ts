import type pg from "pg";
import type { RequestSession } from "./session";

export type AutomaticLoggingCategoryKind = "sleep" | "health" | "commute";

export type AutomaticCategorySpec = {
  name: string;
  color: string;
};

export function healthCategorySpecForEventType(
  eventType: string | null | undefined
): AutomaticCategorySpec {
  if (eventType === "health_sleep_import") {
    return { name: "Sleep", color: "lime" };
  }
  return { name: "Health", color: "moss" };
}

export function commuteCategorySpec(): AutomaticCategorySpec {
  return { name: "Commute", color: "sky" };
}

export function automaticLoggingCategorySpec(
  kind: AutomaticLoggingCategoryKind
): AutomaticCategorySpec {
  if (kind === "sleep") return healthCategorySpecForEventType("health_sleep_import");
  if (kind === "health") return healthCategorySpecForEventType("health_workout_import");
  return commuteCategorySpec();
}

export async function ensureAutomaticCategoryId(
  client: pg.PoolClient,
  session: RequestSession,
  spec: AutomaticCategorySpec
) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`dayframe:auto-category:${session.workspaceId}:${spec.name.toLowerCase()}`]
  );
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
    `insert into categories (workspace_id, name, color, is_pinned)
     values ($1, $2, $3, false)
     returning id`,
    [session.workspaceId, spec.name, spec.color]
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
