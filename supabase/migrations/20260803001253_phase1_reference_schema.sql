-- Phase 1, step 1: FPL reference data, season config, and sync observability.
-- Season is text ('2026-27'). element.id is per-season; element.code is the stable
-- cross-season identifier and is what history_past joins on.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- teams

create table public.teams (
  season                 text    not null,
  id                     integer not null,
  code                   integer not null,
  name                   text    not null,
  short_name             text    not null,
  strength               integer,
  strength_overall_home  integer,
  strength_overall_away  integer,
  strength_attack_home   integer,
  strength_attack_away   integer,
  strength_defence_home  integer,
  strength_defence_away  integer,
  played                 integer,
  win                    integer,
  draw                   integer,
  loss                   integer,
  points                 integer,
  position               integer,
  form                   text,
  unavailable            boolean,
  pulse_id               integer,
  raw                    jsonb   not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (season, id)
);

create unique index teams_season_code_idx on public.teams (season, code);
create trigger teams_set_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

comment on column public.teams.strength_attack_home is
  'Null or 0 until the season has matches played; FPL populates these progressively.';

-- -------------------------------------------------------- element_types

create table public.element_types (
  season               text    not null,
  id                   integer not null,
  singular_name        text    not null,
  singular_name_short  text    not null,
  plural_name          text    not null,
  plural_name_short    text    not null,
  squad_select         integer,
  squad_min_select     integer,
  squad_max_select     integer,
  squad_min_play       integer,
  squad_max_play       integer,
  element_count        integer,
  raw                  jsonb   not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (season, id)
);

create trigger element_types_set_updated_at before update on public.element_types
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ gameweeks

create table public.gameweeks (
  season               text    not null,
  id                   integer not null,
  name                 text    not null,
  deadline_time        timestamptz not null,
  deadline_time_epoch  bigint,
  average_entry_score  integer,
  highest_score        integer,
  finished             boolean not null default false,
  data_checked         boolean not null default false,
  is_previous          boolean not null default false,
  is_current           boolean not null default false,
  is_next              boolean not null default false,
  released             boolean,
  can_enter            boolean,
  can_manage           boolean,
  ranked_count         integer,
  transfers_made       bigint,
  most_selected        integer,
  most_transferred_in  integer,
  most_captained       integer,
  most_vice_captained  integer,
  top_element          integer,
  chip_plays           jsonb,
  raw                  jsonb   not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (season, id)
);

create index gameweeks_current_idx on public.gameweeks (season, is_current) where is_current;
create index gameweeks_next_idx    on public.gameweeks (season, is_next)    where is_next;
create index gameweeks_deadline_idx on public.gameweeks (season, deadline_time);

create trigger gameweeks_set_updated_at before update on public.gameweeks
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- players
-- ~65 typed columns for what the app queries; the full 105-field API object
-- is retained in `raw` so new FPL fields never require a migration.

create table public.players (
  season       text    not null,
  id           integer not null,
  code         integer not null,

  first_name   text,
  second_name  text,
  web_name     text,
  known_name   text,
  team_id      integer not null,
  team_code    integer,
  element_type integer not null,
  squad_number integer,
  photo        text,
  opta_code    text,
  birth_date   date,
  region       integer,

  now_cost                integer,
  cost_change_event       integer,
  cost_change_event_fall  integer,
  cost_change_start       integer,
  cost_change_start_fall  integer,
  price_change_percent    numeric,

  status                        text,
  news                          text,
  news_added                    timestamptz,
  chance_of_playing_this_round  integer,
  chance_of_playing_next_round  integer,
  can_transact                  boolean,
  can_select                    boolean,
  removed                       boolean,

  selected_by_percent  numeric,
  transfers_in         bigint,
  transfers_out        bigint,
  transfers_in_event   bigint,
  transfers_out_event  bigint,

  total_points     integer,
  event_points     integer,
  points_per_game  numeric,
  form             numeric,
  value_form       numeric,
  value_season     numeric,
  minutes          integer,
  starts           integer,
  goals_scored     integer,
  assists          integer,
  clean_sheets     integer,
  goals_conceded   integer,
  own_goals        integer,
  penalties_saved  integer,
  penalties_missed integer,
  yellow_cards     integer,
  red_cards        integer,
  saves            integer,
  bonus            integer,
  bps              integer,

  influence   numeric,
  creativity  numeric,
  threat      numeric,
  ict_index   numeric,

  expected_goals               numeric,
  expected_assists             numeric,
  expected_goal_involvements   numeric,
  expected_goals_conceded      numeric,
  defensive_contribution       integer,
  clearances_blocks_interceptions integer,
  recoveries                   integer,
  tackles                      integer,

  penalties_order   integer,
  penalties_text    text,
  corners_and_indirect_freekicks_order integer,
  corners_and_indirect_freekicks_text  text,
  direct_freekicks_order integer,
  direct_freekicks_text  text,

  ep_this  numeric,
  ep_next  numeric,

  raw         jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (season, id),
  foreign key (season, team_id)      references public.teams (season, id),
  foreign key (season, element_type) references public.element_types (season, id)
);

