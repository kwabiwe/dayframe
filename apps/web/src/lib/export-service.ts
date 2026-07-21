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
    staySegments,
    commuteSegments,
    locationEvidence,
    placeMatchFeedback,
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
    table("stay_segments", session),
    table("commute_segments", session),
    locationEvidenceTable(session),
    table("place_match_feedback", session),
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
    staySegments,
    commuteSegments,
    locationEvidence,
    placeMatchFeedback,
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
     where te.workspace_id = $1 and te.user_id = $2
     order by te.started_at desc`,
    [session.workspaceId, session.userId]
  );

  return toCsv(result.rows);
}

async function table(tableName: string, session: RequestSession) {
  const userScoped = new Set([
    "activity_events",
    "time_entries",
    "review_items",
    "health_sleep_segments",
    "stay_segments",
    "commute_segments",
    "location_evidence",
    "place_match_feedback"
  ]);
  const result = userScoped.has(tableName)
    ? await query(`select * from ${tableName} where workspace_id = $1 and user_id = $2`, [session.workspaceId, session.userId])
    : await query(`select * from ${tableName} where workspace_id = $1`, [session.workspaceId]);
  return result.rows;
}

async function locationEvidenceTable(session: RequestSession) {
  const result = await query(
    `select id, workspace_id, user_id, device_id, client_evidence_id, client_batch_id,
            evidence_type, occurred_at, ended_at,
            case when coordinate is null then null else jsonb_build_object(
              'type', 'Point',
              'coordinates', jsonb_build_array(ST_X(coordinate::geometry), ST_Y(coordinate::geometry))
            ) end as coordinate,
            horizontal_accuracy_m, altitude_m, speed_mps, course_degrees,
            saved_place_id, geofence_identifier, accepted, rejection_reason,
            algorithm_version, time_zone, is_simulated, metadata,
            received_at, expires_at, created_at
     from location_evidence
     where workspace_id = $1 and user_id = $2 and expires_at > now()
     order by occurred_at, client_evidence_id`,
    [session.workspaceId, session.userId]
  );
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
