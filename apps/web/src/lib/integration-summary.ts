import { query } from "./db";
import { foldedOutingMemberSql } from "./review-card-count";
import type { RequestSession } from "./session";

/**
 * Read-only summaries for trusted integrations: logged time per day or week (`time:read`) and what is
 * waiting in Review (`review:read`). Counts and totals only — no Review payloads, titles or evidence.
 */

export const INTEGRATION_SUMMARY_TIME_ZONE = "Europe/London";

export type IntegrationSummaryPeriod = "day" | "week";

type SummaryCategoryRow = {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  seconds: number;
  entryCount: number;
};

type SummaryBoundsRow = { periodStart: Date; periodEnd: Date; date: string };

export type IntegrationTimeSummary = {
  ok: true;
  serverNow: string;
  workspaceId: string;
  period: IntegrationSummaryPeriod;
  timeZone: string;
  date: string;
  range: { from: string; to: string };
  totalSeconds: number;
  entryCount: number;
  running: boolean;
  categories: Array<{ id: string | null; name: string | null; color: string | null; seconds: number; entryCount: number }>;
};

/**
 * Logged time in the London day (or Monday-to-Sunday week) holding `date`, today by default: each
 * logged entry's time inside the period, a running entry counted up to now. Entries still awaiting
 * Review or ignored are left out (unlike `time/current`'s `todaySeconds`, which counts every entry).
 * Uncategorised time is one row with a null category.
 */
export async function getIntegrationTimeSummary(
  session: RequestSession,
  input: { period: IntegrationSummaryPeriod; date: string | null; now?: Date }
): Promise<IntegrationTimeSummary> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const bounds = await query<SummaryBoundsRow>(
    `with day as (select coalesce($2::date, ($1::timestamptz at time zone $3)::date) as d),
          start_day as (select case when $4 = 'week' then d - (extract(isodow from d)::int - 1) else d end as d from day)
     select (start_day.d::timestamp at time zone $3) as "periodStart",
            ((start_day.d + case when $4 = 'week' then 7 else 1 end)::timestamp at time zone $3) as "periodEnd",
            to_char(start_day.d, 'YYYY-MM-DD') as "date"
       from start_day`,
    [nowIso, input.date, INTEGRATION_SUMMARY_TIME_ZONE, input.period]);
  const { periodStart, periodEnd, date } = bounds.rows[0];
  const from = new Date(periodStart).toISOString();
  const to = new Date(periodEnd).toISOString();
  const [categories, running] = await Promise.all([
    query<SummaryCategoryRow>(
      `select cat.id as "categoryId", cat.name as "categoryName", cat.color as "categoryColor",
              coalesce(sum(extract(epoch from (
                least(coalesce(te.stopped_at, $5::timestamptz), $4::timestamptz) - greatest(te.started_at, $3::timestamptz)
              ))), 0)::int as "seconds",
              count(*)::int as "entryCount"
         from time_entries te
         left join categories cat on cat.id = te.category_id and cat.workspace_id = te.workspace_id
        where te.workspace_id = $1 and te.user_id = $2
          and te.review_status in ('confirmed', 'accepted')
          and te.started_at < $4::timestamptz and te.started_at <= $5::timestamptz
          and coalesce(te.stopped_at, $5::timestamptz) > $3::timestamptz
        group by cat.id, cat.name, cat.color
        order by "seconds" desc, cat.name nulls last`,
      [session.workspaceId, session.userId, from, to, nowIso]),
    query<{ running: boolean }>(
      `select exists (select 1 from time_entries where workspace_id = $1 and user_id = $2 and stopped_at is null) as running`,
      [session.workspaceId, session.userId])
  ]);
  const rows = categories.rows.filter((row) => row.seconds > 0);
  return {
    ok: true,
    serverNow: nowIso,
    workspaceId: session.workspaceId,
    period: input.period,
    timeZone: INTEGRATION_SUMMARY_TIME_ZONE,
    date,
    range: { from, to },
    totalSeconds: rows.reduce((sum, row) => sum + row.seconds, 0),
    entryCount: rows.reduce((sum, row) => sum + row.entryCount, 0),
    running: running.rows[0]?.running ?? false,
    categories: rows.map((row) => ({
      id: row.categoryId,
      name: row.categoryName,
      color: row.categoryColor,
      seconds: row.seconds,
      entryCount: row.entryCount
    }))
  };
}

export type IntegrationReviewSummary = {
  ok: true;
  serverNow: string;
  workspaceId: string;
  openCards: number;
  byKind: { place: number; trip: number; health: number; other: number };
  oldestOpenAt: string | null;
  newestOpenAt: string | null;
};

/** Open Review cards, counted as Review shows them (an outing's Moves fold into its Stay card). */
export async function getIntegrationReviewSummary(session: RequestSession, now = new Date()): Promise<IntegrationReviewSummary> {
  const result = await query<{ kind: "place" | "trip" | "health" | "other"; count: number; oldest: Date | null; newest: Date | null }>(
    `select case
              when ae.event_type = 'commute_detected' then 'trip'
              when ae.source like 'health%' or ae.event_type like 'health%' then 'health'
              when ae.source like 'location%' or ae.event_type like 'geofence%' or ri.location_segment_id is not null then 'place'
              else 'other'
            end as kind,
            count(*)::int as count, min(ri.created_at) as oldest, max(ri.created_at) as newest
       from review_items ri
       left join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
      where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
        and not ${foldedOutingMemberSql("ri", "ae")}
      group by 1`,
    [session.workspaceId, session.userId]);
  const byKind = { place: 0, trip: 0, health: 0, other: 0 };
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const row of result.rows) {
    byKind[row.kind] += row.count;
    if (row.oldest) oldest = Math.min(oldest ?? Infinity, new Date(row.oldest).getTime());
    if (row.newest) newest = Math.max(newest ?? -Infinity, new Date(row.newest).getTime());
  }
  return {
    ok: true,
    serverNow: now.toISOString(),
    workspaceId: session.workspaceId,
    openCards: byKind.place + byKind.trip + byKind.health + byKind.other,
    byKind,
    oldestOpenAt: oldest == null ? null : new Date(oldest).toISOString(),
    newestOpenAt: newest == null ? null : new Date(newest).toISOString()
  };
}
