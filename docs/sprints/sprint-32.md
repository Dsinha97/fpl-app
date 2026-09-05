# Sprint 32 — Lock down the Edge Function surface (scoped 2026-09-03, not started)

**Why now.** Sprint 31 settled every public-repo blocker except one, and this is
it. `/functions/v1/sync-*` is callable by anyone holding the publishable key,
which today means anyone who opens devtools on fpldecision.com. Publishing the
repo does not create that exposure — but it changes who finds it. Public GitHub
repos are scraped continuously and mechanically for keys and endpoints in a way
minified bundles are not, so a `sb_publishable_…` string in a public repo gets
harvested in days without anyone deciding to look. **The repo flip waits on
this.**

The blast radius is bounded and worth stating honestly: every sync function is
idempotent, reads public FPL data, and writes public tables, so this is not a
data-disclosure problem. The cost is *yours* — Supabase invocations, egress and
compute on the project's bill, and FPL API traffic attributed to this project,
which is the kind of thing that gets a project throttled.

---

## The one thing that makes it worse than it looks

`sync-fixtures` accepts `?force=1`, which **bypasses its own self-gate**
(`supabase/functions/sync-fixtures/index.ts`). The scheduling migration's whole
cost argument — "self-gating, so their short intervals cost one cheap query on
most invocations" — evaporates for anyone who appends a query parameter. That
turns the cheapest case into the most expensive one on demand: a full 380-fixture
pull from FPL per call. Check every function for the same escape hatch while
doing this; `force` is a debugging affordance that was never meant to be
reachable from the open internet.

## The shape: two classes of function, two different fixes

The surface splits cleanly by who legitimately calls it. Establishing that split
is most of the work; the fixes follow from it.

### Class A — cron-only. No legitimate browser caller at all.

`sync-bootstrap`, `sync-fixtures`, `sync-player-history`, `sync-live-gameweek`,
`sync-news`, `sync-claimed-managers`, `generate-predictions`,
`ingest-fpl-archive`.

**Fix: a shared secret header, minted by `invoke_sync` from a Vault secret.**
These are reachable today only because they authenticate with a key that is
public by design. Give them a second header that has no public copy, and reject
anything without it. That takes the endpoint from "anyone holding the publishable
key" to "the database's own cron, and nothing else" — which is what these
functions actually needed all along.

**Note the deliberate contrast with Sprint 31**, because the same tool gets the
opposite verdict and the reason matters. Vault was *rejected* there for the
publishable key: an identical copy already ships in the browser bundle, so
hiding the repo's copy would have changed nothing about who could call the
endpoint while adding a silent-401 failure mode. Here Vault is *correct*, for
precisely the inverse reason — the new secret has no public copy anywhere, so
hiding it is the entire mechanism rather than theatre. Tool identical, verdict
opposite, and the difference is the reasoning, not the tool.

### Class B — browser-invoked. Must stay reachable, but not by everyone.

`sync-manager` (`app/settings/page.tsx:62`, `app/team/page.tsx:339` and `:1051`)
and `sync-league-picks` (`lib/leagues.ts:116`).

**Fix: `verifyUser` plus a per-user rate limit.** `verifyUser` already exists
(`supabase/functions/_shared/auth.ts`) and is already used by `fpl-session` and
`fpl-my-team` — this is adoption, not new code. Its header comment currently
argues these sync functions "deliberately skip this — a sync triggered by any
visitor is harmless." That premise expires the moment the repo is public and the
endpoint is greppable; **update the comment in the same change**, or the next
reader inherits a stale justification (AGENTS.md's folder convention: a stale
claim gets fixed everywhere it lives).

Requiring a signed-in user turns "anyone on the internet" into "anyone with an
account", which is necessary but not sufficient — accounts are free. The rate
limit is what bounds it.

## Rate limiting

`sync_runs` (`20260803001253_phase1_reference_schema.sql:281`) already records
every execution with `function_name` and `started_at`, which is most of the
substrate. What it lacks is *who*.

