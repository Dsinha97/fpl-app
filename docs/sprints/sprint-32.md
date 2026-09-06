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

## 5b. Deployment status — **COMPLETE as of 2026-09-06.** See §5c for the finish.

The section below is kept as written on 2026-09-05, because its reasoning about
*why* it stopped at two functions is still correct and worth reading. What it
got wrong is only the size of the remaining owner action — see §5c.

## 5b (as of 2026-09-05) — partial, deliberately

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

## 5c. Finished 2026-09-06 (Sprint 34)

All ten functions are deployed and gated. The remaining eight went out in the
§6 order — Class A, then Class B — and the verification section below was run
for the first time.

**The owner action was one command, not the deploy.** §5b concluded the deploy
itself was the owner's to run. It is smaller than that: the Supabase CLI is
installed locally, and only `supabase login` needs a human — everything after
it is non-interactive. Two wrinkles found doing it:

- `npx supabase login` fails from PowerShell with a `PSSecurityException` on the
  `npx.ps1` shim (execution policy). `npx.cmd supabase login` bypasses it, as
  does Git Bash.
- The automatic flow refuses to run in a non-TTY environment at all
  (`LegacyLoginMissingTokenError`), so it must be a real terminal regardless of
  shell.

**Verification results** (the matrix in the Verification section, run for real):

| Check | Result |
|---|---|
| Class A × 8, publishable key, no secret | `401 {"error":"unauthorized"}` on all eight |
| The five `?force=1` hatches | 401, and closed rather than guarded — `verifyCron` runs before `new URL(req.url)` |
| `sync-league-picks`, unauthenticated | 401, "sign in to sync a league" |
| Cron still healthy post-deploy | `sync-claimed-managers` success at 20:44, one minute after the 20:43 deploy; `sync-fixtures`/`sync-live-gameweek` likewise |
| `anon` reads the Pipeline tab's columns | works |
| `anon` reads `sync_runs.invoked_by` | refused — `permission denied for table sync_runs` |

**One real regression, found by the gate and fixed the same pass.**
`sync-manager` came up `503 BOOT_ERROR`: `index.ts` imported `int` from
`_shared/fpl.ts`, which does not export it — it lives in `_shared/coerce.ts`.
This is a latent repo bug `tsc` structurally cannot catch, because
`supabase/functions/**` is excluded from tsconfig and eslint (CLAUDE.md says so
and requires it). It only surfaced now because the previously-deployed copy
predated the `manager-sync.ts` split. `/team`'s Refresh was broken for the
window between deploy and fix. Every other function/shared import was swept for
the same class of error; `sync-manager` was the only one.

### Class B rate limiting — closed 2026-09-06, except the 429 itself

The three checks §5c originally left open needed real signed-in sessions. Two
are now closed against production, and the third is closed by construction with
the gap stated rather than papered over.

**Verified end to end, with real JWTs over the real HTTP path.** Two accounts
signed in and each pressed `/team`'s Refresh:

| When | User | Status | Rows | Duration |
|---|---|---|---|---|
| 22:26:34Z | `eb2905e2` | success | 66 | 2.30s |
| 22:26:15Z | `faff6892` | success | 75 | 4.16s |

That gives three things at once: signed-in callers get a 200; **`invoked_by`
populates for real** (these are the first non-NULL values the column has ever
held — every earlier row predates the migration); and **two distinct users are
attributed correctly**, which is the end-to-end half of the isolation check.

**Verified in SQL, inside a rolled-back transaction**, using two real
`auth.users` ids and the exact query `checkRateLimit` runs. Four properties,
two of which were not on the original checklist:

| Property | Result |
|---|---|
| User A with 30 runs in the window | `used=30` -> `allowed=false` — blocks at exactly the limit |
| User B with 1 run | `used=1` -> `allowed=true` — independent of A |
| A's run 900s ago, outside the 600s window | not counted (30, not 31) — the window bound holds |
| A's `sync-manager` runs counted against `sync-league-picks` | 0 — the limit is per-function, not pooled |

