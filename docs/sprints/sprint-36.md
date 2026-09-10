# Sprint 36 — Historical decision analytics, a two-way Telegram bot, and the Todo sweep

**Started 2026-09-10.** Linear issue [DSI-74](https://linear.app/dsinha-org/issue/DSI-74).
Scoped from the Linear Todo column — six issues the owner promoted out of Backlog on 2026-09-10,
which under this project's own ground rule outranks any "Next up" line in `roadmap.md`. The sprint
clears all six.

Status: **Phases 1-3 built (3 awaiting an owner deploy); phase 4 not started.** Nothing below is a claim about a result until
its section says so.

| Phase | Issue | Item |
|---|---|---|
| 1 | [DSI-66](https://linear.app/dsinha-org/issue/DSI-66) | Historical decision analytics |
| 2 | [DSI-61](https://linear.app/dsinha-org/issue/DSI-61) | Rivals from a league's standings |
| 3 | [DSI-65](https://linear.app/dsinha-org/issue/DSI-65) | Telegram, both directions |
| 4 | [DSI-60](https://linear.app/dsinha-org/issue/DSI-60), [DSI-58](https://linear.app/dsinha-org/issue/DSI-58), [DSI-59](https://linear.app/dsinha-org/issue/DSI-59) | Console and decision items |

The phases are ordered so any prefix is shippable. If the sprint is cut short, cut it at a phase
boundary and move the unstarted issues back to Todo rather than shrinking a phase.

## 0. Where the scope came from, and a note on issue comments

DSI-65's Linear description says "email / push / Telegram / Discord". Its **comment**, added
2026-09-10, says something narrower and larger at once:

> Use telegram as channel. Push notifications along with other on-demand tasks like: View Current
> Team, GW points, Next GW Fixtures, League standings etc.

One channel instead of four, and a **two-way bot** instead of a notifier. That requirement exists
only in the comment thread; reading the description alone would have built the wrong thing. Hence a
standing step, now encoded in `.claude/skills/start-sprint/SKILL.md`: **read every candidate issue's
comments before scoping it, and where a comment and the description disagree, the comment wins.**

## 1. DSI-66 — historical decision analytics — **built 2026-09-10**

`lib/decision-analytics.ts`, `components/decision-analytics-panel.tsx`, mounted on `/team` above
the "This Season" table. Typecheck, lint (0 errors) and build all pass.

Four descriptive analytics over decisions already made, scored against results already in the
database. No new model, no new gate, **no migration**: `manager_gameweek_history`,
`manager_transfers` and `manager_chips` are all already populated — the last of these has had **no
reader anywhere in `lib/`, `components/` or `app/`** since it was created, and this is its first.

New module `lib/decision-analytics.ts` owns all four plus a `DECISION_ANALYTICS_NOTE`, following the
`lib/prediction-accuracy.ts` + `components/accuracy-scoreboard.tsx` precedent.

**One season-wide load, not one per event.** Looping `loadGameweekState` over 38 events is 3 queries
each, ~114 round trips. Instead: `loadManagerPicks` once (whole season, already paged), plus a
season-wide `Map<event, Map<playerId, points>>` in the shape `loadScenarioActuals` already returns,
plus `loadGwHistory` over all finished events, plus `loadTransfers`, plus `manager_chips`.

- **Captain success.** `lib/gameweek-review.ts` already computed best-available-captain for one
  event. That computation **moved** into this module and `loadGameweekReview` calls it — one
  quantity, one implementation. The benchmark is the best raw scorer among the eleven who started;
  the season figure is the **effective** points gap, with the hit rate as its own named term. It
  remains hindsight, and says so. See "One correction to the scope" below for what changed and what
  deliberately did not.
- **Transfer success.** Per `manager_transfers` row: what came in, what went out, over the horizon
  the transfer was made for. **The horizon is a user input, not an invented constant** — the
  database records no intended horizon, so it is a documented page-level control over `HORIZONS`,
  never an estimate. Terms stay separate (`+X in − Y out − Z hit`), never a bare net. A transfer
  whose horizon runs past the last scored gameweek reports as *in progress, N of M scored*.
- **Chip ROI.** Bench Boost and Triple Captain have exact counterfactuals from actual data (the
  bench's points; the captain's third helping). **Free Hit and Wildcard have none** — the squad that
  would otherwise have played is not recorded anywhere — so they render as *not scored, and why*,
  rather than as a reconstructed number. The forward xP helpers (`benchBoostAt`, `tripleCaptainAt`)
  are deliberately not reused: a forward valuation is a different quantity from a retrospective
  actual.
- **Rank progression.** Straight from `manager_gameweek_history`. The only real hazard is the
  direction convention — `percentile_rank` is FPL's lower-is-better "top X%", `percentileScore`
  flips it, and `buildManagerProfile` un-flips again for `rankTier`. One convention per screen,
  labelled, asserted in the note.

Surface: `components/decision-analytics-panel.tsx` on `/team`, season-scoped, anchored to the
existing "This Season" table rather than duplicating it. The rank section is a **chart**, not a
fourth copy of that table's Overall Rank column, with the y axis inverted so a rising line means an
improving rank — the inversion is the reason a picture earns its place here at all.

### One correction to the scope, made during the build

The plan said to widen the captain benchmark from the eleven who started to the fifteen owned, on
the reasoning that a bench player can be captained. **That reasoning is wrong on FPL's own
mechanics**, and the change was not made: an armband on a benched player earns nothing unless FPL
substitutes them on, so scoring the captain against the bench would blame the armband for a
*starting* decision. The benchmark stays the starting XI and `DECISION_ANALYTICS_NOTE` says so
explicitly, which is a stronger statement than the silent narrow definition it replaces.

Two things did change with the move, both real:

- The gap is now reported as **effective** points — `(best − effective) × (multiplier − 1)`, not
  the raw difference. One copy of every starter's score is already in the XI total and the armband
  only adds the extras, so under a Triple Captain the same raw gap costs twice as much. The old
  raw figure hid that.
- `components/gameweek-review-panel.tsx` had `× 2` hardcoded in three places. It now reads the
  pick's own multiplier, so a Triple Captain gameweek no longer renders as a double.

### Verified against live data before the UI existed

A throwaway `npx tsx` harness (not committed) ran the module against entry 274486, and three
independent anchors agreed:

| Check | Module | FPL's own row |
|---|---|---|
| GW3 total (XI 34 + Haaland 9 × 3) | 52 | `points` = 52 |
| GW3 bench | 18 | `points_on_bench` = 18 |
| GW3 Triple Captain ROI (the third helping) | +9 | — |

The season table's GW3 captain row also came back byte-identical to a direct `captainChoiceAt`
call — the proof that moving the computation did not leave a second scorer behind.

Browser-verified on `/team` at 1280 and 375 wide, light and dark: no horizontal overflow, cards
`self-start` so an expanded one does not inflate its row-mate, and the arc's stroke resolves
through `var(--primary)` to the brand green in dark and the deep purple in light rather than a
hardcoded hex.

## 2. DSI-61 — rivals from a league's standings — **built 2026-09-10**

`app/team/page.tsx` (an "Add from a league…" control beside the manual add). Typecheck, lint
(0 errors) and build pass; the data half is verified against live rows, the signed-in interaction
is pending an owner sign-in (see below).


Both halves already exist: `loadLeagueStandings` returns rank-ordered entry ids, and `/team`'s rival
pipeline consumes entry ids. **The cost is the syncs, not the join** — each rival must exist in
`managers` first, one `sync-manager` call each, and `sync-manager` carries Sprint 32's `verifyUser`
plus a per-user rate limit. So the batch is capped and sequential, progress is visible, and a 429 is
a first-class outcome that names which rivals did land. The rate limit is not raised to make this
fit.

### What the live data actually looks like

A throwaway harness (not committed) ran the real loader over entry 274486's 13 leagues:

- **8 of 13 have zero stored standings**, including `Overall` (314) — so "this league has never
  been synced" is the *common* case, not an edge one. It gets its own message naming the fix
  ("sync it once on Leagues") rather than an empty list that reads as "no rivals available".
- Self-exclusion works where it matters: the owner is rank 1 in two of their leagues and rank
  1086 in another, and is filtered out of all three.
- Small leagues yield fewer than the cap — `W&M` has one candidate, `Qwerty` four — so the button
  is labelled from the candidate count, not from `RIVAL_BATCH_MAX`.

The 314 result independently corroborates DSI-60 in phase 4: those load-test rows really were
deleted, and nothing has re-sampled the league since.

### Shape notes

`addRivalById` is the single path to becoming a rival — the manual "Add" button and the batch both
call it, so there is one rule about what a rival needs (a successful `sync-manager` first, then the
`manager_rivals` write). It returns a **rate-limited outcome as its own case**, because the batch
has to stop on a 429 where it can carry on past an ordinary failure.

The batch reports every term separately, per the standing rule: `Added 3 of 5 · 1 failed (name) ·
stopped at <name> — the sync rate limit was reached, so the rest were not attempted.` No netting,
and never a silent partial success.

**Still to verify:** the signed-in interaction. `/team`'s rival controls are behind auth and this
build was exercised signed out, which is exactly the asymmetry CLAUDE.md warns about — an
auth-gated path tested from the other side proves nothing about it.

## 3. DSI-65 — Telegram, both directions — **built and deployed 2026-09-10**

Written and applied where it is safe to: `supabase/migrations/20260910190000_sprint36_notifications.sql`
(applied — three tables, two Vault accessors, RLS verified), `supabase/functions/notify/`,
`supabase/functions/telegram-webhook/`, `supabase/functions/_shared/telegram.ts`,
`lib/notifications.ts`, `components/telegram-link.tsx`, a Notifications tab on `/settings`, and a
compact link button on `/team`. `tsc`, lint (0 errors), `next build` and `deno check` on both
functions all pass.

Deployed and verified live the same day: `@fpl_decision_bot`, both functions ACTIVE, the webhook
registered, and `notify` running on a 15-minute schedule. See "Deployed, and what proved it" below.


### 3a · push out

Signals that already exist and are unused for this: the `change_feed` view, `news_items`,
`fixture_changes`, `lib/price-watch.ts`'s threshold progress, `gameweeks.deadline_time`.

Two new owner-scoped tables (`auth.uid() = user_id` both directions, the Sprint 14 shape — not the
older public-read/service-write one): `user_notification_prefs` and `notification_outbox`.

**The dedupe key is the feature.** `change_feed` is a view with no id, so the outbox key is composed
(`kind:player_code:observed_at`) and unique per user. A timestamp watermark was rejected: it loses
rows to clock skew and late-arriving `observed_at` values, and losing an injury alert silently is
worse than sending one twice.

`notify` is a **Class A (cron-only)** function — explicit `verify_jwt`, `x-cron-secret` via
`_shared/cron-auth.ts`, scheduled through `invoke_sync`. Bot token from Vault, read the way
`invoke_sync` reads `cron_secret`; deliberately **not** a `TELEGRAM_TOKEN` function env var, which
would put the plaintext in a second place that has to match the first by hand.

Deployment order is Sprint 32's, and it is not advisory: Vault secret → migration → function →
verify against `sync_runs`. The cron schedule is therefore its own migration
(`20260910190100_sprint36_notify_schedule.sql`), **not applied**, carrying that order in its own
header — scheduling `notify` before the function exists points pg_cron at a 404 it retries into a
`sync_runs` gap nobody is watching. It was applied last, after the deploy, and the first run
through `invoke_sync` came back `success`.

### 3b · ask in

`telegram-webhook` is a **third caller class** this project has not had: not cron, not the browser.
Its posture is therefore stated rather than defaulted.

- `verify_jwt = false`, explicitly — Telegram sends no JWT. (DSI-59, below, is about exactly this
  being left implicit elsewhere.)
- **Authentication is the `setWebhook` secret token**, arriving as
  `X-Telegram-Bot-Api-Secret-Token`, held in Vault and compared by digest the way
  `verify_cron_secret` does, not by `=`.
- **Authorisation is the chat-id allowlist.** Anyone can message a public bot, and this bot answers
  questions about a specific manager's squad. An unrecognised `chat.id` gets one "not linked" reply
  and no data. That is the access boundary, and it gets an explicit negative test.

**Linking.** The chat id is unknowable before the first message, so the app mints a short-lived
one-time code (`telegram_link_codes`), the owner sends `/link <code>`, the webhook resolves it and
burns it. The control is `components/telegram-link.tsx`, mounted **both** as a button on `/team` —
where the owner actually is — and in `/settings` → Notifications. One component, one minting path,
one link-state read.

**The line the Deno boundary draws.** `supabase/functions/**` cannot import `lib/`. So every command
handler is restricted to **reads of already-computed rows**: `/points` from
`manager_gameweek_history`, `/team` from `manager_picks` + `players`, `/fixtures` from `fixtures`,
`/leagues` from `league_entries`. **Anything modelled — xP, recommendations, chip advice, EO — is
out of scope for the bot** and answered with a link into the site. Adding xP to the bot's `/team`
reply is the obvious next request and it is the one that would fork the engine.

### RLS, verified rather than assumed

Twelve checks inside a rolled-back transaction, simulating two authenticated users **and** `anon`:

| Check | Result |
|---|---|
| A sees only their own prefs / outbox / link codes | 1 row each |
| A reads B's chat id by any route | 0 rows |
| A inserts an outbox row for themselves | blocked (select-only policy) |
| A mints a link code for B | blocked |
| **A repoints their own row at B's chat id** | **blocked by the unique index** |
| `anon` reads prefs / outbox / link codes | 0 rows each |
| `anon` calls `telegram_secret` or the webhook verifier | blocked, both |

The chat-id row is the one worth singling out. It is the inbound allowlist, so "two users claim one
chat" is not a data-integrity nicety — it is the case where a stranger's `/team` returns someone
else's squad. The unique index is what makes that unrepresentable, and it is now tested rather than
argued.

`get_advisors` reports no new findings; the only security lint on the project is the pre-existing
leaked-password-protection warning, unrelated to this work.

### Deployed, and what proved it

The order was the one Sprint 32 insists on — secrets, then functions, then the webhook, then the
schedule — and each step was checked before the next.

**Neither secret was ever handled outside Postgres.** The bot token came from BotFather into Vault
directly. The webhook secret was *generated inside Postgres*
(`encode(extensions.gen_random_bytes(32),'hex')` straight into `vault.create_secret`), so no one
has ever seen it — not the owner, not this repo, not a shell history. `setWebhook` is therefore
also a database function, `public.telegram_set_webhook()`, which reads both out of Vault and makes
the call itself. Calling setWebhook from a terminal would have put both values in a shell history
for no gain.

| Check | Result |
|---|---|
| `getMe` with the stored token (called from Postgres) | `ok: true` — "FPL Decision", `@fpl_decision_bot` |
| `telegram_secret` asked for `cron_secret` | blocked — not a permitted name |
| Webhook verifier: correct / wrong / null secret | `true` / `false` / `false` |
| `setWebhook` | `"Webhook was set"` |
| `getWebhookInfo` | `pending_update_count: 0`, `allowed_updates: [message, edited_message]` |
| **POST to the webhook with no secret header** | **401 `{"error":"unauthorized"}`** |
| **POST with a wrong secret header** | **401 `{"error":"unauthorized"}`** |
| Correctly-signed POST from an **unlinked** chat | 200, not-linked branch, no squad data read |
| `notify` called with only the publishable key | **401** — the cron gate holds |
| `notify` via `invoke_sync` (cron's own path) | `success`, `detected 0 / sent 0`, 0.7s |

`allowed_updates` is narrowed to `message`/`edited_message` at registration, so Telegram never
delivers anything else — the function's ignore-branch is a second line of defence rather than the
only one. `drop_pending_updates` was set on registration so nothing queued before the deploy gets
replayed.

**One divergence worth recording.** The deployed bundles were uploaded through the Supabase
integration with their `_shared/` dependencies inlined, and those copies carry trimmed comments —
`telegram-webhook`'s bundled `sync.ts` contains only the three helpers it uses. Behaviour is
identical and the repo is the source of truth, but the deployed source is not byte-identical to
this repo. A `supabase functions deploy notify telegram-webhook` from a linked CLI would make them
match, and should be done next time either function is touched.

### What is left

Nothing on the infrastructure. The remaining work is a real end-to-end pass once a chat is linked:
`/link` with a good code, a reused code and an expired code; each of the four read commands against
what the site shows; and one real alert through the outbox, with a second detection pass writing
**zero** new rows. That needs a signed-in session, which is the same gap phase 2's rival controls
have.

## 4. Console and decision items

- **DSI-60 — league 314.** The pipeline was proven at full scale on 2026-08-30 (2000 entries,
  30,000 picks, 0 failures, 47s) and the rows were then deleted because it was verification. Run it
  for real, **keep the rows**, and assert `league_entries` for `league_id = 314` is non-zero
  afterwards — the check the last run did not leave behind.
- **DSI-58 — custom SMTP.** A Supabase dashboard setting on Auth. **Unrelated to the Telegram work
  in Phase 3** — different system, different purpose. Recorded here so the next reader does not
  assume one covered the other. Google OAuth stays the primary sign-in path.
- **DSI-59 — Sprint 32's three deliberate gaps.** The `verify_jwt = false` posture on `sync-news`
  and `generate-predictions`; the orphan `scratch-path-test`; and the unverified 429. On the last:
  it was left unproven because a real test looked like 31 Refresh presses and 31 FPL round trips —
  but **the limit is a `game_settings` input, not a constant**, so lowering it to 2 makes the proof
  three presses. Restore the value afterwards, and record that `checkRateLimit` allows the call when
  its own count query errors, by design: best-effort, not a guarantee.

## 5. Tooling shipped alongside

`.claude/skills/start-sprint/SKILL.md` — reads the Linear Todo column, reads each candidate's
**comments** and its **gate**, numbers the sprint from `roadmap.md`, asks before writing, and on
approval writes both halves (Linear and the docs). It pairs with `/linear-sync`, which reconciles;
this one starts.

## 6. Verification (planned; unrun until each phase lands)

1. `/engine-verify` — `lib/decision-analytics.ts` against live data for entry 274486 in a throwaway
   `npx tsx` harness, checked by hand against a known gameweek. Harness stays out of the commit.
2. `loadGameweekReview` for one event must return the same captain gap as the season module's row
   for that event — the proof no second scorer was reintroduced.
3. `/verify-rls` on every new table, simulating a second authenticated user **and** `anon`.
4. Push out: one detection pass writes outbox rows with distinct keys; a **second pass writes zero**;
   a message arrives; `sent_at` is set. Then the browser Send-test path, which exercises CORS
   preflight.
5. Ask in: link from both surfaces; a good code links, a reused code fails, an expired code fails;
   each command returns data agreeing with the site. Then the two negative tests — wrong secret
   token returns 401 and reads nothing, unlinked chat gets the not-linked reply and no squad data.
   `getWebhookInfo` shows no pending-update backlog.
6. DSI-60's row count; DSI-59's 429 with the limit temporarily at 2, then restored.
7. `/responsive-check` over the breakpoint × theme matrix for the new `/team` section and
   `/settings` tab.
8. `/ship-check` (tsc, lint, build) before commit and before push.
