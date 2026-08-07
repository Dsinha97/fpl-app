-- generate-predictions now derives its window from chip_definitions instead
-- of a hardcoded 8 gameweeks (Sprint 12 prerequisite: chip planning needs
-- "season" to mean the real chip window, not whatever 8 gameweeks happened
-- to sum to). The window's length varies run to run — floored at 8, 19 in
-- the current wildcard #1 window — so `fixtures` (a count of fixture rows,
-- inflated by doubles and deflated by blanks) is not a reliable way for a
-- consumer to tell how far xp_total actually reaches. Add last_event
-- alongside the existing first_event so that is answerable directly.
--
-- CREATE OR REPLACE cannot add a column ahead of xp_total in the existing
-- projection, so the view is dropped first, as the migration that added the
-- band columns already documents. Nothing depends on it but the browser
-- client. Definition otherwise carried forward unchanged from
-- 20260804090000_cold_start_rate_priors.sql.
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
 group by p.season, p.model_version, p.player_id, p.player_code, b.first_event, b.last_event;

grant select on public.player_xp_horizons to anon, authenticated;
