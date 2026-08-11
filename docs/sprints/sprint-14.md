# Sprint 14 — Authentication & Team Sync

**Status: built (2026-08-09), plus sub-sprints 14.1–14.4.** See [../roadmap.md](../roadmap.md) for
the sprint index.

Supabase Auth (magic link / email OTP), owned cloud storage for drafts, real-FPL-squad
import, and a session handoff standing in for the FPL login the roadmap originally
specified — see "FPL login is blocked" below for why. This is the item Sprint 8 recorded as
a gap ("a real-FPL-squad starting point waits on Sprint 14") and the item `lib/drafts.ts`
recorded as waiting on ("Cloud sync arrives with Supabase Auth in a later sprint").

**Auth.** Passwordless: `signInWithOtp` + a PKCE callback (`app/signin`, `app/auth/callback`),
mirrored into a `components/auth-provider.tsx` context every page reads. No password is ever
set, stored, or reset for the app's own accounts either — the static export has no server to
hash one against, and it sidesteps building a reset flow for no benefit at one owner's scale.

**Ownership schema — the first RLS beyond "Public read" in this project.**
`user_profiles` / `team_drafts` / `draft_snapshots` / `manager_rivals`, every one scoped
`auth.uid() = user_id` in both directions, migration `20260809190000_sprint14_auth_ownership.sql`.
Verified live, not just read from the policy definitions: with two throwaway `auth.users` rows
in a rolled-back transaction, user B's `select count(*)` against all three RLS-scoped tables
returned 0, and B's `update ... where draft_id = <A's known id>` affected 0 rows — A's row was
provably untouched afterward. `team_drafts.players` is `jsonb`, not the roadmap's original
`team_drafts` / `draft_players` / `draft_lineups` split — a draft is always read and written
whole, so a normalised child table would buy nothing but a hard FK to `players(season, id)`
that a season rollover would strand, the exact trap `manager_picks` already carries.

**Draft sync stays local-first.** `lib/drafts.ts`'s synchronous localStorage API is
unchanged — every existing page (`/builder`, `/scenarios`, `/transfers`, `/chips`) still
works signed out, exactly as before. `lib/draft-sync.ts` layers a replica on top: pulls on
sign-in, pushes on a 2s debounce after any local mutation (`onDraftsChanged`, a small
pub-sub `lib/drafts.ts` now exposes so it stays framework- and auth-agnostic), and merges
via `mergeDrafts` — the exact rule `importDrafts`'s merge branch already used (unseen draft
wins, else newer `updatedAt` wins), pulled out into its own export specifically so file
import and cloud sync cannot disagree about which copy of a draft is correct. Deletes are
tombstoned locally (`fpl_draft_tombstones_v1`) before being pushed as `team_drafts.deleted_at`,
so a delete on one device is not resurrected by a pull on another.

**Real squad import.** `lib/fpl-squad.ts`'s `teamStateFromPicks` turns one gameweek's
`manager_picks` into a `TeamState` with `source: "fpl"` — the value `TeamSource` has carried
unused since it was declared. `manager_picks` has no purchase price, so it falls back to
`now_cost`; `IMPORTED_SQUAD_NOTE` discloses this next to the "Import as draft →" button on
`/team`, following the same disclosure pattern as `SEASON_HORIZON_NOTE` and
`TRANSFER_MODEL_NOTE`. The fallback is exact for every player pre-GW1 (no price has moved
yet), which is why §F below is sequenced last rather than blocking this.

**Rivals leak closed.** `app/team/page.tsx`'s rivals table previously scanned every row in
`managers` (`.neq("entry_id", ...)`) — every manager anyone had ever connected on the
deployment, harmless with one user and wrong the instant there are accounts, since it would
show every user's claimed entry to every other user. Replaced with `manager_rivals`, an
explicitly-added set with an "Add rival by Manager ID" control and per-rival remove buttons.

## FPL login is blocked — automated credential login, not the session handoff

The roadmap originally specified "FPL login through an Edge Function". Probed read-only on
2026-08-09 after being asked to build password login specifically (the owner's FPL account
is Google-federated, but a password may also exist — the finding below turned out not to
depend on which): FPL's identity provider is **PingOne**
(`auth.pingone.eu`, environment `68340de1-dfb9-412e-937c-20172986d129`), found from the
config block in `fantasy.premierleague.com`'s own HTML.

| Route | Result |
|---|---|
| `users.premierleague.com/accounts/login/` — the classic form POST, and the exact method in the widely-cited [2019 Medium guide](https://medium.com/@bram.vanherle1/fantasy-premier-league-api-authentication-guide-2f7aeb2382e4) | **NXDOMAIN**, confirmed against Cloudflare's public resolver — a dangling CNAME to `plusers.ismfg.net`. |
| OIDC `password` / ROPC grant | **Not offered.** `grant_types_supported` has no `password` entry at all — there is nowhere to send a password, full stop. |
| `authorization_code` + PKCE with our own redirect URI | `"Redirect URI mismatch"` — the client belongs to the Premier League; a third party cannot register a callback on it. |
| `device_code` grant | `"Client is missing required grant type: DEVICE_CODE"`. |
| `response_mode=pi.flow` (DaVinci, no redirect URI needed) | **200, a live flow** — but its first node is a PingOne Protect **Protect Payload**, a device/bot-detection signal. No credential screen is reachable before it. |

Every standards-based door is shut by the client's own configuration, and the one reachable
flow opens with bot detection — automating past that is bot-detection bypass, out of scope
regardless of whether a password exists to send. Recorded as blocked with this evidence,
next to team strength and league 314, rather than worked around.

**Built instead — §F, the session handoff.** `app/settings/fpl` lets the signed-in owner
paste the `Cookie` header their own browser sends to `fantasy.premierleague.com` after
signing in normally (Google, 2FA, whatever — no bot to detect because it really is a human).
`supabase/functions/fpl-session` verifies the caller's Supabase JWT (unlike `sync-manager`,
which writes only public data and skips this) and encrypts the pasted value at rest
(AES-256-GCM, Web Crypto, `supabase/functions/_shared/crypto.ts`) under the
`FPL_SESSION_ENC_KEY` Edge secret. `fpl_sessions` has RLS **enabled with zero policies** —
verified live: even the row's own owner, authenticated as themselves, gets `count = 0`
through the anon/authenticated client. Only the service-role client inside an Edge Function
can reach it.

`supabase/functions/fpl-my-team` decrypts the session and calls the endpoint this probe
verified live and working: `GET https://fantasy.premierleague.com/api/my-team/{entry_id}/`,
which returns `403 {"detail":"Authentication credentials were not provided."}`
unauthenticated — a genuine Django-REST endpoint needing only a session. **Deliberately not**
`/drf/my-team/<id>`, the path the 2019 guide uses: that prefix is dead and returns a
misleading `200` — a 10,032-byte SPA shell with `content-type: text/html`, Fastly's response
for any unmatched path on that host, not data. `fpl-my-team` checks content-type as well as
status for exactly this reason. A lapsed session (expired cookie, or that same HTML-shell
trap) is treated as its own first-class state — `{ error: "lapsed" }` — never silently
folded into "no data," which would otherwise let an imported squad's sell prices go quietly
wrong instead of visibly asking for a fresh paste.

