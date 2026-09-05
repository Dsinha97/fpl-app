# Sprint 32 — Lock down the Edge Function surface

Built 2026-09-05, **code only — nothing deployed.** Scoped 2026-09-03 as the
last public-repo blocker: `/functions/v1/sync-*` was callable by anyone holding
the publishable key, which in practice meant anyone who opened devtools on
fpldecision.com, and would have meant anyone scraping a public repo. Every
function is now gated, by one of two mechanisms depending on who legitimately
calls it. The Vault secret, the migrations and the function deploys are
deliberately left un-applied behind the ordering in §6 — applying them in the
wrong order silently 401s every scheduled sync.

The blast radius was bounded and it is worth restating honestly rather than
inflating: every sync is idempotent, reads public FPL data and writes public
tables, so this was never a data-disclosure problem. The cost is Supabase
invocations, egress and compute on this project's bill, plus FPL API traffic
attributed to this project — which is how a project gets throttled.

---

## 0. What the scope doc got wrong, found by grepping rather than reading

The scope doc named **one** `?force=1` escape hatch, in `sync-fixtures`, and
described it as the thing that "makes it worse than it looks". There are
**five**:

| Function | Line |
|---|---|
| `sync-fixtures` | `index.ts:39` |
| `sync-live-gameweek` | `index.ts:28` |
| `sync-player-history` | `index.ts:141` |
| `sync-claimed-managers` | `index.ts:56` |
| `ingest-fpl-archive` | `index.ts:172` |

The argument the scope doc made about one of them applies to all five, and to
the two most expensive ones it applies harder: `sync-player-history` fetches a
per-player element summary for every player, and `ingest-fpl-archive` pulls
whole-season CSVs. The scheduling migration's cost argument — "self-gating, so
their short intervals cost one cheap query on most invocations" — evaporated
for anyone who could append a query parameter to any of them.

