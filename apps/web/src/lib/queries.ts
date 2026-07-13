import type {
  AutomationRuleSummary,
  CategorySummary,
  NormalizationContext,
  PlaceSummary,
  ProjectSummary
} from "@dayframe/shared";
import {
  databaseReadinessError,
  isUndefinedColumnError,
  isUndefinedTableError,
  missingRequiredColumnError,
  query
} from "./db";
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
  isPinned: boolean;
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
  defaultActivityDescription: string | null;
  autoStart: boolean;
};

export type LearnedPlaceRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  visitCount: number;
  sampleCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  confidence: string;
  status: "candidate" | "accepted" | "ignored";
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
  activityDescription: string | null;
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
  categoryColor: string | null;
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
  categoryColor: string | null;
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
  categoryName: string | null;
  placeName: string | null;
};

export type DashboardStats = {
  todaySeconds: number;
  weekSeconds: number;
  reviewCount: number;
};

export type DashboardDateRange = {
  selectedDate: string;
  previousDate: string;
  nextDate: string;
  dayStart: string;
  dayEnd: string;
  weekStart: string;
  weekEnd: string;
};

export type DashboardSeriesPoint = {
  key: string;
  label: string;
  seconds: number;
};

export type ReportSeriesPoint = DashboardSeriesPoint;

export type ReportRow = {
  id: string;
  name: string;
  seconds: number;
  color: string | null;
};

export type BootstrapData = {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
  dateRange: DashboardDateRange;
  clients: ClientRow[];
  categories: CategoryRow[];
  projects: ProjectRow[];
  tags: TagRow[];
  places: PlaceRow[];
  learnedPlaces: LearnedPlaceRow[];
  automationRules: AutomationRuleRow[];
  entries: TimeEntryRow[];
  dayEntries: TimeEntryRow[];
  weekEntries: TimeEntryRow[];
  activeEntry: TimeEntryRow | null;
  reviewItems: ReviewItemRow[];
  activityEvents: ActivityRow[];
  stats: DashboardStats;
  todaySeries: DashboardSeriesPoint[];
  weekSeries: DashboardSeriesPoint[];
};

export async function getBootstrapData(
  session: RequestSession = getDevSession(),
  options: { selectedDate?: string | Date | null } = {}
): Promise<BootstrapData> {
  const dateRange = buildDashboardDateRange(options.selectedDate);
  const [
    user,
    workspaces,
    clients,
    categories,
    projects,
    tags,
    places,
    learnedPlaces,
    automationRules,
    entries,
    dayEntries,
    weekEntries,
    activeEntry,
    reviewItems,
    activityEvents,
    stats
  ] = await Promise.all([
    getUser(session),
    getWorkspaces(session),
    getClients(session),
    getCategories(session),
    getProjects(session),
    getTags(session),
    getPlaces(session),
    getLearnedPlaces(session),
    getAutomationRules(session),
    getTimeEntries(session),
    getTimeEntries(session, {
      startedFrom: dateRange.dayStart,
      startedBefore: dateRange.dayEnd,
      limit: 100
    }),
    getTimeEntries(session, {
      startedFrom: dateRange.weekStart,
      startedBefore: dateRange.weekEnd,
      limit: 300
    }),
    getActiveEntry(session),
    getReviewItems(session),
    getActivityEvents(session),
    getDashboardStats(session, dateRange)
  ]);

  return {
    user,
    workspace: workspaces.find((workspace) => workspace.id === session.workspaceId) ?? workspaces[0],
    workspaces,
    dateRange,
    clients,
    categories,
    projects,
    tags,
    places,
    learnedPlaces,
    automationRules,
    entries,
    dayEntries,
    weekEntries,
    activeEntry,
    reviewItems,
    activityEvents,
    stats,
    todaySeries: buildHourlySeries(dayEntries),
    weekSeries: buildWeekSeries(weekEntries, dateRange)
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
      name: category.name,
      color: category.color,
      isPinned: category.isPinned
    })),
    places: places.map<PlaceSummary>((place) => ({
      id: place.id,
      name: place.name,
      radiusMeters: place.radiusMeters,
      priority: place.priority,
            defaultProjectId: place.defaultProjectId,
            defaultCategoryId: place.defaultCategoryId,
            defaultActivityDescription: place.defaultActivityDescription,
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
      activityDescription: rule.activityDescription,
      enabled: rule.enabled
    }))
  };
}

