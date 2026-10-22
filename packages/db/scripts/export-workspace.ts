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
  "time_entry_tags",
  "review_items",
  // Location stays and moves, including the Apple venue Place IDs kept for stays (location v3 PR 8).
  "stay_segments",
  "commute_segments",
  "health_sleep_segments",
  "location_name_patterns",
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
  // Which blocks a person edited, and the end they set: an earlier queued Stop never pulls back such an
  // end. Only the entry, the action, the end and when; no other audit history.
  const edits = await pool.query(
    `select entity_id as time_entry_id, action, metadata->>'stoppedAt' as stopped_at, created_at
     from audit_log
     where workspace_id = $1 and entity_type = 'time_entry' and action in ('time_entry.end_set', 'time_entry.edited')
     order by created_at, id`,
    [workspaceId]
  );
  exportData.time_entry_edits = edits.rows;

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
