-- Phase 2: read-only manager data, keyed by FPL entry id.
-- Everything here is publicly readable from the FPL API for any entry id,
-- so the RLS posture matches the reference tables: anon read, service write.

-- ------------------------------------------------------------- managers
-- One row per connected FPL entry. Summary fields reflect the current
-- season and are null before GW1.

create table public.managers (
  entry_id       integer primary key,
  team_name      text,
  first_name     text,
  last_name      text,
  region_name    text,
  region_iso     text,
  favourite_team integer,
  joined_time    timestamptz,
  started_event  integer,
  years_active   integer,
  current_event  integer,

  summary_overall_points integer,
  summary_overall_rank   integer,
  summary_event_points   integer,
  summary_event_rank     integer,

  last_deadline_bank            integer,
  last_deadline_value           integer,
  last_deadline_total_transfers integer,

  entered_events integer[],
  raw            jsonb not null,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger managers_set_updated_at before update on public.managers
  for each row execute function public.set_updated_at();

-- ------------------------------------------- manager_season_history
-- Finished past seasons, from entry/{id}/history/ "past".

create table public.manager_season_history (
  entry_id        integer not null references public.managers (entry_id) on delete cascade,
  season_name     text    not null,
  total_points    integer,
  rank            integer,
  rank_percentage numeric,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (entry_id, season_name)
);

create trigger manager_season_history_set_updated_at before update on public.manager_season_history
  for each row execute function public.set_updated_at();

-- ----------------------------------------- manager_gameweek_history
-- Per-gameweek results for the current season, from history/ "current"
-- plus entry_history and active_chip from the picks endpoint.

create table public.manager_gameweek_history (
  season               text    not null,
  entry_id             integer not null references public.managers (entry_id) on delete cascade,
  event                integer not null,
  points               integer,
  total_points         integer,
  rank                 integer,
  overall_rank         integer,
  percentile_rank      integer,
  bank                 integer,
  value                integer,
  event_transfers      integer,
  event_transfers_cost integer,
  points_on_bench      integer,
  active_chip          text,
  raw                  jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (season, entry_id, event)
);

create trigger manager_gameweek_history_set_updated_at before update on public.manager_gameweek_history
  for each row execute function public.set_updated_at();

-- --------------------------------------------------- manager_picks
-- The 15 picks per entry per gameweek. position is squad slot 1-15
-- (12-15 are the bench); multiplier is 0 bench, 1 playing, 2 captain,
-- 3 triple captain.

create table public.manager_picks (
  season          text    not null,
  entry_id        integer not null references public.managers (entry_id) on delete cascade,
  event           integer not null,
  position        integer not null,
  element         integer not null,
  multiplier      integer not null default 1,
  is_captain      boolean not null default false,
  is_vice_captain boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (season, entry_id, event, position),
  foreign key (season, element) references public.players (season, id)
);

create index manager_picks_element_idx on public.manager_picks (season, element);

create trigger manager_picks_set_updated_at before update on public.manager_picks
  for each row execute function public.set_updated_at();

-- ----------------------------------------------- manager_transfers

create table public.manager_transfers (
  id               bigint generated always as identity primary key,
  season           text    not null,
  entry_id         integer not null references public.managers (entry_id) on delete cascade,
  event            integer,
  element_in       integer,
  element_in_cost  integer,
  element_out      integer,
  element_out_cost integer,
  transfer_time    timestamptz,
  raw              jsonb,
  created_at       timestamptz not null default now()
);

create unique index manager_transfers_dedupe_idx on public.manager_transfers
  (entry_id, season, event, transfer_time, element_in, element_out);

-- --------------------------------------------------- manager_chips
-- One chip per gameweek at most, so (season, entry, event) is the key.

create table public.manager_chips (
  season     text    not null,
  entry_id   integer not null references public.managers (entry_id) on delete cascade,
  event      integer not null,
  name       text    not null,
  played_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season, entry_id, event)
);

create trigger manager_chips_set_updated_at before update on public.manager_chips
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ RLS

alter table public.managers                 enable row level security;
alter table public.manager_season_history  enable row level security;
alter table public.manager_gameweek_history enable row level security;
alter table public.manager_picks            enable row level security;
alter table public.manager_transfers        enable row level security;
alter table public.manager_chips            enable row level security;

create policy "Public read" on public.managers                 for select to anon, authenticated using (true);
create policy "Public read" on public.manager_season_history   for select to anon, authenticated using (true);
create policy "Public read" on public.manager_gameweek_history for select to anon, authenticated using (true);
create policy "Public read" on public.manager_picks            for select to anon, authenticated using (true);
create policy "Public read" on public.manager_transfers        for select to anon, authenticated using (true);
create policy "Public read" on public.manager_chips            for select to anon, authenticated using (true);
