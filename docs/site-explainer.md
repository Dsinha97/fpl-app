# Site explainer — for the design audit

What FPL Decision is, who it's for, and what every route actually does today (2026-09-11,
post–Sprint 33 merges). Written as prep for a design audit, not as ongoing reference — the
living version of this is [docs/architecture.md](architecture.md)'s Routes table.

## What the site is

A personal Fantasy Premier League decision-support tool for one manager (FPL manager ID
274486). It's not a general FPL app for many users — it's built around one real squad,
imported from the owner's own FPL account, with a Postgres backend that runs an in-house
expected-points (xP) model over every player and every fixture. The pitch on the landing
page: *"Transfers, captaincy, chips, and fixtures — decided with data, not vibes."*

Signed-out visitors see a marketing splash (`/`) with two calls to action — import your
squad, or browse players. Signed-in visitors skip the splash entirely and land on
`/deadline`, the day-to-day decision surface.

## Navigation model

The nav groups 10 routes into three dropdowns, reflecting three different questions the
owner asks:

- **Live** — "what's happening right now": Deadline, My Team, Leagues, News
- **Strategy** — "what should I do": Builder, Scenarios, Transfers
- **Statistics** — "reference data, not a decision": Players, Fixtures

Settings/sign-in sit outside the groups (account chrome, not analysis). Four former
top-level routes — `/changes`, `/chips`, `/review`, `/status` — are gone from the nav but
still exist as client-side redirect stubs, so old bookmarks and deep links land on the page
that absorbed them instead of 404ing.

## Page-by-page

### `/` — Landing
Marketing splash for signed-out visitors only; signed-in visitors are redirected straight
to `/deadline`. Two buttons: import your squad, or browse players.

### `/deadline` — Deadline Hub (Live)
The default landing page and the app's main daily surface. Countdown to the next deadline,
squad legality check, availability alerts, captain/vice recommendation, a transfer call
(behind a button, not automatic), this-gameweek's chip call, and a squad-scoped news feed.
Read/render layer over the model — doesn't compute anything new itself. Splits into
live-gameweek vs. upcoming-gameweek views.

### `/team` — My Team (Live)
The owner's real FPL squad, synced from the live API. Also: "Import as draft" (paste
`my-team` JSON when the FPL login flow itself is blocked — see CLAUDE.md), rival-manager
tracking, a season transfer ledger, and — since Sprint 33 — the gameweek review (post-mortem
on a finished gameweek) folded into the same gameweek selector this page already had,
instead of a second page with a second, disagreeing selector.

### `/leagues` — Leagues (Live)
Mini-league standings plus effective ownership (EO): who else in your leagues owns which
players, differential picks, rank-gain-if-captained. Wires up an EO engine that shipped
back in Sprint 10 but had nothing rendering it until Sprint 29.

### `/news` — News (Live)
Two tabs: a `change_feed` of price moves, ownership shifts, availability/news updates, and
fixture changes; and an RSS "Feeds" tab pulling real headlines and tagging them to players.
Renamed from `/changes` once the RSS tab made "changes" too narrow a name.

### `/builder` — Builder (Strategy)
Full squad builder: pitch view, a paginated player picker, a knapsack-style squad
optimiser, a starting-XI/captain engine, a replacement finder, and per-gameweek planning.
The most complex single page in the app (~2,600 lines).

### `/scenarios` — Scenarios (Strategy)
Draft manager for "what if" squads: ranks drafts by SquadScore, compares 2–4 drafts
side by side, and saves a timeline of them.

### `/transfers` — Transfers (Strategy)
Weekly transfer plan → basket simulation with hit costs and sell prices. Since Sprint 33
also carries chip timing as a tab (merged from the old standalone `/chips` page — both
pages planned the same draft through the same engine, so editing them in two places could
disagree).

### `/players` — Players (Statistics)
The player explorer: paginated, searchable, filterable by position/team/price. Since
Sprint 33 also opens a slide-over comparison panel (merged from the old standalone
`/compare` page) instead of navigating away to compare 2+ players.

### `/fixtures` — Fixtures (Statistics)
Schedule and FDR-matrix sub-tabs, plus a Premier League table tab and club tactical
profiles.

### `/settings` — Settings
Account chrome, not analysis: link a Manager ID, import a squad by pasting `my-team` JSON,
Telegram link, and — since Sprint 33 — a "Pipeline" tab (merged from the old standalone
`/status` page) showing `sync_runs` health per Edge Function.

### `/signin`, `/auth/callback`
Google OAuth (primary) and magic-link (fallback) sign-in, plus the shared PKCE callback.
Magic link exists because Supabase's built-in email sender is rate-capped. That last part
may now be stale: a link sent 2026-09-13 arrived from `noreply@fpldecision.com`, not
Supabase's default sender, which implies custom SMTP *is* configured — the "no custom SMTP"
copy in `app/signin/page.tsx` and the quota warning built on it should be re-checked against
the Supabase dashboard before either is relied on.

There is also now a dev-only test account (`test@fpldecision.com`, a Cloudflare Email Routing
alias) for driving the signed-in state during this audit — see
[docs/wiki/database-and-rls.md](wiki/database-and-rls.md#the-test-account).

### Redirect stubs (no longer in the nav)
`/changes` → `/news`, `/chips` → `/transfers?tab=chips`, `/review` → `/team`,
`/status` → `/settings?tab=status`, `/compare` → `/players?panel=compare`. Each preserves
any query params (`?ids=`, `?event=`, `?draft=`) the old deep link carried.

## Cross-cutting things worth knowing for a design audit

- **Horizon** (`1 | 3 | 5 | 8 | 19 | "season"`) is a page-level control that drives
  projection, picker, optimiser, and comparison together on Builder/Scenarios/Transfers/
  Players — it's meant to feel like one shared setting, not a per-page one.
- **Dark theme is the primary theme** — class-based (`.dark` on `<html>`), brand purple
  background with a `#00FF87` accent. Both themes need styling on anything new.
- **Static export** — every page fetches its own data from Postgres in the browser at
  runtime; there's no server-rendering step to hide loading states behind, so skeletons /
  spinners are load-bearing UI, not decoration.
- Four pages are literally just a redirect (~25 lines each) — if the audit is counting
  "pages," the real page count is 14, not the 18 folders under `app/`.
