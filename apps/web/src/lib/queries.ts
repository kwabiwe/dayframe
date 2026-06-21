import type {
  AutomationRuleSummary,
  CategorySummary,
  NormalizationContext,
  PlaceSummary,
  ProjectSummary
} from "@dayframe/shared";
import { query } from "./db";
import { getDevSession, type RequestSession } from "./session";

export type ClientRow = {
  id: string;
  name: string;
  color: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  color: string;
};

export type ProjectRow = {
  id: string;
  name: string;
  color: string;
  billable: boolean;
  clientId: string | null;
  clientName: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

export type TagRow = {
  id: string;
  name: string;
  color: string;
};

export type PlaceRow = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  priority: number;
  defaultProjectId: string | null;
  defaultProjectName: string | null;
  defaultCategoryId: string | null;
  defaultCategoryName: string | null;
  autoStart: boolean;
};

export type AutomationRuleRow = {
  id: string;
  name: string;
  triggerSource: string;
  triggerType: string;
  placeId: string | null;
  placeName: string | null;
  action: string;
  projectId: string | null;
  projectName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  confidenceThreshold: string;
  enabled: boolean;
};

export type TimeEntryRow = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  clientName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  placeId: string | null;
  placeName: string | null;
  source: string;
  confidence: string;
  reviewStatus: string;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
  tagNames: string[];
};

export type ReviewItemRow = {
  id: string;
  type: string;
  title: string;
  eventSource: string | null;
  eventType: string | null;
  projectName: string | null;
  categoryName: string | null;
  placeName: string | null;
  suggestedProjectId: string | null;
  suggestedCategoryId: string | null;
  suggestedPlaceId: string | null;
  suggestedStartedAt: string | null;
  suggestedStoppedAt: string | null;
  confidence: string;
  status: string;
  notes: string | null;
  createdAt: string;
};

export type ActivityRow = {
  id: string;
  source: string;
  eventType: string;
  occurredAt: string;
  confidence: string;
  reviewStatus: string;
  projectName: string | null;
  placeName: string | null;
};

export type DashboardStats = {
  todaySeconds: number;
  weekSeconds: number;
  reviewCount: number;
};

export type ReportRow = {
  id: string;
  name: string;
  seconds: number;
  color: string | null;
};

export type BootstrapData = {
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
  clients: ClientRow[];
  categories: CategoryRow[];
  projects: ProjectRow[];
  tags: TagRow[];
  places: PlaceRow[];
  automationRules: AutomationRuleRow[];
  entries: TimeEntryRow[];
  activeEntry: TimeEntryRow | null;
  reviewItems: ReviewItemRow[];
  activityEvents: ActivityRow[];
  stats: DashboardStats;
};

export async function getBootstrapData(session: RequestSession = getDevSession()): Promise<BootstrapData> {
  const [
    workspaces,
    clients,
    categories,
    projects,
    tags,
    places,
    automationRules,
    entries,
    activeEntry,
    reviewItems,
    activityEvents,
    stats
  ] = await Promise.all([
    getWorkspaces(session),
    getClients(session),
    getCategories(session),
    getProjects(session),
    getTags(session),
    getPlaces(session),
    getAutomationRules(session),
    getTimeEntries(session),
    getActiveEntry(session),
    getReviewItems(session),
    getActivityEvents(session),
    getDashboardStats(session)
  ]);

  return {
    workspace: workspaces.find((workspace) => workspace.id === session.workspaceId) ?? workspaces[0],
    workspaces,
    clients,
    categories,
    projects,
    tags,
    places,
    automationRules,
    entries,
    activeEntry,
    reviewItems,
    activityEvents,
    stats
  };
}

export async function getNormalizationContext(
  session: RequestSession = getDevSession()
): Promise<NormalizationContext> {
  const [projects, categories, places, automationRules] = await Promise.all([
    getProjects(session),
    getCategories(session),
    getPlaces(session),
    getAutomationRules(session)
  ]);

  return {
    projects: projects.map<ProjectSummary>((project) => ({
      id: project.id,
      name: project.name,
      clientId: project.clientId,
      categoryId: project.categoryId
    })),
    categories: categories.map<CategorySummary>((category) => ({
      id: category.id,
      name: category.name
    })),
    places: places.map<PlaceSummary>((place) => ({
      id: place.id,
      name: place.name,
      radiusMeters: place.radiusMeters,
      priority: place.priority,
      defaultProjectId: place.defaultProjectId,
      defaultCategoryId: place.defaultCategoryId,
      autoStart: place.autoStart
    })),
    automationRules: automationRules.map<AutomationRuleSummary>((rule) => ({
      id: rule.id,
      name: rule.name,
      triggerSource: rule.triggerSource as AutomationRuleSummary["triggerSource"],
      triggerType: rule.triggerType as AutomationRuleSummary["triggerType"],
      placeId: rule.placeId,
      action: rule.action as AutomationRuleSummary["action"],
      projectId: rule.projectId,
      categoryId: rule.categoryId,
      enabled: rule.enabled
    }))
  };
}