`verifyCron` runs **before** the URL is even parsed, so the gates are closed
rather than guarded. Nothing else in `supabase/functions/` reads a query
parameter that changes behaviour (`sync-manager`'s `entry_id` and
`sync-league-picks`' `league_id`/`event` are arguments, not switches).

## 1. The split: two classes, two mechanisms

### Class A — cron-only (`supabase/functions/_shared/cron-auth.ts`, new)

`sync-bootstrap`, `sync-fixtures`, `sync-player-history`, `sync-live-gameweek`,
`sync-news`, `sync-claimed-managers`, `generate-predictions`,
`ingest-fpl-archive`.

`verifyCron(req, db)` requires an `x-cron-secret` header matching a
Vault-backed secret, compared in constant time, checked before the URL is even
parsed. That takes these endpoints from "anyone holding the publishable key" to
"the database's own cron, and nothing else".

**The secret is never known outside Postgres, and that is a change from this
doc's original scope.** The scope assumed a `CRON_SECRET` function env var.
That works, but it needs the plaintext to exist in a third place — a shell
command, a dashboard field, a clipboard — on the way to matching the Vault copy
`invoke_sync` reads, and CLAUDE.md's rule is that secrets are referenced by
name only and never pasted anywhere. Two copies that must match by hand is also
a silent 401 waiting on a typo. So the value is generated *inside* Postgres
(`gen_random_bytes`) and read from Vault at both ends: `invoke_sync` to send
the header, `cron-auth.ts` to check it. The function does not read Vault itself, and cannot: PostgREST only serves
the schemas it is configured to expose (`public`, `graphql_public`) and `vault`
is not one of them, so `db.schema("vault")` fails at the API layer whatever
the service role's table privileges say — checked before relying on it, not
after. Exposing `vault` to PostgREST to avoid that would widen the REST surface
to the secret store. Instead a `security definer` RPC, `public.verify_cron_secret`,
takes the supplied header and returns a boolean, so the secret is never sent
even to the thing checking it. It compares sha256 digests rather than the raw
values, because `=` on text short-circuits at the first differing byte and
leaks the length of a correct prefix to anyone willing to measure. Execute is
granted to `service_role` only, so it is not an oracle reachable with the
publishable key.

**Deliberate contrast with Sprint 31, because the same tool gets the opposite
verdict.** Vault was *rejected* there for the publishable key: an identical
copy already ships in the browser bundle, so hiding the repo's copy would have
changed nothing about who could call the endpoint while adding a silent-401
failure mode. Here Vault is *correct*, for precisely the inverse reason — the
new secret has no public copy anywhere, so hiding it is the entire mechanism
rather than theatre. Tool identical, verdict opposite, and the difference is
the reasoning rather than the tool.

**Fails closed when the Vault secret is missing.** That is the right security
default and also the failure mode §6 exists to prevent. It logs loudly to the
function console and says nothing useful in the response body.

### Class B — browser-invoked (`verifyUser` + a per-user rate limit)

`sync-manager` and `sync-league-picks`.

`verifyUser` (`_shared/auth.ts`) already existed and was already used by
`fpl-session` and `fpl-my-team` — adoption, not new code. Its header comment
argued that the sync functions "deliberately skip this — a sync triggered by
any visitor is harmless"; that premise expired here and the comment is rewritten
in the same change rather than left to mislead the next reader.

Requiring a signed-in user turns "anyone on the internet" into "anyone with an
account", which is necessary and not sufficient — accounts are free. The rate
limit is the actual bound.

## 2. The rate limit, and where its number came from

`supabase/functions/_shared/rate-limit.ts`, counting rows in `sync_runs`, which
already recorded every execution with `function_name` and `started_at`. What it
lacked was *who*; the migration adds `invoked_by`.

**The limit is an input, not a tuned constant** (CLAUDE.md's `decisionMargin`
precedent). It is a row in `game_settings` under `sync_rate_limit`, so raising
it is a config change rather than a redeploy — the same treatment
`league_ownership_entry_cap` already gets.

The value is derived from what legitimate use of these two buttons has actually
done, measured against `sync_runs` on 2026-09-05:

| Function | Runs | Since | Median gap | Busiest 10-min window |
|---|---|---|---|---|
| `sync-manager` | 432 | 2026-08-03 | 164s | **27** |
| `sync-league-picks` | 12 | 2026-08-21 | 150s | 4 |

**30 per 10 minutes** clears the busiest window ever observed with headroom,
while capping one account at 180/hour per function instead of the unbounded
surface it replaces. `rate-limit.ts` repeats those numbers as a fallback for a
missing `game_settings` row — so a missing row degrades to the documented limit
rather than to no limit. The row is the source of truth; the fallback is not a
second one to be tuned independently.

**Rejections are recorded**, as `status = 'rejected'` with `invoked_by` set.
`sync_runs` is an audit of *runs* and a refusal is not a run, so this was a real
choice between two honest options; the record of who is hammering what is the
whole diagnostic value of having the column at all. The `sync_runs_status_check`
constraint is extended rather than worked around.

A failure to *count* allows the call. The limit bounds cost, not access to
data, and a database hiccup should not take the Refresh button down for a
legitimate user.

### The privacy consequence, which the scope doc did not anticipate

`sync_runs` carries a **public-read** policy (`anon, authenticated`) because
`/status` renders the pipeline log signed-out. Adding `invoked_by` to that table
would have published Supabase user ids to anonymous readers.

RLS is row-level, so the fix is a column-level grant:
`revoke select (invoked_by) on public.sync_runs from anon, authenticated`.
`app/status/page.tsx` selects an explicit column list that does not include it,
so nothing in the frontend breaks; a `select *` as anon now fails, which is the
intended and visible consequence.

## 3. CORS, correctly labelled

`_shared/sync.ts` sent `Access-Control-Allow-Origin: "*"` on every response from
every function, including the eight nothing in a browser should call.

Replaced with an origin allowlist (`fpldecision.com`, `www.`, and
`localhost:3000`) applied by a new `withCors` wrapper that **only the
browser-invoked functions opt into**. A cron-only function now emits no CORS
headers at all and answers a preflight with a bare 204, so a page cannot read
its response even if it manages to issue the request. `Vary: Origin` is set,
without which a cache can serve one origin's allowed response to another.

`withCors` wraps the handler rather than threading a request through
`jsonResponse`, which kept the diff to one line per function instead of
reindenting a 240-line handler.

**This is defence in depth and nothing more.** CORS is enforced by browsers, so
it does not inconvenience `curl` in the slightest. It is not a substitute for
§1 and the code says so where it lives.

## 4. `verify_jwt`, made reviewable

`supabase/config.toml` carried only `project_id`, so the `verify_jwt` posture of
every function was a property of how someone last ran `supabase functions
deploy` rather than something visible in a diff. Now stated per function, with
the reason `verify_jwt = false` is *not* "unauthenticated" for any of them: the
gateway's check is satisfied by the publishable key, which is public by design,
so the function does its own checking and can return a useful error — a 401
"signed out" distinguished from a 429 "over your limit" — instead of an opaque
gateway rejection.

`fpl-session` and `fpl-my-team` were **confirmed, not assumed**, to call
`verifyUser` already (`index.ts:28` in both). They are the two functions that
touch per-user data and were never part of the problem.

## 5. What this changes in the UI

Class B refusals only matter if someone sees them.

- **`/leagues`** — `syncLeaguePicks` (`lib/leagues.ts`) returned
  `error.message`, which on any non-2xx is supabase-js's generic "Edge Function
  returned a non-2xx status code". Both new statuses would have been swallowed
  at exactly the two moments they had something to say. Now unwraps
  `FunctionsHttpError` the way `/team`'s `sync-manager` call already did.
- **`/team`** — a real behaviour change worth naming: the page works signed-out
  off a `localStorage` manager id, and Connect/Refresh forced a live sync.
  That sync now requires a session. Rather than surfacing a 401 the visitor
  cannot act on, `syncFromFpl` checks for a session first and throws a
  `SignedOutSyncError`; the page renders it as an amber **notice** beside the
  data, not a red error replacing it — the refresh failed, the page did not.
  Signed-out visitors still see everything the background cron wrote.
  The one case that genuinely cannot work signed-out is a manager id the cron
  has never seen, which now says so instead of reporting a bare "no rows".

### Not done here

Nothing was deployed and no migration was applied. `/status` gained no view of
`rejected` rows — the accuracy-scoreboard panel it is already waiting on is the
natural place for that, and adding a second half-panel first would be worse
than adding neither.

## 5b. Deployment status — partial, deliberately, as of 2026-09-05

Steps 1, 2 and 4 are **done and verified against the live project**. Step 3 is
**2 of 10 functions**.

| Step | State |
|---|---|
| 1. Vault secret `cron_secret` | **Done.** Generated in-database with `gen_random_bytes(36)`; nobody has ever held the value. |
| 2. Both migrations | **Applied and verified.** `invoked_by` + grants + `sync_rate_limit`; `invoke_sync` sending the header; `verify_cron_secret` RPC. |
| 3. Function deploys | **sync-fixtures and sync-live-gameweek only.** The other eight are unchanged. |
| 4. Verify `sync_runs` | **Done** over a full 20-minute cycle — every scheduled function still `success`/`skipped`, the two gated ones 10/10. |

**Why it stopped at two.** These deploys went through the Supabase MCP
integration, which takes file *contents* as arguments — meaning every byte of
each function plus its shared dependencies is retyped by hand on the way in.
That is ~35 KB per function and ~300 KB for the remaining eight, and
`generate-predictions` alone carries `_shared/xp-model.ts` (70 KB of model
code) where a single silently-mistyped coefficient would corrupt predictions in
a way no test here would catch. The CLI deploys the same files from disk,
byte-exact, in one command — it just needs an authenticated session, which is
the owner's to give.

**The partial state is safe, and monotonic.** A deployed function is gated; an
undeployed one behaves exactly as it did before this sprint. `invoke_sync`
sends the header to all ten either way, and the eight that do not yet check it
ignore it — which is precisely the harmless middle state step 2 was ordered to
create. Nothing is half-broken; eight things are simply not yet tightened.

**To finish**, after `npx supabase login`:

```bash
npx supabase functions deploy sync-bootstrap sync-player-history sync-news sync-claimed-managers sync-manager sync-league-picks ingest-fpl-archive generate-predictions
```

Then re-run the `sync_runs` check in step 4. Until that lands, the eight remain
callable by anyone holding the publishable key, so **the repo flip still
waits** — on this command, not on more code.

## 6. The deployment ordering, which can break everything silently

The Class A change has one real failure mode, and it is the one Sprint 31 named
when it rejected Vault for the publishable key: **if the function starts
requiring a header before `invoke_sync` sends it, every scheduled sync 401s** —
silently, into `sync_runs` rows nobody is watching.

Run in this order. Do not reorder 2 and 3.

**1. Create the Vault secret**, generated in place so no one ever holds it:

```sql
select vault.create_secret(
  encode(extensions.gen_random_bytes(36), 'base64'),
  'cron_secret',
  'Sprint 32 — shared secret for cron-only Edge Functions'
);
```

There is no second copy to set. Both `invoke_sync` and `cron-auth.ts` read
this row.

**2. Apply the migrations.** In this order — the second is the one that matters:

```bash
npx supabase db push
```

`20260905120000_sprint32_sync_runs_invoked_by.sql` adds the column, index,
constraint, column grant and `game_settings` row.
`20260905120100_sprint32_invoke_sync_cron_secret.sql` makes `invoke_sync` send
the header. **After this step cron sends a header the deployed functions still
ignore. That is harmless, and it is the whole point of doing it second.**

**3. Deploy the functions.** Class A first, then Class B:

```bash
npx supabase functions deploy sync-bootstrap sync-fixtures sync-player-history sync-live-gameweek sync-news sync-claimed-managers generate-predictions ingest-fpl-archive
```

```bash
npx supabase functions deploy sync-manager sync-league-picks
```

**4. Verify against `sync_runs` before walking away.** `sync-live-gameweek`
runs every 2 minutes and is the fastest signal:

```sql
select function_name, status, started_at, error
from sync_runs
where started_at > now() - interval '15 minutes'
order by started_at desc;
```

Every scheduled function must still be reaching `success` or `skipped`. A wall
of `error` rows carrying a 401 means step 3 landed before step 2.

**Rollback** reverses 3 then 2, in that order, for the same reason.

## Verification

Per CLAUDE.md's "verify, don't assume", and the RLS precedent of simulating the
caller rather than trusting the policy. **None of this has been run — it is the
post-deploy gate, not a record of a pass.**

Class A, with the publishable key and no cron secret — the exact request the
threat model is about, so run it rather than reason about it:

```bash
curl -i -X POST "https://fyxyqxpscmqjyjxsyhms.supabase.co/functions/v1/sync-fixtures" -H "Authorization: Bearer $SB_PUBLISHABLE_KEY"
```

Expect `401 {"error":"unauthorized"}`.

**The positive case is not a curl.** Nobody holds the secret, by design, so
there is no value to put in a header — which means the proof that cron still
works is the cron tick itself: a `success` row in `sync_runs` from a real
scheduled run, after the functions were deployed. That is the stronger
evidence anyway; a curl with a hand-copied header would only prove that the
comparison works, not that `invoke_sync` is sending what the function expects.

Then the bypass that started this sprint, unauthenticated:

```bash
curl -i -X POST "https://fyxyqxpscmqjyjxsyhms.supabase.co/functions/v1/sync-fixtures?force=1" -H "Authorization: Bearer $SB_PUBLISHABLE_KEY"
```

Expect `401`, and confirm from the function log that it never reached the URL
parse — guarded is not the same as closed. Repeat for the other four in §0.

Class B, against `sync-manager`:

- Signed out → `401`, and `/team` shows the amber notice rather than a red
  error or a silent nothing.
- Signed in → `200`.
- Signed in, 31 calls inside 10 minutes → `429`, the message names the limit,
  and `/team`'s Refresh surfaces it.
- A `rejected` row lands in `sync_runs` with the right `invoked_by`.
- **A second user's limit is independent of the first's** — same
  `set_config('request.jwt.claims', …)` discipline the RLS checks use, inside a
  rolled-back transaction.
- As `anon`, `select invoked_by from sync_runs` is refused while `/status`'s own
  column list still works.

And the regression test that matters most, because its failure is silent:
`sync_runs` after a full cron cycle, every scheduled function still succeeding.

## Out of scope

Making the repo public (a separate, deliberate owner action, unblocked once this
is deployed); rotating the publishable key (pointless — it is public by design,
and Sprint 31 recorded why); rate limiting the read path (RLS governs it, and
`/functions/v1/` was the part with no equivalent).
