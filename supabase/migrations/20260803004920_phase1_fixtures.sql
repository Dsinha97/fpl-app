-- Phase 1, step 2: fixtures and an audit trail of fixture reschedules.

create table public.fixtures (
  season                 text    not null,
  id                     integer not null,
  code                   bigint,
  event                  integer,
  kickoff_time           timestamptz,
  provisional_start_time boolean,
  team_h                 integer not null,
  team_a                 integer not null,
  team_h_score           integer,
  team_a_score           integer,
  team_h_difficulty      integer,
  team_a_difficulty      integer,
  started                boolean,
  finished               boolean,
  finished_provisional   boolean,
  minutes                integer,
  pulse_id               bigint,
  stats                  jsonb,
  raw                    jsonb not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (season, id),
  foreign key (season, team_h) references public.teams (season, id),
  foreign key (season, team_a) references public.teams (season, id)
);

create index fixtures_event_idx   on public.fixtures (season, event);
create index fixtures_kickoff_idx on public.fixtures (season, kickoff_time);
create index fixtures_team_h_idx  on public.fixtures (season, team_h);
create index fixtures_team_a_idx  on public.fixtures (season, team_a);

-- Supports the self-gating check in sync-live-gameweek.
create index fixtures_live_idx on public.fixtures (season)
  where started and not finished;

create trigger fixtures_set_updated_at before update on public.fixtures
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ fixture_changes
-- Append-only log of reschedules: a fixture moving gameweek or kickoff time
-- is a decision-relevant event (blanks, doubles, chip planning).

create table public.fixture_changes (
  id          bigint generated always as identity primary key,
  season      text    not null,
  fixture_id  integer not null,
  field       text    not null,
  old_value   text,
  new_value   text,
  observed_at timestamptz not null default now()
);

create index fixture_changes_recent_idx  on public.fixture_changes (season, observed_at desc);
create index fixture_changes_fixture_idx on public.fixture_changes (season, fixture_id);

alter table public.fixtures        enable row level security;
alter table public.fixture_changes enable row level security;

create policy "Public read" on public.fixtures        for select to anon, authenticated using (true);
create policy "Public read" on public.fixture_changes for select to anon, authenticated using (true);
