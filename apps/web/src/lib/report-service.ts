import { analyzeTimeIntervals } from "@dayframe/shared";
import type { CategoryRow, PlaceRow, TagRow, TimeEntryRow } from "@/lib/queries";
import { query } from "@/lib/db";
import { formatSourceLabel } from "@/lib/format";
import {
  REPORT_SOURCE_VALUES,
  isReportUuid,
  type ReportFilters,
  type ReportQueryInput,
  type ReportRangeMetadata
} from "@/lib/report-filters";
import { calculatePreviousPeriodComparison } from "@/lib/dashboard-intelligence";
import type { RequestSession } from "@/lib/session";

export type ReportBreakdownRow = {
  id: string;
  name: string;
  color: string | null;
  seconds: number;
  entryCount: number;
};

export type ReportSeriesPoint = {
  key: string;
  label: string;
  seconds: number;
  coveredSeconds: number;
  additionalOverlappingActivitySeconds: number;
};

export type ReportEntryRow = TimeEntryRow & {
  isRunning: boolean;
  overlapCount: number;
  overlapSeconds: number;
};

export type ReportFilterOptions = {
  categories: CategoryRow[];
  tags: TagRow[];
  places: PlaceRow[];
  sources: Array<{ id: string; name: string }>;
};

export type ReportResult = {
  range: ReportRangeMetadata;
  appliedFilters: ReportFilters;
  filterOptions: ReportFilterOptions;
  totalLoggedSeconds: number;
  timeCoveredSeconds: number;
  additionalOverlappingActivitySeconds: number;
  additionalOverlapSeconds: number;
  concurrentCoverageSeconds: number;
  maxConcurrency: number;
  totalSeconds: number;
  previousPeriodSeconds: number;
  previousPeriodCoveredSeconds: number;
  comparison: ReturnType<typeof calculatePreviousPeriodComparison>;
  dailyAverageSeconds: number;
  activeDayCount: number;
  byCategory: ReportBreakdownRow[];
  byTag: ReportBreakdownRow[];
  byPlace: ReportBreakdownRow[];
  bySource: ReportBreakdownRow[];
  dailySeries: ReportSeriesPoint[];
  entries: ReportEntryRow[];
  overlapCandidates: Array<{
    id: string;
    startedAt: string;
    stoppedAt: string | null;
    description: string | null;
    categoryName: string | null;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    totalEntries: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  capturedNow: string;
};

export type ReportExportRow = {
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
  description: string | null;
  tagNames: string[];
  categoryName: string | null;
  placeName: string | null;
  source: string;
};

type ReportDataRow = {
  totalSeconds: number;
  coveredSeconds: number;
  additionalOverlapSeconds: number;
  concurrentCoverageSeconds: number;
  maxConcurrency: number;
  previousPeriodSeconds: number;
  previousPeriodCoveredSeconds: number;
  byCategory: ReportBreakdownRow[];
  byTag: ReportBreakdownRow[];
  byPlace: ReportBreakdownRow[];
  bySource: ReportBreakdownRow[];
  dailySeries: ReportSeriesPoint[];
  entries: ReportEntryRow[];
  analysisEntries: Array<{
    id: string;
    startedAt: string;
    stoppedAt: string;
    description: string | null;
    categoryName: string | null;
  }>;
  totalEntries: number;
};

export async function getReports(session: RequestSession, input: ReportQueryInput): Promise<ReportResult> {
  const capturedNow = new Date().toISOString();
  const filterOptions = await getReportFilterOptions(session);
  const appliedFilters = sanitizeReportFilters(input.filters, filterOptions);
  const statement = buildReportDataQuery(session, input, appliedFilters, capturedNow);
  const result = await query<ReportDataRow>(statement.text, statement.values);
  const row = result.rows[0] ?? emptyReportData(input);
  const totalSeconds = numberValue(row.totalSeconds);
  const previousPeriodSeconds = numberValue(row.previousPeriodSeconds);
  const previousPeriodCoveredSeconds = numberValue(row.previousPeriodCoveredSeconds);
  const analysisEntries = arrayValue(row.analysisEntries);
  const analysis = analyzeTimeIntervals(
    analysisEntries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    { now: capturedNow }
  );
  const timeCoveredSeconds = Math.max(
    0,
    totalSeconds - analysis.additionalOverlappingActivitySeconds
  );
  const dailySeries = arrayValue(row.dailySeries).map((point, index) => {
    const boundary = input.dayBoundaries[index];
    const pointSeconds = numberValue(point.seconds);
    if (!boundary) {
      return {
        ...point,
        seconds: pointSeconds,
        coveredSeconds: pointSeconds,
        additionalOverlappingActivitySeconds: 0
      };
    }
    const dayAnalysis = analyzeTimeIntervals(
      analysisEntries.map((entry) => ({
        id: entry.id,
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt
      })),
      {
        now: capturedNow,
        range: { start: boundary.start, end: boundary.end }
      }
    );
    return {
      ...point,
      seconds: pointSeconds,
      coveredSeconds: Math.max(
        0,
        pointSeconds - dayAnalysis.additionalOverlappingActivitySeconds
      ),
      additionalOverlappingActivitySeconds:
        dayAnalysis.additionalOverlappingActivitySeconds
    };
  });
  const analysisById = new Map(analysis.entries.map((entry) => [entry.id, entry]));
  const totalEntries = numberValue(row.totalEntries);
  const totalPages = Math.max(1, Math.ceil(totalEntries / input.pageSize));

  return {
    range: input.range,
    appliedFilters,
    filterOptions,
    totalLoggedSeconds: totalSeconds,
    timeCoveredSeconds,
    additionalOverlappingActivitySeconds:
      analysis.additionalOverlappingActivitySeconds,
    additionalOverlapSeconds: analysis.additionalOverlappingActivitySeconds,
    concurrentCoverageSeconds: analysis.concurrentCoverageSeconds,
    maxConcurrency: analysis.maxConcurrency,
    totalSeconds,
    previousPeriodSeconds,
    previousPeriodCoveredSeconds,
    comparison: calculatePreviousPeriodComparison(totalSeconds, previousPeriodSeconds),
    dailyAverageSeconds: input.range.dayCount > 0 ? Math.round(totalSeconds / input.range.dayCount) : 0,
    activeDayCount: dailySeries.filter((point) => point.coveredSeconds > 0).length,
    byCategory: normalizeBreakdown(row.byCategory),
    byTag: normalizeBreakdown(row.byTag),
    byPlace: normalizeBreakdown(row.byPlace),
    bySource: normalizeBreakdown(row.bySource),
    dailySeries,
    entries: arrayValue(row.entries).map((entry) => {
      const entryAnalysis = analysisById.get(entry.id);
      return {
        ...entry,
        durationSeconds: numberValue(entry.durationSeconds),
        tagNames: arrayValue(entry.tagNames),
        tags: arrayValue(entry.tags),
        overlapCount: entryAnalysis?.overlapCount ?? 0,
        overlapSeconds: entryAnalysis?.overlapSeconds ?? 0
      };
    }),
    overlapCandidates: arrayValue(row.analysisEntries).map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt,
      description: entry.description,
      categoryName: entry.categoryName
    })),
    pagination: {
      page: input.filters.page,
      pageSize: input.pageSize,
      totalEntries,
      totalPages,
      hasPrevious: input.filters.page > 1,
      hasNext: input.filters.page < totalPages
    },
    capturedNow
  };
}

