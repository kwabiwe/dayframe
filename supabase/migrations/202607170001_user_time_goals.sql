begin;

alter table public.users
  add column if not exists daily_goal_minutes integer not null default 480,
  add column if not exists weekly_goal_minutes integer not null default 2400;

alter table public.users
  drop constraint if exists users_daily_goal_minutes_range,
  drop constraint if exists users_weekly_goal_minutes_range;

alter table public.users
  add constraint users_daily_goal_minutes_range
    check (daily_goal_minutes between 1 and 1440),
  add constraint users_weekly_goal_minutes_range
    check (weekly_goal_minutes between 1 and 10080);

comment on column public.users.daily_goal_minutes is
  'Personal daily tracked-time goal in minutes. Defaults to 8 hours.';

comment on column public.users.weekly_goal_minutes is
  'Personal weekly tracked-time goal in minutes. Defaults to 40 hours.';

commit;
