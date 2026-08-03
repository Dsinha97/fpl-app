-- Phase 1, step 5: provisional live gameweek stats.
--
-- Deliberately separate from player_gameweek_stats. The live endpoint returns
-- one aggregate row per player for the whole gameweek (not per fixture), and
-- its bonus points are provisional until the gameweek is finalised.
-- player_gameweek_stats stays the authoritative per-fixture record, written by
-- sync-player-history once the gameweek completes.

create table public.player_live_stats (
  season       text    not null,
  event        integer not null,
  player_id    integer not null,
  player_code  integer,

  minutes        integer,
  starts         integer,
  total_points   integer,
  goals_scored   integer,
  assists        integer,
  clean_sheets   integer,
  goals_conceded integer,
  own_goals      integer,
  penalties_saved  integer,
  penalties_missed integer,
  yellow_cards   integer,
  red_cards      integer,
  saves          integer,
  bonus          integer,
  bps            integer,

  influence  numeric,
  creativity numeric,
  threat     numeric,
  ict_index  numeric,

  expected_goals             numeric,
  expected_assists           numeric,
  expected_goal_involvements numeric,
  expected_goals_conceded    numeric,
  defensive_contribution     integer,

  in_dreamteam boolean,
  raw          jsonb not null,
  observed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (season, event, player_id)
);

create index player_live_stats_event_idx on public.player_live_stats (season, event);

create trigger player_live_stats_set_updated_at before update on public.player_live_stats
  for each row execute function public.set_updated_at();

alter table public.player_live_stats enable row level security;

create policy "Public read" on public.player_live_stats for select to anon, authenticated using (true);