export async function getReportExportRows(session: RequestSession, input: ReportQueryInput) {
  const capturedNow = new Date().toISOString();
  const options = await getReportFilterOptions(session);
  const filters = sanitizeReportFilters(input.filters, options);
  const statement = buildReportExportQuery(session, input, filters, capturedNow);
  const result = await query<ReportExportRow>(statement.text, statement.values);
  return {
    filters,
    range: input.range,
    rows: result.rows.map((row) => ({ ...row, durationSeconds: numberValue(row.durationSeconds) })),
    capturedNow
  };
}

export async function getReportFilterOptions(session: RequestSession): Promise<ReportFilterOptions> {
  const [categories, tags, places] = await Promise.all([
    query<CategoryRow>(
      `select id, name, color, is_pinned as "isPinned"
       from categories
       where workspace_id = $1 and is_archived = false
       order by is_pinned desc, name`,
      [session.workspaceId]
    ),
    query<TagRow>(
      `select tag.id,
              tag.name,
              tag.normalized_name as "normalizedName",
              count(te.id)::int as "usageCount"
       from tags tag
       left join time_entry_tags tet
         on tet.workspace_id = tag.workspace_id and tet.tag_id = tag.id
       left join time_entries te
         on te.workspace_id = tet.workspace_id
        and te.id = tet.time_entry_id
        and te.user_id = $2
       where tag.workspace_id = $1
       group by tag.id
       order by lower(tag.name), tag.id`,
      [session.workspaceId, session.userId]
    ),
    query<PlaceRow>(
      `select pl.id,
              pl.name,
              pl.latitude,
              pl.longitude,
              pl.radius_meters as "radiusMeters",
              pl.priority,
              null::uuid as "defaultProjectId",
              null::text as "defaultProjectName",
              pl.default_category_id as "defaultCategoryId",
              null::text as "defaultCategoryName",
              pl.default_activity_description as "defaultActivityDescription",
              pl.auto_start as "autoStart",
              pl.logging_enabled as "loggingEnabled"
       from places pl
       where pl.workspace_id = $1
       order by pl.priority desc, lower(pl.name), pl.id`,
      [session.workspaceId]
    )
  ]);

  return {
    categories: categories.rows,
    tags: tags.rows,
    places: places.rows,
    sources: REPORT_SOURCE_VALUES.map((source) => ({ id: source, name: formatSourceLabel(source) }))
  };
}