create unique index players_season_code_idx on public.players (season, code);
create index players_team_idx     on public.players (season, team_id);
create index players_position_idx on public.players (season, element_type);
create index players_status_idx   on public.players (season, status);

create trigger players_set_updated_at before update on public.players
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------- chip_definitions
-- From bootstrap.chips. Each chip appears once per season half, so the key
-- includes start_event. Satisfies "do not hardcode one season's chip rules".

create table public.chip_definitions (
  season       text    not null,
  name         text    not null,
  number       integer not null,
  chip_type    text,
  start_event  integer not null,
  stop_event   integer,
  raw          jsonb   not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (season, name, start_event)
);

create trigger chip_definitions_set_updated_at before update on public.chip_definitions
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------- scoring_rules
-- From game_config.scoring, unpivoted. 10 stats are position-keyed
-- (GKP/DEF/MID/FWD); the remaining 25 are scalars, stored with position 'ALL'.
-- Values are stored verbatim. Threshold semantics (e.g. saves per point,
-- defensive-contribution thresholds) belong to the xP engine, not to ingestion.

create table public.scoring_rules (
  season      text    not null,
  stat        text    not null,
  position    text    not null,
  value       numeric not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (season, stat, position),
  constraint scoring_rules_position_check
    check (position in ('GKP', 'DEF', 'MID', 'FWD', 'ALL'))
);

create trigger scoring_rules_set_updated_at before update on public.scoring_rules
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------- game_settings

create table public.game_settings (
  season      text not null,
  key         text not null,
  value       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (season, key)
);

create trigger game_settings_set_updated_at before update on public.game_settings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ sync_runs
-- Observability for every ingestion function. Without this there is no way to
-- distinguish a broken sync from a genuinely quiet news day.

create table public.sync_runs (
  id            bigint generated always as identity primary key,
  function_name text not null,
  season        text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running',
  rows_written  integer not null default 0,
  http_status   integer,
  cursor        jsonb,
  error         text,
  details       jsonb,
  constraint sync_runs_status_check
    check (status in ('running', 'success', 'partial', 'error'))
);

create index sync_runs_recent_idx on public.sync_runs (function_name, started_at desc);

-- ------------------------------------------------------------------ RLS
-- All of this is public FPL data: readable by anon, writable only by the
-- service role used by Edge Functions (which bypasses RLS).

alter table public.teams            enable row level security;
alter table public.element_types    enable row level security;
alter table public.gameweeks        enable row level security;
alter table public.players          enable row level security;
alter table public.chip_definitions enable row level security;
alter table public.scoring_rules    enable row level security;
alter table public.game_settings    enable row level security;
alter table public.sync_runs        enable row level security;

create policy "Public read" on public.teams            for select to anon, authenticated using (true);
create policy "Public read" on public.element_types    for select to anon, authenticated using (true);
create policy "Public read" on public.gameweeks        for select to anon, authenticated using (true);
create policy "Public read" on public.players          for select to anon, authenticated using (true);
create policy "Public read" on public.chip_definitions for select to anon, authenticated using (true);
create policy "Public read" on public.scoring_rules    for select to anon, authenticated using (true);
create policy "Public read" on public.game_settings    for select to anon, authenticated using (true);
create policy "Public read" on public.sync_runs        for select to anon, authenticated using (true);
