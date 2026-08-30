-- Sprint 29.0 — price-change prediction, step 1: fix the sampling.
--
-- player_ownership_history is gated to roughly once per 20 hours
-- (20260803004948_phase1_player_snapshots.sql), because full-population
-- 2-hourly sampling is ~7.8M rows/season. That gate is a data-accrual
-- clock: every day it stays at 20h is a day of transfer-velocity history
-- that can never be recovered, and FPL's price algorithm keys on velocity,
-- not a daily snapshot. This does not lower the gate for everyone — it adds
-- a bounded watchlist sampled at ~2 hours, keeping the 20h default for the
-- rest of the population.
--
-- A player is on the watchlist when any of:
--   - cost_change_event <> 0 (already mid-move today), or
--   - selected_by_percent above game_settings.price_watch_ownership_threshold
--     (a documented, adjustable input — not hardcoded, same pattern as
--     league_ownership_entry_cap), or
--   - net transfers moved meaningfully in the last event
--     (|transfers_in_event - transfers_out_event| above
--     game_settings.price_watch_net_transfer_threshold).
--
-- Expected growth: bootstrap runs every 30 min (supabase/functions/
-- sync-bootstrap), so the ~2h floor here is enforced by this function, not
-- the caller's cadence. A watchlist of low hundreds of players sampled
-- ~12x/day instead of ~1.2x/day adds on the order of tens of thousands of
-- rows/season, not millions — verify the actual watchlist size after
-- deploying (see docs/sprints/sprint-29.md verification).

insert into public.game_settings (season, key, value)
select season, 'price_watch_ownership_threshold', '5.0'::jsonb
from (select distinct season from public.gameweeks) s
on conflict (season, key) do nothing;

insert into public.game_settings (season, key, value)
select season, 'price_watch_net_transfer_threshold', '20000'::jsonb
from (select distinct season from public.gameweeks) s
on conflict (season, key) do nothing;

create or replace function public.record_player_snapshots(p_season text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prices     integer;
  v_status     integer;
  v_news       integer;
  v_ownership  integer;
  v_watchlist  integer;
  v_own_thresh numeric;
  v_net_thresh numeric;
begin
  select (value #>> '{}')::numeric into v_own_thresh
    from public.game_settings
   where season = p_season and key = 'price_watch_ownership_threshold';
  v_own_thresh := coalesce(v_own_thresh, 5.0);

  select (value #>> '{}')::numeric into v_net_thresh
    from public.game_settings
   where season = p_season and key = 'price_watch_net_transfer_threshold';
  v_net_thresh := coalesce(v_net_thresh, 20000);

  -- Price: insert when now_cost differs from the last recorded price.
  with latest as (
    select distinct on (player_code) player_code, price
      from public.player_price_history
     where season = p_season
     order by player_code, observed_at desc
  ), ins as (
    insert into public.player_price_history (season, player_code, price, cost_change_event)
    select p.season, p.code, p.now_cost, p.cost_change_event
      from public.players p
      left join latest l on l.player_code = p.code
     where p.season = p_season
       and p.now_cost is not null
       and (l.player_code is null or l.price is distinct from p.now_cost)
    returning 1
  )
  select count(*) into v_prices from ins;

  -- Availability: status or either chance-of-playing figure changing.
  with latest as (
    select distinct on (player_code)
           player_code, status, chance_of_playing_this_round, chance_of_playing_next_round
      from public.player_status_history
     where season = p_season
     order by player_code, observed_at desc
  ), ins as (
    insert into public.player_status_history
      (season, player_code, status, chance_of_playing_this_round, chance_of_playing_next_round)
    select p.season, p.code, p.status,
           p.chance_of_playing_this_round, p.chance_of_playing_next_round
      from public.players p
      left join latest l on l.player_code = p.code
     where p.season = p_season
       and (l.player_code is null
            or l.status is distinct from p.status
            or l.chance_of_playing_this_round is distinct from p.chance_of_playing_this_round
            or l.chance_of_playing_next_round is distinct from p.chance_of_playing_next_round)
    returning 1
  )
  select count(*) into v_status from ins;

  -- News: only when the text itself changes. Players with no news are skipped
  -- entirely unless they previously had some (i.e. an injury clearing).
  with latest as (
    select distinct on (player_code) player_code, news
      from public.player_news
     where season = p_season
     order by player_code, observed_at desc
  ), ins as (
    insert into public.player_news (season, player_code, news, news_added)
    select p.season, p.code, p.news, p.news_added
      from public.players p
      left join latest l on l.player_code = p.code
     where p.season = p_season
       and (   (l.player_code is null and p.news is not null)
            or (l.player_code is not null and l.news is distinct from p.news))
    returning 1
  )
  select count(*) into v_news from ins;

  -- Ownership: daily by default, ~2h for a bounded watchlist (Sprint 29.0).
  -- Single pass, single transaction — the watchlist condition is an extra
  -- `or` branch on the existing time gate, not a second insert.
  with latest as (
    select distinct on (player_code) player_code, observed_at
      from public.player_ownership_history
     where season = p_season
     order by player_code, observed_at desc
  ), watchlist as (
    select p.code as player_code
      from public.players p
     where p.season = p_season
       and (
            coalesce(p.cost_change_event, 0) <> 0
         or coalesce(p.selected_by_percent, 0) >= v_own_thresh
         or abs(coalesce(p.transfers_in_event, 0) - coalesce(p.transfers_out_event, 0)) >= v_net_thresh
       )
  ), ins as (
    insert into public.player_ownership_history
      (season, player_code, selected_by_percent, transfers_in_event, transfers_out_event)
    select p.season, p.code, p.selected_by_percent,
           p.transfers_in_event, p.transfers_out_event
      from public.players p
      left join latest l on l.player_code = p.code
      left join watchlist w on w.player_code = p.code
     where p.season = p_season
       and (
            l.player_code is null
         or (w.player_code is not null and l.observed_at < now() - interval '2 hours')
         or (w.player_code is null and l.observed_at < now() - interval '20 hours')
       )
    returning 1
  )
  select count(*) into v_ownership from ins;

  select count(*) into v_watchlist from public.players p
   where p.season = p_season
     and (
          coalesce(p.cost_change_event, 0) <> 0
       or coalesce(p.selected_by_percent, 0) >= v_own_thresh
       or abs(coalesce(p.transfers_in_event, 0) - coalesce(p.transfers_out_event, 0)) >= v_net_thresh
     );

  return jsonb_build_object(
    'price_history',       v_prices,
    'status_history',      v_status,
    'news',                v_news,
    'ownership_history',   v_ownership,
    'price_watchlist_size', v_watchlist
  );
end;
$$;
