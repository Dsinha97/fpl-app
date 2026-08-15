# Additional info

Ops log, housekeeping, and small finished items that don't belong in a sprint file or in the
top-level roadmap. See [../roadmap.md](../roadmap.md) for the sprint index.

## Numbering correction

`update-aug3.md` lists Sprint 4 as "Squad Optimizer". In this repo the squad optimiser shipped in
Sprint 2, and Sprint 4 delivered the **comparison engine and replacement finder** — which the new
document numbers as Sprints 6 and 7. Those were therefore already built when this file was written.
Sprints 5, 8 and 9 have since shipped; **Sprint 12A, Manager Percentile Profile** shipped alongside
this reconciliation (10 is blocked pre-season, 11 is built, 13 needs a live match, 14 is
authentication). **Sprint 12, Chip Strategy Engine, is built** after its prerequisite, extending the
prediction window past 8 gameweeks, landed 2026-08-06.

## Pre-Sprint-12 finishing batch (2026-08-06)

Cleared before starting Sprint 12 proper: the prediction-window extension it depends on, plus four
items this file had recorded as knowingly carried.

- **Prediction window extended.** `generate-predictions`' `HORIZON = 8` is replaced by a window
  derived from `chip_definitions` — the chip window covering the next gameweek (GW1-19 today,
  Wildcard #1's real span), floored at 8 and clamped to the season's last gameweek. `player_xp_horizons`
  gains `last_event` so a consumer can read the real span rather than inferring it from `fixtures`.
  "Season" now means that real window everywhere it is used — `horizonLength`, `fixtureScore`,
  `riskScore`, `comparePlayers` and `squadScore` all take an optional `seasonWindow`, threaded through
  from `first_event`/`last_event` on each page that needs it, defaulting to 8 (today's floor) where not
  yet wired. `SEASON_HORIZON_NOTE` is now `seasonHorizonNote(windowGws)`, stating the real figure
  instead of a claim that stopped being true the moment the window moved. Deployed and verified live:
  `events: "1-19"`, 10,868 rows, `squad_consistency_violations` unchanged at 10.
- **Dependency advisories cleared** (see "Dependency advisories" below, kept for the record) —
  `next` bumped to 16.3.0, `shadcn` moved to `devDependencies`. `npm audit` now reports only the
  `hono` moderate advisory, isolated to `shadcn`'s own dev-time tree.
- **CSP added** to `public/_headers` (see "Hosting follow-ups" below).
- **Sprint 7 gaps closed** — `findReplacements` takes an optional trailing `ReplacementFilters` object
  (minimum start probability, price ceiling, "include below the minutes floor", `seasonWindow`) without
  changing its existing positional `limit` or default, so `/transfers` and `transfer-optimizer.ts`'s beam
  search are unaffected. The builder panel now shows 10 by default (5/10/20 control) with all three
  filters user-adjustable via `components/ui/range-slider.tsx`'s new single-thumb `ValueSlider`.
- **Sprint 9 follow-on, half closed** — `SquadBalance` is now computed and shown as its own rationale
  line (change in the squad's week-to-week coefficient of variation from the swap), loaded lazily only
  when the replacement panel is first opened. It is **not** folded into `teamFit`'s ranking — no
  exchange rate combines it with xP/fixture/risk, since inventing one would be exactly the "fudge
  factor" `TRANSFER_OPTIMIZER_NOTE` already warns against for the sibling `FutureFlexibility` term.
  `FutureFlexibility` itself stays unbuilt: the design spec never gives it a formula, and no computable
  proxy was found here that doesn't invent a coefficient with nothing to fit it against — the same
  conclusion `transfer-optimizer.ts` already reached, which is why its own roll-vs-spend decision
  exposes `decisionMargin` as a disclosed input rather than modelling it. `REPLACEMENT_MODEL_NOTE`
  says both of these things now.
- **Draft export/import shipped** on `/scenarios` (see "Hosting follow-ups" below).

## Hosting follow-ups (recorded 2026-08-04, after the move to Cloudflare)

- **Content-Security-Policy — done (2026-08-06).** `public/_headers` now sets one: `connect-src` for
  the Supabase project, `img-src` for `flagcdn.com`, `resources.premierleague.com` and
  `fantasy.premierleague.com`, `script-src`/`style-src` with `'unsafe-inline'` (a nonce needs a server
  a static export doesn't have, and Next's own RSC hydration payload changes every build so it can't be
  hashed either — the standard trade-off for this hosting shape). Verified via `wrangler dev` (the
  same asset-serving path Cloudflare uses in production): header present on every response, crests and
  flags load, zero CSP violations across `/players`, `/fixtures`, `/builder` and a connected `/team`.
- **Cloudflare Access.** The repo is private; the site is not. Gating it with Access (email
  one-time-PIN, free to 50 users) is a dashboard change needing no code. If it is switched on, gate
  **preview deployments too** — they get their own public URLs, so an unprotected preview makes the
  gate decorative.
- **Draft export/import — done (2026-08-06).** `lib/drafts.ts` gains `exportDrafts`/`importDrafts`
  under a versioned envelope carrying both the drafts and the save timeline; merge keeps whichever
  copy of a draft is newer by `updatedAt`, so reimporting an old backup can't clobber later work.
  `/scenarios` has a download button and a file picker. Sprint 14 still supersedes it with cloud sync.
- **Actions minutes are now metered.** Private repos get a monthly quota where public repos were
  unlimited. Deleting `deploy.yml` roughly halved per-push consumption, leaving `ci.yml` at ~2
  minutes a push — hundreds of pushes before it matters, but no longer free-and-ignorable.

## Dependency advisories — cleared (2026-08-06, recorded 2026-08-03)

`npm audit` reported 4 — 3 high, 1 moderate.

| Package | Severity | What it is | Resolution |
|---|---|---|---|
| `postcss` | high | Path traversal / arbitrary `.map` file read via attacker-controlled `sourceMappingURL` in CSS comments | Cleared by the `next` bump below (transitive) |
| `sharp` | high | Inherited libvips CVEs | Cleared by the `next` bump below (transitive) |
| `next` | high | Flagged transitively through the two above | **Bumped 16.2.12 → 16.3.0** (`isSemVerMajor: false`) |
| `hono` | moderate | ReDoS in CORS middleware | **`shadcn` moved to `devDependencies`** — drops the `@modelcontextprotocol/sdk` → `hono` subtree from production installs |

Verified: full gate (`tsc`, `lint`, `build`) passed, `npm audit` now reports only `hono`, isolated to
`shadcn`'s own dev-time tree (unreachable from either fix — it is `shadcn`'s own dependency, not a
transitive one either bump touches, so it stays until `shadcn` itself updates).

## Squad view on Deadline Hub and My Team — built (2026-08-15)

Deadline Hub shipped read-only over existing engines but with no squad *visual* at all, and `/team`
rendered `manager_picks` as four plain position lists rather than a pitch — and neither page
defaulted to the squad actually imported from FPL (`teamStateFromMyTeamJson`, Sprint 14.2), even
though that squad carries the owner's real purchase prices. This closed both gaps.

- **Import naming consolidated.** The two importers (`/team`'s `manager_picks` path and
  `/settings`'s pasted-JSON path) had drifted to two different draft-naming rules, which meant
  nothing could reliably answer "which draft is this manager's own import?" `importedDraftName`/
  `isImportedDraftFor` (`lib/fpl-squad.ts`) is now the one rule both call. `TeamState` gained an
  optional `entryId`, recorded by both constructors, so the match survives a rename instead of
  depending on the name matching forever.
- **`resolveRequestedDraft` (`lib/drafts.ts`) takes an optional preference.** `?draft=<id>` still
  wins first; then the linked manager's import by `entryId`; then by the name rule (for imports
  made before `entryId` existed); then the newest import; then the newest draft of any kind. Only
  `/deadline` and `/team` pass the preference — builder, scenarios, transfers and chips keep their
  existing "most recently edited" default unchanged.
- **`PitchView` (`components/pitch-view.tsx`) now takes a `SquadLayout`, not a bare
  `LineupResult`.** A `LineupResult` is projection-shaped (`startersXp`, `subProbability`,
  auto-sub odds) and could only ever draw a squad the optimiser had scored; a squad already
  entered — or already played — has a known XI, not a projection. `layoutFromLineup` adapts the
  optimiser's output into the same shape, so the pitch component itself stays singular. Its three
  edit callbacks (`onSetCaptain`/`onSetVice`/`onRemove`) became optional, and
  `components/player-detail.tsx`'s action buttons each render only when their handler is present —
  the builder passes all three unchanged, so its behaviour is untouched.
- **Deadline Hub gained a Squad section** directly under the countdown: the pitch shows the XI the
  owner actually set (not the optimiser's — the existing Captain & Starting XI section already
  states the diff), falling back to the model's own XI, clearly labelled, when none is set yet.
- **My Team gained a Squad view section** with a **Current squad** / **Gameweek result** switch.
  Current squad renders the resolved import (§ above), or — without ever silently saving a draft —
  a throwaway `TeamState` built from the latest `manager_picks` event when no import exists yet.
  Gameweek result adds a `<select>` over every gameweek the manager has entered, each showing that
  gameweek's real per-player points.
- **New `lib/manager-picks.ts`** — nothing under `lib/` read `manager_picks` before this; the read
  and its correctness rules now live in one place rather than being reinvented per page:
  - The starting XI is `position` 1–11, bench 12–15 — **never** `multiplier > 0`. Under Bench Boost
    every pick's multiplier is non-zero, so the multiplier test would silently promote the bench
    onto the pitch in exactly the gameweek where the distinction matters.
  - `player_gameweek_stats` is keyed per **fixture**; points are summed per `(player, event)` so a
    double gameweek doesn't lose a fixture.
  - The displayed total is never reconciled into one number. `manager_picks` is as-picked and FPL's
    own `automatic_subs` isn't synced by `sync-manager`, and `manager_gameweek_history.points` is
    net of any transfer hit — so the summary shows both totals side by side
    (`60 XI + 9 armband (×2) = 69 · FPL recorded 66 · includes a −4 transfer hit`) rather than
    picking a winner.
  - An unfinished gameweek's points fall back to `player_live_stats` and are labelled provisional.
- **Verified two ways.** A throwaway `npx tsx` harness (`/engine-verify` pattern) checked the
  shaping rules directly — captain ×2/×3, DGW summing, the Bench Boost multiplier trap, missing-
  stats handling — all passing before any UI existed. Since `manager_picks`/`player_gameweek_stats`
  are genuinely empty for 2026-27 pre-GW1, the live read path was exercised by seeding one
  gameweek's picks and stats for entry 274486 directly in Supabase inside a manual test pass, then
  deleting every seeded row afterward (`manager_picks`, `player_gameweek_stats`,
  `manager_gameweek_history`, and reverting `gameweeks.finished`) — confirmed the GW selector,
  per-player points, the two-total summary, the provisional label toggling on `gameweeks.finished`,
  and the read-only detail panel, with the builder's own pitch controls unaffected. No fixture data
  exists yet for a real double gameweek or a real Bench Boost payload; the harness covers that math,
  the live path does not yet.

## Queued items, built (2026-08-07)

Five small independent items, taken alongside Sprint 12.5 immediately after Sprint 12 shipped.

- **Price filter on the Builder player search — built.** The main picker (`app/builder/page.tsx`)
  gained a min/max price band using `RangeSlider` (`components/ui/range-slider.tsx`, the same control
  the replacement panel's `ValueSlider` sibling already used), with bounds derived from the live pool
  rather than a hardcoded range so it stays correct as prices move.
- **Fixture list in the player detail panel — built, horizon-driven.** Smaller than it first looked:
  the ticker already existed (`components/player-detail.tsx` renders `player.upcoming` via
  `FixtureCell`), just hardcoded to 3 gameweeks. `app/builder/page.tsx`'s `DISPLAY_GWS` became
  `MAX_TICKER_GWS = 8`, and the slice now follows `horizonLength(horizon, seasonWindow)` capped at 8 —
  the panel is a compact popover with a fixed `PANEL_MAX_HEIGHT`, not a schedule page.
- **A 19 GW horizon, and Season expanded to the full 38 — built.** Two pieces:
  - `player_xp_horizons` (a view) gained `xp_19`/`xp_19_lower`/`xp_19_upper`
    (`20260807120000_horizon_xp_19.sql`); `Horizon`, `HORIZONS`, `HorizonXp` and `xpAt`
    (`lib/team-state.ts`) extended to match. `tsc` found every `Record<Horizon>` literal that needed
    the new key — nine call sites across `app/*` and `lib/chips.ts`/`lib/transfer-optimizer.ts`.
  - `generate-predictions` now runs from the next gameweek through the season's actual last gameweek
    (previously capped at the chip window, GW19) — verified live: 10,887 → **21,774** rows, 573
    players, 20 seconds. `seasonHorizonNote` was rewritten: its old text ("a longer window is a
    Sprint 12 prerequisite") went stale the moment Sprint 12 shipped; it now states the real remaining
    caveat — a frozen season-long projection cannot see news that hasn't happened yet, so its far end
    is its least trustworthy part, the same caveat `decisionMargin` exists for in
    `transfer-optimizer.ts`.
- **Sprint 12.5 — PL Team Manager Intelligence, buildable slice — built.** See [sprint-12.md](sprint-12.md).
- **Squad reconciliation, phase 2 — built and shipped.** See [squad-reconciliation.md](squad-reconciliation.md);
  this is the one item that needed a gate before shipping, and it passed.
