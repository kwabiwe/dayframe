import type {
  AutomationRuleSummary,
  CategorySummary,
  CategoryUsageRank,
  NormalizationContext,
  PlaceRole,
  PlaceSummary,
  PlaceVisitStats,
  ProjectSummary,
  RecentActivitySuggestion,
  RecentActivitySuggestionCandidate
} from "@dayframe/shared";
import { REVIEW_DECISION_PAYLOAD_KEY } from "./review-decision-signal";
import { foldedOutingMemberSql, OUTING_STAYS_SQL, outingStaysFromRows } from "./review-card-count";
import {
  analyzeTimeIntervals,
  buildCategoryUsageRanks,
  buildHistoricalSuggestionCandidates,
  buildRecentActivitySuggestions,
  LOCATION_ENGINE_V2_CONFIG
} from "@dayframe/shared";
import {
  databaseReadinessError,
  isUndefinedColumnError,
  isUndefinedTableError,
  missingRequiredColumnError,
  query
} from "./db";
import { getLocationGroups, withLocationGroups, type LocationGroup } from "./location/location-groups";
import { placeDisplayNameSql } from "./place-display";
import { getDevSession, type RequestSession } from "./session";
import { entryOverlapSeconds } from "./time-entry-overlap";
import { addDaysToDateKey, mondayOfDateKey, zonedDateKey, zonedStartOfDay, zonedWallHour } from "./viewer-time-zone";

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
  /** Key from the shared activity icon set; null derives the icon from the name. */
  icon?: string | null;
  /** Starter activity key; set by Dayframe, never by clients. */
  starterKey?: string | null;
  /** false leaves this activity's time out of goal progress (UIA-043; Sleep starts false). */
  countsTowardGoal?: boolean;
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
  normalizedName: string;
  usageCount: number;
};

export type PlaceRow = {
  id: string;
  name: string;
  role: PlaceRole | null;
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
  loggingEnabled: boolean;
  autoLog: boolean;
};

export type LearnedPlaceRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  visitCount: number;
  distinctDayCount: number;
  sampleCount: number;
  totalDwellSeconds: number;
  longestDwellSeconds: number;
  averageAccuracyMeters: number | null;
  maxClusterSpreadMeters: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  confidence: string;
  classification: "place_candidate" | "one_off_activity" | "noise";
  status: "candidate" | "accepted" | "ignored";
  address: Record<string, unknown> | null;
  poiName: string | null;
  formattedAddress: string | null;
  geocodedAt: string | null;
  rawPayload: Record<string, unknown> | null;
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
  /** Its place is archived (PRD D19 A10): kept and exported, never executed. */
  placeArchived?: boolean;
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
  placeKind?: "saved" | "one_time" | null;
  source: string;
  confidence: string;
  reviewStatus: string;
  /** True when an owner decision in Review created the block (see `confirmedInReviewSql`). */
  confirmedInReview?: boolean;
  /** True when the owner typed the description in the Review decision (see `ownerAuthoredInReviewSql`). */
  ownerAuthoredInReview?: boolean;
  /** For a Move's automatic block (PRD D19), its Move's event, for "Don't log trips like this". */
  automaticMoveEventId?: string | null;
  /** A member of a named A → B → A (location v3 PR 14): adjacent members show as one row. */
  locationGroup?: LocationGroup;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  updatedAt: string;
  durationSeconds: number;
  tagNames: string[];
  tags: Array<Pick<TagRow, "id" | "name" | "normalizedName">>;
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
  rawPayload: Record<string, unknown> | null;
  createdAt: string;
  /**
   * Needs-review entries created from this suggestion's event (the same link the Review
   * presentation uses), so a calendar draws that moment once. Only the bootstrap list sets it.
   */
  linkedEntryIds?: string[];
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
  /** Time away from a saved place, which is never a commute. */
  timeAway: boolean;
};

