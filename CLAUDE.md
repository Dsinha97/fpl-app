@AGENTS.md

# FPL Decision — Analytics Hub

Personal Fantasy Premier League analytics and decision-support app. Static Next.js
front end on Cloudflare, Supabase Postgres + Edge Functions behind it.

- Live: https://fpldecision.com/ on Cloudflare Workers static assets ·
  repo `Dsinha97/fpl-app` (**private**)
- Supabase project `FPL-App`, ref `fyxyqxpscmqjyjxsyhms`
- Owner's FPL manager ID **274486**; season being ingested 2026-27 (GW1 deadline 2026-08-21)
- Full documentation index, including status: [docs/README.md](docs/README.md). Start there.
  Planned work and its status live in Linear — mapping: [docs/linear.md](docs/linear.md).
  Sprint plan: [docs/roadmap.md](docs/roadmap.md). Architecture/schema: [docs/architecture.md](docs/architecture.md).
  xP model method + backtest: [docs/phase-4-model.md](docs/phase-4-model.md). Topic wiki (how/why,
  cross-linked, source-attributed): [docs/wiki/index.md](docs/wiki/index.md).

## Commands

```bash
npm run dev          # Next dev server (Turbopack)
npx tsc --noEmit     # typecheck — run before every commit
npm run lint         # eslint
npm run build        # static export to out/ — must pass before pushing
```

Never start the dev server with Bash; use the preview tools. If Turbopack reports a
parse error that `tsc` and `npm run build` both disagree with, it is a stale `.next`
cache — delete `.next` and restart.

## Current state

Status, built features, and version are tracked in [docs/README.md](docs/README.md) — check
there, not here. **Next:** see roadmap.md's own "Next up" section, not a sprint name pinned
here — that's what went stale last time (this line named Sprint 13/15 long after both had
either shipped or blocked). Full plan: [docs/roadmap.md](docs/roadmap.md).

## Ground rules