export function sanitizeReportFilters(filters: ReportFilters, options: ReportFilterOptions): ReportFilters {
  const categoryIds = new Set(options.categories.map((category) => category.id));
  const tagIds = new Set(options.tags.map((tag) => tag.id));
  const placeIds = new Set(options.places.map((place) => place.id));
  const sourceIds = new Set(options.sources.map((source) => source.id));
  return {
    ...filters,
    categories: filters.categories.filter((id) => id === "uncategorized" || categoryIds.has(id)),
    tags: filters.tags.filter((id) => tagIds.has(id)),
    places: filters.places.filter((id) => id === "no-place" || placeIds.has(id)),
    sources: filters.sources.filter((source) => sourceIds.has(source))
  };
}

export function buildReportDataQuery(
  session: RequestSession,
  input: ReportQueryInput,
  filters: ReportFilters,
  capturedNow: string
) {
  const sql = new ReportSqlBuilder(session, input, filters, capturedNow);
  const limitParam = sql.param(input.pageSize);
  const offsetParam = sql.param((filters.page - 1) * input.pageSize);
  const dayBoundsParam = sql.param(JSON.stringify(input.dayBoundaries.map((day, index) => ({
    key: day.key,
    label: day.label,
    start_at: day.start,
    end_at: day.end,
    ordinal: index
  }))));
  const detailOrder = filters.sort === "duration"
    ? `clipped_seconds desc, started_at desc, id desc`
    : `started_at desc, id desc`;

  return {
    text: `${sql.filteredEntriesCte()},
      current_intervals as (
        select fe.id,
               greatest(fe.started_at, ${sql.param(input.range.start)}::timestamptz) as interval_start,
               least(fe.effective_stopped_at, ${sql.param(input.range.end)}::timestamptz) as interval_end
        from filtered_entries fe
      ),
      current_ordered_intervals as (
        select ci.*,
               max(ci.interval_end) over (
                 order by ci.interval_start, ci.interval_end, ci.id
                 rows between unbounded preceding and 1 preceding
               ) as prior_max_end
        from current_intervals ci
      ),
      current_grouped_intervals as (
        select coi.*,
               sum(
                 case when coi.prior_max_end is null or coi.interval_start > coi.prior_max_end then 1 else 0 end
               ) over (order by coi.interval_start, coi.interval_end, coi.id) as island_id
        from current_ordered_intervals coi
      ),
      current_islands as (
        select island_id, min(interval_start) as island_start, max(interval_end) as island_end
        from current_grouped_intervals
        group by island_id
      ),
      current_coverage as (
        select coalesce(sum(extract(epoch from (island_end - island_start))), 0)::int as seconds
        from current_islands
      ),
      current_event_points as (
        select point_at, sum(delta)::int as delta
        from (
          select interval_start as point_at, 1 as delta from current_intervals
          union all
          select interval_end as point_at, -1 as delta from current_intervals
        ) points
        group by point_at
      ),
      current_concurrency_segments as (
        select point_at,
               lead(point_at) over (order by point_at) as next_at,
               sum(delta) over (order by point_at) as concurrency
        from current_event_points
      ),
      current_concurrency as (
        select coalesce(
                 sum(extract(epoch from (next_at - point_at))) filter (where concurrency > 1),
                 0
               )::int as concurrent_seconds,
               coalesce(max(concurrency), 0)::int as max_concurrency
        from current_concurrency_segments
      ),
      previous_intervals as (
        select pfe.id,
               greatest(pfe.started_at, ${sql.param(input.previousRange.start)}::timestamptz) as interval_start,
               least(pfe.effective_stopped_at, ${sql.param(input.previousRange.end)}::timestamptz) as interval_end
        from previous_filtered_entries pfe
      ),
      previous_ordered_intervals as (
        select pi.*,
               max(pi.interval_end) over (
                 order by pi.interval_start, pi.interval_end, pi.id
                 rows between unbounded preceding and 1 preceding
               ) as prior_max_end
        from previous_intervals pi
      ),
      previous_grouped_intervals as (
        select poi.*,
               sum(
                 case when poi.prior_max_end is null or poi.interval_start > poi.prior_max_end then 1 else 0 end
               ) over (order by poi.interval_start, poi.interval_end, poi.id) as island_id
        from previous_ordered_intervals poi
      ),
      previous_islands as (
        select island_id, min(interval_start) as island_start, max(interval_end) as island_end
        from previous_grouped_intervals
        group by island_id
      ),
      previous_coverage as (
        select coalesce(sum(extract(epoch from (island_end - island_start))), 0)::int as seconds
        from previous_islands
      ),
      category_totals as (
        select coalesce(fe.category_id::text, 'uncategorized') as id,
               coalesce(fe.category_name, 'Uncategorized') as name,
               fe.category_color as color,
               sum(fe.clipped_seconds)::int as seconds,
               count(*)::int as entry_count
        from filtered_entries fe
        group by coalesce(fe.category_id::text, 'uncategorized'), coalesce(fe.category_name, 'Uncategorized'), fe.category_color
      ),
      tag_totals as (
        select tag.id::text as id,
               tag.name,
               tag.color,
               sum(fe.clipped_seconds)::int as seconds,
               count(distinct fe.id)::int as entry_count
        from filtered_entries fe
        join time_entry_tags tet
          on tet.workspace_id = fe.workspace_id and tet.time_entry_id = fe.id
        join tags tag
          on tag.workspace_id = tet.workspace_id and tag.id = tet.tag_id
        group by tag.id, tag.name, tag.color
      ),
      place_totals as (
        select case
                 when fe.place_id is not null then fe.place_id::text
                 when fe.place_label is not null then 'one-time:' || lower(regexp_replace(btrim(fe.place_label), '[[:space:]]+', ' ', 'g'))
                 else 'no-place'
               end as id,
               min(coalesce(fe.place_name, 'No place')) as name,
               null::text as color,
               sum(fe.clipped_seconds)::int as seconds,
               count(*)::int as entry_count
        from filtered_entries fe
        group by case
          when fe.place_id is not null then fe.place_id::text
          when fe.place_label is not null then 'one-time:' || lower(regexp_replace(btrim(fe.place_label), '[[:space:]]+', ' ', 'g'))
          else 'no-place'
        end
      ),
      source_totals as (
        select fe.source as id,
               fe.source as name,
               null::text as color,
               sum(fe.clipped_seconds)::int as seconds,
               count(*)::int as entry_count
        from filtered_entries fe
        group by fe.source
      ),
      day_bounds as (
        select day.key,
               day.label,
               day.start_at,
               day.end_at,
               day.ordinal
        from jsonb_to_recordset(${dayBoundsParam}::jsonb)
          as day(key text, label text, start_at timestamptz, end_at timestamptz, ordinal int)
      ),
      daily_intervals as (
        select day.key,
               day.ordinal,
               fe.id,
               greatest(fe.started_at, day.start_at) as interval_start,
               least(fe.effective_stopped_at, day.end_at) as interval_end
        from day_bounds day
        join filtered_entries fe
          on fe.started_at < day.end_at
         and fe.effective_stopped_at > day.start_at
      ),
      daily_ordered_intervals as (
        select di.*,
               max(di.interval_end) over (
                 partition by di.key
                 order by di.interval_start, di.interval_end, di.id
                 rows between unbounded preceding and 1 preceding
               ) as prior_max_end
        from daily_intervals di
      ),
      daily_grouped_intervals as (
        select doi.*,
               sum(
                 case when doi.prior_max_end is null or doi.interval_start > doi.prior_max_end then 1 else 0 end
               ) over (
                 partition by doi.key
                 order by doi.interval_start, doi.interval_end, doi.id
               ) as island_id
        from daily_ordered_intervals doi
      ),
      daily_islands as (
        select key, island_id, min(interval_start) as island_start, max(interval_end) as island_end
        from daily_grouped_intervals
        group by key, island_id
      ),
      daily_coverage as (
        select key,
               sum(extract(epoch from (island_end - island_start)))::int as covered_seconds
        from daily_islands
        group by key
      ),
      daily_totals as (
        select day.key,
               day.label,
               day.ordinal,
               coalesce(
                 sum(
                   greatest(
                     0,
                     extract(epoch from (least(fe.effective_stopped_at, day.end_at) - greatest(fe.started_at, day.start_at)))
                   )
                 ) filter (where fe.id is not null),
                 0
               )::int as seconds,
               coalesce(max(dc.covered_seconds), 0)::int as covered_seconds,
               greatest(
                 0,
                 coalesce(
                   sum(
                     greatest(
                       0,
                       extract(epoch from (least(fe.effective_stopped_at, day.end_at) - greatest(fe.started_at, day.start_at)))
                     )
                   ) filter (where fe.id is not null),
                   0
                 ) - coalesce(max(dc.covered_seconds), 0)
               )::int as additional_overlapping_activity_seconds
        from day_bounds day
        left join filtered_entries fe
          on fe.started_at < day.end_at
         and fe.effective_stopped_at > day.start_at
        left join daily_coverage dc on dc.key = day.key
        group by day.key, day.label, day.ordinal
      ),
      paged_entries as (
        select *
        from filtered_entries
        order by ${detailOrder}
        limit ${limitParam}
        offset ${offsetParam}
      )
      select
        coalesce((select sum(clipped_seconds) from filtered_entries), 0)::int as "totalSeconds",
        (select seconds from current_coverage) as "coveredSeconds",
        (
          coalesce((select sum(clipped_seconds) from filtered_entries), 0)
          - (select seconds from current_coverage)
        )::int as "additionalOverlapSeconds",
        (select concurrent_seconds from current_concurrency) as "concurrentCoverageSeconds",
        (select max_concurrency from current_concurrency) as "maxConcurrency",
        coalesce((select sum(clipped_seconds) from previous_filtered_entries), 0)::int as "previousPeriodSeconds",
        (select seconds from previous_coverage) as "previousPeriodCoveredSeconds",
        coalesce((
          select jsonb_agg(
            jsonb_build_object('id', id, 'name', name, 'color', color, 'seconds', seconds, 'entryCount', entry_count)
            order by seconds desc, lower(name), id
          ) from category_totals
        ), '[]'::jsonb) as "byCategory",
        coalesce((
          select jsonb_agg(
            jsonb_build_object('id', id, 'name', name, 'color', color, 'seconds', seconds, 'entryCount', entry_count)
            order by seconds desc, lower(name), id
          ) from tag_totals
        ), '[]'::jsonb) as "byTag",
        coalesce((
          select jsonb_agg(
            jsonb_build_object('id', id, 'name', name, 'color', color, 'seconds', seconds, 'entryCount', entry_count)
            order by seconds desc, lower(name), id
          ) from place_totals
        ), '[]'::jsonb) as "byPlace",
        coalesce((
          select jsonb_agg(
            jsonb_build_object('id', id, 'name', name, 'color', color, 'seconds', seconds, 'entryCount', entry_count)
            order by seconds desc, lower(name), id
          ) from source_totals
        ), '[]'::jsonb) as "bySource",
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'key', key,
              'label', label,
              'seconds', seconds,
              'coveredSeconds', covered_seconds,
              'additionalOverlappingActivitySeconds', additional_overlapping_activity_seconds
            )
            order by ordinal
          ) from daily_totals
        ), '[]'::jsonb) as "dailySeries",
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', ci.id,
              'startedAt', ci.interval_start,
              'stoppedAt', ci.interval_end,
              'description', fe.description,
              'categoryName', fe.category_name
            )
            order by ci.interval_start, ci.interval_end, ci.id
          )
          from current_intervals ci
          join filtered_entries fe on fe.id = ci.id
        ), '[]'::jsonb) as "analysisEntries",
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', pe.id,
              'projectId', null,
              'projectName', null,
              'projectColor', null,
              'clientName', null,
              'categoryId', pe.category_id,
              'categoryName', pe.category_name,
              'categoryColor', pe.category_color,
              'placeId', pe.place_id,
              'placeName', pe.place_name,
              'placeKind', pe.place_kind,
              'source', pe.source,
              'confidence', pe.confidence,
              'reviewStatus', pe.review_status,
              'description', pe.description,
              'startedAt', pe.started_at,
              'stoppedAt', pe.stopped_at,
              'durationSeconds', pe.clipped_seconds,
              'isRunning', pe.stopped_at is null,
              'tagNames', coalesce((
                select jsonb_agg(tag.name order by lower(tag.name), tag.id)
                from time_entry_tags tet
                join tags tag on tag.workspace_id = tet.workspace_id and tag.id = tet.tag_id
                where tet.workspace_id = pe.workspace_id and tet.time_entry_id = pe.id
              ), '[]'::jsonb),
              'tags', coalesce((
                select jsonb_agg(
                  jsonb_build_object('id', tag.id, 'name', tag.name, 'normalizedName', tag.normalized_name)
                  order by lower(tag.name), tag.id
                )
                from time_entry_tags tet
                join tags tag on tag.workspace_id = tet.workspace_id and tag.id = tet.tag_id
                where tet.workspace_id = pe.workspace_id and tet.time_entry_id = pe.id
              ), '[]'::jsonb)
            ) order by ${detailOrder.replaceAll("clipped_seconds", "pe.clipped_seconds").replaceAll("started_at", "pe.started_at").replaceAll(" id", " pe.id")}
          ) from paged_entries pe
        ), '[]'::jsonb) as entries,
        (select count(*) from filtered_entries)::int as "totalEntries"`,
    values: sql.values
  };
}

