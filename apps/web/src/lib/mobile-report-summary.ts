import type { ReportSummary, ReportSummaryRequest } from "@dayframe/shared";
import { query } from "./db";
import type { RequestSession } from "./session";

export function buildMobileReportSummaryQuery(
  session: RequestSession,
  input: ReportSummaryRequest,
  capturedNow: string,
) {
  return {
    values: [
      session.workspaceId,
      session.userId,
      capturedNow,
      input.start,
      input.end,
      JSON.stringify(input.buckets),
    ],
    text: `with bounds as (
      select b.value->>'key' as key, (b.value->>'start')::timestamptz as start_at,
        (b.value->>'end')::timestamptz as end_at, b.ordinal
      from jsonb_array_elements($6::jsonb) with ordinality as b(value, ordinal)
    ), eligible as (
      select te.id, te.category_id, te.started_at, te.stopped_at,
        least(coalesce(te.stopped_at, $3::text::timestamptz), $3::text::timestamptz) as end_at,
        coalesce(te.category_id::text, 'uncategorized') as category_key,
        case when te.category_id is null then 'No activity' else coalesce(c.name, 'Unavailable activity') end as name, c.color,
        coalesce(c.counts_toward_goal, true) as counts_toward_goal
      from time_entries te
      left join categories c on c.workspace_id = te.workspace_id and c.id = te.category_id
      where te.workspace_id = $1::uuid and te.user_id = $2::uuid
        and te.review_status in ('confirmed', 'accepted')
        and te.started_at < $5::text::timestamptz
        and coalesce(te.stopped_at, $3::text::timestamptz) > $4::text::timestamptz
    ), pieces as (
      select e.*, b.key, b.ordinal,
        greatest(0, extract(epoch from (least(e.end_at, b.end_at) - greatest(e.started_at, b.start_at))))::double precision as seconds
      from eligible e join bounds b on e.started_at < b.end_at and e.end_at > b.start_at
    ), categories as (
      select category_key, category_id, name, color, sum(seconds) as seconds
      from pieces group by category_key, category_id, name, color having sum(seconds) > 0
    ), allocations as (
      select key, category_key, sum(seconds) as seconds from pieces group by key, category_key
    ), running as (
      -- The running entry the phone replaces with its own projection ('active' below).
      select e.id from eligible e where e.stopped_at is null order by e.started_at desc, e.id limit 1
    ), goal_spans as (
      -- Goal time (UIA-043): covered time (overlaps once) of activities that count, per bucket.
      select p.key, greatest(p.started_at, b.start_at) as span_start, least(p.end_at, b.end_at) as span_end,
        p.id = (select id from running) is true as is_running
      from pieces p join bounds b on b.key = p.key
      where p.counts_toward_goal and least(p.end_at, b.end_at) > greatest(p.started_at, b.start_at)
    ), fixed_marked as (
      -- The same union without the running entry: the phone adds its projected timer to it.
      select key, span_start, span_end,
        case when span_start <= max(span_end) over (partition by key order by span_start, span_end
          rows between unbounded preceding and 1 preceding) then 0 else 1 end as starts_island
      from goal_spans where not is_running
    ), fixed_islands as (
      select key, min(span_start) as island_start, max(span_end) as island_end
      from (select *, sum(starts_island) over (partition by key order by span_start, span_end
        rows unbounded preceding) as island from fixed_marked) marked
      group by key, island
    ), fixed_intervals as (
      select key, jsonb_agg(jsonb_build_object('start', island_start, 'end', island_end) order by island_start) as intervals
      from fixed_islands group by key
    ), goal_marked as (
      select key, span_start, span_end,
        case when span_start <= max(span_end) over (partition by key order by span_start, span_end
          rows between unbounded preceding and 1 preceding) then 0 else 1 end as starts_island
      from goal_spans
    ), goal_islands as (
      select key, min(span_start) as island_start, max(span_end) as island_end
      from (select *, sum(starts_island) over (partition by key order by span_start, span_end
        rows unbounded preceding) as island from goal_marked) marked
      group by key, island
    ), goal_totals as (
      select key, sum(extract(epoch from (island_end - island_start)))::double precision as seconds
      from goal_islands group by key
    ), bucket_totals as (
      select b.key, b.ordinal, coalesce(sum(a.seconds), 0) as seconds,
        coalesce(jsonb_agg(jsonb_build_object('key', a.category_key, 'seconds', a.seconds) order by a.category_key)
          filter (where a.category_key is not null), '[]'::jsonb) as by_category,
        coalesce((select g.seconds from goal_totals g where g.key = b.key), 0) as goal_seconds,
        coalesce((select f.intervals from fixed_intervals f where f.key = b.key), '[]'::jsonb) as goal_intervals
      from bounds b left join allocations a on a.key = b.key group by b.key, b.ordinal
    ) select jsonb_build_object(
      'capturedNow', $3::text, 'range', jsonb_build_object('start', $4::text, 'end', $5::text),
      'totalSeconds', coalesce((select sum(seconds) from categories), 0),
      'categories', coalesce((select jsonb_agg(jsonb_build_object('key', category_key, 'categoryId', category_id,
        'name', name, 'color', color, 'seconds', seconds) order by seconds desc, category_key) from categories), '[]'::jsonb),
      'buckets', (select jsonb_agg(jsonb_build_object('key', key, 'seconds', seconds, 'byCategory', by_category,
        'goalSeconds', goal_seconds, 'goalIntervals', goal_intervals) order by ordinal) from bucket_totals),
      'active', (select jsonb_build_object('id', e.id, 'categoryId', e.category_id, 'startedAt', e.started_at,
        'buckets', coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'seconds', p.seconds) order by p.ordinal)
          from pieces p where p.id = e.id), '[]'::jsonb))
        from eligible e where e.stopped_at is null order by e.started_at desc, e.id limit 1)
    ) as summary`,
  };
}

export async function getMobileReportSummary(
  session: RequestSession,
  input: ReportSummaryRequest,
): Promise<ReportSummary> {
  const capturedNow = new Date().toISOString();
  const sql = buildMobileReportSummaryQuery(session, input, capturedNow);
  const result = await query<{ summary: ReportSummary }>(sql.text, sql.values);
  return result.rows[0].summary;
}
