import assert from "node:assert/strict";
import { DAYFRAME_STARTER_ACTIVITIES } from "@dayframe/shared";
import { seedDefaultWorkspaceData } from "../apps/web/src/lib/auth/local";
import { ensureCommuteCategoryId } from "../apps/web/src/lib/automatic-category-service";
import { pool } from "../apps/web/src/lib/db";
import type { RequestSession } from "../apps/web/src/lib/session";
import { addMissingStarterActivities } from "../apps/web/src/lib/starter-activities-service";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "DATABASE_URL is required.");
const parsedDatabaseUrl = new URL(databaseUrl);
assert(
  ["localhost", "127.0.0.1"].includes(parsedDatabaseUrl.hostname) && parsedDatabaseUrl.pathname.endsWith("_test"),
  "Refusing to run starter activity validation outside a disposable local *_test database."
);

const NEW_WORKSPACE = "52000000-0000-4000-8000-000000000001";
const EXISTING_WORKSPACE = "52000000-0000-4000-8000-000000000002";
const RACE_WORKSPACE = "52000000-0000-4000-8000-000000000003";
const USER_ID = "52000000-0000-4000-8000-000000000009";

function session(workspaceId: string): RequestSession {
  return { workspaceId, userId: USER_ID, authMode: "token", scopes: ["app:read", "app:write"] };
}

type Row = { name: string; starterKey: string | null; isPinned: boolean; icon: string | null; isArchived: boolean };

async function categories(workspaceId: string) {
  const result = await pool.query<Row>(
    `select name, starter_key as "starterKey", is_pinned as "isPinned", icon, is_archived as "isArchived"
     from categories where workspace_id = $1 order by created_at, name`,
    [workspaceId]
  );
  return result.rows;
}

async function resetWorkspaces() {
  await pool.query("delete from workspaces where id = any($1::uuid[])", [[NEW_WORKSPACE, EXISTING_WORKSPACE, RACE_WORKSPACE]]);
  await pool.query("delete from users where id = $1", [USER_ID]);
  await pool.query("insert into users (id, email, name) values ($1, 'starter-validation@example.test', 'Starter Validation')", [USER_ID]);
  for (const id of [NEW_WORKSPACE, EXISTING_WORKSPACE, RACE_WORKSPACE]) {
    await pool.query("insert into workspaces (id, name) values ($1, 'Starter Validation')", [id]);
    await pool.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [id, USER_ID]);
  }
}

async function insertCategory(workspaceId: string, name: string, starterKey: string | null, isArchived = false) {
  await pool.query(
    `insert into categories (workspace_id, name, color, starter_key, is_archived, created_at)
     values ($1, $2, 'steel', $3, $4, now() + (random() * interval '1 millisecond'))`,
    [workspaceId, name, starterKey, isArchived]
  );
}

async function validateNewWorkspaceSeeding() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await seedDefaultWorkspaceData(client, NEW_WORKSPACE);
    await client.query("commit");
  } finally {
    client.release();
  }
  const rows = await categories(NEW_WORKSPACE);
  assert.equal(rows.length, 16, "a new workspace gets the 16 starters");
  assert.deepEqual(rows.filter((row) => row.isPinned).map((row) => row.name).sort(), ["Admin", "Exercise", "Learning", "Personal", "Work"]);
  assert.ok(rows.every((row) => row.icon && row.starterKey), "every starter carries an icon and starter key");
  assert.ok(!rows.some((row) => row.name === "General"), "no General category");
  const project = await pool.query<{ categoryId: string | null }>(
    `select category_id as "categoryId" from projects where workspace_id = $1 and name = 'General'`,
    [NEW_WORKSPACE]
  );
  assert.equal(project.rows[0]?.categoryId, null, "the legacy General project has no category");
}

