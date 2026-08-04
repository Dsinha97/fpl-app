-- Cold-start patch, phase 1: empirical-Bayes rate priors.
--
-- Why this exists. `deriveRates` in _shared/xp-model.ts returned null below 270
-- recency-weighted prior-season minutes, and generate-predictions then skipped
-- the player outright — 187 of 567 players got no projection at all. That gate
-- was doing two unrelated jobs badly:
--
--   * 95 of those players already had Premier League evidence, thrown away
--     wholesale. At 269 weighted minutes you got nothing; at 271 you got a
--     full-confidence point estimate. A cliff, not a confidence judgement.
--   * The rest genuinely have no PL history — mostly promoted-club squads.
--
-- Both are now handled by shrinking a player's own rates toward a fitted prior
-- in proportion to how much evidence they actually have, instead of discarding
-- the estimate entirely. The shrinkage weight is derived from variance
-- components measured off this very table, not chosen:
--
--     w_prior = sigma2 / (n_eff * tau2 + sigma2)
--
-- so it needs somewhere to keep those components. Hence `rate_priors`.

-- Long-and-thin rather than one wide row per band: a new metric should not
-- require a migration, and `sample_size` has to travel per metric because
-- coverage differs (every player has minutes; only some have saves).
create table public.rate_priors (
  season        text    not null,
  model_version text    not null references public.prediction_models (version),
  -- element_type id. Positions differ in kind, not degree — a keeper's xg90 is
  -- degenerately zero, so priors are never pooled across positions.
  position_id   integer not null,
  -- Price bucket label, e.g. 'p2_50_59'. FPL price is a legitimate weak signal
  -- for role and expected minutes; it is fitted here, never assumed monotone.
  price_band    text    not null,
  metric        text    not null,

  -- Prior mean for the band.
  mu            numeric not null,
  -- Within-player, season-to-season variance: how noisy one player's own
  -- estimate is. The numerator of the shrinkage weight.
  sigma2        numeric not null,
  -- Between-player variance inside the band: how much players genuinely differ.
  -- Large tau2 means the prior says little, so evidence should dominate sooner.
  tau2          numeric not null,
  sample_size   integer not null,
  -- True when the band was too thin to stand alone and was pulled toward the
  -- position-wide mean. Recorded because it changes how much the number is worth.
  shrunk_toward_position boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (season, model_version, position_id, price_band, metric)
);

create trigger rate_priors_set_updated_at
  before update on public.rate_priors
  for each row execute function public.set_updated_at();

-- Prediction provenance. All nullable: existing v1.0.0 rows predate the prior
-- engine and stay valid, which also means a null here reads as "produced before
-- shrinkage existed" rather than as missing data.
alter table public.player_predictions
  add column prior_weight numeric,
  add column n_eff        numeric,
  add column reliability  text,
  add column prior_source text,
  add column xp_lower     numeric,
  add column xp_upper     numeric;

comment on column public.player_predictions.prior_weight is
  'Share of the rate estimate that came from the prior rather than the player''s own PL minutes. 0 = pure evidence, 1 = pure prior.';
comment on column public.player_predictions.prior_source is
  'Which rung of the fallback hierarchy supplied the prior: pl_recent | pl_extended | position_price | position_baseline.';
comment on column public.player_predictions.xp_lower is
  'Low end of a RATE-uncertainty band, from re-running the model at the rates'' lower bound. Not a prediction interval — it ignores match-to-match Poisson noise and is therefore narrower than reality.';

alter table public.rate_priors enable row level security;
create policy "Public read" on public.rate_priors for select to anon, authenticated using (true);

-- The horizon rollup gains confidence alongside the totals, so the front end can
-- label a projection without a second query. CREATE OR REPLACE cannot add
-- columns to an existing view, so it is dropped first — nothing depends on it
-- but the browser client.
drop view if exists public.player_xp_horizons;

create view public.player_xp_horizons
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
       round(sum(p.xp) filter (where p.event <  b.first_event + 5), 2) as xp_5,
       round(sum(p.xp) filter (where p.event <  b.first_event + 8), 2) as xp_8,
       round(sum(p.xp), 2)                                             as xp_total,
       -- Band per horizon, not just per season: the squad optimiser's Low risk
       -- setting optimises the lower bound at whatever horizon the user picked,
       -- so a season-level band alone would not answer the question.
       round(sum(p.xp_lower) filter (where p.event <  b.first_event + 1), 2) as xp_1_lower,
       round(sum(p.xp_upper) filter (where p.event <  b.first_event + 1), 2) as xp_1_upper,
       round(sum(p.xp_lower) filter (where p.event <  b.first_event + 3), 2) as xp_3_lower,
       round(sum(p.xp_upper) filter (where p.event <  b.first_event + 3), 2) as xp_3_upper,
       round(sum(p.xp_lower) filter (where p.event <  b.first_event + 5), 2) as xp_5_lower,
       round(sum(p.xp_upper) filter (where p.event <  b.first_event + 5), 2) as xp_5_upper,
       round(sum(p.xp_lower) filter (where p.event <  b.first_event + 8), 2) as xp_8_lower,
       round(sum(p.xp_upper) filter (where p.event <  b.first_event + 8), 2) as xp_8_upper,
       round(sum(p.xp_lower), 2)                                       as xp_total_lower,
       round(sum(p.xp_upper), 2)                                       as xp_total_upper,
       -- Rates are per player, not per fixture, so these are constant across the
       -- group; max() is just a way to carry one value through the aggregate.
       round(max(p.prior_weight), 3)                                   as prior_weight,
       max(p.reliability)                                              as reliability,
       max(p.prior_source)                                             as prior_source
  from public.player_predictions p
  join base b on b.season = p.season and b.model_version = p.model_version
 group by p.season, p.model_version, p.player_id, p.player_code, b.first_event;

grant select on public.player_xp_horizons to anon, authenticated;
