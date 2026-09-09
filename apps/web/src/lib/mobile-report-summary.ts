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
        case when te.category_id is null then 'Uncategorized' else coalesce(c.name, 'Unavailable category') end as name, c.color
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
    ), bucket_totals as (
      select b.key, b.ordinal, coalesce(sum(a.seconds), 0) as seconds,
        coalesce(jsonb_agg(jsonb_build_object('key', a.category_key, 'seconds', a.seconds) order by a.category_key)
          filter (where a.category_key is not null), '[]'::jsonb) as by_category
      from bounds b left join allocations a on a.key = b.key group by b.key, b.ordinal
    ) select jsonb_build_object(
      'capturedNow', $3::text, 'range', jsonb_build_object('start', $4::text, 'end', $5::text),
      'totalSeconds', coalesce((select sum(seconds) from categories), 0),
      'categories', coalesce((select jsonb_agg(jsonb_build_object('key', category_key, 'categoryId', category_id,
        'name', name, 'color', color, 'seconds', seconds) order by seconds desc, category_key) from categories), '[]'::jsonb),
      'buckets', (select jsonb_agg(jsonb_build_object('key', key, 'seconds', seconds, 'byCategory', by_category) order by ordinal) from bucket_totals),
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
