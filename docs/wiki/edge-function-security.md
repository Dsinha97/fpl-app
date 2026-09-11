# Edge Function security

Who is allowed to call `/functions/v1/*`, and what enforces it. Three caller classes, three
different mechanisms, each stated rather than defaulted. Built in Sprint 32 (2026-09-05), deployed
across Sprints 32–34, extended with a third class in Sprint 36.

What the functions *do* and when they run: [data-pipeline.md](data-pipeline.md). How the tables
they write are protected: [database-and-rls.md](database-and-rls.md).

## The problem, stated honestly

Before Sprint 32 every sync function was callable by anyone holding the publishable key — in
practice anyone who opened devtools on fpldecision.com, and prospectively anyone scraping a public
repo. **The blast radius was bounded and worth not inflating:** every sync is idempotent, reads
public FPL data and writes public tables, so this was never a data-disclosure problem. The cost is
Supabase invocations, egress and compute on this project's bill, plus FPL API traffic attributed to
this project — which is how a project gets throttled.

The scope doc named **one** `?force=1` escape hatch. Grepping found **five**
(`sync-fixtures`, `sync-live-gameweek`, `sync-player-history`, `sync-claimed-managers`,
`ingest-fpl-archive`), and the two most expensive — a per-player element summary for every player,
and whole-season CSVs — were among them. The scheduling migration's cost argument ("self-gating, so
short intervals cost one cheap query on most invocations") evaporated for anyone who could append a
query parameter.

## Class A — cron-only

`sync-bootstrap`, `sync-fixtures`, `sync-player-history`, `sync-live-gameweek`, `sync-news`,
`sync-claimed-managers`, `generate-predictions`, `ingest-fpl-archive`, and (Sprint 36) `notify`.

`verifyCron(req, db)` in `_shared/cron-auth.ts` requires an `x-cron-secret` header matching a
Vault-backed secret. Two properties worth keeping:

- **It runs before the URL is parsed**, so the five `?force=1` hatches are *closed* rather than
  guarded — verified after deploy by confirming from the function log that the request never
  reached `new URL(req.url)`.
- **It fails closed when the Vault secret is missing**, logging loudly to the function console and
  saying nothing useful in the response body.

### The secret is never known outside Postgres

The original scope assumed a `CRON_SECRET` function env var. That works, but it needs the plaintext
to exist in a third place — a shell command, a dashboard field, a clipboard — on the way to matching
the Vault copy `invoke_sync` reads, and two copies that must match by hand is a silent 401 waiting
on a typo. So the value is generated *inside* Postgres (`gen_random_bytes`) and read from Vault at
both ends.

The function cannot read Vault itself, and this was checked before being relied on: **PostgREST only
serves the schemas it is configured to expose** (`public`, `graphql_public`), and `vault` is not one
of them, so `db.schema("vault")` fails at the API layer whatever the service role's table privileges
say. Exposing `vault` to PostgREST to work around that would widen the REST surface to the secret
store. Instead a `security definer` RPC, `public.verify_cron_secret`, takes the supplied header and
returns a boolean — the secret is never sent even to the thing checking it. It compares **sha256
digests rather than raw values**, because `=` on text short-circuits at the first differing byte and
leaks the length of a correct prefix to anyone willing to measure. Execute is granted to
`service_role` only, so it is not an oracle reachable with the publishable key.

**The same tool, the opposite verdict, one sprint apart.** Vault was *rejected* in Sprint 31 for the
publishable key: an identical copy already ships in the browser bundle, so hiding the repo's copy
would have changed nothing about who could call the endpoint while adding a silent-401 failure mode.
Here Vault is *correct*, for precisely the inverse reason — the new secret has no public copy
anywhere, so hiding it is the entire mechanism rather than theatre.

## Class B — browser-invoked: `verifyUser` + a per-user rate limit

`sync-manager` and `sync-league-picks`.

`verifyUser` (`_shared/auth.ts`) already existed for `fpl-session`/`fpl-my-team` — adoption, not new
code. Its header comment had argued that the sync functions "deliberately skip this — a sync
triggered by any visitor is harmless"; that premise expired and the comment was rewritten in the
same change rather than left to mislead.

Requiring a signed-in user turns "anyone on the internet" into "anyone with an account", which is
necessary and not sufficient — accounts are free. **The rate limit is the actual bound.**