async function getUser(session: RequestSession) {
  const result = await query<{ id: string; email: string; name: string }>(
    `select id, email, name
     from users
     where id = $1`,
    [session.userId]
  );
  return result.rows[0] ?? { id: session.userId, email: "local@dayframe", name: "Dayframe user" };
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
  try {
    const result = await query<CategoryRow>(
      `select id, name, color, is_pinned as "isPinned"
       from categories
       where workspace_id = $1 and is_archived = false
       order by is_pinned desc, name`,
      [session.workspaceId]
    );
    return result.rows;
  } catch (error) {
    if (isUndefinedColumnError(error, "is_pinned")) {
      throw missingRequiredColumnError(
        "categories",
        "is_pinned",
        "supabase/migrations/202607040001_category_pins_and_project_backfill.sql",
        error
      );
    }
    throw error;
  }
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
     left join clients c on c.id = p.client_id and c.workspace_id = p.workspace_id
     left join categories cat on cat.id = p.category_id and cat.workspace_id = p.workspace_id
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
  try {
    const result = await query<PlaceRow>(
      `select pl.id,
              pl.name,
              pl.latitude,
              pl.longitude,
              pl.radius_meters as "radiusMeters",
              pl.priority,
              p.id as "defaultProjectId",
              p.name as "defaultProjectName",
              c.id as "defaultCategoryId",
              c.name as "defaultCategoryName",
              pl.default_activity_description as "defaultActivityDescription",
              pl.auto_start as "autoStart"
       from places pl
       left join projects p on p.id = pl.default_project_id and p.workspace_id = pl.workspace_id
       left join categories c on c.id = pl.default_category_id and c.workspace_id = pl.workspace_id
       where pl.workspace_id = $1
       order by pl.priority desc, pl.name`,
      [session.workspaceId]
    );
    return result.rows;
  } catch (error) {
    if (isUndefinedColumnError(error, "default_activity_description")) {
      throw missingRequiredColumnError(
        "places",
        "default_activity_description",
        "supabase/migrations/202607070002_place_default_activity_description.sql",
        error
      );
    }
    throw error;
  }
}

async function getLearnedPlaces(session: RequestSession, limit = 10) {
  try {
    const result = await query<LearnedPlaceRow>(
      `select id,
              name,
              latitude,
              longitude,
              radius_meters as "radiusMeters",
              visit_count as "visitCount",
              sample_count as "sampleCount",
              first_seen_at as "firstSeenAt",
              last_seen_at as "lastSeenAt",
              last_started_at as "lastStartedAt",
              last_stopped_at as "lastStoppedAt",
              confidence,
              status
       from learned_places
       where workspace_id = $1
         and user_id = $2
         and status = 'candidate'
       order by visit_count desc, last_seen_at desc, sample_count desc, name
       limit $3`,
      [session.workspaceId, session.userId, limit]
    );
    return result.rows;
  } catch (error) {
    if (isUndefinedTableError(error, "learned_places")) {
      throw databaseReadinessError(
        "Database schema is missing public.learned_places. Run supabase/migrations/202607120002_location_learning.sql before viewing learned places.",
        "public.learned_places",
        "supabase/migrations/202607120002_location_learning.sql",
        error
      );
    }
    throw error;
  }
}

async function getAutomationRules(session: RequestSession) {
  try {
    const result = await query<AutomationRuleRow>(
      `select ar.id,
              ar.name,
              ar.trigger_source as "triggerSource",
              ar.trigger_type as "triggerType",
              pl.id as "placeId",
              pl.name as "placeName",
              ar.action,
              p.id as "projectId",
              p.name as "projectName",
              c.id as "categoryId",
              c.name as "categoryName",
              ar.activity_description as "activityDescription",
              ar.confidence_threshold as "confidenceThreshold",
              ar.enabled
       from automation_rules ar
       left join places pl on pl.id = ar.place_id and pl.workspace_id = ar.workspace_id
       left join projects p on p.id = ar.project_id and p.workspace_id = ar.workspace_id and p.is_archived = false
       left join categories c on c.id = ar.category_id and c.workspace_id = ar.workspace_id and c.is_archived = false
       where ar.workspace_id = $1
       order by ar.created_at desc`,
      [session.workspaceId]
    );
    return result.rows;
  } catch (error) {
    if (isUndefinedColumnError(error, "activity_description")) {
      const result = await query<AutomationRuleRow>(
        `select ar.id,
                ar.name,
                ar.trigger_source as "triggerSource",
                ar.trigger_type as "triggerType",
                pl.id as "placeId",
                pl.name as "placeName",
                ar.action,
                p.id as "projectId",
                p.name as "projectName",
                c.id as "categoryId",
                c.name as "categoryName",
                null::text as "activityDescription",
                ar.confidence_threshold as "confidenceThreshold",
                ar.enabled
         from automation_rules ar
         left join places pl on pl.id = ar.place_id and pl.workspace_id = ar.workspace_id
         left join projects p on p.id = ar.project_id and p.workspace_id = ar.workspace_id and p.is_archived = false
         left join categories c on c.id = ar.category_id and c.workspace_id = ar.workspace_id and c.is_archived = false
         where ar.workspace_id = $1
         order by ar.created_at desc`,
        [session.workspaceId]
      );
      return result.rows;
    }
    throw error;
  }
}