async function validateExistingWorkspace() {
  // Exercise archived and Walk renamed to "Exercise"; Sleep's key held only by an archived row;
  // two unlinked "Errands" rows; a renamed Commute starter.
  await insertCategory(EXISTING_WORKSPACE, "Exercise", "exercise", true);
  await insertCategory(EXISTING_WORKSPACE, "Exercise", "walk");
  await insertCategory(EXISTING_WORKSPACE, "Sleep", "sleep", true);
  await insertCategory(EXISTING_WORKSPACE, "Errands", null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await insertCategory(EXISTING_WORKSPACE, "errands", null);
  await insertCategory(EXISTING_WORKSPACE, "Getting there", "commute");
  const before = await categories(EXISTING_WORKSPACE);

  const first = await addMissingStarterActivities(session(EXISTING_WORKSPACE));
  const after = await categories(EXISTING_WORKSPACE);
  const active = after.filter((row) => !row.isArchived);

  const activeNames = active.map((row) => row.name.trim().toLowerCase());
  assert.equal(new Set(activeNames).size + 1, activeNames.length, "only the pre-existing Errands pair shares a name");
  assert.equal(active.filter((row) => row.name === "Exercise").length, 1, "Exercise is not added back as a duplicate name");
  assert.ok(active.some((row) => row.name === "Sleep" && row.starterKey === "sleep"), "Sleep is re-added when its key is only archived");
  const errands = active.filter((row) => row.name.toLowerCase() === "errands");
  assert.deepEqual(errands.map((row) => row.starterKey), ["errands", null], "the oldest Errands is linked");
  assert.ok(!active.some((row) => row.name === "Commute"), "a renamed Commute starter is respected");
  assert.ok(first.added.every((row) => active.find((candidate) => candidate.starterKey === row.starterKey)?.isPinned === false), "added starters are unpinned");
  for (const row of before) {
    const same = after.find((candidate) => candidate.name === row.name && candidate.isArchived === row.isArchived && (candidate.starterKey === row.starterKey || row.starterKey === null));
    assert.ok(same, `existing ${row.name} keeps its name`);
    assert.equal(same.isPinned, row.isPinned, `existing ${row.name} keeps its pin`);
    assert.equal(same.icon, row.icon, `existing ${row.name} keeps its icon`);
  }

  const second = await addMissingStarterActivities(session(EXISTING_WORKSPACE));
  assert.deepEqual(second, { added: [], linked: [] }, "a second call changes nothing");
}

async function validateRaceWithAutomaticCommute() {
  const automatic = (async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const id = await ensureCommuteCategoryId(client, session(RACE_WORKSPACE));
      await client.query("commit");
      return id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  })();
  const [, starters] = await Promise.all([automatic, addMissingStarterActivities(session(RACE_WORKSPACE))]);
  assert.ok(starters, "the starters call completes");
  const commute = (await categories(RACE_WORKSPACE)).filter((row) => !row.isArchived && row.starterKey === "commute");
  assert.equal(commute.length, 1, "exactly one active Commute starter after a race");
  const all = (await categories(RACE_WORKSPACE)).filter((row) => !row.isArchived);
  assert.equal(all.length, DAYFRAME_STARTER_ACTIVITIES.length, "every starter exists once");
}

async function validateConstraints() {
  await assert.rejects(
    pool.query("insert into categories (workspace_id, name, color, starter_key) values ($1, 'Second Sleep', 'steel', 'sleep')", [NEW_WORKSPACE]),
    /categories_workspace_starter_key_idx/
  );
  await assert.rejects(
    pool.query("insert into categories (workspace_id, name, color, icon) values ($1, 'Bad', 'steel', 'Bad Icon')", [NEW_WORKSPACE]),
    /categories_icon_format/
  );
}

async function run() {
  await resetWorkspaces();
  await validateNewWorkspaceSeeding();
  await validateExistingWorkspace();
  await validateRaceWithAutomaticCommute();
  await validateConstraints();
  await pool.query("delete from workspaces where id = any($1::uuid[])", [[NEW_WORKSPACE, EXISTING_WORKSPACE, RACE_WORKSPACE]]);
  await pool.query("delete from users where id = $1", [USER_ID]);
  console.log("Starter activity validation passed: seeding, add/link without duplicates, archived keys, oldest link, idempotence, automatic race, constraints.");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
