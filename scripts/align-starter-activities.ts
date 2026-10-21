import assert from "node:assert/strict";
import pg from "pg";
import { applyStarterAlignment, describeAlignment, readStarterAlignment } from "../apps/web/src/lib/starter-alignment";

// Owner-approved (20 Oct 2026): one workspace's activities in line with a new account's ("Travel"
// becomes "Getting around"; missing starters added; nothing deleted, merged or recoloured).
//   DATABASE_URL=… npx tsx scripts/align-starter-activities.ts --workspace <uuid>          (plan only)
//   DATABASE_URL=… npx tsx scripts/align-starter-activities.ts --workspace <uuid> --apply  (one transaction)
// Prints activity names only.
const args = process.argv.slice(2);
const workspaceId = args[args.indexOf("--workspace") + 1];
const apply = args.includes("--apply");
assert(process.env.DATABASE_URL, "DATABASE_URL is required.");
assert(args.includes("--workspace") && /^[0-9a-f-]{36}$/i.test(workspaceId ?? ""), "Pass --workspace <uuid>.");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
async function run() {
  await client.connect();
  try {
    await client.query(apply ? "begin" : "begin transaction read only");
    const plan = apply ? await applyStarterAlignment(client, workspaceId) : await readStarterAlignment(client, workspaceId);
    await client.query(apply ? "commit" : "rollback");
    console.log(`${apply ? "Applied" : "Plan (nothing changed)"}:`);
    for (const line of describeAlignment(plan)) console.log(`  ${line}`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