Both functions are deployed. **One step only the owner can do**: set the
`FPL_SESSION_ENC_KEY` Edge secret (a 32-byte key, base64-encoded) via the Supabase dashboard
or CLI — until then `fpl-session` fails closed with "Server is not configured to store this
yet" rather than storing anything unencrypted.

## Sprint 14.1 — Google sign-in, and an honest rate-limit error (built, 2026-08-09)

The first real sign-in attempt failed: `auth` logs showed `error_code:
"over_email_send_rate_limit"` on `/otp`, from Sprint 14's own verification round-trips
exhausting Supabase's built-in email sender's quota. That sender's cap is **a
project-wide, rolling hourly token bucket** — Supabase's own rate-limits docs are explicit
that it is changeable *only* by adding custom SMTP, which this app deliberately doesn't
have (sender verification wants a domain the app doesn't own; it lives on `workers.dev`).
There is no dashboard setting that raises the built-in cap, and no "used up permanently"
state — it refills continuously, confirmed by triggering the same 429 again with the exact
same error code an hour into the same session.

**Google became the primary sign-in path** (`app/signin/page.tsx`), sending no email at all
so the quota never applies to it. `app/auth/callback/page.tsx` needed no change for the
happy path — `flowType: "pkce"` / `detectSessionInUrl: true` exchange a Google `?code=`
identically to a magic-link one. It did need a genuine fix: cancelling at Google's consent
screen redirects back with `?error=access_denied&error_description=…` and no code, which
the callback page previously had no path for and would spin on "Signing you in…" forever.
Reading that off the URL had to go in a `useEffect`, not a `useState` lazy initializer — the
page is statically prerendered (no `window` at build time), so a lazy initializer produces a
genuine hydration mismatch between the prerendered "Signing you in…" and the client's
immediate error render. Caught by testing the exact cancelled-consent URL shape in the
browser, not by inspection — the mismatch only shows up once the client actually hydrates.

Magic link stays as the fallback (kept deliberately, not removed, once the mechanism was
confirmed to be a renewing hourly limit rather than a one-time cap) with its two most common
Supabase error codes explained in place of the raw string:
`over_email_send_rate_limit` points at the Google button; `email_address_invalid` (hit
during Sprint 14's own testing with `@example.com`) says the address was rejected rather
than echoing Supabase's bare message.

**Testing note, since this quota is genuinely easy to exhaust by hand**: send at most one
real magic-link OTP per testing session and prefer the Google button for anything repeated
— see [../../CLAUDE.md](../../CLAUDE.md), "Magic-link testing shares one project-wide email
quota".

## Sprint 14.2 — the §F session handoff doesn't work; replaced with a paste-the-JSON import (built, 2026-08-09)

The owner tested §F end to end: Save succeeded (`fpl-session` returned 200, a row existed
with a real ciphertext) but Test connection failed every time (`fpl-my-team` returned 401).
The cause is not a bug in either function — **FPL no longer authenticates `/api/` calls
with cookies at all.** Verified via `auth`/`edge-function` logs and live probes:

| Check | Result |
|---|---|
| `fpl-session` POST | 200, every time — Save and encryption both work |
| `fpl-my-team` GET | 401, every time, seconds after each successful Save |
| `fpl_sessions` row | Exists, `ciphertext` present, `entry_id` correctly set to 274486 |

A description of how a third-party FPL app ("Fantasy Football Manager") authenticates was
supplied as a possible fix. Checked rather than trusted, because one of its claims was
falsifiable in seconds:

| Claim in that description | Result |
|---|---|
| Posts credentials to `users.premierleague.com/options/login/` | Host is **NXDOMAIN** (Cloudflare public resolver, not just local) — a dangling CNAME to `plusers.ismfg.net`; the exact URL cannot open a connection |
| FPL returns `sessionid` cookies used for API auth | Contradicted directly by the 401s above |
| `GET /api/my-team/{id}/` needs auth | True — live, `403 {"detail":"Authentication credentials were not provided."}` unauthenticated |

That write-up describes the pre-PingOne world (it names `/options/login/` where the 2019
Medium guide named `/accounts/login/` — two variants of the same dead host). A web search
for the real, current mechanism turned up prior art (a working FPL MCP server) confirming
what the 401s already implied: FPL authenticates `/api/` calls with **a bearer token**,
sent as `X-API-Authorization: Bearer <token>`, minted from an **OIDC refresh token** that
lives only in the browser's `localStorage` (key `oidc.user:…`) — never in a cookie.
Escalating to implement that exchange (POST the refresh token to PingOne's token endpoint,
store the access token) was considered and declined: **the refresh token rotates on first
exchange**, retiring whichever copy the browser is still holding, so a server-side exchange
risks silently signing the owner out of their own FPL session or forcing a background
re-auth. Not a risk this app should take for a token whose payoff, measured against real
data, turned out to be zero anyway (next paragraph).

**The decisive finding was in the owner's own data.** Manually fetching
`/api/my-team/274486/` in a real logged-in browser (which works — the endpoint itself was
never the problem) returned all 15 picks with `purchase_price` identical to
`selling_price` and to current price (45/45, 120/120, 155/155, …), `bank: 0`, `value: 1000`.
Pre-season, no price has moved, so **the authenticated endpoint currently returns nothing
`now_cost` doesn't already give for free** — confirmed independently by the warehouse
(`manager_transfers`: 0 rows, `manager_picks`: 0 rows, next gameweek: 1). The whole token
chase was pointed at zero present value.

**What shipped instead — paste the response, skip the credential entirely.** The owner is
already signed in, in their own browser; fetching the JSON there and pasting it into the app
needs no cookie, no bearer token, no rotation risk, and nothing secret held server-side.
`teamStateFromMyTeamJson` (`lib/fpl-squad.ts`) parses and validates it (mirroring
`importDrafts`'s idiom in `lib/drafts.ts` — try/catch, shape guard, per-entry checks, plain
English errors) into a `TeamState` with FPL's **real** `purchase_price` per pick — strictly
better data than `manager_picks` will ever carry, since it also has `selling_price`,
`transfers.bank/value/limit`, and chip availability. `app/settings/fpl/page.tsx` was this
importer at the time; Sprint 14.3 moved it to `app/settings/page.tsx`'s Import tab and turned
`/settings/fpl` into a redirect (see Sprint 14.3, below).

Two decisions worth keeping:

- **`selling_price` is read but not stored.** `sellPrice` (`lib/transfers.ts:118`) is the
  one implementation of that rule (CLAUDE.md's "one quantity, one implementation"), so a
  second stored value would let the two disagree. Instead the pasted `selling_price` is a
  **cross-check**: recompute from the pasted `purchase_price` and flag a mismatch as a
  warning, never a silent override. Verified with a harness against the real payload (all
  15 agree) and a deliberately-wrong payload (the one mutated pick is caught, the other 14
  are not) — a genuinely new test of `sellPrice` against real data, which nothing else
  exercises it against.
- **`transfers.limit: null` + `status: "unlimited"`** is what pre-deadline looks like
  (confirmed in the real payload) and maps to `rules.squadSize` free transfers, not a
  default of 1 — a default of 1 would let `simulateTransfers` invent a −4 hit FPL would
  never actually charge pre-deadline.

**Superseded, not deleted.** `supabase/functions/fpl-session` and `fpl-my-team` stay
deployed but dormant — a working, JWT-gated, encrypted implementation, reversible for free
if a future season's data ever makes the bearer-token route worth the rotation risk; the
one stored row was deleted (`delete from fpl_sessions`) since a cookie it holds can never
authenticate anything. `IMPORTED_SQUAD_NOTE` (`lib/fpl-squad.ts`) — which used to end
*"Connecting your FPL session (Settings → FPL Account) replaces this with your real purchase
prices,"* a sentence that stopped being true the moment §F's design was disproven — now
correctly distinguishes the two import paths: `manager_picks` (today's price, exact
pre-GW1) versus a pasted `my-team` response (FPL's real purchase price, always).

## Sprint 14.3 — a signed-in-only pipeline bug, squad naming, and an account menu (built, 2026-08-10)

Using the Sprint 14.2 import end to end surfaced three issues, the first a genuine
regression every earlier verification pass ran signed out and so never hit.

**"Data pipeline: unreachable" for any signed-in visitor.** `app/page.tsx` queries
`health_check` with `.single()`. That table's RLS policy
(`20260802234938_create_health_check.sql`, the very first migration) granted `SELECT`
**`to anon` only** — written before the `to anon, authenticated` convention every later
table follows. Signing in flips the client's role from `anon` to `authenticated`, the
policy stops matching, and the query returns zero rows. Proven by running the exact query
as both roles before and after: `anon` saw 1 row throughout; `authenticated` saw 0, then 1
after `sprint14_3_fix_health_check_rls` recreated the policy as `to anon, authenticated`.
A sweep of every RLS-enabled public table for the same shape (`SELECT` granted to `anon`
without `authenticated`) found exactly one other case — `fpl_sessions`, which has **zero**
policies by design (not even `anon`) — so this was a one-table fix, not a systemic pattern.

**Every import was named "Imported squad", identically, forever.** `lib/drafts.ts` gains
`uniqueDraftName(base)`, appending ` (2)`, ` (3)` … on a collision, used by both the
importer (named from the linked FPL team, e.g. "DS United", falling back to "Imported
squad" if no Manager ID is linked yet) and by `cloneDraft`, which had the identical latent
bug — its old unconditional `" (copy)"` suffix collided on a second clone of the same
draft. `renameDraft`'s return type changed from `TeamState | null` to
`{ state, error }`: a collision is now a clear message ("A draft called \"X\" already
exists") with the rename input left open to correct, rather than `null` indistinguishable
from every other rejection reason and silently discarded by its one caller
(`app/scenarios/page.tsx`, which previously never checked the return value at all).

**The header carried four separate controls** (email, "FPL Account" link, Sign out, theme
toggle) once sign-in existed to add them. Replaced with one circular `AccountMenu`
(`components/account-menu.tsx`) — initials from the linked FPL team name, a generic icon
otherwise — reusing the click-toggle / outside-click / Escape popover convention
`components/nav-links.tsx` and `info-tooltip.tsx` already share rather than inventing a
fourth version of it. The menu is **always rendered**, signed in or out, specifically so
theme switching is never unreachable — signed out it holds Theme + Sign in; signed in,
Manage account + Theme + Sign out. `components/theme.tsx`'s cycling `ThemeToggle` button
became a `useThemeMode()` hook (three explicit choices needed a different shape than a
cycle), and `components/auth-provider.tsx` now loads the claimed profile
(`user_profiles.entry_id` → `managers.team_name`) once per session alongside the existing
`user`/`session`, exposed as `entryId`/`teamName`/`refreshProfile()` — the header, `/team`,
and the settings page all need the same two fields, so fetching them per-component would
mean three queries doing the same join on every page load.

**"Manage account" lands on `/settings`**, a single page with two tabs
(Account details, Import squad) using the tab pattern already built on `/fixtures`
(`tabButton`/`type Tab`/`aria-current`) rather than a new mechanism, with the active tab
read from `window.location.search` — not `useSearchParams`, which every other
`?draft=`-reading page already avoids for the same reason: it needs a Suspense boundary
this static export has no existing precedent for. `/settings/fpl` (the Sprint 14.2 route)
is now a redirect to `/settings/?tab=import`, kept rather than deleted so the link already
placed on `/team`'s empty state, and any existing bookmark, doesn't 404.

**A React warning caught by testing the account menu, not assumed clean**: both
`/signin` and (at the time) `/settings/fpl` called `router.replace()` directly in the
render body rather than an effect — a real "setState on a different component during
render" warning that only fires on the branch each page redirects *from*, which every
earlier signed-out-only or signed-in-only test pass had never exercised. Fixed with
`useEffect` in both places, and in `/settings`'s own redirect gate, re-verified clean on a
fresh tab.

## Sprint 14.4 — the import instructions told users to do the one thing that 401s (built, 2026-08-10)

Testing the Sprint 14.2 import flow in a real browser (Zen/Firefox) surfaced that its own step 1
never works: it told the user to open `fantasy.premierleague.com/api/my-team/<id>/` directly in a
new tab. That request carries only cookies, and the endpoint wants
`X-API-Authorization: Bearer …` — the exact gap Sprint 14.2 documents above — so the tab returns
`{"detail": "Authentication credentials were not provided."}` even for a signed-in user. The
instructions were written before that failure mode was confirmed live and never updated to match.

`app/settings/page.tsx`'s `ImportTab()` now walks the DevTools Network tab instead: open
`/my-team`, open DevTools, reload, filter for "my-team", open the matching request's Response tab,
copy the body. The URL hint (`myTeamUrlHint`) substitutes the signed-in user's real `entryId` where
it previously always showed the `<your Manager ID>` placeholder, so step 4 ("the request ending
in …") is something the user can actually match in the request list. `teamStateFromMyTeamJson`
(`lib/fpl-squad.ts`) gained a check ahead of the generic shape guard: a paste matching `{"detail":
...}` — the exact body the old instructions caused — now returns a message naming the bearer-token
gap and pointing at the Network tab, instead of falling through to "doesn't look like picks and
transfers". Two related crash paths caught while in the file: `data.chips` is now optional (was an
unguarded `.find` throwing when absent) and `transfers: null` is rejected explicitly (previously
passed `typeof x === "object"` and threw later on `.value`) — both used to surface a raw
`TypeError` through the page's catch block rather than a plain-English error.
