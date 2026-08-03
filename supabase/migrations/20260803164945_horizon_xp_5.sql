-- Horizons become 1 / 3 / 5 / 8 / Season to match the revised feature spec in
-- docs/update-aug3.md. xp_6 is replaced by xp_5; xp_total already served as the
-- season figure.
--
-- Note that xp_total currently equals xp_8 exactly, because generate-predictions
-- runs an 8-gameweek window. SEASON_HORIZON_NOTE in lib/team-state.ts says so in
-- the UI rather than presenting the same number under a longer-sounding name.
--
-- CREATE OR REPLACE cannot rename an existing view column, so the view is
-- dropped first. Nothing depends on it but the browser client.
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
       round(sum(p.xp), 2)                                             as xp_total
  from public.player_predictions p
  join base b on b.season = p.season and b.model_version = p.model_version
 group by p.season, p.model_version, p.player_id, p.player_code, b.first_event;

grant select on public.player_xp_horizons to anon, authenticated;
