-- Hidden Gems engine (Sprint 15.5): per-90 rate profile, read-only view.
--
-- Not new columns on `players` — `xp-model.ts` (Deno, excluded from tsconfig)
-- already derives xg90/xa90/dc90 for the projection and writes them into
-- `player_predictions.rates`. A second, independently-computed copy on
-- `players` would be a second implementation of the same numbers, which is
-- exactly what CLAUDE.md's "one quantity, one implementation" forbids. This
-- view recomputes the same recency-weighted per-90 shape from
-- `player_season_history` for read-side discovery (percentile filters), kept
-- deliberately close to `deriveRates` in `supabase/functions/_shared/
-- xp-model.ts` so the two never drift into disagreeing about what "dc90"
-- means. It is not consumed by `generate-predictions` and does not touch
-- `player_predictions` or bump `MODEL_VERSION`.
--
-- Mirrors `deriveRates`: the three most recent seasons with any minutes,
-- weighted 0.6 / 0.3 / 0.1 (MODEL_PARAMS.seasonWeights), most recent first.
--
-- `dc90` uses its own eligible-minutes denominator, restricted to seasons
-- where anyone in the table recorded a real (non-zero-because-untracked)
-- `defensive_contribution` — see `deriveDcEligibleSeasons`. FPL only tracks
-- the stat from 2024/25; blending earlier seasons in halves the rate.
--
-- `cbit90` / `cbirt90` (the position-correct defensive-action split the
-- aggregate `dc90` cannot give — see XDC_MODEL_NOTE in lib/scoring.ts) come
-- only from the single most recent season, and only when it is the season
-- the API populated `clearances_blocks_interceptions` / `tackles` /
-- `recoveries` for (2025/26 at time of writing, confirmed empty for
-- 2024/25 and earlier). Null rather than zero when that data isn't there —
-- a zero would read as "no defensive actions", not "not tracked yet".
drop view if exists public.player_rate_profile;

create view public.player_rate_profile
with (security_invoker = true) as
with latest_season as (
  select max(season_name) as season_name from public.player_season_history
),
dc_eligible as (
  select distinct season_name
    from public.player_season_history
   where coalesce(defensive_contribution, 0) > 0
),
ranked as (
  select
    h.player_code,
    h.season_name,
    coalesce(h.minutes, 0)                        as minutes,
    coalesce(h.expected_goals, 0)                 as expected_goals,
    coalesce(h.expected_assists, 0)                as expected_assists,
    coalesce(h.defensive_contribution, 0)          as defensive_contribution,
    h.clearances_blocks_interceptions,
    h.tackles,
    h.recoveries,
    row_number() over (partition by h.player_code order by h.season_name desc) as season_rank
    from public.player_season_history h
   where coalesce(h.minutes, 0) > 0
),
weighted as (
  select
    r.player_code,
    r.minutes,
    case r.season_rank when 1 then 0.6 when 2 then 0.3 when 3 then 0.1 else 0 end as w,
    r.expected_goals,
    r.expected_assists,
    r.defensive_contribution,
    (r.season_name in (select season_name from dc_eligible)) as is_dc_eligible
    from ranked r
   where r.season_rank <= 3
),
agg as (
  select
    player_code,
    sum(w * minutes)                                     as w_minutes,
    sum(w * expected_goals)                               as w_xg,
    sum(w * expected_assists)                              as w_xa,
    sum(w * minutes) filter (where is_dc_eligible)         as dc_minutes,
    sum(w * defensive_contribution) filter (where is_dc_eligible) as dc_total
    from weighted
   group by player_code
),
latest as (
  select
    r.player_code,
    r.minutes                          as latest_minutes,
    r.clearances_blocks_interceptions,
    r.tackles,
    r.recoveries
    from ranked r
    join latest_season ls on ls.season_name = r.season_name
   where r.season_rank = 1
)
select
  a.player_code,
  round(a.w_minutes, 1)                                                   as observed_minutes,
  round(case when a.w_minutes > 0 then (a.w_xg / a.w_minutes) * 90 else 0 end, 3)          as xg90,
  round(case when a.w_minutes > 0 then (a.w_xa / a.w_minutes) * 90 else 0 end, 3)          as xa90,
  round(case when a.w_minutes > 0 then ((a.w_xg + a.w_xa) / a.w_minutes) * 90 else 0 end, 3) as xgi90,
  round(case when coalesce(a.dc_minutes, 0) > 0 then (a.dc_total / a.dc_minutes) * 90 else 0 end, 2) as dc90,
  case
    when l.latest_minutes > 0
     and l.clearances_blocks_interceptions is not null
     and l.tackles is not null
    then round(((l.clearances_blocks_interceptions + l.tackles) / l.latest_minutes::numeric) * 90, 2)
    else null
  end as cbit90,
  case
    when l.latest_minutes > 0
     and l.clearances_blocks_interceptions is not null
     and l.tackles is not null
     and l.recoveries is not null
    then round(((l.clearances_blocks_interceptions + l.tackles + l.recoveries) / l.latest_minutes::numeric) * 90, 2)
    else null
  end as cbirt90
  from agg a
  left join latest l on l.player_code = a.player_code;

grant select on public.player_rate_profile to anon, authenticated;
