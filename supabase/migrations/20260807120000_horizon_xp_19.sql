-- Add a 19-gameweek horizon.
--
-- Sprint 12 (Chip Strategy) made the half-season a real decision unit: both
-- chip windows are 19 gameweeks long (GW1-19, GW20-38, from chip_definitions),
-- so "how much is this squad worth over the rest of this chip window" had no
-- horizon that could express it — 8 stops short and "Season" now runs to the
-- end of the season rather than the end of the window.
--
-- Paired with generate-predictions extending its window past the chip-window
-- cap to the season's last gameweek, so xp_total is the full 38 rather than
-- 19. Without this horizon that change would have removed the only way to ask
-- for a half-season figure.
--
-- CREATE OR REPLACE cannot insert columns into the middle of an existing
-- projection, so the view is dropped and recreated, as both prior migrations
-- to this view already document. Nothing depends on it but the browser client.
-- Definition otherwise carried forward unchanged from
-- 20260806120000_horizon_last_event.sql.
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
       -- Rates are per player, not per fixture, so these are constant across the
       -- group; max() is just a way to carry one value through the aggregate.
       round(max(p.prior_weight), 3)                                   as prior_weight,
       max(p.reliability)                                              as reliability,
       max(p.prior_source)                                             as prior_source
  from public.player_predictions p
  join base b on b.season = p.season and b.model_version = p.model_version
 group by p.season, p.model_version, p.player_id, p.player_code, b.first_event, b.last_event;

grant select on public.player_xp_horizons to anon, authenticated;