The last two matter: a per-user count that was correct on identity could still
have leaked across the time window or across functions, and nothing in the
original checklist would have caught either.

**Deliberately not exercised: the 429 response itself**, and with it the
`rejected` row and `rateLimitMessage`'s text rendering in the UI. It needs 31
Refresh presses inside ten minutes, each a real FPL API round trip. Everything
the 429 depends on is verified above — the counting query, per-user scoping, the
window bound, per-function scoping, and real `invoked_by` attribution through
the live HTTP path — so what remains untested is whether the *message* renders
correctly on a path that already fails closed. Recorded as a known gap rather
than claimed, and cheap to close opportunistically if anyone is on `/team`
anyway.

**One design decision worth surfacing, found while reading the implementation
to write this.** `checkRateLimit` returns `allowed: true` when its count query
errors, and says so in its own comment: the limit exists to bound cost, not to
guard data, and a database hiccup should not take the Refresh button down for a
legitimate signed-in user. That is the right call, and it does mean the limit is
**best-effort by design, not a hard guarantee** — worth knowing before anyone
treats it as one.

**`verify_jwt` deliberately left as found.** `config.toml` records `false` for
`sync-news` and `generate-predictions`, `true` for the other eight, and its own
header flags that as a record rather than a decision. A CLI deploy *applies* the
file, so deploying as-found changed nothing about the gateway posture — which
kept that open question out of an ordered deploy whose failure mode is silent
401s on every cron job. It remains open. So does `scratch-path-test`, the
leftover debug function with `verify_jwt = false` that §5b's config comment
already names — still deployed, still not in this repo.

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

## 5d. Error messages in responses — a CodeQL alert, deliberately left open

CodeQL default setup (enabled 2026-09-06, Sprint 34) raises
`js/stack-trace-exposure` at `_shared/sync.ts:194`, the shared `jsonResponse`
helper, for the `{ ok: false, error: message }` shape every function's 500
branch returns. **Left open rather than dismissed, and deliberately not
"fixed".** The reasoning, so nobody re-litigates it from the alert alone:

**It is not actually a stack trace.** `grep` for `.stack` across
`supabase/functions/` returns nothing. Every path is
`err instanceof Error ? err.message : String(err)`. CodeQL models
`Error.message` as stack-derived; here it is a message string.

**The residual concern is real but small.** A raw `err.message` can leak
internals — a Postgres error naming a table, say. Post-Sprint 32 that is
reachable only by an authenticated user on the two Class B functions, or by
cron; unauthenticated callers get a 401 before any work happens.

**Sanitising the response would be theatre, because the same text is already
public by design.** `sync_runs.error` is public-read (verified: `set local role
anon` can select it), and `components/pipeline-status.tsx:203` renders it on the
Pipeline tab — which Sprint 33 made the deliberate signed-out-visible exception
to `/settings`' auth wall. So these strings are already served to anyone loading
the site, by a *less* restricted path than the Edge Function the alert points
at. Hiding them in the HTTP 500 while leaving them on a public page would lock
the front door and leave the window open.

**Doing it properly would cost something real.** The fix would have to sanitise
what goes *into* `sync_runs.error`, not the response — and that panel's whole
purpose is saying why a sync broke. It is how the GW1 `sync-fixtures` kickoff
lag was diagnosed, and how FPL's matchday 403s on `sync-live-gameweek` were read
as third-party rate limiting rather than a bug here. The strings in practice
name a public third-party API, not this schema.

**What would change the answer**, either of:

- A `sync_runs.error` observed carrying a Postgres error that names this
  schema. That is a genuine leak, and the fix belongs at the `SyncRun` write,
  not at the HTTP response.
- The Pipeline tab moving behind the sign-in wall, at which point sanitising
  the Edge Function responses becomes coherent rather than cosmetic.

## Out of scope

Making the repo public (a separate, deliberate owner action, unblocked once this
is deployed); rotating the publishable key (pointless — it is public by design,
and Sprint 31 recorded why); rate limiting the read path (RLS governs it, and
`/functions/v1/` was the part with no equivalent).