export function buildReportExportQuery(
  session: RequestSession,
  input: ReportQueryInput,
  filters: ReportFilters,
  capturedNow: string
) {
  const sql = new ReportSqlBuilder(session, input, filters, capturedNow);
  return {
    text: `${sql.filteredEntriesCte()}
      select fe.started_at as "startedAt",
             fe.stopped_at as "stoppedAt",
             fe.clipped_seconds as "durationSeconds",
             fe.description,
             coalesce((
               select array_agg(tag.name order by lower(tag.name), tag.id)
               from time_entry_tags tet
               join tags tag on tag.workspace_id = tet.workspace_id and tag.id = tet.tag_id
               where tet.workspace_id = fe.workspace_id and tet.time_entry_id = fe.id
             ), array[]::text[]) as "tagNames",
             fe.category_name as "categoryName",
             fe.place_name as "placeName",
             fe.source
      from filtered_entries fe
      order by fe.started_at desc, fe.id desc`,
    values: sql.values
  };
}

class ReportSqlBuilder {
  values: unknown[];
  private session: RequestSession;
  private input: ReportQueryInput;
  private filters: ReportFilters;
  private capturedNow: string;

  constructor(session: RequestSession, input: ReportQueryInput, filters: ReportFilters, capturedNow: string) {
    this.values = [];
    this.session = session;
    this.input = input;
    this.filters = filters;
    this.capturedNow = capturedNow;
  }

