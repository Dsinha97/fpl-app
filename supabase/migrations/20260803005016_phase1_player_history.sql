-- Phase 1, step 4: per-fixture player performance and prior-season totals.

-- Keyed on fixture rather than event: in a double gameweek a player has two
-- rows for the same event, and per-fixture granularity is what the xP model
-- needs to attribute output to opponent and venue.
create table public.player_gameweek_stats (
  season       text    not null,
  player_id    integer not null,
  player_code  integer not null,
  fixture      integer not null,
  event        integer,
  opponent_team integer,
  was_home     boolean,
  kickoff_time timestamptz,
  team_h_score integer,
  team_a_score integer,

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
  clearances_blocks_interceptions integer,
  recoveries integer,
  tackles    integer,

  value              integer,
  selected           bigint,
  transfers_balance  bigint,
  transfers_in       bigint,
  transfers_out      bigint,

  raw        jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season, player_id, fixture)
);

create index player_gameweek_stats_event_idx  on public.player_gameweek_stats (season, event);
create index player_gameweek_stats_code_idx   on public.player_gameweek_stats (season, player_code);
create index player_gameweek_stats_player_idx on public.player_gameweek_stats (season, player_id, event);

create trigger player_gameweek_stats_set_updated_at before update on public.player_gameweek_stats
  for each row execute function public.set_updated_at();

-- Prior-season totals from element-summary history_past. Keyed on
-- element_code because element.id is reassigned between seasons. This is the
-- training data for the Phase 4 xP model and is available pre-season.
create table public.player_season_history (
  player_code  integer not null,
  season_name  text    not null,
  start_cost   integer,
  end_cost     integer,
  total_points integer,
  minutes      integer,
  starts       integer,
  goals_scored integer,
  assists      integer,
  clean_sheets integer,
  goals_conceded integer,
  own_goals    integer,
  penalties_saved  integer,
  penalties_missed integer,
  yellow_cards integer,
  red_cards    integer,
  saves        integer,
  bonus        integer,
  bps          integer,
  influence    numeric,
  creativity   numeric,
  threat       numeric,
  ict_index    numeric,
  expected_goals             numeric,
  expected_assists           numeric,
  expected_goal_involvements numeric,
  expected_goals_conceded    numeric,
  defensive_contribution     integer,
  clearances_blocks_interceptions integer,
  recoveries   integer,
  tackles      integer,
  raw          jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (player_code, season_name)
);

create trigger player_season_history_set_updated_at before update on public.player_season_history
  for each row execute function public.set_updated_at();

-- A cursored pass over 564 players cannot finish inside one Edge Function
-- invocation reliably, so 'skipped' lets a self-gating run record that it
-- deliberately did no work.
alter table public.sync_runs drop constraint sync_runs_status_check;
alter table public.sync_runs add constraint sync_runs_status_check
  check (status in ('running', 'success', 'partial', 'error', 'skipped'));

alter table public.player_gameweek_stats enable row level security;
alter table public.player_season_history enable row level security;

create policy "Public read" on public.player_gameweek_stats for select to anon, authenticated using (true);
create policy "Public read" on public.player_season_history for select to anon, authenticated using (true);