async function getWorkspaces(session: RequestSession) {
  const result = await query<{ id: string; name: string }>(
    `select w.id, w.name
     from workspaces w
     join workspace_members wm on wm.workspace_id = w.id
     where wm.user_id = $1
     order by w.name`,
    [session.userId]
  );
  return result.rows;
}

async function getClients(session: RequestSession) {
  const result = await query<ClientRow>(
    `select id, name, color
     from clients
     where workspace_id = $1 and is_archived = false
     order by name`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getCategories(session: RequestSession) {
  const result = await query<CategoryRow>(
    `select id, name, color
     from categories
     where workspace_id = $1 and is_archived = false
     order by name`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getProjects(session: RequestSession) {
  const result = await query<ProjectRow>(
    `select p.id,
            p.name,
            p.color,
            p.billable,
            p.client_id as "clientId",
            c.name as "clientName",
            p.category_id as "categoryId",
            cat.name as "categoryName"
     from projects p
     left join clients c on c.id = p.client_id
     left join categories cat on cat.id = p.category_id
     where p.workspace_id = $1 and p.is_archived = false
     order by p.name`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getTags(session: RequestSession) {
  const result = await query<TagRow>(
    `select id, name, color
     from tags
     where workspace_id = $1
     order by name`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getPlaces(session: RequestSession) {
  const result = await query<PlaceRow>(
    `select pl.id,
            pl.name,
            pl.latitude,
            pl.longitude,
            pl.radius_meters as "radiusMeters",
            pl.priority,
            pl.default_project_id as "defaultProjectId",
            p.name as "defaultProjectName",
            pl.default_category_id as "defaultCategoryId",
            c.name as "defaultCategoryName",
            pl.auto_start as "autoStart"
     from places pl
     left join projects p on p.id = pl.default_project_id
     left join categories c on c.id = pl.default_category_id
     where pl.workspace_id = $1
     order by pl.priority desc, pl.name`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getAutomationRules(session: RequestSession) {
  const result = await query<AutomationRuleRow>(
    `select ar.id,
            ar.name,
            ar.trigger_source as "triggerSource",
            ar.trigger_type as "triggerType",
            ar.place_id as "placeId",
            pl.name as "placeName",
            ar.action,
            ar.project_id as "projectId",
            p.name as "projectName",
            ar.category_id as "categoryId",
            c.name as "categoryName",
            ar.confidence_threshold as "confidenceThreshold",
            ar.enabled
     from automation_rules ar
     left join places pl on pl.id = ar.place_id
     left join projects p on p.id = ar.project_id
     left join categories c on c.id = ar.category_id
     where ar.workspace_id = $1
     order by ar.created_at desc`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getTimeEntries(session: RequestSession) {
  const result = await query<TimeEntryRow>(
    `select te.id,
            te.project_id as "projectId",
            p.name as "projectName",
            p.color as "projectColor",
            cl.name as "clientName",
            te.category_id as "categoryId",
            cat.name as "categoryName",
            te.place_id as "placeId",
            pl.name as "placeName",
            te.source,
            te.confidence,
            te.review_status as "reviewStatus",
            te.description,
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id
              where tet.time_entry_id = te.id
            ) as "tagNames",
            extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at))::int as "durationSeconds"
     from time_entries te
     left join projects p on p.id = te.project_id
     left join clients cl on cl.id = p.client_id
     left join categories cat on cat.id = te.category_id
     left join places pl on pl.id = te.place_id
     where te.workspace_id = $1
     order by te.started_at desc
     limit 100`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getActiveEntry(session: RequestSession) {
  const result = await query<TimeEntryRow>(
    `select te.id,
            te.project_id as "projectId",
            p.name as "projectName",
            p.color as "projectColor",
            cl.name as "clientName",
            te.category_id as "categoryId",
            cat.name as "categoryName",
            te.place_id as "placeId",
            pl.name as "placeName",
            te.source,
            te.confidence,
            te.review_status as "reviewStatus",
            te.description,
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id
              where tet.time_entry_id = te.id
            ) as "tagNames",
            extract(epoch from (now() - te.started_at))::int as "durationSeconds"
     from time_entries te
     left join projects p on p.id = te.project_id
     left join clients cl on cl.id = p.client_id
     left join categories cat on cat.id = te.category_id
     left join places pl on pl.id = te.place_id
     where te.workspace_id = $1 and te.user_id = $2 and te.stopped_at is null
     order by te.started_at desc
     limit 1`,
    [session.workspaceId, session.userId]
  );
  return result.rows[0] ?? null;
}

async function getReviewItems(session: RequestSession) {
  const result = await query<ReviewItemRow>(
    `select ri.id,
            ri.type,
            ri.title,
            ae.source as "eventSource",
            ae.event_type as "eventType",
            p.name as "projectName",
            c.name as "categoryName",
            pl.name as "placeName",
            ri.suggested_project_id as "suggestedProjectId",
            ri.suggested_category_id as "suggestedCategoryId",
            ri.suggested_place_id as "suggestedPlaceId",
            ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            ri.confidence,
            ri.status,
            ri.notes,
            ri.created_at as "createdAt"
     from review_items ri
     left join activity_events ae on ae.id = ri.event_id
     left join projects p on p.id = ri.suggested_project_id
     left join categories c on c.id = ri.suggested_category_id
     left join places pl on pl.id = ri.suggested_place_id
     where ri.workspace_id = $1
     order by case ri.status when 'open' then 0 else 1 end, ri.created_at desc
     limit 100`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getActivityEvents(session: RequestSession) {
  const result = await query<ActivityRow>(
    `select ae.id,
            ae.source,
            ae.event_type as "eventType",
            ae.occurred_at as "occurredAt",
            ae.confidence,
            ae.review_status as "reviewStatus",
            p.name as "projectName",
            pl.name as "placeName"
     from activity_events ae
     left join projects p on p.id = ae.suggested_project_id
     left join places pl on pl.id = ae.suggested_place_id
     where ae.workspace_id = $1
     order by ae.occurred_at desc
     limit 24`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getDashboardStats(session: RequestSession) {
  const result = await query<DashboardStats>(
    `select
        coalesce(sum(
          extract(epoch from (coalesce(stopped_at, now()) - started_at))
        ) filter (where started_at::date = current_date), 0)::int as "todaySeconds",
        coalesce(sum(
          extract(epoch from (coalesce(stopped_at, now()) - started_at))
        ) filter (where started_at >= date_trunc('week', now())), 0)::int as "weekSeconds",
        (select count(*)::int from review_items where workspace_id = $1 and status = 'open') as "reviewCount"
     from time_entries
     where workspace_id = $1`,
    [session.workspaceId]
  );
  return result.rows[0] ?? { todaySeconds: 0, weekSeconds: 0, reviewCount: 0 };
}

export async function getReports(session: RequestSession = getDevSession()) {
  const [byProject, byClient, byCategory, bySource, byPlace, byTag] = await Promise.all([
    query<ReportRow>(
      `select coalesce(p.id::text, 'unassigned') as id,
              coalesce(p.name, 'Unassigned') as name,
              p.color,
              sum(extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at)))::int as seconds
       from time_entries te
       left join projects p on p.id = te.project_id
       where te.workspace_id = $1
       group by coalesce(p.id::text, 'unassigned'), coalesce(p.name, 'Unassigned'), p.color
       order by seconds desc`,
      [session.workspaceId]
    ),
    query<ReportRow>(
      `select coalesce(c.id::text, 'unassigned') as id,
              coalesce(c.name, 'Unassigned') as name,
              c.color,
              sum(extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at)))::int as seconds
       from time_entries te
       left join projects p on p.id = te.project_id
       left join clients c on c.id = p.client_id
       where te.workspace_id = $1
       group by coalesce(c.id::text, 'unassigned'), coalesce(c.name, 'Unassigned'), c.color
       order by seconds desc`,
      [session.workspaceId]
    ),
    query<ReportRow>(
      `select coalesce(c.id::text, 'unassigned') as id,
              coalesce(c.name, 'Unassigned') as name,
              c.color,
              sum(extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at)))::int as seconds
       from time_entries te
       left join categories c on c.id = te.category_id
       where te.workspace_id = $1
       group by coalesce(c.id::text, 'unassigned'), coalesce(c.name, 'Unassigned'), c.color
       order by seconds desc`,
      [session.workspaceId]
    ),
    query<ReportRow>(
      `select source as id,
              source as name,
              null::text as color,
              sum(extract(epoch from (coalesce(stopped_at, now()) - started_at)))::int as seconds
       from time_entries
       where workspace_id = $1
       group by source
       order by seconds desc`,
      [session.workspaceId]
    ),
    query<ReportRow>(
      `select coalesce(pl.id::text, 'no-place') as id,
              coalesce(pl.name, 'No place') as name,
              null::text as color,
              sum(extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at)))::int as seconds
       from time_entries te
       left join places pl on pl.id = te.place_id
       where te.workspace_id = $1
       group by coalesce(pl.id::text, 'no-place'), coalesce(pl.name, 'No place')
       order by seconds desc`,
      [session.workspaceId]
    ),
    query<ReportRow>(
      `select t.id::text as id,
              t.name,
              t.color,
              sum(extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at)))::int as seconds
       from time_entry_tags tet
       join tags t on t.id = tet.tag_id
       join time_entries te on te.id = tet.time_entry_id
       where te.workspace_id = $1
       group by t.id, t.name, t.color
       order by seconds desc`,
      [session.workspaceId]
    )
  ]);

  return {
    byProject: byProject.rows,
    byClient: byClient.rows,
    byCategory: byCategory.rows,
    bySource: bySource.rows,
    byPlace: byPlace.rows,
    byTag: byTag.rows
  };
}
