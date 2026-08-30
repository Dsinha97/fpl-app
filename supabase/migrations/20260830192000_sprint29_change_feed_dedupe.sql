-- Sprint 29.5 — collapse the status+news duplicate, and stop treating a
-- player's first-ever news row as a "change".
--
-- record_player_snapshots writes player_status_history and player_news in
-- one transaction (20260803004948_phase1_player_snapshots.sql), so an FPL
-- update that changes both status/chance_of_playing_next_round AND the news
-- text lands on the identical observed_at in both tables. The view then
-- emitted two rows — kind='status' and kind='news' — for one real-world
-- event, and neither /news nor /deadline collapsed them (the /news url-dedup
-- only catches the separate RSS-triplication problem). Separately, the news
-- branch had no rn > 1 guard, so a player's very first news row (news going
-- from null to non-null with no prior row to compare against) was reported
-- as a change even though nothing changed from the feed's point of view.
--
-- Fix: add the rn > 1 guard to news (mirroring status), then merge a status
-- event and a news event sharing (season, player_code, observed_at) into one
-- row — kind stays 'status' (the structured fact), and the news sentence is
-- folded into detail as news_old/news_new so nothing is lost. A news event
-- with no co-timestamped status event still emits its own kind='news' row.
-- Price events are untouched — a co-timestamped price move is a genuinely
-- separate fact, not a restatement of the same update.

create or replace view public.change_feed
with (security_invoker = true) as
with price_events as (
  select h.season, h.observed_at, h.player_code,
         lag(h.price) over w as old_price,
         h.price as new_price
    from public.player_price_history h
  window w as (partition by h.season, h.player_code order by h.observed_at)
),
status_raw as (
  select h.season, h.observed_at, h.player_code,
         lag(h.status) over w as old_status,
         h.status as new_status,
         lag(h.chance_of_playing_next_round) over w as old_chance,
         h.chance_of_playing_next_round as new_chance,
         row_number() over w as rn
    from public.player_status_history h
  window w as (partition by h.season, h.player_code order by h.observed_at)
),
status_filtered as (
  select season, observed_at, player_code, old_status, new_status, old_chance, new_chance
    from status_raw
   where rn > 1
),
-- Every news row is an event by construction (rows are only written when the
-- text changes), except the very first row for a player: news going from
-- "no history yet" to a value on day one isn't a change to report.
news_raw as (
  select h.season, h.observed_at, h.player_code,
         lag(h.news) over w as old_news,
         h.news as new_news,
         row_number() over w as rn
    from public.player_news h
  window w as (partition by h.season, h.player_code order by h.observed_at)
),
news_filtered as (
  select season, observed_at, player_code, old_news, new_news
    from news_raw
   where rn > 1
),
-- One row per (season, player_code, observed_at): a status change with an
-- optional co-timestamped news change folded in, or a news-only change.
status_or_news as (
  select
    coalesce(s.season, n.season) as season,
    coalesce(s.observed_at, n.observed_at) as observed_at,
    coalesce(s.player_code, n.player_code) as player_code,
    case
      when s.player_code is not null then 'status'
      else 'news'
    end as kind,
    case
      when s.player_code is not null then
        jsonb_build_object(
          'old_status', s.old_status, 'new_status', s.new_status,
          'old_chance', s.old_chance, 'new_chance', s.new_chance
        ) || case
               when n.player_code is not null
                 then jsonb_build_object('news_old', n.old_news, 'news_new', n.new_news)
               else '{}'::jsonb
             end
      else jsonb_build_object('old', n.old_news, 'new', n.new_news)
    end as detail
  from status_filtered s
  full outer join news_filtered n
    on n.season = s.season and n.player_code = s.player_code and n.observed_at = s.observed_at
),
player_events as (
  select season, observed_at, player_code,
         case when new_price > old_price then 'price_rise' else 'price_fall' end as kind,
         jsonb_build_object('old', old_price, 'new', new_price) as detail
    from price_events
   where old_price is not null and old_price <> new_price

  union all

  select season, observed_at, player_code, kind, detail
    from status_or_news
)
select e.season,
       e.kind,
       e.observed_at,
       e.player_code,
       p.web_name,
       p.element_type,
       t.short_name as team_short,
       e.detail
  from player_events e
  left join public.players p on p.season = e.season and p.code = e.player_code
  left join public.teams   t on t.season = e.season and t.id = p.team_id

union all

select fc.season,
       'fixture' as kind,
       fc.observed_at,
       null::integer as player_code,
       null::text as web_name,
       null::integer as element_type,
       null::text as team_short,
       jsonb_build_object(
         'field', fc.field, 'old', fc.old_value, 'new', fc.new_value,
         'home', th.short_name, 'away', ta.short_name, 'event', f.event
       ) as detail
  from public.fixture_changes fc
  left join public.fixtures f  on f.season = fc.season and f.id = fc.fixture_id
  left join public.teams th on th.season = f.season and th.id = f.team_h
  left join public.teams ta on ta.season = f.season and ta.id = f.team_a;

grant select on public.change_feed to anon, authenticated;
