-- Phase 4: expected points engine.
--
-- Predictions are stored per player per fixture (not per gameweek) so double
-- gameweeks sum naturally and each prediction can be attributed to a specific
-- opponent and venue. Every scoring component is stored separately: the build
-- plan's instruction is "keep the components explicit so the model can be
-- debugged", and a single xp number is impossible to audit.

create table public.prediction_models (
  version     text primary key,
  description text not null,
  params      jsonb not null,
  created_at  timestamptz not null default now()
);

create table public.player_predictions (
  season        text    not null,
  model_version text    not null references public.prediction_models (version),
  player_id     integer not null,
  player_code   integer not null,
  fixture       integer not null,
  event         integer not null,
  opponent_team integer,
  was_home      boolean,
  fdr           integer,

  -- inputs
  expected_minutes  numeric,
  start_probability numeric,
  p60               numeric,
  availability      numeric,
  attack_multiplier numeric,
  defence_multiplier numeric,

  -- components (all in points)
  xp_appearance             numeric not null default 0,
  xp_goals                  numeric not null default 0,
  xp_assists                numeric not null default 0,
  xp_clean_sheet            numeric not null default 0,
  xp_goals_conceded         numeric not null default 0,
  xp_saves                  numeric not null default 0,
  xp_bonus                  numeric not null default 0,
  xp_defensive_contribution numeric not null default 0,
  xp_cards                  numeric not null default 0,

  xp           numeric not null,
  rates        jsonb,
  computed_at  timestamptz not null default now(),

  primary key (season, model_version, player_id, fixture)
);

create index player_predictions_event_idx  on public.player_predictions (season, model_version, event);
create index player_predictions_player_idx on public.player_predictions (season, model_version, player_id);
create index player_predictions_xp_idx     on public.player_predictions (season, model_version, xp desc);

-- Horizon rollups. Windows are measured from the earliest predicted gameweek
-- rather than a hardcoded number, so the view stays correct as the season
-- advances and older gameweeks drop out of the prediction set.
create or replace view public.player_xp_horizons
with (security_invoker = true) as
with base as (
  select season, model_version, min(event) as first_event
    from public.player_predictions
   group by season, model_version
)
select p.season,
       p.model_version,
       p.player_id,
       p.player_code,
       b.first_event,
       count(*)                                                        as fixtures,
       round(sum(p.xp) filter (where p.event <  b.first_event + 1), 2) as xp_1,
       round(sum(p.xp) filter (where p.event <  b.first_event + 3), 2) as xp_3,
       round(sum(p.xp) filter (where p.event <  b.first_event + 6), 2) as xp_6,
       round(sum(p.xp) filter (where p.event <  b.first_event + 8), 2) as xp_8,
       round(sum(p.xp), 2)                                             as xp_total
  from public.player_predictions p
  join base b on b.season = p.season and b.model_version = p.model_version
 group by p.season, p.model_version, p.player_id, p.player_code, b.first_event;

alter table public.prediction_models  enable row level security;
alter table public.player_predictions enable row level security;

create policy "Public read" on public.prediction_models  for select to anon, authenticated using (true);
create policy "Public read" on public.player_predictions for select to anon, authenticated using (true);

grant select on public.player_xp_horizons to anon, authenticated;
