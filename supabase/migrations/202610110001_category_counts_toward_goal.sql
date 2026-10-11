-- An activity (stored as a category) can be left out of the daily goal (UI audit UIA-043,
-- option c). Time in an activity that does not count still shows everywhere as framed time
-- (totals, ribbons, reports); only goal progress (Today's goal frame, Reports' days on goal)
-- leaves it out. Sleep starts out not counting: the Sleep starter, and any activity named
-- Sleep (active or archived). Every other activity keeps counting, as before.
--
-- The backfill runs only in the run that adds the column, so rerunning this file never
-- switches Sleep off again after someone switched it on. No RLS change: the column sits on
-- public.categories, whose existing workspace policies already cover it.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'categories'
      and column_name = 'counts_toward_goal'
  ) then
    alter table public.categories add column counts_toward_goal boolean not null default true;
    update public.categories
    set counts_toward_goal = false
    where starter_key = 'sleep' or lower(btrim(name)) = 'sleep';
  end if;
end
$$;
-- Additive; apply to staging before the server Preview that reads counts_toward_goal, and to
-- production before that server deploys. Production requires separate approval. Only Sleep
-- rows change (to not counting).
