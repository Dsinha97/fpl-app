-- Sprint 21: manager leagues.
--
-- entry.leagues.classic is already fetched by sync-manager on every sync and
-- stored whole inside managers.raw — this promotes it into its own typed
-- table so /team can list a manager's leagues without parsing jsonb
-- client-side. Same public-read/service-write shape as every other
-- manager_* table (this is public FPL data about a manager's league
-- memberships, not something owned by an authenticated user, so it does not
-- use the auth.uid() shape manager_rivals uses).

create table public.manager_leagues (
  entry_id         integer not null references public.managers (entry_id) on delete cascade,
  league_id        integer not null,
  name             text not null,
  -- FPL's own grouping: 's' = system (general/broadcaster leagues FPL itself
  -- creates — country, Overall, Gameweek 1, broadcaster tie-ins), 'x' =
  -- invitational (a private code-joined league). No finer split exists in
  -- the API; a broadcaster-vs-general distinction would have to be a
  -- hardcoded id list, which is not built here — see docs/sprints/sprint-21.md.
  league_type      text not null check (league_type in ('s', 'x')),
  scoring          text,
  start_event      integer,
  -- All three are 0/null pre-season — FPL publishes no standings until GW1
  -- is scored (verified 2026-08-21, same probe-before-building rule as every
  -- other FPL-API field this app has hit zeroed pre-season).
  entry_rank       integer,
  entry_last_rank  integer,
  rank_count       integer,
  synced_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (entry_id, league_id)
);

create trigger manager_leagues_set_updated_at before update on public.manager_leagues
  for each row execute function public.set_updated_at();

alter table public.manager_leagues enable row level security;
create policy "Public read" on public.manager_leagues for select to anon, authenticated using (true);
