-- An activity (stored as a category) can be left out of the daily goal (UI audit UIA-043,
-- option c). Time in an activity that does not count still shows everywhere as framed time
-- (totals, ribbons, reports); only goal progress (Today's goal frame, Reports' days on goal)
-- leaves it out. Sleep starts out not counting: the Sleep starter, and any activity named
-- Sleep (active or archived). Every other activity keeps counting, as before.
--
-- The backfill runs only in the run that adds the column, so rerunning this file never
-- switches Sleep off again after someone switched it on.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'categories'
      and column_name = 'counts_toward_goal'
  ) then
    alter table categories add column counts_toward_goal boolean not null default true;
    update categories
    set counts_toward_goal = false
    where starter_key = 'sleep' or lower(btrim(name)) = 'sleep';
  end if;
end
$$;