export type DashboardStats = {
  todaySeconds: number;
  weekSeconds: number;
  todayCoveredSeconds: number;
  weekCoveredSeconds: number;
  todayAdditionalOverlapSeconds: number;
  weekAdditionalOverlapSeconds: number;
  reviewCount: number;
  /** Review cards (an outing once, PRD D19); `reviewCount` stays every open suggestion for older iPhones. */
  reviewCardCount: number;
  /**
   * Each open Move folded into its outing's open Stay card (member → Stay review id), so a client moves
   * `reviewCardCount` exactly for local decisions; left out beyond `OUTING_STAYS_LIMIT` Moves.
   */
  reviewOutingStays?: Record<string, string>;
  /** More open outing Moves than the map holds: no map was sent (a local adjustment is then approximate). */
  reviewOutingStaysOverflow?: boolean;
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

export type BootstrapData = {
  authMode?: RequestSession["authMode"];
  /**
   * The zone whose midnights built `dateRange` and the series: the web viewer's (`dayframe_tz`)
   * when the browser sent it, null for the server's own. The web runtime reuses a cached day only
   * when this matches its current cookie. Optional so older cached snapshots still read.
   */
  viewerTimeZone?: string | null;
  user: {
    id: string; email: string; name: string; dailyGoalMinutes: number; weeklyGoalMinutes: number; goalsRevision: number;
    /** "Log trips automatically" (PRD D19, A4); false where the column is not there yet. */
    logTripsAutomatically?: boolean;
  };
  workspace: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
  dateRange: DashboardDateRange;
  clients: ClientRow[];
  categories: CategoryRow[];
  /**
   * Every activity, active or archived, switched off "Counts toward goal" (UIA-043). `categories`
   * holds only active ones, so this keeps an archived Sleep's history out of goal progress.
   */
  goalExcludedCategoryIds: string[];
  projects: ProjectRow[];
  tags: TagRow[];
  places: PlaceRow[];
  learnedPlaces: LearnedPlaceRow[];
  automationRules: AutomationRuleRow[];
  entries: TimeEntryRow[];
  historyEntries: TimeEntryRow[];
  dayEntries: TimeEntryRow[];
  weekEntries: TimeEntryRow[];
  activeEntry: TimeEntryRow | null;
  reviewItems: ReviewItemRow[];
  activityEvents: ActivityRow[];
  categoryUsage: CategoryUsageRank[];
  taskSuggestions: RecentActivitySuggestion[];
  /**
   * Web-only: the bounded pool a typed Description searches (most recent distinct variants from
   * the last 26 weeks). `taskSuggestions` stays the compact contextual top 6 for the empty field
   * and for older clients; optional so a cached bootstrap from before the field still reads.
   */
  taskSuggestionCandidates?: RecentActivitySuggestionCandidate[];
  stats: DashboardStats;
  todaySeries: DashboardSeriesPoint[];
  weekSeries: DashboardSeriesPoint[];
  /**
   * The journey in progress ("Travelling since…", location v4 step 5), when replay saw one and its
   * latest observation is recent. Never a block and never logged. Optional for older clients.
   */
  openTrip?: OpenTripRow | null;
};

export type OpenTripRow = {
  startedAt: string;
  lastObservedAt: string;
  fromPlaceId: string | null;
  travelMode: "walking" | "running" | "cycling" | "automotive" | null;
};

/** How long after its latest observation a stored journey still shows as in progress (the engine's continuity limit). */
const OPEN_TRIP_FRESH_MS = LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs;

/**
 * The journey replay last saw in progress, from its origin stay's `openTrip` metadata. A journey
 * never runs past `commuteMaximumDurationMs`, so only stays that ended within it are read
 * (idx_stay_segments_user_time). Stale entries (no replay since the phone went quiet) are not shown.
 */
export async function getOpenTrip(session: RequestSession, capturedNow: string): Promise<OpenTripRow | null> {
  const result = await query<{ startedAt: string; lastObservedAt: string; fromPlaceId: string | null; travelMode: string | null }>(
    `select sg.metadata->'openTrip'->>'startedAt' as "startedAt",
            sg.metadata->'openTrip'->>'lastObservedAt' as "lastObservedAt",
            sg.place_id as "fromPlaceId",
            sg.metadata->'openTrip'->>'travelMode' as "travelMode"
       from stay_segments sg
      where sg.workspace_id = $1 and sg.user_id = $2 and sg.status <> 'superseded'
        and sg.stopped_at >= $3::timestamptz - make_interval(secs => $4::double precision / 1000)
        and sg.metadata ? 'openTrip'
      order by sg.metadata->'openTrip'->>'lastObservedAt' desc
      limit 1`,
    [session.workspaceId, session.userId, capturedNow, LOCATION_ENGINE_V2_CONFIG.commuteMaximumDurationMs]);
  const row = result.rows[0];
  if (!row || !row.startedAt || !row.lastObservedAt) return null;
  if (Date.parse(capturedNow) - Date.parse(row.lastObservedAt) > OPEN_TRIP_FRESH_MS) return null;
  const travelMode = row.travelMode === "walking" || row.travelMode === "running" || row.travelMode === "cycling" ||
    row.travelMode === "automotive" ? row.travelMode : null;
  return { startedAt: new Date(row.startedAt).toISOString(), lastObservedAt: new Date(row.lastObservedAt).toISOString(),
    fromPlaceId: row.fromPlaceId, travelMode };
}

/**
 * Bootstrap's reads, at most `BOOTSTRAP_READ_CONCURRENCY` at a time. Fired all at once they took every
 * connection of the 10-connection pool, so a second bootstrap or a timer write waiting behind them hit
 * the 1.5 s connect timeout (production 21 Oct 2026, "timeout exceeded when trying to connect";
 * stability audit SERVER-3). Results keep their positions.
 */
export const BOOTSTRAP_READ_CONCURRENCY = 4;

export async function runBootstrapReads<const Reads extends readonly (() => Promise<unknown>)[]>(
  reads: Reads,
  concurrency = BOOTSTRAP_READ_CONCURRENCY
): Promise<{ -readonly [Index in keyof Reads]: Awaited<ReturnType<Reads[Index]>> }> {
  const results = new Array<unknown>(reads.length);
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < reads.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await reads[index]!();
      } catch (error) {
        // The bootstrap fails as before; the remaining reads are not started.
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, reads.length) }, lane));
  return results as { -readonly [Index in keyof Reads]: Awaited<ReturnType<Reads[Index]>> };
}

