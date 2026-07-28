import { query } from "./db";
import type { RequestSession } from "./session";

export type GlobalSearchResult = {
  id: string;
  kind: "activity" | "entry" | "place" | "category" | "tag" | "review";
  label: string;
  detail: string;
  occurredAt: string | null;
  entryId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  placeId: string | null;
  description: string | null;
  tagNames: string[];
  startedAt: string | null;
  stoppedAt: string | null;
  durationSeconds: number | null;
};

type SearchRow = GlobalSearchResult & {
  rank: number;
};

export async function searchDayframe(
  searchTerm: string,
  session: RequestSession,
  limit = 20
): Promise<GlobalSearchResult[]> {
  const normalized = searchTerm.trim().replace(/\s+/g, " ");
  if (normalized.length < 2) return [];

  const result = await query<SearchRow>(
    `with matching_entries as (
       select te.id,
              te.description,
              te.started_at,
              te.stopped_at,
              cat.id as category_id,
              cat.name as category_name,
              cat.color as category_color,
              pl.id as place_id,
              pl.name as place_name,
              coalesce(array_agg(distinct tag.name) filter (where tag.id is not null), array[]::text[]) as tag_names,
              greatest(0, extract(epoch from (coalesce(te.stopped_at, now()) - te.started_at)))::int as duration_seconds
       from time_entries te
       left join categories cat on cat.id = te.category_id and cat.workspace_id = te.workspace_id
       left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
       left join time_entry_tags tet on tet.time_entry_id = te.id and tet.workspace_id = te.workspace_id
       left join tags tag on tag.id = tet.tag_id and tag.workspace_id = te.workspace_id
       where te.workspace_id = $1
         and te.user_id = $2
         and (
           coalesce(te.description, '') ilike '%' || $3 || '%'
           or coalesce(cat.name, '') ilike '%' || $3 || '%'
           or coalesce(pl.name, '') ilike '%' || $3 || '%'
           or coalesce(tag.name, '') ilike '%' || $3 || '%'
         )
       group by te.id, cat.id, cat.name, cat.color, pl.id, pl.name
     ),
     candidates as (
       select 'entry:' || me.id::text as id,
              'entry'::text as kind,
              coalesce(nullif(btrim(me.description), ''), me.category_name, 'Uncategorized') as label,
              concat_ws(' · ', me.category_name, me.place_name) as detail,
              me.started_at as occurred_at,
              me.id as entry_id,
              me.category_id,
              me.category_name,
              me.category_color,
              me.place_id,
              me.description,
              me.tag_names,
              me.started_at,
              me.stopped_at,
              me.duration_seconds,
              case
                when lower(coalesce(me.description, '')) = lower($3) then 100
                when coalesce(me.description, '') ilike $3 || '%' then 80
                else 55
              end as rank
       from matching_entries me
       union all
       select 'activity:' || latest.id::text,
              'activity',
              coalesce(nullif(btrim(latest.description), ''), latest.category_name, 'Uncategorized'),
              concat_ws(' · ', 'Start again', latest.category_name),
              latest.started_at,
              latest.id,
              latest.category_id,
              latest.category_name,
              latest.category_color,
              latest.place_id,
              latest.description,
              latest.tag_names,
              latest.started_at,
              latest.stopped_at,
              latest.duration_seconds,
              70
       from (
         select distinct on (
           lower(coalesce(me.description, '')),
           coalesce(me.category_id::text, ''),
           coalesce(me.place_id::text, ''),
           array_to_string(me.tag_names, '|')
         ) me.*
         from matching_entries me
         where nullif(btrim(coalesce(me.description, '')), '') is not null
           and me.stopped_at is not null
         order by lower(coalesce(me.description, '')),
                  coalesce(me.category_id::text, ''),
                  coalesce(me.place_id::text, ''),
                  array_to_string(me.tag_names, '|'),
                  me.started_at desc
       ) latest
       union all
       select 'category:' || c.id::text, 'category', c.name, 'Category', null, null,
              c.id, c.name, c.color, null, null, array[]::text[], null, null, null,
              case when lower(c.name) = lower($3) then 110 when c.name ilike $3 || '%' then 90 else 60 end
       from categories c
       where c.workspace_id = $1 and c.is_archived = false and c.name ilike '%' || $3 || '%'
       union all
       select 'place:' || p.id::text, 'place', p.name, 'Place', null, null,
              p.default_category_id, c.name, c.color, p.id, p.default_activity_description,
              array[]::text[], null, null, null,
              case when lower(p.name) = lower($3) then 110 when p.name ilike $3 || '%' then 90 else 60 end
       from places p
       left join categories c on c.id = p.default_category_id and c.workspace_id = p.workspace_id
       where p.workspace_id = $1 and p.name ilike '%' || $3 || '%'
       union all
       select 'tag:' || t.id::text, 'tag', t.name, 'Tag', null, null,
              null, null, null, null, null, array[t.name], null, null, null,
              case when lower(t.name) = lower($3) then 110 when t.name ilike $3 || '%' then 90 else 60 end
       from tags t
       where t.workspace_id = $1 and t.name ilike '%' || $3 || '%'
       union all
       select 'review:' || r.id::text, 'review', r.title, 'Open review item',
              coalesce(r.suggested_started_at, r.created_at), null, r.suggested_category_id,
              c.name, c.color, r.suggested_place_id, null, array[]::text[],
              r.suggested_started_at, r.suggested_stopped_at, null,
              case when lower(r.title) = lower($3) then 105 when r.title ilike $3 || '%' then 85 else 65 end
       from review_items r
       left join categories c on c.id = r.suggested_category_id and c.workspace_id = r.workspace_id
       where r.workspace_id = $1 and r.user_id = $2 and r.status = 'open'
         and r.title ilike '%' || $3 || '%'
     )
     select id, kind, label, detail,
            occurred_at as "occurredAt", entry_id as "entryId",
            category_id as "categoryId", category_name as "categoryName",
            category_color as "categoryColor", place_id as "placeId",
            description, tag_names as "tagNames", started_at as "startedAt",
            stopped_at as "stoppedAt", duration_seconds as "durationSeconds", rank
     from candidates
     order by rank desc, occurred_at desc nulls last, label
     limit $4`,
    [session.workspaceId, session.userId, normalized, Math.min(Math.max(limit, 1), 40)]
  );

  return result.rows.map((row) => {
    const publicResult = { ...row };
    delete (publicResult as Partial<SearchRow>).rank;
    return publicResult;
  });
}
