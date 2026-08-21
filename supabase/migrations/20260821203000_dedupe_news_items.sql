-- Cleans up the news_items rows written before sync-news normalised guids.
--
-- BBC's <guid> is the article URL with a #fragment that changes with the
-- item's position in the feed (#17, #4, #5...), so every refetch inserted a
-- new row under the (source_id, guid) unique constraint — 150 of 316 rows
-- were duplicates by the time this was found (verified 2026-08-21). Fixed
-- going forward by _shared/rss.ts's normaliseGuid (strips #fragment and
-- BBC's own at_medium/at_campaign tracking params — nothing else, since
-- FantasyFootballScout's guid uses a real, identifying `?p=<id>` query
-- param that must NOT be stripped). This migration applies that same
-- normalisation retroactively: for each (source_id, normalised guid) group,
-- keeps the earliest row and deletes the rest — news_item_entities cascades
-- on delete, so no separate re-pointing step is needed, each surviving
-- row's own entity links already exist from its own independent
-- resolution. Verified in a rolled-back transaction first: 316 -> 166 rows,
-- zero orphaned news_item_entities, zero remaining duplicate (source_id,
-- guid) groups.

with norm as (
  select id, source_id, fetched_at,
    case when guid ~ '^https?://' then
      regexp_replace(
        regexp_replace(
          regexp_replace(split_part(guid, '#', 1), '([?&])at_medium=[^&]*&?', '\1', 'g'),
          '([?&])at_campaign=[^&]*&?', '\1', 'g'
        ),
        '[?&]$', ''
      )
    else guid end as norm_guid
  from public.news_items
),
ranked as (
  select id, source_id, norm_guid,
    row_number() over (partition by source_id, norm_guid order by fetched_at asc, id asc) as rn
  from norm
)
delete from public.news_items
where id in (select id from ranked where rn > 1);

-- Normalise the survivors' guid too, so a future refetch's normalised guid
-- (produced by the now-fixed sync-news) upserts onto them directly instead
-- of creating one more near-duplicate.
with norm as (
  select id,
    case when guid ~ '^https?://' then
      regexp_replace(
        regexp_replace(
          regexp_replace(split_part(guid, '#', 1), '([?&])at_medium=[^&]*&?', '\1', 'g'),
          '([?&])at_campaign=[^&]*&?', '\1', 'g'
        ),
        '[?&]$', ''
      )
    else guid end as norm_guid
  from public.news_items
)
update public.news_items ni
set guid = norm.norm_guid
from norm
where ni.id = norm.id and ni.guid <> norm.norm_guid;
