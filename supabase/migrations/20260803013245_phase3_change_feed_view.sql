-- Phase 3: unified change feed.
--
-- The snapshot tables record one row per genuine change (plus one baseline row
-- per player when tracking began). This view turns them into a single ordered
-- feed of events with old/new values, excluding the baselines, so the frontend
-- reads one relation instead of reimplementing window logic in the client.

create or replace view public.change_feed
with (security_invoker = true) as
with price_events as (
  select h.season, h.observed_at, h.player_code,
         lag(h.price) over w as old_price,
         h.price as new_price
    from public.player_price_history h
  window w as (partition by h.season, h.player_code order by h.observed_at)
),
status_events as (
  select h.season, h.observed_at, h.player_code,
         lag(h.status) over w as old_status,
         h.status as new_status,
         lag(h.chance_of_playing_next_round) over w as old_chance,
         h.chance_of_playing_next_round as new_chance,
         row_number() over w as rn
    from public.player_status_history h
  window w as (partition by h.season, h.player_code order by h.observed_at)
),
-- Every news row is an event by construction: rows are only written when the
-- text changes, and the first row only when news is non-null.
news_events as (
  select h.season, h.observed_at, h.player_code,
         lag(h.news) over w as old_news,
         h.news as new_news
    from public.player_news h
  window w as (partition by h.season, h.player_code order by h.observed_at)
),
player_events as (
  select season, observed_at, player_code,
         case when new_price > old_price then 'price_rise' else 'price_fall' end as kind,
         jsonb_build_object('old', old_price, 'new', new_price) as detail
    from price_events
   where old_price is not null and old_price <> new_price

  union all

  select season, observed_at, player_code,
         'status' as kind,
         jsonb_build_object(
           'old_status', old_status, 'new_status', new_status,
           'old_chance', old_chance, 'new_chance', new_chance
         ) as detail
    from status_events
   where rn > 1

  union all

  select season, observed_at, player_code,
         'news' as kind,
         jsonb_build_object('old', old_news, 'new', new_news) as detail
    from news_events
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
