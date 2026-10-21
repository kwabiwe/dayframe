import type pg from "pg";
import { DAYFRAME_STARTER_ACTIVITIES, starterActivityByKey, type DayframeStarterActivity } from "@dayframe/shared";
import { AUTOMATIC_STARTER_LOCK_NAMES, automaticCategoryLockKey } from "./automatic-category-service";

/**
 * One workspace's activities brought in line with a new account's (owner decision, 20 Oct 2026):
 * its "Travel" starter becomes "Getting around" with the route icon, keeping its id, colour and
 * history, and any starter it lacks is added (unpinned). Nothing is deleted, merged, recoloured
 * or re-pinned; an activity that already has a starter's name, or an archived starter, is left
 * alone and reported. Run by `scripts/align-starter-activities.ts`.
 */
export type AlignmentRow = {
  id: string;
  name: string;
  starterKey: string | null;
  isArchived: boolean;
};

export type AlignmentPlan = {
  rename: { id: string; from: string; to: string; icon: string } | null;
  add: DayframeStarterActivity[];
  leftAlone: { name: string; reason: string }[];
};

const normalized = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function planStarterAlignment(rows: readonly AlignmentRow[]): AlignmentPlan {
  const active = rows.filter((row) => !row.isArchived);
  const archived = rows.filter((row) => row.isArchived);
  const travel = starterActivityByKey("travel");
  const leftAlone: AlignmentPlan["leftAlone"] = [];

  // The rename: the Travel starter (its key, else an activity simply named Travel), unless a
  // Getting around already exists or the person renamed it to something of their own.
  let rename: AlignmentPlan["rename"] = null;
  const hasGettingAround = active.some((row) => normalized(row.name) === normalized(travel.name));
  const keyed = active.find((row) => row.starterKey === "travel");
  const named = active.filter((row) => normalized(row.name) === "travel");
  const candidate = keyed && normalized(keyed.name) === "travel" ? keyed : keyed ? null : named[0] ?? null;
  if (hasGettingAround) {
    for (const row of named) leftAlone.push({ name: row.name, reason: `kept: a "${travel.name}" activity already exists` });
  } else if (keyed && !candidate) {
    leftAlone.push({ name: keyed.name, reason: "kept: the Travel starter was renamed by you" });
  } else if (candidate) {
    rename = { id: candidate.id, from: candidate.name, to: travel.name, icon: travel.icon };
    for (const row of named.filter((row) => row.id !== candidate.id)) {
      leftAlone.push({ name: row.name, reason: "kept: another activity with this name" });
    }
  }

  const add: DayframeStarterActivity[] = [];
  for (const starter of DAYFRAME_STARTER_ACTIVITIES) {
    if (starter.starterKey === "travel" && (rename || keyed || hasGettingAround)) continue;
    if (active.some((row) => row.starterKey === starter.starterKey)) continue;
    const sameName = active.find((row) => normalized(row.name) === normalized(starter.name));
    if (sameName) {
      leftAlone.push({ name: sameName.name, reason: "kept: already has this starter's name" });
      continue;
    }
    const archivedStarter = archived.find((row) => row.starterKey === starter.starterKey || normalized(row.name) === normalized(starter.name));
    if (archivedStarter) {
      leftAlone.push({ name: archivedStarter.name, reason: "kept archived: not added again" });
      continue;
    }
    add.push(starter);
  }
  return { rename, add, leftAlone };
}

/** The plan as names only, for the record. */
export function describeAlignment(plan: AlignmentPlan) {
  return [
    plan.rename ? `rename "${plan.rename.from}" → "${plan.rename.to}" (icon ${plan.rename.icon}; same id, colour and history)` : "rename: none",
    plan.add.length ? `add (unpinned): ${plan.add.map((starter) => starter.name).join(", ")}` : "add: none",
    ...plan.leftAlone.map((item) => `left alone: "${item.name}" (${item.reason})`)
  ];
}

type Client = Pick<pg.PoolClient, "query">;

async function readRows(client: Client, workspaceId: string) {
  const result = await client.query<AlignmentRow>(
    `select id, name, starter_key as "starterKey", coalesce(is_archived, false) as "isArchived"
       from categories where workspace_id = $1 order by created_at asc, id asc`,
    [workspaceId]
  );
  return result.rows;
}

/** Reads the plan inside the caller's transaction (no changes). */
export async function readStarterAlignment(client: Client, workspaceId: string) {
  return planStarterAlignment(await readRows(client, workspaceId));
}

/**
 * Applies the plan inside the caller's transaction, under the same activity-name locks and
 * workspace lock as automatic creation and "Add starter activities", so neither can race it.
 */
export async function applyStarterAlignment(client: Client, workspaceId: string) {
  const travel = starterActivityByKey("travel");
  const names = [...new Set([...AUTOMATIC_STARTER_LOCK_NAMES, "Travel"])].sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [automaticCategoryLockKey(workspaceId, name)]);
  }
  await client.query("select id from workspaces where id = $1 for no key update", [workspaceId]);
  const plan = planStarterAlignment(await readRows(client, workspaceId));
  if (plan.rename) {
    const renamed = await client.query(
      `update categories set name = $3, icon = $4, starter_key = coalesce(starter_key, $5)
        where id = $1 and workspace_id = $2 and lower(btrim(name)) = 'travel'`,
      [plan.rename.id, workspaceId, plan.rename.to, plan.rename.icon, travel.starterKey]
    );
    if (renamed.rowCount !== 1) throw new Error("The Travel activity changed while aligning; nothing was changed.");
  }
  for (const starter of plan.add) {
    await client.query(
      `insert into categories (workspace_id, name, color, is_pinned, icon, starter_key, counts_toward_goal)
       values ($1, $2, $3, false, $4, $5, $6)`,
      [workspaceId, starter.name, starter.color, starter.icon, starter.starterKey, starter.countsTowardGoal]
    );
  }
  return plan;
}