export async function getBootstrapData(
  session: RequestSession = getDevSession(),
  options: {
    selectedDate?: string | Date | null;
    /**
     * The web viewer's zone (the `dayframe_tz` cookie), when the browser sent it: days, weeks and
     * series then start at that zone's midnights instead of the server's (UTC on Vercel). Callers
     * pass it only when the cookie is present, so the iPhone, which never sends it, is unchanged.
     */
    timeZone?: string | null;
  } = {}
): Promise<BootstrapData> {
  const dateRange = buildDashboardDateRange(options.selectedDate, options.timeZone);
  const timeZone = options.timeZone ?? null;
  const capturedNow = new Date().toISOString();
  const historyStart = addDays(new Date(dateRange.dayStart), -59).toISOString();
  const [
    user,
    workspaces,
    clients,
    categories,
    goalExcludedCategoryIds,
    projects,
    tags,
    places,
    learnedPlaces,
    automationRules,
    entries,
    historyEntries,
    dayEntries,
    weekEntries,
    activeEntry,
    reviewItems,
    activityEvents,
    categoryUsage,
    { taskSuggestions, taskSuggestionCandidates },
    stats,
    reviewOutingStays,
    openTrip
  ] = await runBootstrapReads([
    () => getUser(session),
    () => getWorkspaces(session),
    () => getClients(session),
    () => getCategories(session),
    () => getGoalExcludedCategoryIds(session),
    () => getProjects(session),
    () => getTags(session),
    () => getPlaces(session),
    () => getLearnedPlaces(session),
    () => getAutomationRules(session),
    () => getTimeEntries(session, { capturedNow }),
    () => getTimeEntries(session, {
      overlappingFrom: historyStart,
      startedBefore: dateRange.dayEnd,
      limit: 2000,
      capturedNow
    }),
    () => getTimeEntries(session, {
      overlappingFrom: dateRange.dayStart,
      startedBefore: dateRange.dayEnd,
      limit: 100,
      capturedNow
    }),
    () => getTimeEntries(session, {
      overlappingFrom: dateRange.weekStart,
      startedBefore: dateRange.weekEnd,
      limit: 300,
      capturedNow
    }),
    () => getActiveEntry(session),
    () => getReviewItems(session),
    () => getActivityEvents(session),
    () => getCategoryUsageRanks(session),
    () => getTaskSuggestionSets(session),
    () => getDashboardStats(session, dateRange, capturedNow),
    () => getReviewOutingStays(session),
    () => getOpenTrip(session, capturedNow)
  ] as const);

  // Named patterns (PR 14): one read over every list's location blocks, then each list is tagged.
  const locationGroups = await getLocationGroups({ query }, session, [...entries, ...historyEntries, ...dayEntries, ...weekEntries]);
  const grouped = <T extends { id: string }>(list: T[]) => withLocationGroups(list, locationGroups);

  const capturedAt = new Date(capturedNow);
  const todayCoverage = analyzeTimeIntervals(
    dayEntries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    {
      range: { start: dateRange.dayStart, end: dateRange.dayEnd },
      now: capturedAt
    }
  );
  const weekCoverage = analyzeTimeIntervals(
    weekEntries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    {
      range: { start: dateRange.weekStart, end: dateRange.weekEnd },
      now: capturedAt
    }
  );

  return {
    authMode: session.authMode,
    viewerTimeZone: timeZone,
    user,
    workspace: workspaces.find((workspace) => workspace.id === session.workspaceId) ?? workspaces[0],
    workspaces,
    dateRange,
    clients,
    categories,
    goalExcludedCategoryIds,
    projects,
    tags,
    places,
    learnedPlaces,
    automationRules,
    entries: grouped(entries),
    historyEntries: grouped(historyEntries),
    dayEntries: grouped(dayEntries),
    weekEntries: grouped(weekEntries),
    activeEntry,
    reviewItems,
    activityEvents,
    categoryUsage,
    taskSuggestions,
    taskSuggestionCandidates,
    stats: {
      ...stats,
      todayCoveredSeconds: todayCoverage.coveredSeconds,
      weekCoveredSeconds: weekCoverage.coveredSeconds,
      todayAdditionalOverlapSeconds: todayCoverage.additionalOverlapSeconds,
      weekAdditionalOverlapSeconds: weekCoverage.additionalOverlapSeconds,
      ...(reviewOutingStays ? { reviewOutingStays } : { reviewOutingStaysOverflow: true })
    },
    todaySeries: buildHourlySeries(dayEntries, dateRange, new Date(capturedNow), timeZone),
    weekSeries: buildWeekSeries(weekEntries, dateRange, new Date(capturedNow), timeZone),
    openTrip
  };
}

