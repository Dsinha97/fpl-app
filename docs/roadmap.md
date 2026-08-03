# Roadmap

**Authoritative sprint plan.** Sourced from [update-aug3.md](update-aug3.md) (the owner's revised
feature set, kept unedited) and reconciled against what is actually in the repo.
[updated-plan.md](updated-plan.md) remains the reference for formulas and method; its roadmap table
is superseded by this file.

## Numbering correction

`update-aug3.md` lists Sprint 4 as "Squad Optimizer". In this repo the squad optimiser shipped in
Sprint 2, and Sprint 4 delivered the **comparison engine and replacement finder** — which the new
document numbers as Sprints 6 and 7. Those are therefore already built, and the next sprint to start
is **5, Scenario Lab**.

| Sprint | Theme | Status |
|---|---|---|
| 5 | Scenario Lab & Draft Management | **Partial** — see below |
| 6 | Player Comparison Engine | **Built** — `/compare`, `lib/scoring.ts` |
| 7 | Replacement Finder | **Built** — builder panel, `findReplacements` |
| 8 | Transfer Simulator | Not started |
| 9 | Transfer Optimizer (up to 5 banked FTs) | Not started |
| 10 | Ownership Intelligence | Not started — **blocked**, see below |
| 11 | Captain & Bench Optimizer | **Built** — `lib/lineup.ts` |
| 12 | Chip Strategy Engine | Not started |
| 13 | Live Matchday Hub | Not started |
| 14 | Authentication & Team Sync | Not started |
| 15 | Action Layer | Not started |
| 16 | Notifications & Automation | Not started |
| 17 | Historical Analytics & ML | Not started |

## Finishing passes on what exists

Small, do them opportunistically rather than as sprints.

- **Sprint 6 gaps** — EO column (needs Sprint 10); Form term (dropped, see `COMPARISON_MODEL_NOTE`).
- **Sprint 7 gaps** — the spec asks for top 10 replacements; the panel shows 5. The position, budget,
  club-limit, availability and minutes filters are applied but not user-adjustable.
- **Sprint 11 gaps** — the TeamAttack term is dropped until team strength populates
  (`CAPTAIN_MODEL_NOTE`).

## Sprint 5 — Scenario Lab & Draft Management (next)

Already present in `lib/drafts.ts`: list, save, clone, delete, plus the builder's draft bar and the
one-slot Revert.

To build:

- **Rename** a draft, and a **Draft Manager** view listing every draft with its SquadScore.
- **Draft comparison** — two to four drafts side by side, same treatment as `/compare`: metric rows
  with the best highlighted.
- **Draft timeline** — the sequence of saves for one draft, so a line of thinking can be retraced.
- **SquadScore**, from the revised spec and fully computable today:

  ```
  SquadScore = ExpectedPoints + FixtureQuality + BenchStrength + Value − RiskScore
  ```

  ExpectedPoints from `computeProjection`, FixtureQuality and RiskScore from `lib/scoring.ts`,
  BenchStrength from the bench ordering in `lib/lineup.ts`.

Drafts stay in `localStorage` for now. The `team_drafts` / `draft_players` / `draft_lineups` tables
belong with Sprint 14, when Supabase Auth gives them an owner — a cloud table with no user column
would have to be rebuilt.

## Sprint 8 — Transfer Simulator

Player out → player in → recomputed squad. Outputs team xP before and after, captain impact, fixture
impact, bench impact, budget and remaining bank.

```
TransferGain = xP(new team) − xP(old team) − TransferCost − RiskChange
```

`findReplacements` already computes the per-player half of this; the simulator lifts it to the squad.

## Sprint 9 — Transfer Optimizer

Evaluates roll / 1 transfer / 2 transfers / take a hit / wildcard.

```
TransferValue = ExpectedGain − TransferCost − Risk
RollValue     = FutureFlexibility + ExpectedFutureGain
recommend transfer when TransferValue > RollValue + DecisionMargin
```

