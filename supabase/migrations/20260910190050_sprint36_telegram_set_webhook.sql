-- Sprint 36 (DSI-65) — point Telegram at the webhook, from inside Postgres.
--
-- Applied 2026-09-10, between the function deploy and the cron schedule.
--
-- `setWebhook` needs both secrets in one call: the bot token in the URL, and
-- the webhook secret as `secret_token`. Doing that from a shell puts both
-- values in a terminal history for no gain. Doing it here means neither ever
-- leaves the database — the same reasoning `invoke_sync` uses for the cron
-- secret, and the reason the webhook secret was generated inside Postgres in
-- the first place (`encode(extensions.gen_random_bytes(32), 'hex')` straight
-- into `vault.create_secret`, so nobody has ever seen its value).
--
-- Idempotent: calling it again re-registers the same URL.

create or replace function public.telegram_set_webhook()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token   text;
  v_secret  text;
  v_request bigint;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'telegram_webhook_secret';

  -- Loud, and refuses to call. Registering a webhook without a secret token
  -- would leave the endpoint authenticated by nothing at all.
  if v_token is null then
    raise exception 'vault secret "telegram_bot_token" is not set';
  end if;
  if v_secret is null then
    raise exception 'vault secret "telegram_webhook_secret" is not set';
  end if;

  select net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/setWebhook',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'url', 'https://fyxyqxpscmqjyjxsyhms.supabase.co/functions/v1/telegram-webhook',
      'secret_token', v_secret,
      -- Only what the bot actually handles. Telegram then never delivers
      -- anything else, so the function's own ignore-branch is a second line of
      -- defence rather than the only one.
      'allowed_updates', jsonb_build_array('message', 'edited_message'),
      -- Anything queued from before this deploy is not worth replaying.
      'drop_pending_updates', true
    ),
    timeout_milliseconds := 15000
  ) into v_request;

  return v_request;
end;
$$;

revoke all on function public.telegram_set_webhook() from public, anon, authenticated;