export async function getNormalizationContext(
  session: RequestSession = getDevSession(),
  execute?: typeof query
): Promise<NormalizationContext> {
  const [projects, categories, places, automationRules] = execute ? [
    await getProjects(session, execute), await getCategories(session, execute),
    await getPlaces(session, execute), await getAutomationRules(session, execute)
  ] : await Promise.all([
    getProjects(session), getCategories(session), getPlaces(session), getAutomationRules(session)
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
      isPinned: category.isPinned,
      starterKey: category.starterKey ?? null,
      countsTowardGoal: category.countsTowardGoal
    })),
    places: places.map<PlaceSummary>((place) => ({
      id: place.id,
      name: place.name,
      role: place.role ?? null,
      radiusMeters: place.radiusMeters,
      priority: place.priority,
      defaultProjectId: place.defaultProjectId,
      defaultCategoryId: place.defaultCategoryId,
      defaultActivityDescription: place.defaultActivityDescription,
      autoStart: place.autoStart,
      loggingEnabled: place.loggingEnabled,
      autoLog: place.autoLog
    })),
    // A rule at an archived place never runs: matching sees the event's place id, not the
    // catalogue, so leaving the place out of `places` alone would not stop it (Codex r1 on #503).
    automationRules: automationRules.filter((rule) => !rule.placeArchived).map<AutomationRuleSummary>((rule) => ({
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

export async function getUser(session: RequestSession) {
  let result;
  try {
    result = await query<{
      id: string; email: string; name: string; dailyGoalMinutes: number; weeklyGoalMinutes: number; goalsRevision: string | number;
      logTripsAutomatically: boolean;
    }>(
      // "Log trips automatically" through to_jsonb, so a database without the column yet (its
      // migration runs before this server) reads it as off, as automatic Moves do, and never fails.
      `select id, email, name,
              daily_goal_minutes as "dailyGoalMinutes",
              weekly_goal_minutes as "weeklyGoalMinutes",
              goals_revision as "goalsRevision",
              coalesce((to_jsonb(users) -> 'log_trips_automatically')::boolean, false) as "logTripsAutomatically"
       from users
       where id = $1`,
      [session.userId]
    );
  } catch (error) {
    if (isUndefinedColumnError(error, "goals_revision")) {
      throw missingRequiredColumnError("users", "goals_revision", "supabase/migrations/202610120002_user_goals_revision.sql", error);
    }
    throw error;
  }
  const row = result.rows[0];
  // bigint arrives as a string from pg; goal revisions stay far below 2^53.
  if (row) return { ...row, goalsRevision: Number(row.goalsRevision) };
  return {
    id: session.userId,
    email: "local@dayframe",
    name: "Dayframe user",
    dailyGoalMinutes: 480,
    weeklyGoalMinutes: 2400,
    goalsRevision: 0,
    logTripsAutomatically: false
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

async function getCategories(session: RequestSession, execute: typeof query = query) {
  try {
    const result = await execute<CategoryRow>(
      `select id, name, color, is_pinned as "isPinned", icon, starter_key as "starterKey",
              counts_toward_goal as "countsTowardGoal"
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
    for (const column of ["icon", "starter_key"]) {
      if (isUndefinedColumnError(error, column)) {
        throw missingRequiredColumnError(
          "categories",
          column,
          "supabase/migrations/202610060001_category_icon_and_starter_key.sql",
          error
        );
      }
    }
    if (isUndefinedColumnError(error, "counts_toward_goal")) {
      throw missingRequiredColumnError(
        "categories",
        "counts_toward_goal",
        "supabase/migrations/202610110001_category_counts_toward_goal.sql",
        error
      );
    }
    throw error;
  }
}

/** Activities (active or archived) whose time does not count toward the goal (UIA-043). */
async function getGoalExcludedCategoryIds(session: RequestSession) {
  try {
    const result = await query<{ id: string }>(
      `select id
       from categories
       where workspace_id = $1 and counts_toward_goal = false
       order by id`,
      [session.workspaceId]
    );
    return result.rows.map((row) => row.id);
  } catch (error) {
    if (isUndefinedColumnError(error, "counts_toward_goal")) {
      throw missingRequiredColumnError(
        "categories",
        "counts_toward_goal",
        "supabase/migrations/202610110001_category_counts_toward_goal.sql",
        error
      );
    }
    throw error;
  }
}

async function getProjects(session: RequestSession, execute: typeof query = query) {
  const result = await execute<ProjectRow>(
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

export async function getTags(session: RequestSession) {
  const result = await query<TagRow>(
    `select tag.id,
            tag.name,
            tag.normalized_name as "normalizedName",
            count(tet.time_entry_id)::int as "usageCount"
     from tags tag
     left join time_entry_tags tet
       on tet.tag_id = tag.id and tet.workspace_id = tag.workspace_id
     where tag.workspace_id = $1
     group by tag.id
     order by tag.name`,
    [session.workspaceId]
  );
  return result.rows;
}

async function getPlaces(session: RequestSession, execute: typeof query = query) {
  try {
    const result = await execute<PlaceRow>(
      `select pl.id,
              pl.name,
              pl.role,
              pl.latitude,
              pl.longitude,
              pl.radius_meters as "radiusMeters",
              pl.priority,
              p.id as "defaultProjectId",
              p.name as "defaultProjectName",
              c.id as "defaultCategoryId",
              c.name as "defaultCategoryName",
              pl.default_activity_description as "defaultActivityDescription",
              pl.auto_start as "autoStart",
              pl.logging_enabled as "loggingEnabled",
              pl.auto_log as "autoLog"
       from places pl
       left join projects p on p.id = pl.default_project_id and p.workspace_id = pl.workspace_id
       left join categories c on c.id = pl.default_category_id and c.workspace_id = pl.workspace_id
       -- An archived place (PRD D19 A10) leaves every list, picker, matcher and geofence.
       where pl.workspace_id = $1 and pl.archived_at is null
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
    if (isUndefinedColumnError(error, "logging_enabled")) {
      throw missingRequiredColumnError(
        "places",
        "logging_enabled",
        "supabase/migrations/202607140002_place_logging_enabled.sql",
        error
      );
    }
    if (isUndefinedColumnError(error, "auto_log")) {
      throw missingRequiredColumnError("places", "auto_log", "supabase/migrations/202610150001_place_auto_log.sql", error);
    }
    if (isUndefinedColumnError(error, "role")) {
      throw missingRequiredColumnError("places", "role", "supabase/migrations/202610070001_place_role.sql", error);
    }
    if (isUndefinedColumnError(error, "archived_at")) {
      throw missingRequiredColumnError("places", "archived_at", PLACE_ARCHIVE_MIGRATION, error);
    }
    throw error;
  }
}

export const PLACE_ARCHIVE_MIGRATION = "supabase/migrations/202610210001_place_archive.sql";

export type ArchivedPlaceRow = { id: string; name: string; archivedAt: string };

/** Archived places, newest first, for Places' Archived section (restorable). */
export async function getArchivedPlaces(session: RequestSession, execute: typeof query = query) {
  try {
    const result = await execute<ArchivedPlaceRow>(
      `select id, name, archived_at as "archivedAt"
         from places
        where workspace_id = $1 and archived_at is not null
        order by archived_at desc, name`,
      [session.workspaceId]
    );
    return result.rows;
  } catch (error) {
    if (isUndefinedColumnError(error, "archived_at")) {
      throw missingRequiredColumnError("places", "archived_at", PLACE_ARCHIVE_MIGRATION, error);
    }
    throw error;
  }
}

export const PLACE_VISITS_SQL = `select sg.place_id as "placeId",
          max(coalesce(sg.stopped_at, sg.started_at)) as "lastVisitAt",
          (count(*) filter (where sg.started_at >= $3::timestamptz - interval '30 days'))::int as "visitsLast30Days"
     from stay_segments sg
     join places pl on pl.id = sg.place_id and pl.workspace_id = sg.workspace_id and pl.archived_at is null
    where sg.workspace_id = $1 and sg.user_id = $2
      and sg.place_id is not null and sg.status <> 'superseded'
    group by sg.place_id`;

/**
 * The person's visits to each saved place (Places last visit and sections, location v3 PR 16c):
 * from their current stays there, so a Review edit, split, merge or replay that moves a stay is
 * reflected at once. Uses idx_stay_segments_place_visits. Never returns coordinates.
 */
export async function getPlaceVisitStats(session: RequestSession, now = new Date(), execute: typeof query = query) {
  const result = await execute<{ placeId: string; lastVisitAt: Date | string | null; visitsLast30Days: number }>(
    PLACE_VISITS_SQL,
    [session.workspaceId, session.userId, now.toISOString()]
  );
  return result.rows.map((row): PlaceVisitStats => ({
    placeId: row.placeId,
    lastVisitAt: row.lastVisitAt == null ? null : new Date(row.lastVisitAt).toISOString(),
    visitsLast30Days: Number(row.visitsLast30Days) || 0
  }));
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
              distinct_day_count as "distinctDayCount",
              sample_count as "sampleCount",
              total_dwell_seconds as "totalDwellSeconds",
              longest_dwell_seconds as "longestDwellSeconds",
              average_accuracy_meters as "averageAccuracyMeters",
              max_cluster_spread_meters as "maxClusterSpreadMeters",
              first_seen_at as "firstSeenAt",
              last_seen_at as "lastSeenAt",
              last_started_at as "lastStartedAt",
              last_stopped_at as "lastStoppedAt",
              confidence,
              classification,
              status,
              address,
              poi_name as "poiName",
              formatted_address as "formattedAddress",
              geocoded_at as "geocodedAt",
              raw_payload as "rawPayload"
       from learned_places
       where workspace_id = $1
         and user_id = $2
         and status = 'candidate'
         and classification = 'place_candidate'
       order by visit_count desc, last_seen_at desc, sample_count desc, name
       limit $3`,
      [session.workspaceId, session.userId, limit]
    );
    return result.rows;
  } catch (error) {
    if (isUndefinedColumnError(error, "classification")) {
      throw missingRequiredColumnError(
        "learned_places",
        "classification",
        "supabase/migrations/202607140001_location_learning_intelligence.sql",
        error
      );
    }
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

async function getAutomationRules(session: RequestSession, execute: typeof query = query) {
  try {
    const result = await execute<AutomationRuleRow>(
      `select ar.id,
              ar.name,
              ar.trigger_source as "triggerSource",
              ar.trigger_type as "triggerType",
              pl.id as "placeId",
              ${placeDisplayNameSql("pl")} as "placeName",
              ar.action,
              p.id as "projectId",
              p.name as "projectName",
              c.id as "categoryId",
              c.name as "categoryName",
              ar.activity_description as "activityDescription",
              ar.confidence_threshold as "confidenceThreshold",
              ar.enabled,
              coalesce(pl.archived_at is not null, false) as "placeArchived"
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
    if (isUndefinedColumnError(error, "activity_description") && execute === query) {
      const result = await execute<AutomationRuleRow>(
        `select ar.id,
                ar.name,
                ar.trigger_source as "triggerSource",
                ar.trigger_type as "triggerType",
                pl.id as "placeId",
                ${placeDisplayNameSql("pl")} as "placeName",
                ar.action,
                p.id as "projectId",
                p.name as "projectName",
                c.id as "categoryId",
                c.name as "categoryName",
                null::text as "activityDescription",
                ar.confidence_threshold as "confidenceThreshold",
                ar.enabled,
                coalesce(pl.archived_at is not null, false) as "placeArchived"
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

/**
 * Whether the block came from an owner decision in Review: its source event's Review item was
 * accepted (accept, edit and confirm, record once, save place and confirm…), or it is a child of a
 * Review split/merge correction (those events exist only for Review decisions). Auto-logged blocks
 * have no Review item, so they read false, as do open and skipped suggestions (no block, or a
 * needs-review one). The accepted-item list is uncorrelated, so it is read once per query.
 * Recent description suggestions learn from location visits only when this is true (E1).
 * Uses $1 (workspace) and $2 (user) of the surrounding statement.
 */
export const confirmedInReviewExpressionSql = `coalesce(
              te.created_from_event_id in (
                select accepted_review.event_id
                from review_items accepted_review
                where accepted_review.workspace_id = $1
                  and accepted_review.user_id = $2
                  and accepted_review.status = 'accepted'
                  and accepted_review.event_id is not null
              )
              or (
                te.source = 'location_learning'
                and exists (
                  select 1
                  from activity_events correction_event
                  where correction_event.id = te.created_from_event_id
                    and correction_event.workspace_id = te.workspace_id
                    and correction_event.user_id = te.user_id
                    and correction_event.client_event_id like 'location-correction:%'
                )
              ),
              false
            )`;
export const confirmedInReviewSql = `${confirmedInReviewExpressionSql} as "confirmedInReview"`;

/** For a block a Move logged itself (PRD D19), the Move's event; null for every other block. */
export const automaticMoveEventIdSql = `case when te.source = 'location_auto_log' then (
  select move_event.id from activity_events move_event
  where move_event.id = te.created_from_event_id and move_event.workspace_id = te.workspace_id
    and move_event.user_id = te.user_id and move_event.event_type = 'commute_detected'
) end as "automaticMoveEventId"`;

/**
 * Whether the owner typed the block's description while making the Review decision that created
 * it (E1, Codex r2). Location Review actions record this on the block's source event at decision
 * time (`recordOwnerAuthoredDescription` / split and merge parts in `location-review-service.ts`)
 * under a key client-ingested payloads can never carry. A suggested title accepted as is or edited
 * back to it, a place's default description, legacy geofence acceptance, auto-logged visits and
 * rows from before the signal existed all read false. A primary-key lookup per block.
 */
export const ownerAuthoredInReviewExpressionSql = `coalesce((
              select (owner_event.raw_payload -> '${REVIEW_DECISION_PAYLOAD_KEY}' ->> 'ownerAuthoredDescription') = 'true'
              from activity_events owner_event
              where owner_event.id = te.created_from_event_id
                and owner_event.workspace_id = te.workspace_id
                and owner_event.user_id = te.user_id
                and owner_event.source = 'location_learning'
            ), false)`;
export const ownerAuthoredInReviewSql = `${ownerAuthoredInReviewExpressionSql} as "ownerAuthoredInReview"`;

export type TimeEntryQueryOptions = {
  capturedNow?: string;
  /** Only this block. */
  entryId?: string;
  overlappingFrom?: string;
  startedFrom?: string;
  startedBefore?: string;
  limit?: number;
};

export function buildTimeEntriesQuery(
  session: RequestSession,
  options: TimeEntryQueryOptions = {}
) {
  const where = ["te.workspace_id = $1", "te.user_id = $2"];
  const capturedNow = options.capturedNow ?? new Date().toISOString();
  const values: Array<string | number> = [session.workspaceId, session.userId, capturedNow];
  const capturedNowParam = "$3";
  if (options.entryId) {
    values.push(options.entryId);
    where.push(`te.id = $${values.length}::uuid`);
  }
  if (options.overlappingFrom) {
    values.push(options.overlappingFrom);
    where.push(`coalesce(te.stopped_at, ${capturedNowParam}::timestamptz) > $${values.length}::timestamptz`);
  }
  if (options.startedFrom) {
    values.push(options.startedFrom);
    where.push(`te.started_at >= $${values.length}::timestamptz`);
  }
  if (options.startedBefore) {
    values.push(options.startedBefore);
    where.push(`te.started_at < $${values.length}::timestamptz`);
  }
  values.push(options.limit ?? 100);

  return {
    text: `select te.id,
            p.id as "projectId",
            p.name as "projectName",
            p.color as "projectColor",
            cl.name as "clientName",
            cat.id as "categoryId",
            cat.name as "categoryName",
            cat.color as "categoryColor",
            pl.id as "placeId",
            coalesce(${placeDisplayNameSql("pl")}, te.place_label) as "placeName",
            case
              when pl.id is not null then 'saved'
              when te.place_label is not null then 'one_time'
              else null
            end as "placeKind",
            te.source,
            te.confidence,
            te.review_status as "reviewStatus",
            ${confirmedInReviewSql},
            ${ownerAuthoredInReviewSql},
            ${automaticMoveEventIdSql},
            te.description,
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            te.updated_at as "updatedAt",
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
              where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
            ) as "tagNames",
            (
              select coalesce(
                json_agg(
                  json_build_object(
                    'id', t.id,
                    'name', t.name,
                    'normalizedName', t.normalized_name
                  ) order by t.name
                ),
                '[]'::json
              )
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
              where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
            ) as tags,
            greatest(
              0,
              extract(epoch from (coalesce(te.stopped_at, ${capturedNowParam}::timestamptz) - te.started_at))
            )::int as "durationSeconds"
     from time_entries te
     left join projects p on p.id = te.project_id and p.workspace_id = te.workspace_id
     left join clients cl on cl.id = p.client_id and cl.workspace_id = te.workspace_id
     left join categories cat on cat.id = te.category_id and cat.workspace_id = te.workspace_id
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
     where ${where.join(" and ")}
     order by te.started_at desc, te.id desc
     limit $${values.length}`,
    values
  };
}

async function getTimeEntries(
  session: RequestSession,
  options: TimeEntryQueryOptions = {}
) {
  const statement = buildTimeEntriesQuery(session, options);
  const result = await query<TimeEntryRow>(statement.text, statement.values);
  return result.rows;
}

/** One block, as the bootstrap lists show it (null when it is not this user's). */
export async function getTimeEntryById(session: RequestSession, entryId: string) {
  const rows = await getTimeEntries(session, { entryId, limit: 1 });
  return rows[0] ?? null;
}

/** Recent typed-search pool bounds: distinct variants and how far back they reach. */
export const TASK_SUGGESTION_CANDIDATE_LIMIT = 150;
export const TASK_SUGGESTION_CANDIDATE_WINDOW_DAYS = 182;

export async function getTaskSuggestions(session: RequestSession) {
  return (await getTaskSuggestionSets(session)).taskSuggestions;
}

/**
 * One read of the owner's eligible completed blocks feeds both the compact contextual list
 * (`taskSuggestions`, unchanged: top 6, also read by older clients) and the bounded pool a typed
 * Description searches (`taskSuggestionCandidates`, #363 learning tiers, last 26 weeks).
 */
export async function getTaskSuggestionSets(session: RequestSession, now: Date = new Date()) {
  const result = await query<{
    id: string;
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    description: string | null;
    durationSeconds: number;
    eventType: string | null;
    reviewStatus: string | null;
    source: string | null;
    startedAt: string;
    stoppedAt: string | null;
    userConfirmed: boolean;
    confirmedInReview: boolean;
    ownerAuthoredInReview: boolean;
    tagNames: string[];
  }>(
    `select te.id,
            cat.id as "categoryId",
            cat.name as "categoryName",
            cat.color as "categoryColor",
            te.description,
            extract(epoch from (te.stopped_at - te.started_at))::int as "durationSeconds",
            ae.event_type as "eventType",
            te.review_status as "reviewStatus",
            te.source,
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            coalesce((select array_agg(t.name order by lower(t.name)) from time_entry_tags tet join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id), array[]::text[]) as "tagNames",
            exists (
              select 1
              from review_items accepted_review
              where accepted_review.event_id = te.created_from_event_id
                and accepted_review.workspace_id = te.workspace_id
                and accepted_review.user_id = te.user_id
                and accepted_review.status = 'accepted'
            ) and coalesce(ae.event_type, '') not in ('health_sleep_import', 'health_workout_import') as "userConfirmed",
            ${confirmedInReviewSql},
            ${ownerAuthoredInReviewSql}
     from time_entries te
     left join activity_events ae on ae.id = te.created_from_event_id and ae.workspace_id = te.workspace_id
     left join categories cat on cat.id = te.category_id and cat.workspace_id = te.workspace_id and cat.is_archived = false
     where te.workspace_id = $1
       and te.user_id = $2
       and te.review_status = 'confirmed'
       and te.stopped_at is not null
       and (
         te.source in ('manual_app', 'mobile_app')
         or (
           coalesce(ae.event_type, '') not in ('health_sleep_import', 'health_workout_import')
           and exists (
             select 1
             from review_items accepted_review
             where accepted_review.event_id = te.created_from_event_id
               and accepted_review.workspace_id = te.workspace_id
               and accepted_review.user_id = te.user_id
               and accepted_review.status = 'accepted'
           )
         )
         -- #363 tier 2 (Codex r1 on #386): a Review split/merge part has no Review item of its
         -- own, so it qualifies only when confirmed in Review AND titled by the owner. The
         -- contextual list ignores these rows (no accepted item on the block's own event).
         or (
           ${confirmedInReviewExpressionSql}
           and ${ownerAuthoredInReviewExpressionSql}
         )
       )
       and nullif(btrim(coalesce(te.description, '')), '') is not null
     order by te.stopped_at desc
     limit 5000`,
    [session.workspaceId, session.userId]
  );

  const taskSuggestions = buildRecentActivitySuggestions(result.rows, {
    contextDate: now,
    limit: 6,
    minDurationSeconds: 60
  });
  const windowStartMs = now.getTime() - TASK_SUGGESTION_CANDIDATE_WINDOW_DAYS * 86_400_000;
  const candidateRows = result.rows.flatMap((row) => {
    // pg returns timestamptz as Date; the shared builder reads ISO strings.
    const startedAt = timestampIso(row.startedAt);
    const stoppedAt = timestampIso(row.stoppedAt);
    if (!startedAt || !stoppedAt || Date.parse(stoppedAt) < windowStartMs) return [];
    return [{ ...row, startedAt, stoppedAt }];
  });
  const taskSuggestionCandidates = buildHistoricalSuggestionCandidates(
    candidateRows,
    {
      contextDate: now,
      limit: TASK_SUGGESTION_CANDIDATE_LIMIT,
      minDurationSeconds: 60
    }
  );
  return { taskSuggestions, taskSuggestionCandidates };
}

function timestampIso(value: unknown) {
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function getCategoryUsageRanks(session: RequestSession) {
  const result = await query<{
    id: string;
    categoryId: string | null;
    description: string | null;
    durationSeconds: number;
    eventType: string | null;
    reviewStatus: string | null;
    source: string | null;
    startedAt: string;
    stoppedAt: string | null;
  }>(
    `select te.id,
            te.category_id as "categoryId",
            te.description,
            extract(epoch from (te.stopped_at - te.started_at))::int as "durationSeconds",
            ae.event_type as "eventType",
            te.review_status as "reviewStatus",
            te.source,
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt"
     from time_entries te
     left join activity_events ae on ae.id = te.created_from_event_id and ae.workspace_id = te.workspace_id
     where te.workspace_id = $1
       and te.user_id = $2
       and te.review_status = 'confirmed'
       and te.stopped_at is not null
       and te.started_at >= now() - interval '120 days'
       and te.source in ('manual_app', 'mobile_app')
       and te.category_id is not null
     order by te.stopped_at desc
     limit 1000`,
    [session.workspaceId, session.userId]
  );

  return buildCategoryUsageRanks(result.rows, {
    contextDate: new Date(),
    limit: 50,
    minDurationSeconds: 60
  });
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
            coalesce(${placeDisplayNameSql("pl")}, te.place_label) as "placeName",
            case
              when pl.id is not null then 'saved'
              when te.place_label is not null then 'one_time'
              else null
            end as "placeKind",
            te.source,
            te.confidence,
            te.review_status as "reviewStatus",
            ${automaticMoveEventIdSql},
            te.description,
            te.started_at as "startedAt",
            te.stopped_at as "stoppedAt",
            te.updated_at as "updatedAt",
            (
              select coalesce(array_agg(t.name order by t.name), '{}')
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
              where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
            ) as "tagNames",
            (
              select coalesce(
                json_agg(
                  json_build_object(
                    'id', t.id,
                    'name', t.name,
                    'normalizedName', t.normalized_name
                  ) order by t.name
                ),
                '[]'::json
              )
              from time_entry_tags tet
              join tags t on t.id = tet.tag_id and t.workspace_id = te.workspace_id
              where tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
            ) as tags,
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
                and ri.title <> coalesce(${placeDisplayNameSql("pl")}, '')
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
            ${placeDisplayNameSql("pl")} as "placeName",
            p.id as "suggestedProjectId",
            c.id as "suggestedCategoryId",
            pl.id as "suggestedPlaceId",
            ri.suggested_started_at as "suggestedStartedAt",
            ri.suggested_stopped_at as "suggestedStoppedAt",
            ri.confidence,
            ri.status,
            ri.notes,
            ae.raw_payload as "rawPayload",
            ri.created_at as "createdAt",
            coalesce((
              select array_agg(te.id::text order by te.id)
              from time_entries te
              where te.workspace_id = ri.workspace_id and te.user_id = ri.user_id
                and te.created_from_event_id = ri.event_id
                and te.review_status = 'needs_review'
            ), array[]::text[]) as "linkedEntryIds"
     from review_items ri
     left join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     left join projects p on p.id = ri.suggested_project_id and p.workspace_id = ri.workspace_id
     left join categories c on c.id = ri.suggested_category_id and c.workspace_id = ri.workspace_id
     left join places pl on pl.id = ri.suggested_place_id and pl.workspace_id = ri.workspace_id
     where ri.workspace_id = $1
       and ri.user_id = $2
       and ri.status = 'open'
     order by ri.created_at desc
     limit 100`,
    [session.workspaceId, session.userId]
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
            ${placeDisplayNameSql("pl")} as "placeName",
            coalesce(ae.event_type = 'commute_detected' and ae.raw_payload ->> 'qualificationReason' = 'same_place_outing', false) as "timeAway"
     from activity_events ae
     left join projects p on p.id = ae.suggested_project_id and p.workspace_id = ae.workspace_id
     left join categories c on c.id = ae.suggested_category_id and c.workspace_id = ae.workspace_id
     left join places pl on pl.id = ae.suggested_place_id and pl.workspace_id = ae.workspace_id
     where ae.workspace_id = $1 and ae.user_id = $2
     order by ae.occurred_at desc
     limit 24`,
    [session.workspaceId, session.userId]
  );
  return result.rows;
}

async function getReviewOutingStays(session: RequestSession) {
  const result = await query<{ member: string; stay: string }>(OUTING_STAYS_SQL, [session.workspaceId, session.userId]);
  return outingStaysFromRows(result.rows);
}

async function getDashboardStats(
  session: RequestSession,
  dateRange: DashboardDateRange,
  capturedNow: string
) {
  const result = await query<DashboardStats>(
    `select
        coalesce(sum(
          greatest(
            0,
            extract(epoch from (
              least(coalesce(stopped_at, $7::timestamptz), $3::timestamptz)
              - greatest(started_at, $2::timestamptz)
            ))
          )
        ) filter (
          where started_at < $3::timestamptz
            and coalesce(stopped_at, $7::timestamptz) > $2::timestamptz
        ), 0)::int as "todaySeconds",
        coalesce(sum(
          greatest(
            0,
            extract(epoch from (
              least(coalesce(stopped_at, $7::timestamptz), $5::timestamptz)
              - greatest(started_at, $4::timestamptz)
            ))
          )
        ) filter (
          where started_at < $5::timestamptz
            and coalesce(stopped_at, $7::timestamptz) > $4::timestamptz
        ), 0)::int as "weekSeconds",
        (select count(*)::int from review_items where workspace_id = $1 and user_id = $6 and status = 'open') as "reviewCount",
        -- One count per outing (PRD D19, PR 12c): the cards Review shows; older iPhones read reviewCount.
        (select count(*)::int
         from review_items ri
         left join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
         where ri.workspace_id = $1 and ri.user_id = $6 and ri.status = 'open'
           and not ${foldedOutingMemberSql("ri", "ae")}) as "reviewCardCount"
     from time_entries
      where workspace_id = $1
        and user_id = $6
        and started_at < $5::timestamptz
        and coalesce(stopped_at, $7::timestamptz) > $4::timestamptz`,
    [
      session.workspaceId,
      dateRange.dayStart,
      dateRange.dayEnd,
      dateRange.weekStart,
      dateRange.weekEnd,
      session.userId,
      capturedNow
    ]
  );
  return result.rows[0] ?? {
    todaySeconds: 0,
    weekSeconds: 0,
    todayCoveredSeconds: 0,
    weekCoveredSeconds: 0,
    todayAdditionalOverlapSeconds: 0,
    weekAdditionalOverlapSeconds: 0,
    reviewCount: 0,
    reviewCardCount: 0
  };
}

export function buildDashboardDateRange(input?: string | Date | null, timeZone?: string | null): DashboardDateRange {
  if (timeZone) return buildZonedDashboardDateRange(input, timeZone);
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

/**
 * A "YYYY-MM-DD" key rolled over as a calendar date ("2026-13-01" → "2027-01-01",
 * "2026-02-30" → "2026-03-02"), as the server-zone path's `new Date(year, month - 1, day)` does.
 */
function normalizeDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** The same range with the viewer zone's midnights (DST-safe; date keys do the calendar maths). */
function buildZonedDashboardDateRange(input: string | Date | null | undefined, timeZone: string): DashboardDateRange {
  const selectedDate = typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? normalizeDateKey(input)
    : zonedDateKey(coerceDate(input), timeZone);
  const weekKey = mondayOfDateKey(selectedDate);
  return {
    selectedDate,
    previousDate: addDaysToDateKey(selectedDate, -1),
    nextDate: addDaysToDateKey(selectedDate, 1),
    dayStart: zonedStartOfDay(selectedDate, timeZone).toISOString(),
    dayEnd: zonedStartOfDay(addDaysToDateKey(selectedDate, 1), timeZone).toISOString(),
    weekStart: zonedStartOfDay(weekKey, timeZone).toISOString(),
    weekEnd: zonedStartOfDay(addDaysToDateKey(weekKey, 7), timeZone).toISOString()
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

export function buildHourlySeries(
  entries: TimeEntryRow[],
  dateRange: DashboardDateRange,
  capturedNow: Date,
  timeZone: string | null = null
): DashboardSeriesPoint[] {
  const hours = Array.from({ length: 8 }, (_, index) => 8 + index * 2);
  const dayStart = new Date(dateRange.dayStart);
  const at = (hour: number) => {
    if (timeZone) return zonedWallHour(dateRange.selectedDate, hour, timeZone);
    const instant = new Date(dayStart);
    instant.setHours(hour, 0, 0, 0);
    return instant;
  };
  // Each bucket's bounds once, not once per entry.
  const bounds = new Map([...hours, hours[hours.length - 1] + 2].map((hour) => [hour, at(hour)]));
  return hours.map((hour) => ({
    key: `${hour}`,
    label: `${hour.toString().padStart(2, "0")}:00`,
    seconds: entries.reduce(
      (sum, entry) => sum + entryOverlapSeconds(entry, { start: bounds.get(hour)!, end: bounds.get(hour + 2)! }, capturedNow),
      0
    )
  }));
}

export function buildWeekSeries(
  entries: TimeEntryRow[],
  dateRange: DashboardDateRange,
  capturedNow: Date,
  timeZone: string | null = null
): DashboardSeriesPoint[] {
  const start = new Date(dateRange.weekStart);
  const weekKey = timeZone ? mondayOfDateKey(dateRange.selectedDate) : null;
  return Array.from({ length: 7 }, (_, index) => {
    const dayKey = weekKey ? addDaysToDateKey(weekKey, index) : null;
    const day = dayKey && timeZone ? zonedStartOfDay(dayKey, timeZone) : addDays(start, index);
    const nextDay = dayKey && timeZone ? zonedStartOfDay(addDaysToDateKey(dayKey, 1), timeZone) : addDays(day, 1);
    const key = dayKey ?? toDateKey(day);
    return {
      key,
      label: new Intl.DateTimeFormat("en-GB", { weekday: "short", ...(dayKey ? { timeZone: "UTC" } : {}) })
        .format(dayKey ? new Date(`${dayKey}T12:00:00Z`) : day),
      seconds: entries.reduce(
        (sum, entry) => sum + entryOverlapSeconds(entry, { start: day, end: nextDay }, capturedNow),
        0
      )
    };
  });
}
