import { query } from "./db";
import type { RequestSession } from "./session";

type IntegrationTimeEntryRow = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  clientName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  placeId: string | null;
  placeName: string | null;
  source: string;
  confidence: string;
  reviewStatus: string;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  updatedAt: string;
  tagNames: string[];
  elapsedSeconds: number;
};

type TodayTotalRow = {
  todaySeconds: number;
};

const INTEGRATION_TIME_ZONE = "Europe/London";

export type IntegrationTimeCurrentSnapshot = {
  ok: true;
  serverNow: string;
  workspaceId: string;
  activeEntry: IntegrationTimeEntry | null;
  todaySeconds: number;
  updatedAt: string;
};

export type IntegrationTimeEntry = {
  id: string;
  description: string | null;
  startedAt: string;
  stoppedAt: null;
  elapsedSeconds: number;
  source: string;
  confidence: string;
  reviewStatus: string;
  project: {
    id: string;
    name: string;
    color: string | null;
    clientName: string | null;
  } | null;
  category: {
    id: string;
    name: string;
    color: string | null;
  } | null;
  place: {
    id: string;
    name: string;
  } | null;
  tags: string[];
  updatedAt: string;
};

export async function getIntegrationTimeCurrentSnapshot(
  session: RequestSession
): Promise<IntegrationTimeCurrentSnapshot> {
  const serverNow = new Date();
  const [activeResult, totalResult] = await Promise.all([
    query<IntegrationTimeEntryRow>(
      `select te.id,
              p.id as "projectId",
              p.name as "projectName",
              p.color as "projectColor",
              cl.name as "clientName",
              cat.id as "categoryId",
              cat.name as "categoryName",
              cat.color as "categoryColor",
              pl.id as "placeId",
              pl.name as "placeName",
              te.source,
              te.confidence,
              te.review_status as "reviewStatus",
              te.description,
              te.started_at as "startedAt",
              te.stopped_at as "stoppedAt",
              te.updated_at as "updatedAt",
              (
                select coalesce(array_agg(t.name order by t.name), '{}')
                from time_entry_tags tet
                join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
                where tet.time_entry_id = te.id
              ) as "tagNames",
              extract(epoch from ($3::timestamptz - te.started_at))::int as "elapsedSeconds"
       from time_entries te
       left join projects p on p.id = te.project_id and p.workspace_id = te.workspace_id
       left join clients cl on cl.id = p.client_id and cl.workspace_id = te.workspace_id
       left join categories cat on cat.id = te.category_id and cat.workspace_id = te.workspace_id
       left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
       where te.workspace_id = $1 and te.user_id = $2 and te.stopped_at is null
       order by te.started_at desc
       limit 1`,
      [session.workspaceId, session.userId, serverNow.toISOString()]
    ),
    query<TodayTotalRow>(
      `with bounds as (
         select (($3::timestamptz at time zone $4)::date at time zone $4) as day_start,
                ((($3::timestamptz at time zone $4)::date + interval '1 day') at time zone $4) as day_end
       )
       select coalesce(
                sum(
                  extract(epoch from (
                    least(coalesce(te.stopped_at, $3::timestamptz), bounds.day_end)
                    - greatest(te.started_at, bounds.day_start)
                  ))
                ),
                0
              )::int
              as "todaySeconds"
       from time_entries te
       cross join bounds
       where te.workspace_id = $1
         and te.user_id = $2
         and te.started_at < bounds.day_end
         and coalesce(te.stopped_at, $3::timestamptz) > bounds.day_start`,
      [session.workspaceId, session.userId, serverNow.toISOString(), INTEGRATION_TIME_ZONE]
    )
  ]);

  const activeEntry = activeResult.rows[0] ? publicEntry(activeResult.rows[0]) : null;
  return {
    ok: true,
    serverNow: serverNow.toISOString(),
    workspaceId: session.workspaceId,
    activeEntry,
    todaySeconds: totalResult.rows[0]?.todaySeconds ?? 0,
    updatedAt: activeEntry?.updatedAt ?? serverNow.toISOString()
  };
}

function publicEntry(row: IntegrationTimeEntryRow): IntegrationTimeEntry {
  return {
    id: row.id,
    description: row.description,
    startedAt: row.startedAt,
    stoppedAt: null,
    elapsedSeconds: Math.max(0, row.elapsedSeconds),
    source: row.source,
    confidence: row.confidence,
    reviewStatus: row.reviewStatus,
    project:
      row.projectId && row.projectName
        ? {
            id: row.projectId,
            name: row.projectName,
            color: row.projectColor,
            clientName: row.clientName
          }
        : null,
    category:
      row.categoryId && row.categoryName
        ? {
            id: row.categoryId,
            name: row.categoryName,
            color: row.categoryColor
          }
        : null,
    place:
      row.placeId && row.placeName
        ? {
            id: row.placeId,
            name: row.placeName
          }
        : null,
    tags: row.tagNames,
    updatedAt: row.updatedAt
  };
}