  param(value: unknown) {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  filteredEntriesCte() {
    const workspace = this.param(this.session.workspaceId);
    const user = this.param(this.session.userId);
    const now = this.param(this.capturedNow);
    const currentStart = this.param(this.input.range.start);
    const currentEnd = this.param(this.input.range.end);
    const previousStart = this.param(this.input.previousRange.start);
    const previousEnd = this.param(this.input.previousRange.end);
    const where = [
      `te.workspace_id = ${workspace}`,
      `te.user_id = ${user}`,
      `te.review_status in ('confirmed', 'accepted')`,
      `te.started_at < ${currentEnd}::timestamptz`,
      `coalesce(te.stopped_at, ${now}::timestamptz) > ${previousStart}::timestamptz`
    ];

    const selectedCategoryIds = this.filters.categories.filter(isReportUuid);
    const includesUncategorized = this.filters.categories.includes("uncategorized");
    if (selectedCategoryIds.length > 0 || includesUncategorized) {
      const parts: string[] = [];
      if (selectedCategoryIds.length > 0) parts.push(`te.category_id = any(${this.param(selectedCategoryIds)}::uuid[])`);
      if (includesUncategorized) parts.push(`te.category_id is null`);
      where.push(`(${parts.join(" or ")})`);
    }

    if (this.filters.tags.length > 0) {
      const tagIds = this.param(this.filters.tags);
      where.push(`exists (
        select 1
        from time_entry_tags filter_tet
        join tags filter_tag
          on filter_tag.workspace_id = filter_tet.workspace_id and filter_tag.id = filter_tet.tag_id
        where filter_tet.workspace_id = te.workspace_id
          and filter_tet.time_entry_id = te.id
          and filter_tag.id = any(${tagIds}::uuid[])
      )`);
    }

    const selectedPlaceIds = this.filters.places.filter(isReportUuid);
    const includesNoPlace = this.filters.places.includes("no-place");
    if (selectedPlaceIds.length > 0 || includesNoPlace) {
      const parts: string[] = [];
      if (selectedPlaceIds.length > 0) parts.push(`te.place_id = any(${this.param(selectedPlaceIds)}::uuid[])`);
      if (includesNoPlace) parts.push(`te.place_id is null and te.place_label is null`);
      where.push(`(${parts.join(" or ")})`);
    }

    if (this.filters.sources.length > 0) {
      where.push(`te.source = any(${this.param(this.filters.sources)}::text[])`);
    }

    if (this.filters.description) {
      where.push(`position(lower(${this.param(this.filters.description)}) in lower(coalesce(te.description, ''))) > 0`);
    }

    return `with candidate_entries as (
      select te.id,
             te.workspace_id,
             te.category_id,
             cat.name as category_name,
             cat.color as category_color,
             te.place_id,
             te.place_label,
             coalesce(pl.name, te.place_label) as place_name,
             case
               when pl.id is not null then 'saved'
               when te.place_label is not null then 'one_time'
               else null
             end as place_kind,
             te.source,
             te.confidence,
             te.review_status,
             te.description,
             te.started_at,
             te.stopped_at,
             coalesce(te.stopped_at, ${now}::timestamptz) as effective_stopped_at
      from time_entries te
      left join categories cat
        on cat.workspace_id = te.workspace_id and cat.id = te.category_id
      left join places pl
        on pl.workspace_id = te.workspace_id and pl.id = te.place_id
      where ${where.join("\n        and ")}
    ),
    filtered_entries as (
      select ce.*,
             extract(epoch from (
               least(ce.effective_stopped_at, ${currentEnd}::timestamptz)
               - greatest(ce.started_at, ${currentStart}::timestamptz)
             ))::int as clipped_seconds
      from candidate_entries ce
      where ce.started_at < ${currentEnd}::timestamptz
        and ce.effective_stopped_at > ${currentStart}::timestamptz
    ),
    previous_filtered_entries as (
      select ce.*,
             extract(epoch from (
               least(ce.effective_stopped_at, ${previousEnd}::timestamptz)
               - greatest(ce.started_at, ${previousStart}::timestamptz)
             ))::int as clipped_seconds
      from candidate_entries ce
      where ce.started_at < ${previousEnd}::timestamptz
        and ce.effective_stopped_at > ${previousStart}::timestamptz
    )`;
  }
}

function normalizeBreakdown(value: ReportBreakdownRow[] | null | undefined) {
  return arrayValue(value).map((row) => ({
    ...row,
    seconds: numberValue(row.seconds),
    entryCount: numberValue(row.entryCount)
  }));
}

function emptyReportData(input: ReportQueryInput): ReportDataRow {
  return {
    totalSeconds: 0,
    coveredSeconds: 0,
    additionalOverlapSeconds: 0,
    concurrentCoverageSeconds: 0,
    maxConcurrency: 0,
    previousPeriodSeconds: 0,
    previousPeriodCoveredSeconds: 0,
    byCategory: [],
    byTag: [],
    byPlace: [],
    bySource: [],
    dailySeries: input.dayBoundaries.map(({ key, label }) => ({
      key,
      label,
      seconds: 0,
      coveredSeconds: 0,
      additionalOverlappingActivitySeconds: 0
    })),
    entries: [],
    analysisEntries: [],
    totalEntries: 0
  };
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function arrayValue<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
