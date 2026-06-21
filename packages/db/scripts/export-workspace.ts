import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";

const workspaceId = process.env.DAYFRAME_DEV_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000010";
const databaseUrl = process.env.DATABASE_URL ?? "postgres://dayframe:dayframe@localhost:54322/dayframe";
const outputPath = resolve(process.argv[2] ?? `dayframe-backup-${new Date().toISOString().slice(0, 10)}.json`);

const pool = new pg.Pool({ connectionString: databaseUrl });

const tables = [
  "clients",
  "projects",
  "categories",
  "tags",
  "places",
  "automation_rules",
  "activity_events",
  "time_entries",
  "review_items",
  "health_sleep_segments",
  "import_runs"
];

async function main() {
  const exportData: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    workspaceId
  };

  for (const table of tables) {
    const result = await pool.query(`select * from ${table} where workspace_id = $1`, [workspaceId]);
    exportData[table] = result.rows;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(exportData, null, 2)}\n`);
  console.log(`Wrote Dayframe workspace backup to ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
