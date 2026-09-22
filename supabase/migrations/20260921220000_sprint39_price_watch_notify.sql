-- Sprint 39 (DSI-181 item 7) — notify when a squad or shortlist player's net
-- transfers cross a price-change threshold.
--
-- Deliberately NOT the fitted, ownership-scaled threshold `lib/price-watch.ts`
-- uses for the on-site reading (FALL_THRESHOLD_BASE/PER_PERCENT,
-- RISE_THRESHOLD_FLAT). `supabase/functions/notify` is Deno and cannot import
-- `lib/`, and its own header states the rule this migration and the function
-- change both follow: "no modelled quantity is ever sent... facts the
-- pipeline already wrote are fair game; anything derived is not, and belongs
-- on the site." A fitted regression threshold is exactly the kind of derived
-- reading that belongs on the site, not in a Telegram message.
--
-- Instead this reuses `price_watch_net_transfer_threshold` — the flat,
-- already-stored value from 20260830191442_sprint29_price_watchlist.sql that
-- decides which players get sampled every ~2h. It was never fitted; it is the
-- one number this schema already treats as a plain, documented input for
-- "worth paying attention to right now" (CLAUDE.md: "when a term cannot be
-- dropped, make it an input"). The notification asks the same class of
-- question the watchlist itself asks, just the crossed/not-crossed version of
-- it, not FPL's real trigger point.

alter table public.user_notification_prefs
  add column notify_price_watch boolean not null default false;

alter table public.notification_outbox
  drop constraint notification_outbox_kind_check;
alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('deadline', 'status', 'news', 'price', 'fixture', 'price_watch'));
