-- Prediction archive.
--
-- generate-predictions deletes every player_predictions row for the season
-- before each run (see the comment above that delete in
-- supabase/functions/generate-predictions/index.ts) — a deliberate
-- invariant, because no front-end call site filters on model_version, so a
-- partial delete would double every player's horizon data. The cost is that
-- there has never been a record of what the model said *before* a gameweek
-- was played: GW1's predictions were overwritten within the first cron tick
-- after GW1 finished, so there is no way to score the model against GW1's
-- real results, and no way to honestly refit positionCalibration (fitted
-- in-sample; see docs/phase-4-model.md's "Honest limitations"). GW2 is about
-- to be lost the same way unless this lands before its 2026-08-28 17:30 UTC
-- deadline.
--
-- This table is an append-only historical fact, not a live replaceable
-- projection like player_predictions — deliberately different shape:
--
-- - No model_version in the primary key. One archived truth per gameweek:
--   the last snapshot generate-predictions wrote *before* that gameweek's
--   deadline. A mid-season MODEL_VERSION bump overwrites only the still-open
--   gameweek's row (correct — that's the number the app is currently
--   showing) and never touches a settled past gameweek, whose row is frozen
--   the moment its deadline passes. model_version is kept as a plain column
--   so a later accuracy panel can still segment by it.
-- - captured_at and deadline_time are both stored because the write only
--   happens on generate-predictions' own cron cadence (':05,:35' — see
--   20260803021500_phase4_schedule_predictions.sql), so a snapshot can be up
--   to ~30 minutes stale relative to the real deadline. Any reader must be
--   able to disclose that rather than imply a deadline-instant capture.
--
-- Public-read/service-write, same shape as player_predictions and every
-- other pre-Sprint-14 prediction/stats table: this is derived from public
-- FPL data, not owned by an authenticated user.

create table public.player_prediction_archive (
  season        text    not null,
  event         integer not null,
  player_id     integer not null,
  player_code   integer not null,
  fixture       integer not null,
  model_version text    not null references public.prediction_models (version),

  opponent_team integer,
  was_home      boolean,
  fdr           integer,

  expected_minutes    numeric,
  start_probability   numeric,
  p60                  numeric,
  availability         numeric,
  attack_multiplier    numeric,
  defence_multiplier   numeric,

  xp_appearance              numeric,
  xp_goals                   numeric,
  xp_assists                 numeric,
  xp_clean_sheet              numeric,
  xp_goals_conceded           numeric,
  xp_saves                    numeric,
  xp_bonus                    numeric,
  xp_defensive_contribution   numeric,
  xp_cards                    numeric,

  xp        numeric not null,
  xp_lower  numeric,
  xp_upper  numeric,

  prior_weight numeric,
  n_eff        numeric,
  reliability  text,
  prior_source text,
  rates        jsonb,

  -- The gameweek this snapshot is a pre-deadline record of, and when it was
  -- actually captured — see the staleness note above.
  deadline_time timestamptz not null,
  captured_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (season, event, player_id, fixture)
);

create index player_prediction_archive_event_idx
  on public.player_prediction_archive (season, event);

create trigger player_prediction_archive_set_updated_at
  before update on public.player_prediction_archive
  for each row execute function public.set_updated_at();

alter table public.player_prediction_archive enable row level security;
create policy "Public read" on public.player_prediction_archive
  for select to anon, authenticated using (true);
