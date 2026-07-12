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
  const { dayStart, dayEnd } = currentLocalDayRange(serverNow);
  const [activeResult, totalResult] = await Promise.all([
    query<IntegrationTimeEntryRow>(
      `select te.id,
              te.project_id as "projectId",
              p.name as "projectName",
              p.color as "projectColor",
              cl.name as "clientName",
              te.category_id as "categoryId",
              cat.name as "categoryName",
              cat.color as "categoryColor",
              te.place_id as "placeId",
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
                join tags t on t.id = tet.tag_id
                where tet.time_entry_id = te.id
              ) as "tagNames",
              extract(epoch from ($3::timestamptz - te.started_at))::int as "elapsedSeconds"
       from time_entries te
       left join projects p on p.id = te.project_id
       left join clients cl on cl.id = p.client_id
       left join categories cat on cat.id = te.category_id
       left join places pl on pl.id = te.place_id
       where te.workspace_id = $1 and te.user_id = $2 and te.stopped_at is null
       order by te.started_at desc
       limit 1`,
      [session.workspaceId, session.userId, serverNow.toISOString()]
    ),
    query<TodayTotalRow>(
      `select coalesce(sum(extract(epoch from (coalesce(te.stopped_at, $5::timestamptz) - te.started_at))), 0)::int
              as "todaySeconds"
       from time_entries te
       where te.workspace_id = $1
         and te.user_id = $2
         and te.started_at >= $3::timestamptz
         and te.started_at < $4::timestamptz`,
      [session.workspaceId, session.userId, dayStart.toISOString(), dayEnd.toISOString(), serverNow.toISOString()]
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

function currentLocalDayRange(now: Date) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}