**Linear is the planning interface.** The [FPL-App](https://linear.app/dsinha-org/project/fpl-app-83aaf6f4e868)
project (team `DSI`) holds what is planned and what its status is; `docs/` holds what happened and
why. Read the Linear backlog before proposing new work — an item changed or added in the dashboard
outranks a stale "Next up" line in roadmap.md. When a sprint ships, close its issue and add its row
to [docs/linear.md](docs/linear.md). Don't restate a gate in Linear that `docs/roadmap.md` already
states — link it. `/linear-sync` reconciles the two and reports drift in both directions.

**Secrets.** Never ask for, store, or accept the Supabase DB password or an FPL password.
Migrations and function deploys go through the Supabase MCP OAuth integration; secrets are
referenced by name only, in `.env.local`, GitHub Secrets, or Cloudflare Build variables —
never pasted into chat or a commit.

**FPL login is blocked, and a pasted cookie authenticates nothing — don't re-derive
either.** PingOne (FPL's identity provider) offers no password grant, and its one reachable
flow opens with bot detection. `/api/` calls need a bearer token minted from a
browser-only OIDC refresh token, never a cookie. `app/settings/fpl` and
`supabase/functions/fpl-session`/`fpl-my-team` are superseded but deliberately still
deployed — don't remove them. Real purchase prices come from the owner pasting `my-team`
JSON they fetch themselves, parsed by `teamStateFromMyTeamJson` (`lib/fpl-squad.ts`). Full
probe evidence: [docs/sprints/sprint-14.md](docs/sprints/sprint-14.md).

**Row Level Security is a real access boundary — verify it, don't just enable it.** Before
trusting a new policy, simulate a second user with `set_config('request.jwt.claims', ...)`
inside a rolled-back `execute_sql` transaction and confirm zero rows/writes leak. New
owner-scoped tables use `auth.uid() = user_id` in both directions; tables before Sprint 14
use public-read/service-write (`to anon, authenticated using (true)`) — don't mix the
shapes without a reason.

**Missing pre-season data — drop, renormalise, disclose.** Several formulas reference
fields FPL zeroes between seasons (team strength, `players.form`). Don't multiply a term by
zero and ship a quietly shrunken score — drop the term, renormalise the remaining weights,
and surface a `*_MODEL_NOTE`/`*_NOTE` next to the number (grep `lib/` for the existing
precedents before writing a new one).

**When a term cannot be dropped, make it an input.** If the missing quantity is itself the
feature, don't estimate it — expose it as a documented, user-set input instead
(`decisionMargin` in `lib/transfer-optimizer.ts` is the precedent). Never tune an invented
coefficient until the answer looks reasonable.

**Say what the number means.** Downgrades are labelled as downgrades; empty result sets say
so rather than ranking worse options. Costs and assumptions stay their own terms — a
headline reads `+8.5 xP − 8 hit − 0.2 risk = +0.3`, never a bare net figure.

**One quantity, one implementation.** `riskPoints` (`lib/squad-score.ts`) is the only
risk→points rate; the transfer optimiser scores every branch through `simulateTransfers`
rather than a second scorer. Two implementations of one number is a bug with a delay on it.

**Squad rules come from the database.** Load `SquadRules` from `game_settings`; never
hardcode 15 players / £100m / 3-per-club.

**Verify, don't assume.** Probe the FPL API before designing against it, and check asset
URLs with curl — several documented patterns 404.

## Layout

```
app/            routes: / · /team · /leagues · /players · /fixtures · /builder · /scenarios ·
                /transfers · /chips · /compare · /changes · /news · /deadline · /review ·
                /status · /signin · /settings
lib/            stats.ts (shared mean/median/variance/quantile — import, don't redeclare),
                team-state.ts, optimizer.ts, lineup.ts, scoring.ts, squad-score.ts, transfers.ts,
                transfer-optimizer.ts, chips.ts, tactical-profile.ts (types + loader only,
                deliberately no scoring function), player-search.ts, formation.ts, fdr.ts,
                drafts.ts, draft-sync.ts, fpl-squad.ts, manager-profile.ts, utils.ts
components/     pitch-view, pitch, player-card, player-detail, armband, transfer-plan,
                fixture-schedule, fdr-matrix, draft-timeline, confidence-badge,
                manager-profile-card, club-tactics, brand, theme, nav-links, account-menu, ui/
supabase/       migrations/ (SQL) · functions/ (Deno Edge Functions) · functions/_shared/
docs/           README.md is the index — see it for the full file map
```

Full module-by-module map, routes table, and data model: [docs/architecture.md](docs/architecture.md).

`supabase/functions/**` is Deno and is **excluded from tsconfig and eslint** — it must be,
or `tsc --noEmit` breaks on Deno globals.

## Front-end conventions

- Everything squad-shaped consumes the shared `TeamState` (`lib/team-state.ts`). Mutations
  are pure functions returning a new state — `addPlayer`, `removePlayer`, `setCaptain`,
  `setViceCaptain` (which **swaps** rather than vacating the other armband).
- Horizon (`1 | 3 | 5 | 8 | 19 | "season"`, with `HORIZONS`, `horizonLabel` and
  `horizonLength` in `lib/team-state.ts`) is a **page-level** control that drives the
  projection, picker, optimiser, and comparison. `"season"` is a string, so anything doing
  arithmetic on a horizon must go through `horizonLength`, never the value itself.
- Player search goes through `matchesPlayerQuery` (`lib/player-search.ts`) — `web_name`
  alone is not enough, FPL abbreviates it (`E.Anderson`).
- Dark theme is class-based (`.dark` on `<html>`, no-FOUC boot script in `app/layout.tsx`).
  Brand purple: `#0E0118` page / `#1E0234` card / `#2A0A45` input, `#00FF87` accent. Style
  both themes on anything new.
- Static export means no server components fetching at request time, no route handlers, no
  `next/image` optimisation.

## Gotchas that have bitten

- Supabase `.select()` needs a single string literal; concatenating with `+` collapses the
  row type to `GenericStringError`.
- **The API caps every response at 1000 rows** whatever `.limit()` asks for — page with
  `.range()` until a short page comes back, or a large table (e.g. `player_predictions`)
  quietly shrinks.
- Edge Functions called from the browser need CORS preflight (`preflight()` in
  `_shared/sync.ts`) — curl never exercises the OPTIONS request.
- `trailingSlash: true` is required or a direct hit on `/team/` 404s.
- **Cloudflare's setup wizard configures the OpenNext adapter** on seeing `next` in
  package.json — wrong for this static export (`output: "export"`, plain `npm run build`,
  `wrangler.jsonc` serves `out/`). Don't let the wizard re-add it.
- **Cloudflare runtime variables are not build variables.** `NEXT_PUBLIC_*` is baked in at
  build time; set only as a runtime binding, `createClient` throws `supabaseUrl is
  required` during prerender.
- FPL kit images need the size suffix: `shirt_{team_code}-110.png`, GK
  `shirt_{code}_1-110.png`. Crests: `resources.premierleague.com/premierleague/badges/70/t{team_code}.png`.
  Region codes aren't all ISO — EN/S1/WA/NI map to flagcdn `gb-eng`/`gb-sct`/`gb-wls`/`gb-nir`.
- Don't touch refs inside an IIFE in JSX; hoist into a `useMemo` or React lints it.
- **A page tested only signed-out can hide an RLS policy that only covers `anon`.** Simulate
  both roles (`set local role …` + `request.jwt.claims` in `execute_sql`), not just the one
  the feature you're building happens to exercise.
- **`router.replace()` in a render body, not an effect, is a real React warning** that only
  fires on the branch a page redirects *from* — a signed-in-only or signed-out-only test
  pass never triggers it. Always wrap in `useEffect`.
- **Filling a budget-constrained squad greedily by raw score is wrong.** It's a knapsack —
  order the fill by score *per million*, then let swap passes spend the surplus on raw
  points. A legality floor is not a quality floor.
- **Bounded searches prune the moves that only pay off in combination.** A beam ranked
  purely by gain drops a funding leg before its payoff leg exists — carry funders alongside
  winners (`FUNDER_WIDTH` in `transfer-optimizer.ts`).
- Verify engine changes by running the real module against live data in a `npx tsx` harness
  before trusting the UI — both bugs above survived review and were caught that way in
  minutes. Keep the harness out of the commit.
- **A prior fitted on a filtered sample answers a different question.** Check what a
  fitting filter selects *for* — fitting a playing-time prior only on 450+ minute seasons
  conditions on the very thing being predicted.
- **A variance needs far more data than a mean.** Estimate spread at the coarsest level
  that is still meaningful, or it collapses to zero on thin cells and the prior silently
  overrides real evidence.
- **An acceptance threshold you invented is not evidence.** Gate on an existing backtest
  (bias, MAE, Pearson r), not a round number that sounds right.
- **`manager_season_history.rank_percentage` is FPL's own "top X%" — lower is better.**
  `lib/manager-profile.ts` flips it to a 0–100 higher-is-better `percentileScore`; don't mix
  the two conventions in one screen.
- **`total_players` is a pre-season snapshot, not a field size** — it climbs ~4× before
  GW1. Nothing consumes it yet; `game_settings.updated_at` is the sample-time record.
- **Bank is stored cash, not a residual.** `TeamState.bank` is the primitive; total
  budget is derived (`bank + squadSellValue`). Deriving it the other way — from the
  frozen at-sync `budget` — charges a *per-player* price move to the team's cash: one
  player rising £0.2m silently took £0.1m out of Bank and tripped "over budget" on a
  legal squad. Read it only through `squadBank` (`lib/squad-budget.ts`); `addPlayer`/
  `removePlayer` are what move it, so `removePlayer` needs the outgoing player's live
  price to credit `sellPrice`, not what was paid. Drafts saved before the field existed
  have no bank to recover and keep the old drifting derivation until re-imported.
- **CSS Grid — and flex rows — stretch every cell to its tallest sibling.** A `grid ...
  sm:grid-cols-2`-style pairing of independently-expandable/variable-height cards (e.g.
  `LiveFixtureCard`, `ClubTacticsGrid`) shows dead space (default `stretch`) or ragged bottoms
  (`items-start`) once one card expands and its row-mate doesn't. Switching to `flex flex-wrap`
  with a fixed `w-[calc(...)]` basis per card is only half the fix — flex rows default to
  `align-items: stretch` too, so an expanded card still inflates its still-collapsed row-mate.
  Add `self-start` on the card itself alongside the `w-[calc(...)]` basis.

## Communication style

**Keep responses concise.** Skip preamble and restating the request; lead with the answer
or the change. Match length to the question — a one-line question gets a one-line answer.

## Notifications

`PushNotification` reaches the owner's phone when Claude Code Remote Control is paired. Use it at
approval gates and when a long run finishes — a migration awaiting sign-off, a red build, a sprint
landing. Not for routine progress.