### The limit is an input, not a tuned constant

`_shared/rate-limit.ts` counts rows in `sync_runs`, which already recorded every execution with
`function_name` and `started_at`. What it lacked was *who*; the migration added `invoked_by`.

The value lives in `game_settings` under `sync_rate_limit`, so raising it is a config change rather
than a redeploy — the same treatment `league_ownership_entry_cap` gets, and the `decisionMargin`
precedent in [methodology.md](methodology.md#when-a-term-cannot-be-dropped-make-it-an-input). It was
derived from what legitimate use had actually done, measured against `sync_runs` on 2026-09-05:
`sync-manager` 432 runs since 2026-08-03, median gap 164s, **busiest ten-minute window 27**;
`sync-league-picks` 12 runs, busiest window 4. **30 per 10 minutes** clears the busiest window ever
observed with headroom while capping one account at 180/hour per function.

`rate-limit.ts` repeats those numbers as a fallback for a missing `game_settings` row, so a missing
row degrades to the documented limit rather than to no limit. The row is the source of truth; the
fallback is not a second one to be tuned independently.

**Rejections are recorded** as `status = 'rejected'` with `invoked_by` set. `sync_runs` is an audit
of *runs* and a refusal is not a run, so this was a real choice between two honest options — the
record of who is hammering what is the whole diagnostic value of having the column.

**A failure to count allows the call.** `checkRateLimit` returns `allowed: true` when its own count
query errors, and says so in its comment: the limit bounds cost, it does not guard data, and a
database hiccup should not take the Refresh button down for a legitimate signed-in user. That makes
it **best-effort by design, not a hard guarantee**, and it should never be described as one.

### What it does to the UI

- **`/leagues`** — `syncLeaguePicks` returned `error.message`, which on any non-2xx is supabase-js's
  generic "Edge Function returned a non-2xx status code", swallowing both new statuses at exactly
  the two moments they had something to say. Now unwraps `FunctionsHttpError`.
- **`/team`** — a real behaviour change: the page works signed-out off a `localStorage` manager id,
  and Connect/Refresh forced a live sync that now requires a session. Rather than surfacing a 401
  the visitor cannot act on, `syncFromFpl` checks for a session first and throws a
  `SignedOutSyncError`, rendered as an amber **notice beside** the data rather than a red error
  replacing it — the refresh failed, the page did not. Signed-out visitors still see everything the
  background cron wrote.

### Verified, in two halves

Signed-in, over the real HTTP path: two accounts each pressed Refresh, both got 200s, and
`invoked_by` populated with two distinct users — the first non-NULL values the column has ever held.

In SQL, inside a rolled-back transaction, running the exact query `checkRateLimit` runs: blocks at
exactly 30; user B's count independent of A's; a run 900s ago outside the 600s window not counted;
A's `sync-manager` runs counted as 0 against `sync-league-picks`. **The last two were not on the
original checklist** — a per-user count correct on identity could still have leaked across the time
window or across functions.

Re-proved in Sprint 36 against synthetic rows: allowed at 29, refused at 30, 50 rows outside the
window ignored, cross-function count 0. **What remains unproven is only that the refusal renders as
a 429 with `rateLimitMessage` in the browser.** The cheap way to close it is the one the sprint
identified: the limit is a `game_settings` row, so temporarily setting `max_calls` to 2 makes it
three clicks instead of thirty-one. Restore the row afterwards.

## Class C — the Telegram webhook (Sprint 36)

`telegram-webhook` is neither cron nor browser, so its posture is stated rather than defaulted:
`verify_jwt = false` explicitly (Telegram sends no JWT), authentication by the `setWebhook`
`secret_token` arriving as `X-Telegram-Bot-Api-Secret-Token` and compared by digest the way
`verify_cron_secret` does, and **authorisation by a chat-id allowlist**. Full detail:
[notifications-and-bot.md](notifications-and-bot.md).

## The privacy consequence the scope doc did not anticipate

`sync_runs` carries a **public-read** policy because `/status` (now `/settings` → Pipeline) renders
the pipeline log signed-out. Adding `invoked_by` to it would have published Supabase user ids to
anonymous readers.

RLS is row-level, so the fix is a **column-level grant**:
`revoke select (invoked_by) on public.sync_runs from anon, authenticated`. `app/status/page.tsx`
selects an explicit column list that does not include it, so nothing breaks; a `select *` as anon
now fails, which is the intended and visible consequence. Verified after deploy: anon reads the
Pipeline tab's columns fine and gets `permission denied for table sync_runs` on `invoked_by`.

## CORS, correctly labelled

`_shared/sync.ts` sent `Access-Control-Allow-Origin: "*"` on every response from every function,
including the eight nothing in a browser should call. Replaced with an origin allowlist
(`fpldecision.com`, `www.`, `localhost:3000`) applied by a `withCors` wrapper that **only the
browser-invoked functions opt into**. A cron-only function now emits no CORS headers at all and
answers a preflight with a bare 204. `Vary: Origin` is set, without which a cache can serve one
origin's allowed response to another.

**This is defence in depth and nothing more** — CORS is enforced by browsers, so it does not
inconvenience `curl` in the slightest, and the code says so where it lives.

## `verify_jwt`, measured rather than assumed

`config.toml` originally carried only `project_id`, so each function's `verify_jwt` posture was a
property of how someone last ran `supabase functions deploy` rather than something visible in a
diff. Sprint 32 wrote it down per function and **deliberately left the values as found** — a CLI
deploy *applies* the file, so deploying as-found changed nothing about the gateway posture, which
kept an open question out of an ordered deploy whose failure mode is silent 401s on every cron job.

Sprint 36 probed all three states live and settled it:

| Request | Result |
|---|---|
| `sync-bootstrap` (`verify_jwt = true`), no auth header | `401 UNAUTHORIZED_NO_AUTH_HEADER` — **gateway**, function never runs |
| `sync-news` (`verify_jwt = false`), no auth header | `401 {"error":"unauthorized"}` — **function ran**, then cron-auth refused |
| `sync-news`, with the publishable key | the same — cron-auth refused |

**The posture buys no access control.** The publishable key is public by design, so anyone can
satisfy the gateway and reach the same cron-secret check either way. The only real difference is
that with `false` an unauthenticated request *costs an invocation* before being rejected — so the
argument for flipping is cost and consistency, not security, which is a smaller claim than
"hardening".

`config.toml` now says `true` for both, **but a config file is only a claim until a deploy applies
it.** Until `supabase functions deploy sync-news generate-predictions` runs, the repo asserts a
posture the project does not have — the exact failure the file was written to prevent. See
[deployment.md](deployment.md#one-cli-deploy-reconciles-four-drifts) for why that deploy is
deliberately bundled and still outstanding.

## Two things deliberately left open

**`js/stack-trace-exposure` (CodeQL, `_shared/sync.ts:194`)** — left open rather than dismissed or
"fixed", with the reasoning recorded so nobody re-litigates it from the alert alone. It is **not
actually a stack trace**: `grep` for `.stack` across `supabase/functions/` returns nothing; every
path is `err instanceof Error ? err.message : String(err)`, and CodeQL models `Error.message` as
stack-derived. The residual concern (a raw message naming a table) is real but reachable only by an
authenticated Class B caller or by cron. And **sanitising the response would be theatre, because the
same text is already public by design**: `sync_runs.error` is public-read and rendered on the
Pipeline tab, so these strings are already served to anyone loading the site by a *less* restricted
path than the alert points at. Doing it properly would mean sanitising what goes *into*
`sync_runs.error` — and that panel's whole purpose is saying why a sync broke, which is how the GW1
kickoff lag and FPL's matchday 403s were both diagnosed. What would change the answer: a
`sync_runs.error` observed naming *this* schema (fix belongs at the write, not the response), or the
Pipeline tab moving behind the sign-in wall.

**`scratch-path-test`** — a leftover debug function, `verify_jwt = false`, deployed but not in this
repo. Probed in Sprint 36: returned `200` and the body `hi` to a completely unauthenticated request.
It leaked nothing; the finding was an open unauthenticated endpoint on the project's bill that
nothing called and no source controlled. **Deleted 2026-09-10** — now `404 NOT_FOUND`.

## The rule that generalises

A posture nobody wrote down is a posture nobody decided. Both of this area's long-lived gaps —
`verify_jwt` and `scratch-path-test` — existed because the state lived in deploy history rather than
in a file. Writing it into `config.toml` did not fix either one, but it is what made them
*reviewable*, and both were closed within two sprints of becoming visible.