async function getTimeEntries(
  session: RequestSession,
  options: { startedFrom?: string; startedBefore?: string; limit?: number } = {}
) {
  const where = ["te.workspace_id = $1"];
  const values: Array<string | number> = [session.workspaceId];
  if (options.startedFrom) {
    values.push(options.startedFrom);
    where.push(`te.started_at >= $${values.length}`);
  }
  if (options.startedBefore) {
    values.push(options.startedBefore);
    where.push(`te.started_at < $${values.length}`);
  }
  values.push(options.limit ?? 100);

  const result = await query<TimeEntryRow>(
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
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id
              where tet.time_entry_id = te.id
            ) as "tagNames",
            extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at))::int as "durationSeconds"
     from time_entries te
     left join projects p on p.id = te.project_id and p.workspace_id = te.workspace_id
     left join clients cl on cl.id = p.client_id and cl.workspace_id = te.workspace_id
     left join categories cat on cat.id = te.category_id and cat.workspace_id = te.workspace_id
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
     where ${where.join(" and ")}
     order by te.started_at desc
     limit $${values.length}`,
    values
  );
  return result.rows;
}

async function getActiveEntry(session: RequestSession) {
  const result = await query<TimeEntryRow>(
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
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id
              where tet.time_entry_id = te.id
            ) as "tagNames",
            extract(epoch from (now() - te.started_at))::int as "durationSeconds"
     from time_entries te
     left join projects p on p.id = te.project_id and p.workspace_id = te.workspace_id
     left join clients cl on cl.id = p.client_id and cl.workspace_id = te.workspace_id
     left join categories cat on cat.id = te.category_id and cat.workspace_id = te.workspace_id
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
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
            case
              when ae.event_type = 'geofence_exit'
                and nullif(ri.title, '') is not null
                and ri.title <> coalesce(pl.name, '')
              then ri.title
              when ae.event_type = 'geofence_exit'
                and nullif(pl.default_activity_description, '') is not null
              then pl.default_activity_description
              else ri.title
            end as title,
            ae.source as "eventSource",
            ae.event_type as "eventType",
            p.name as "projectName",
            c.name as "categoryName",
            c.color as "categoryColor",
            pl.name as "placeName",
            p.id as "suggestedProjectId",
            c.id as "suggestedCategoryId",
            pl.id as "suggestedPlaceId",
            ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            ri.confidence,
            ri.status,
            ri.notes,
            ri.created_at as "createdAt"
     from review_items ri
     left join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id
     left join projects p on p.id = ri.suggested_project_id and p.workspace_id = ri.workspace_id
     left join categories c on c.id = ri.suggested_category_id and c.workspace_id = ri.workspace_id
     left join places pl on pl.id = ri.suggested_place_id and pl.workspace_id = ri.workspace_id
     where ri.workspace_id = $1
       and ri.status = 'open'
     order by ri.created_at desc
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
            c.name as "categoryName",
            pl.name as "placeName"
     from activity_events ae
     left join projects p on p.id = ae.suggested_project_id and p.workspace_id = ae.workspace_id
     left join categories c on c.id = ae.suggested_category_id and c.workspace_id = ae.workspace_id
     left join places pl on pl.id = ae.suggested_place_id and pl.workspace_id = ae.workspace_id
     where ae.workspace_id = $1
     order by ae.occurred_at desc
     limit 24`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getDashboardStats(session: RequestSession, dateRange: DashboardDateRange) {
  const result = await query<DashboardStats>(
    `select
        coalesce(sum(
          extract(epoch from (coalesce(stopped_at, now()) - started_at))
        ) filter (where started_at >= $2::timestamptz and started_at < $3::timestamptz), 0)::int as "todaySeconds",
        coalesce(sum(
          extract(epoch from (coalesce(stopped_at, now()) - started_at))
        ) filter (where started_at >= $4::timestamptz and started_at < $5::timestamptz), 0)::int as "weekSeconds",
        (select count(*)::int from review_items where workspace_id = $1 and status = 'open') as "reviewCount"
     from time_entries
     where workspace_id = $1`,
    [
      session.workspaceId,
      dateRange.dayStart,
      dateRange.dayEnd,
      dateRange.weekStart,
      dateRange.weekEnd
    ]
  );
  return result.rows[0] ?? { todaySeconds: 0, weekSeconds: 0, reviewCount: 0 };
}

