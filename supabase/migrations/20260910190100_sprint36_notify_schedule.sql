-- Sprint 36 (DSI-65) — the cron schedule for `notify`.
--
-- ============================ DEPLOYMENT ORDER ============================
-- APPLY THIS LAST. It is deliberately a separate migration from
-- 20260910190000_sprint36_notifications.sql, which creates the tables and can
-- be applied at any time.
--
--   1. Owner creates the bot with BotFather and generates a webhook secret.
--   2. Both go into Vault as `telegram_bot_token` and `telegram_webhook_secret`.
--   3. Deploy the `notify` and `telegram-webhook` functions.
--   4. Point Telegram at the webhook with setWebhook (secret_token = the one
--      from step 2).
--   5. Apply THIS migration, which starts the clock.
--
-- Applying this before step 3 points pg_cron at a function that does not exist
-- yet. That is not harmless: it produces a `sync_runs` gap and a stream of
-- failed net.http_post requests nobody is watching — the same silent failure
-- mode Sprint 32 documented when it insisted the cron secret be in place
-- before the functions that check it.
-- ==========================================================================
--
-- Every 15 minutes. The cadence is set by the slowest thing that matters, not
-- the fastest: the deadline reminder has an hours-wide window, price changes
-- land once a day, and status/news arrive whenever `sync-news` and
-- `sync-bootstrap` write them. Running this every two minutes like
-- `sync-live-gameweek` would buy nothing and spend invocations.
--
-- Detection is idempotent (the outbox's unique dedupe key), so a run that
-- overlaps the previous one's window re-detects the same facts and writes
-- nothing. That is what makes a generous `lookback_minutes` safe.

select cron.schedule(
  'notify-every-15-min',
  '*/15 * * * *',
  $$select public.invoke_sync('notify')$$
);
