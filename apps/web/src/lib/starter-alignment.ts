import type pg from "pg";
import { DAYFRAME_STARTER_ACTIVITIES, starterActivityByKey, type DayframeStarterActivity } from "@dayframe/shared";
import { AUTOMATIC_STARTER_LOCK_NAMES, lockActivityNames } from "./automatic-category-service";

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

  // The rename: the Travel starter (its key, else an unlinked activity simply named Travel), unless
  // a Getting around already exists or the person renamed the starter to something of their own.
  // A row named Travel that is another starter (renamed) is never taken (Codex r1 on #502).
  let rename: AlignmentPlan["rename"] = null;
  const keyed = active.find((row) => row.starterKey === "travel");
  const legacyNamed = active.filter((row) => normalized(row.name) === "travel");
  // Any other active activity already called Getting around (unlinked, or another starter renamed
  // to it) blocks the rename: no two activities may share the name (Codex r2 on #502).
  const otherGettingAround = active.filter((row) => row.id !== keyed?.id && normalized(row.name) === normalized(travel.name));
  const hasGettingAround = otherGettingAround.length > 0 || (keyed !== undefined && normalized(keyed.name) === normalized(travel.name));
  const candidate = keyed
    ? normalized(keyed.name) === "travel" && otherGettingAround.length === 0 ? keyed : null
    : hasGettingAround ? null : legacyNamed.find((row) => !row.starterKey) ?? null;
  if (candidate) rename = { id: candidate.id, from: candidate.name, to: travel.name, icon: travel.icon };
  else if (keyed && !hasGettingAround) leftAlone.push({ name: keyed.name, reason: "kept: the Travel starter was renamed by you" });
  for (const row of otherGettingAround) leftAlone.push({ name: row.name, reason: "kept: already has this starter's name" });
  for (const row of legacyNamed.filter((row) => row.id !== candidate?.id)) {
    leftAlone.push({
      name: row.name,
      reason: hasGettingAround ? `kept: a "${travel.name}" activity already exists` : "kept: another activity with this name"
    });
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
    // Archived under its key, its name, or (Getting around) its old name: not added again.
    const archivedStarter = archived.find((row) => row.starterKey === starter.starterKey
      || normalized(row.name) === normalized(starter.name)
      || (starter.starterKey === "travel" && normalized(row.name) === "travel"));
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
  await lockActivityNames(client, workspaceId, [...AUTOMATIC_STARTER_LOCK_NAMES]);
  await client.query("select id from workspaces where id = $1 for no key update", [workspaceId]);
  const plan = planStarterAlignment(await readRows(client, workspaceId));
  if (plan.rename) {
    const renamed = await client.query(
      `update categories set name = $3, icon = $4, starter_key = coalesce(starter_key, $5)
        where id = $1 and workspace_id = $2 and lower(btrim(name)) = 'travel' and coalesce(is_archived, false) = false`,
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