Recommended: add `invoked_by uuid null references auth.users(id)` to `sync_runs`
plus an index on `(function_name, invoked_by, started_at desc)`, and have Class B
functions count rows in a window before doing any work. One table, one
implementation, and the rate limit is queryable next to the audit trail that
already exists.

The wrinkle to decide during implementation rather than now: `sync_runs` is an
audit of *runs*, and a rejected call is not a run. Either write a `rejected` row
(cheap, and the record of who is hammering what has real diagnostic value) or
keep rejections out of the audit and count only successes (cleaner semantics,
blind to abuse). Prefer the former, and extend the `sync_runs_status_check`
constraint rather than working around it.

**Do not invent the limit.** Pick it from what legitimate use actually does —
`/team`'s Refresh button and `/leagues`' sync button, at human speed — and put
the number in `game_settings` as a documented, user-set input rather than a
constant tuned until it felt right (CLAUDE.md's `decisionMargin` precedent).

## Also worth doing while in here

- **CORS is `Access-Control-Allow-Origin: "*"`** (`_shared/sync.ts:113`).
  Tighten Class B to the known origins (`fpldecision.com`, localhost for dev).
  This is defence in depth, not a control — CORS binds browsers, not `curl` —
  so it must not be mistaken for, or substituted for, the auth work above.
- **`supabase/config.toml` carries only `project_id`.** Whatever `verify_jwt`
  posture these functions are deployed with is currently implicit. Make it
  explicit per function so it is reviewable in the repo rather than being a
  property of how someone last ran `supabase functions deploy`.
- **`fpl-session` / `fpl-my-team`** are superseded but deliberately still
  deployed (CLAUDE.md). They already call `verifyUser`, so they are not part of
  the problem — but confirm rather than assume, since they are the two functions
  that touch per-user data.

## The deployment ordering, which can break everything

The Class A change has a real failure mode, and it is the one Sprint 31 named
when rejecting Vault for the publishable key: **if the function starts requiring
a header before `invoke_sync` sends it, every scheduled sync silently 401s** —
and silently is the operative word, because `sync_runs` would record failures
that nobody is watching.

Sequence deliberately:

1. Create the Vault secret.
2. Migration updating `invoke_sync` to send the header. Cron now sends something
   the functions ignore. Harmless.
3. Deploy the functions that require it.
4. **Verify against `sync_runs` before walking away** — confirm a real cron tick
   lands `success`, not `error`, for at least one function on a short cadence
   (`sync-live-gameweek` at `*/2` is the fastest signal).

Rolling back means reversing 3 then 2, in that order, for the same reason.

## Verification

Per CLAUDE.md's "verify, don't assume" and the RLS precedent of simulating the
role rather than trusting the policy:

- `curl` a Class A function with the publishable key and **no** cron secret →
  must be rejected. This is the exact request the threat model is about, so run
  it rather than reasoning about it.
- `curl` the same with the secret → succeeds.
- `curl` `sync-fixtures?force=1` unauthenticated → rejected, and confirm the
  self-gate bypass is closed rather than merely guarded.
- Class B signed-out → rejected; signed in → succeeds; signed in over the limit
  → rejected with a real message, and the UI surfaces it rather than failing
  silently (`/team`'s Refresh and `/leagues`' sync both have visible buttons that
  need a sensible error state).
- A second user's limit is independent of the first's — same
  `set_config('request.jwt.claims', …)` discipline the RLS checks use.
- **`sync_runs` after a full cron cycle**: every scheduled function still
  succeeding. This is the regression test that matters most, because the failure
  is silent.

## Out of scope

Making the repo public (a separate, deliberate owner action, unblocked once this
lands); rotating the publishable key (pointless — it is public by design, and
Sprint 31 recorded why); rate limiting the read path (RLS already governs it,
and `/functions/v1/` is the part with no equivalent).
