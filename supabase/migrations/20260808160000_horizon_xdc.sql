-- Add a defensive-contribution horizon to player_xp_horizons.
--
-- xp_defensive_contribution is a real column on player_predictions
-- (see 20260803020100_phase4_xp_engine.sql) but nothing aggregates it — the
-- view only rolls up xp/xp_lower/xp_upper. Sprint 12.6 adds an xDefcon column
-- to /players and /compare (defenders and midfielders' expected points from
-- clearing the defensive-contribution threshold), which needs it summed over
-- a horizon the same way xp_1..xp_19/xp_total already are.
--
-- Ships alongside xP engine v1.4.0, which gives dc90 its own eligible-minutes
-- denominator (see deriveDcEligibleSeasons in supabase/functions/_shared/
-- xp-model.ts) — the FPL API only tracks defensive_contribution from 2024/25,
-- and blending earlier seasons into the same-minutes denominator was
-- silently halving the rate. Without that fix this column would sum a
-- confidently wrong number; see docs/roadmap.md.
--
-- CREATE OR REPLACE cannot insert columns into the middle of an existing
-- projection, so the view is dropped and recreated, as every prior migration
-- to this view already documents. Definition otherwise carried forward
-- unchanged from 20260807120000_horizon_xp_19.sql.
drop view if exists public.player_xp_horizons;

create view public.player_xp_horizons
with (security_invoker = true) as
with base as (
  select season, model_version,
         min(event) as first_event,
         max(event) as last_event
    from public.player_predictions
   group by season, model_version
)
select p.season,
       p.model_version,
       p.player_id,
       p.player_code,
       b.first_event,
       b.last_event,
       count(*)                                                        as fixtures,
       round(sum(p.xp) filter (where p.event <  b.first_event + 1), 2) as xp_1,
       round(sum(p.xp) filter (where p.event <  b.first_event + 3), 2) as xp_3,
       round(sum(p.xp) filter (where p.event <  b.first_event + 5), 2) as xp_5,
       round(sum(p.xp) filter (where p.event <  b.first_event + 8), 2) as xp_8,
       round(sum(p.xp) filter (where p.event <  b.first_event + 19), 2) as xp_19,
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
       round(sum(p.xp_lower) filter (where p.event <  b.first_event + 19), 2) as xp_19_lower,
       round(sum(p.xp_upper) filter (where p.event <  b.first_event + 19), 2) as xp_19_upper,
       round(sum(p.xp_lower), 2)                                       as xp_total_lower,
       round(sum(p.xp_upper), 2)                                       as xp_total_upper,
       -- Defensive contribution over the same horizons — see the migration
       -- header. Position-scoped by the caller (GKP/FWD carry a real but
       -- near-zero figure since dcThreshold is 0 for GKP and their own dc90
       -- is negligible; the front end blanks those rather than printing a
       -- misleading 0.00).
       round(sum(p.xp_defensive_contribution) filter (where p.event <  b.first_event + 1), 2) as xdc_1,
       round(sum(p.xp_defensive_contribution) filter (where p.event <  b.first_event + 3), 2) as xdc_3,
       round(sum(p.xp_defensive_contribution) filter (where p.event <  b.first_event + 5), 2) as xdc_5,
       round(sum(p.xp_defensive_contribution) filter (where p.event <  b.first_event + 8), 2) as xdc_8,
       round(sum(p.xp_defensive_contribution) filter (where p.event <  b.first_event + 19), 2) as xdc_19,
       round(sum(p.xp_defensive_contribution), 2)                      as xdc_total,
       -- Rates are per player, not per fixture, so these are constant across the
       -- group; max() is just a way to carry one value through the aggregate.
       round(max(p.prior_weight), 3)                                   as prior_weight,
       max(p.reliability)                                              as reliability,
       max(p.prior_source)                                             as prior_source
  from public.player_predictions p
  join base b on b.season = p.season and b.model_version = p.model_version
 group by p.season, p.model_version, p.player_id, p.player_code, b.first_event, b.last_event;

grant select on public.player_xp_horizons to anon, authenticated;
