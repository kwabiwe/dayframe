import { query } from "./db";
import { type RequestSession } from "./session";

export type ExportKind = "workspace_json" | "time_entries_csv" | "time_entries_json" | "activity_events_json" | "review_items_json";

export async function buildWorkspaceExport(session: RequestSession) {
  const [
    clients,
    projects,
    categories,
    tags,
    places,
    automationRules,
    activityEvents,
    timeEntries,
    reviewItems,
    healthSleepSegments,
    importRuns
  ] = await Promise.all([
    table("clients", session),
    table("projects", session),
    table("categories", session),
    table("tags", session),
    table("places", session),
    table("automation_rules", session),
    table("activity_events", session),
    table("time_entries", session),
    table("review_items", session),
    table("health_sleep_segments", session),
    table("import_runs", session)
  ]);

  return {
    exportedAt: new Date().toISOString(),
    workspaceId: session.workspaceId,
    clients,
    projects,
    categories,
    tags,
    places,
    automationRules,
    activityEvents,
    timeEntries,
    reviewItems,
    healthSleepSegments,
    importRuns
  };
}

export async function buildJsonExport(kind: ExportKind, session: RequestSession) {
  switch (kind) {
    case "workspace_json":
      return buildWorkspaceExport(session);
    case "time_entries_json":
      return table("time_entries", session);
    case "activity_events_json":
      return table("activity_events", session);
    case "review_items_json":
      return table("review_items", session);
    default:
      throw new Error(`Unsupported JSON export: ${kind}`);
  }
}

export async function buildTimeEntriesCsv(session: RequestSession) {
  const result = await query(
    `select te.id,
            te.started_at,
            te.stopped_at,
            extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at))::int as duration_seconds,
            te.description,
            p.name as project,
            cl.name as client,
            c.name as category,
            pl.name as place,
            te.source,
            te.confidence,
            te.review_status
     from time_entries te
     left join projects p on p.id = te.project_id
     left join clients cl on cl.id = p.client_id
     left join categories c on c.id = te.category_id
     left join places pl on pl.id = te.place_id
     where te.workspace_id = $1
     order by te.started_at desc`,
    [session.workspaceId]
  );

  return toCsv(result.rows);
}

async function table(tableName: string, session: RequestSession) {
  const result = await query(`select * from ${tableName} where workspace_id = $1`, [session.workspaceId]);
  return result.rows;
}

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n");
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
