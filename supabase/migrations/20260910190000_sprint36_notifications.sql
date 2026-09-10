-- Sprint 36 (DSI-65) — notifications and the Telegram bot.
--
-- Three tables, no cron and no Vault secret. Both of those come later and
-- deliberately: scheduling `notify` before the function exists points cron at
-- a 404 it will retry forever, and the bot token cannot exist until the owner
-- has talked to BotFather. See docs/sprints/sprint-36.md §3 for the ordered
-- deploy; the ordering is Sprint 32's lesson and it is not advisory.
--
-- All three are owner-scoped in the Sprint 14 shape — `auth.uid() = user_id`
-- in both directions, no anon access at all. Not the older public-read/
-- service-write shape used by the ingestion tables: these rows say which
-- alerts a named person receives and which chat can ask about their squad,
-- which is the opposite of public data.

-- ------------------------------------------------- user_notification_prefs
--
-- One row per user. `telegram_chat_id` is doing double duty and it is worth
-- being explicit about the second job: it is the outbound address *and* the
-- inbound allowlist. `telegram-webhook` resolves an incoming chat id against
-- this column and answers nothing at all when it misses — anyone can message
-- a public bot, so this column is the access boundary for a stranger asking
-- about someone else's squad.
--
-- Hence the unique index. Two users claiming one chat id would make that
-- resolution ambiguous, and "ambiguous" on an access boundary means the wrong
-- squad gets sent to someone.

create table public.user_notification_prefs (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  telegram_chat_id  bigint,
  -- Per-kind switches. Off by default for everything: a notifier that starts
  -- sending the moment a chat is linked is a notifier people mute.
  notify_deadline   boolean not null default false,
  notify_status     boolean not null default false,
  notify_news       boolean not null default false,
  notify_price      boolean not null default false,
  notify_fixture    boolean not null default false,
  -- How long before a deadline the reminder fires. An input, not a constant:
  -- there is no defensible universal answer and the app has no evidence for
  -- one (CLAUDE.md — when a term cannot be dropped, make it an input).
  deadline_hours_before integer not null default 4,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index user_notification_prefs_chat_idx
  on public.user_notification_prefs (telegram_chat_id)
  where telegram_chat_id is not null;

create trigger user_notification_prefs_set_updated_at
  before update on public.user_notification_prefs
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ notification_outbox
--
-- Detection and delivery are separate rows-in-a-table apart, not two halves of
-- one function call, so a send that fails is a row that can be retried rather
-- than an alert that silently never happened.
--
-- `dedupe_key` is the whole feature. `change_feed` is a view with no id, so
-- the key is composed from the fact itself — `status:<player_code>:<observed_at>`,
-- `deadline:<event>` — and made unique per user. The unique index is the
-- dedupe: detection can run as often as it likes and re-inserting a known fact
-- is a no-op.
--
-- A timestamp watermark was the obvious alternative and was rejected. It loses
-- rows to clock skew and to a source whose `observed_at` lands behind a
-- watermark already advanced past it, and a *lost* injury alert is a worse
-- failure than a duplicated one.

create table public.notification_outbox (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('deadline', 'status', 'news', 'price', 'fixture')),
  dedupe_key  text not null,
  -- Rendered at detection time, not at send time: the message should describe
  -- the world when the fact was observed, not the world whenever delivery
  -- happened to succeed.
  body        text not null,
  payload     jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text,
  attempts    integer not null default 0
);

create unique index notification_outbox_dedupe_idx
  on public.notification_outbox (user_id, dedupe_key);

-- The send pass's own query: unsent rows, oldest first.
create index notification_outbox_unsent_idx
  on public.notification_outbox (created_at)
  where sent_at is null;

-- -------------------------------------------------------- telegram_link_codes
--
-- A chat id is not knowable until the chat has said something, so the link is
-- established from the chat's side: the app mints a code, the owner sends
-- `/link <code>` to the bot, and the webhook resolves it.
--
-- The alternative — asking the owner to find their numeric chat id via some
-- third-party bot and paste it into a form — makes the user do the protocol's
-- work and is the kind of instruction that gets a stranger's chat id pasted in
-- by accident.
--
-- Short-lived and single-use. `used_at` rather than a delete so a second
-- attempt with a burnt code can say "already used" instead of the same
-- "unknown code" a typo gets.