Must track current FT, **banked FTs up to five** per current FPL rules, and wildcard / free-hit
interactions. This is where `SquadBalance` and `FutureFlexibility` — omitted from TeamFit today, see
`REPLACEMENT_MODEL_NOTE` — become computable.

## Sprint 10 — Ownership Intelligence

**Blocked.** League 314 ("Overall") returns an empty standings array pre-season — verified by probing
the API on 2026-08-03. No standings means no manager list, no picks, no EO, no template. Nothing here
can be validated until GW1 is scored.

When it unblocks, build it **sampled at the top 1,000**, not the top 10,000: ~20 standings pages plus
1,000 `entry/{id}/event/{gw}/picks` calls per gameweek, cursor-batched the way `sync-player-history`
is. Keep the cap in a config row so it can be raised once real rate-limit behaviour is known. Ten
thousand managers is ~10,000 requests per gameweek against an unauthenticated API — earn that
gradually.

Every EO figure must be labelled as a top-1k **sample**, never as "top 10k".

```
EO           = ownership × multiplier      (captain 2×, triple captain 3×, bench 0×)
Differential = xP × (1 − EO) × Upside × MinutesProbability
RankGain     = ExpectedPoints × (1 − EO)
```

Tables: `top10k_managers`, `top10k_picks`, `template_snapshots`, `ownership_metrics`, `eo_metrics`.

## Sprints 12–17

- **12 Chip Strategy** — `ChipValue = xP(with chip) − xP(without)`, optimised over 5 GW / 8 GW /
  season. `chip_definitions` already holds the real windows (GW1–19, GW20–38). Needs the prediction
  window extended past 8 gameweeks first, or "season" chip planning is really 8-week planning.
- **13 Live Matchday Hub** — a `GameweekState` object: live score, bonus, live rank, pending auto
  subs, captain EO, safety score. Depends on `sync-live-gameweek`'s row-writing path, which has never
  executed — there have been no live matches.
- **14 Authentication & Team Sync** — Supabase Auth, FPL login through an Edge Function, import team,
  compare draft against live. Drafts migrate off `localStorage` here.
- **15 Action Layer** — submit lineup, captain, transfers, chips. Always with explicit confirmation;
  credentials server-side only.
- **16 Notifications** — deadline, injury, suspension, price change, fixture change, new
  recommendation. Email / push / Telegram / Discord.
- **17 Historical Analytics & ML** — captain success, transfer success, chip ROI, xP accuracy, rank
  progression, recommendation accuracy. Then gradient-boosted minutes and injury models. Note that
  the current xP calibration is in-sample; refitting it against real 2026/27 results is a
  prerequisite for taking any accuracy claim seriously.

## Cross-cutting

**Risk formula** (revised spec):

```
RiskScore = 0.30 Rotation + 0.25 Injury + 0.20 Minutes + 0.15 FixtureVariance − 0.10 EO
```

EO is unavailable until Sprint 10, so the term is dropped and the four remaining weights are
renormalised over 0.90 → `0.333 / 0.278 / 0.222 / 0.167`. See `RISK_WEIGHTS` and `RISK_MODEL_NOTE` in
`lib/scoring.ts`. This changed every risk score in the app relative to the previous
`0.35 / 0.30 / 0.20 / 0.15`.

**Horizons** are `1 | 3 | 5 | 8 | "season"` (`lib/team-state.ts`). Season reads `xp_total` from
`player_xp_horizons`, which currently equals `xp_8` because `generate-predictions` runs an 8-gameweek
window — `SEASON_HORIZON_NOTE` discloses that wherever Season is selected.

**Every recommendation returns** recommendation, expected gain, confidence, risk, explanation, and
alternatives. The existing rationale strings in `findReplacements` and the strengths/weaknesses in
`comparePlayers` are the pattern to follow.
