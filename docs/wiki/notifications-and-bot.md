# Notifications and the Telegram bot

One Telegram bot, `@fpl_decision_bot`, doing two independent things: **pushing** alerts the owner
did not ask for (deadlines, injuries, price moves, fixture changes) and **answering** commands the
owner sends it (current team, GW points, next fixtures, league standings). Built, deployed and
verified 2026-09-10 — [sprint-36.md §3](../sprints/sprint-36.md).

Its caller class and auth posture sit with the rest of the function surface in
[edge-function-security.md](edge-function-security.md#class-c--the-telegram-webhook-sprint-36).

## Why a two-way bot, and how that requirement was nearly missed

The Linear issue's **description** said "email / push / Telegram / Discord". Its **comment**, added
the same day the sprint was scoped, said something narrower and larger at once:

> Use telegram as channel. Push notifications along with other on-demand tasks like: View Current
> Team, GW points, Next GW Fixtures, League standings etc.

One channel instead of four, and a two-way bot instead of a notifier. **That requirement existed
only in the comment thread** — reading the description alone would have built the wrong thing. This
is now a standing step in `.claude/skills/start-sprint/SKILL.md`: read every candidate issue's
comments before scoping it, and where a comment and the description disagree, the comment wins.
See [methodology.md](methodology.md#read-the-comments-not-just-the-issue).

## Push out

### The dedupe key is the feature

Signals that already existed and were unused for this: the `change_feed` view, `news_items`,
`fixture_changes`, `lib/price-watch.ts`'s threshold progress, `gameweeks.deadline_time`.

`change_feed` is a **view with no id**, so `notification_outbox`'s key is composed —
`kind:player_code:observed_at`, or `deadline:<event>` — and unique per user. A timestamp watermark
was rejected: it loses rows to clock skew and late-arriving `observed_at` values, and losing an
injury alert silently is worse than sending one twice.

`notify` runs `detect()` and `send()` as two separate passes over the outbox in one invocation.
Detection writes are idempotent by the unique index (`on conflict do nothing` *is* the dedupe), and
a per-row send failure records `error` without blocking the rest of the batch.

**Proved against the real detector, not a mock.** A live run legitimately detected nothing (two
`change_feed` rows in the window, neither in the squad; no fixture changes; a deadline 41h out
against a 4h threshold), so the deadline window was temporarily widened to 48h to give the detector
a real fact, then restored:

| Pass | Result |
|---|---|
| 1 | `detected 1, sent 1, failed 0` — outbox row `deadline:4`, `sent_at` stamped, message delivered |
| 2 | **`detected 0, sent 0`** — still exactly one outbox row |

The second pass re-read the same fact, composed the same key, and the unique index turned the insert
into a no-op. That is the mechanism working, rather than an absence of input — a distinction the
first run could not have made.

### Secrets: neither one was ever handled outside Postgres

The bot token went from BotFather into Vault directly. The webhook secret was **generated inside
Postgres** (`encode(extensions.gen_random_bytes(32),'hex')` straight into `vault.create_secret`), so
nobody has ever seen it — not the owner, not this repo, not a shell history. `setWebhook` is
therefore also a database function, `public.telegram_set_webhook()`, which reads both out of Vault
and makes the call itself; calling it from a terminal would have put both values in a shell history
for no gain.

`telegram_secret(p_name)` carries an **allowlist**, verified: asked for `cron_secret` it refuses.

Deliberately **not** a `TELEGRAM_TOKEN` function env var — that would put the plaintext in a second
place that has to match the first by hand, the same argument
[edge-function-security.md](edge-function-security.md#the-secret-is-never-known-outside-postgres)
makes for the cron secret.

### Deployment order, again

Vault secret → migration → function deploy → verify → *then* the cron schedule. The
`notify` schedule is its own migration carrying that order in its header, because scheduling it
before the function exists points pg_cron at a 404 it retries into a `sync_runs` gap nobody is
watching. See [deployment.md](deployment.md#deployment-ordering-is-not-advisory).

## Ask in — the command bot

`/team`, `/points`, `/fixtures`, `/leagues`, `/link`, `/help`.

### Authorisation is the chat-id allowlist

Anyone can message a public bot, and this bot answers questions about a specific manager's squad. An
unrecognised `chat.id` gets one "not linked" reply and no data read. That is the real access
boundary — the secret token only proves the request came from Telegram.

`allowed_updates` is narrowed to `message`/`edited_message` at registration, so Telegram never
delivers anything else and the function's ignore-branch is a second line of defence rather than the
only one. `drop_pending_updates` was set so nothing queued before the deploy got replayed.

Telegram redelivers a webhook that does not answer quickly or returns non-200, so each handler is a
single query and the function acknowledges with 200 even on a handled error. `getWebhookInfo`
showing `pending_update_count: 0` afterwards is the check that this holds.

### Linking a chat

The chat id is unknowable before the first message, so the app mints a short-lived one-time code
(`telegram_link_codes`), the owner sends it, the webhook resolves it and burns it.
`components/telegram-link.tsx` is mounted **both** on `/team` — beside **Import as draft**, where
the owner actually is — and in `/settings` → Notifications. One component, one minting path, one
link-state read; two copies of "am I linked?" would be the same mistake as two scorers.

`t.me/fpl_decision_bot?start=<code>` opens the chat with the code attached, which arrives as
`/start CODE`. So `/start` had to become a **link attempt rather than a greeting**, handled *before*
the linked-chat check — the entire point is that the chat is not linked yet. The manual
`/link CODE` stays visible beside it, because a deep link fails silently with no Telegram installed
and opens the wrong account for anyone signed into two.

`lib/notifications.ts`'s `saveNotificationPrefs` deliberately **cannot write `telegram_chat_id`** —
only the webhook, having proved possession of the chat, sets it.

### The line the Deno boundary draws

`supabase/functions/**` cannot import `lib/`, so every command handler would otherwise be a second
implementation of a number the app already computes. The line drawn:

- **In scope: reads of already-computed rows.** `/points` from `manager_gameweek_history`, `/team`
  from `manager_picks`/`team_drafts` + `players`, `/fixtures` from `fixtures`, `/leagues` from
  `league_entries`. None of these re-derives anything.
- **Out of scope: anything modelled** — xP, transfer recommendations, chip advice, EO. The bot
  replies with a link into the site. *Adding xP to the bot's `/team` reply is the obvious next
  request, and it is the one that would fork the engine.*

See [methodology.md](methodology.md#one-quantity-one-implementation).

## The output pass, and the judgement calls inside it

The owner ran all four commands, confirmed the numbers, and asked for presentation work. What
changed:

- **A titled header on every message** carrying the team name — `⚽ Your Team — DS United (FPL)`.
- **Club and position emoji**, in `_shared/telegram-format.ts` so they have one home. **Nicknames
  rather than kit colours** wherever one exists: Arsenal are the Gunners, Liverpool the Liver bird —
  two red circles are indistinguishable at emoji size. A club with no entry renders with **no emoji
  rather than a wrong one**, and the map needs the same once-a-season promotion update that
  `_shared/entities.ts`'s `CLUB_ALIASES` does.
- **Ranks abbreviated** — `1029798` → `1M`, `63223` → `63.2k`. Below 1,000 the exact number stays,
  because that is the range where it matters: `1 of 5` in a mini-league is the whole point.
- **Leagues split by size, not by `league_type`.** FPL's own `x`/`s` split does not answer the
  question — `x` covers both a two-person league between friends and a 66,000-entry YouTube league,
  and calling the latter "mini" is wrong in the way that matters. The threshold is stated in the
  message rather than hidden in the code.
- **Fixtures grouped by day**, kickoff time only, in UK time.
- **`/points` shows direction only** — 🔼🔽🟰, no magnitude, while `/leagues` keeps the magnitude.
  Deliberate: a mini-league move of two places is a real event, where an overall-rank swing of 100k
  mostly measures the size of the field rather than how the manager played. (Rank is lower-is-better,
  resolved once in the formatter rather than at each call site — the same convention hazard
  [manager-profile.md](manager-profile.md) records.)
- **`/team` reads the current squad, not the last scored one.** `manager_picks` only holds gameweeks
  FPL has already started, so the old command answered a question about last week; the imported
  draft is the only record of the team standing for the upcoming deadline. It is matched against the
  **user's own** drafts and then filtered on entry id, because two accounts can hold a draft for the
  same entry and "any draft claiming this id" is not a question a bot should ask on someone's
  behalf.

### The substitution suggestion, and the line it does not cross

What `/team` reports is **availability**: a starter whose `players.status` is not `a`, and the bench
player FPL's own auto-sub rule would bring on — first in bench order whose arrival still leaves a
legal formation, with formation limits read from `element_types` rather than hardcoded.

It is a deliberate second copy of the rule `projectAutoSubs` owns in `lib/gameweek-state.ts`, for
the same reason `_shared/entities.ts` keeps its own `fold()` — the Deno boundary — and carries the
same keep-in-sync obligation.

It is **not** the xP-optimal XI. That is `optimiseLineup`, it is modelled, and putting it in the bot
would fork the engine. The message says "availability only — who to start on merit is on the site".

## RLS: the row that is actually a security boundary

Twelve checks in a rolled-back transaction, two authenticated users and `anon` — the standing
discipline in [database-and-rls.md](database-and-rls.md#the-rule-this-repo-follows). The one worth
singling out:

**A user repointing their own prefs row at another user's chat id is blocked by a unique index.**
That is not a data-integrity nicety — `telegram_chat_id` is the inbound allowlist, so "two users
claim one chat" is the case where a stranger's `/team` returns someone else's squad. The unique
index makes it unrepresentable, and it is now tested rather than argued.

## What was observed and left open

**The first scheduled run failed.** 19:15:02 — the first time pg_cron drove `notify` rather than a
manual `invoke_sync` — `user_notification_prefs: Gateway Timeout` after 5.2s. Every run before and
after succeeded in ~1–2s. It looks like a transient PostgREST timeout rather than a defect in a
one-row read on a one-row table, and the honest position is one observation and no explanation.
Recorded rather than dismissed: **if it recurs on the :15/:30/:45 boundaries it is a pattern.** It
later turned out to be part of a project-wide cluster — see
[data-pipeline.md](data-pipeline.md#sync-health-what-has-quietly-not-happened).

Note the prefs read is **deliberately fatal**: a run that cannot tell who is subscribed should not
proceed, so this failed loudly rather than silently sending nothing.

Still unverified: `/link` with a **reused** and an **expired** code. The happy path is proven (one
chat linked, one code minted and burned, first attempt); the two refusal paths are not.