function buildDashboardDateRange(input?: string | Date | null): DashboardDateRange {
  const selected = coerceDate(input);
  selected.setHours(0, 0, 0, 0);
  const dayEnd = addDays(selected, 1);
  const previous = addDays(selected, -1);
  const next = addDays(selected, 1);
  const weekStart = startOfWeek(selected);
  const weekEnd = addDays(weekStart, 7);

  return {
    selectedDate: toDateKey(selected),
    previousDate: toDateKey(previous),
    nextDate: toDateKey(next),
    dayStart: selected.toISOString(),
    dayEnd: dayEnd.toISOString(),
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString()
  };
}

function coerceDate(input?: string | Date | null) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return new Date(input);
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (typeof input === "string") {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildHourlySeries(entries: TimeEntryRow[]): DashboardSeriesPoint[] {
  const hours = Array.from({ length: 8 }, (_, index) => 8 + index * 2);
  return hours.map((hour) => ({
    key: `${hour}`,
    label: `${hour.toString().padStart(2, "0")}:00`,
    seconds: entries
      .filter((entry) => new Date(entry.startedAt).getHours() >= hour && new Date(entry.startedAt).getHours() < hour + 2)
      .reduce((sum, entry) => sum + entry.durationSeconds, 0)
  }));
}

function buildWeekSeries(entries: TimeEntryRow[], dateRange: DashboardDateRange): DashboardSeriesPoint[] {
  const start = new Date(dateRange.weekStart);
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(start, index);
    const key = toDateKey(day);
    return {
      key,
      label: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day),
      seconds: entries
        .filter((entry) => toDateKey(new Date(entry.startedAt)) === key)
        .reduce((sum, entry) => sum + entry.durationSeconds, 0)
    };
  });
}

export async function getReports(session: RequestSession = getDevSession()) {
  const dateRange = buildDashboardDateRange();
  const [byCategory, bySource, byPlace, weekTotals] = await Promise.all([
    query<ReportRow>(
      `select coalesce(c.id::text, 'unassigned') as id,
              coalesce(c.name, 'Uncategorized') as name,
              c.color,
              sum(extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at)))::int as seconds
       from time_entries te
       left join categories c on c.id = te.category_id
       where te.workspace_id = $1
       group by coalesce(c.id::text, 'unassigned'), coalesce(c.name, 'Uncategorized'), c.color
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
    query<{ index: number; seconds: number }>(
      `with days as (
         select day_start, index
         from generate_series(
           $2::timestamptz,
           $3::timestamptz - interval '1 day',
           interval '1 day'
         ) with ordinality as series(day_start, index)
       )
       select (days.index - 1)::int as index,
              coalesce(sum(
                extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at))
              ), 0)::int as seconds
       from days
       left join time_entries te
         on te.workspace_id = $1
        and te.started_at >= days.day_start
        and te.started_at < days.day_start + interval '1 day'
       group by days.index
       order by days.index`,
      [session.workspaceId, dateRange.weekStart, dateRange.weekEnd]
    )
  ]);

  const secondsByDay = new Map(weekTotals.rows.map((row) => [row.index, row.seconds]));
  const weekStart = new Date(dateRange.weekStart);
  const weekSeries = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekStart, index);
    return {
      key: toDateKey(day),
      label: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day),
      seconds: secondsByDay.get(index) ?? 0
    };
  });

  return {
    byCategory: byCategory.rows,
    bySource: bySource.rows,
    byPlace: byPlace.rows,
    weekSeries
  };
}