create table public.telegram_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index telegram_link_codes_user_idx on public.telegram_link_codes (user_id, created_at desc);

-- ------------------------------------------------------------------- RLS

alter table public.user_notification_prefs enable row level security;
alter table public.notification_outbox     enable row level security;
alter table public.telegram_link_codes     enable row level security;

create policy "Select own" on public.user_notification_prefs
  for select to authenticated using (auth.uid() = user_id);
create policy "Insert own" on public.user_notification_prefs
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own" on public.user_notification_prefs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own" on public.user_notification_prefs
  for delete to authenticated using (auth.uid() = user_id);

-- Read-only to its owner. Nothing in the browser writes an outbox row: they
-- are produced by detection and consumed by delivery, both inside `notify`
-- under the service role. A user can see what was sent to them and nothing
-- else.
create policy "Select own" on public.notification_outbox
  for select to authenticated using (auth.uid() = user_id);

-- Insert-own only. The webhook reads and burns codes under the service role;
-- a user may mint their own and may not read anyone else's, so a code cannot
-- be harvested from the client by someone who guesses a user id.
create policy "Select own" on public.telegram_link_codes
  for select to authenticated using (auth.uid() = user_id);
create policy "Insert own" on public.telegram_link_codes
  for insert to authenticated with check (auth.uid() = user_id);

-- ---------------------------------------------------------- notify settings
--
-- The delivery batch size, as a `game_settings` row rather than a constant in
-- the function, matching how `sync_rate_limit` is held. Telegram's own limit
-- is roughly 30 messages/second overall; this is well under it and exists to
-- bound one invocation's work, not to approach that ceiling.

insert into public.game_settings (season, key, value)
select season, 'notify_batch', '{"max_sends": 25, "lookback_minutes": 180}'::jsonb
from (select distinct season from public.gameweeks) s
on conflict (season, key) do nothing;

-- ------------------------------------------------- reaching the bot's secrets
--
-- Both functions need something out of Vault, and neither can read it directly:
-- PostgREST serves only the schemas it is configured to expose (`public`,
-- `graphql_public`), and `vault` is not among them, so `db.schema("vault")`
-- fails at the API layer whatever the service role's privileges say. This was
-- established in Sprint 32 rather than being re-derived here
-- (20260905120100_sprint32_invoke_sync_cron_secret.sql).
--
-- Two accessors, deliberately different shapes, because the two secrets are
-- needed for different things:
--
--   * The bot token is used to *call* Telegram, so the function genuinely needs
--     the value. `telegram_secret` returns it — and is therefore restricted to
--     an allowlist of names, so it is an accessor for this one secret rather
--     than a general-purpose Vault reader reachable over the API.
--   * The webhook secret is only ever *compared*, so the value never needs to
--     leave Postgres. `verify_telegram_webhook_secret` asks a yes/no question
--     and gets a yes/no answer, exactly as `verify_cron_secret` does.

create or replace function public.telegram_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  -- An allowlist, not a convenience check. Without it this is
  -- "read any Vault secret by name", exposed to whatever can execute it.
  if p_name not in ('telegram_bot_token') then
    raise exception 'telegram_secret: % is not a permitted secret name', p_name;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = p_name;

  return v_secret;
end;
$$;

revoke all on function public.telegram_secret(text) from public, anon, authenticated;
grant execute on function public.telegram_secret(text) to service_role;

create or replace function public.verify_telegram_webhook_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_secret is null or length(p_secret) = 0 then
    return false;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'telegram_webhook_secret';

  if v_secret is null then
    return false;
  end if;

  -- Digests, not the raw values: `=` on text short-circuits at the first
  -- differing byte, which leaks the length of a correct prefix to anyone
  -- willing to measure. Two sha256 digests differ from byte 0 for any wrong
  -- input. Same reasoning as verify_cron_secret.
  return extensions.digest(v_secret, 'sha256') = extensions.digest(p_secret, 'sha256');
end;
$$;

revoke all on function public.verify_telegram_webhook_secret(text) from public, anon, authenticated;
grant execute on function public.verify_telegram_webhook_secret(text) to service_role;
