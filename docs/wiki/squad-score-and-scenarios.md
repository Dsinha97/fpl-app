# SquadScore & Scenario Lab

`/scenarios` — every saved draft as a card ranked by one composite score, with 2–4 draft comparison
and a save timeline. Sprint 5.

## SquadScore

```
SquadScore = ExpectedPoints + FixtureQuality + BenchStrength + Value − RiskScore
```

The four terms arrive in incompatible units (expected points in the hundreds, fixture quality 0–1,
risk 0–100), so each is converted to **points-equivalent** before summing, and `squadScore` returns
the per-term breakdown so a comparison table can show what actually drove a total rather than just
the total. `BenchStrength` comes from [lineup-captain-bench.md](lineup-captain-bench.md)'s
`benchExpectedContribution`, computed against **each draft's own best XI**, not whatever lineup
happens to be stored — so a draft that's been through the lineup optimiser isn't compared unfairly
against one that hasn't. `SquadScore` itself is points-only; the *money* side of the same XI/bench
split — how much is parked on a bench that barely scores — is
[lineup-captain-bench.md](lineup-captain-bench.md#bench-cost-sprint-18)'s `squadBudget`, not folded
into this composite. `RiskScore` uses the same `riskPoints` exchange rate as
[transfer-engine.md](transfer-engine.md), so the two screens can't disagree about one squad — see
[risk-scoring.md](risk-scoring.md).

## Presentation rules

- Metrics that are **context, not merit** (spend, squad size) carry no "best" marker — spending less
  is not itself a virtue in FPL.
- A best-marker is suppressed when the *formatted* values tie — a ▲ beside two cells both reading
  "0.5" claims a winner the reader can't actually verify.

## Storage

Drafts live in `localStorage` (`fpl_drafts_v1`, with `fpl_draft_history_v1` holding the last 20
saves per draft for the timeline) — cloud sync arrived with Supabase Auth in
[fpl-authentication.md](fpl-authentication.md) (Sprint 14), which layers `lib/draft-sync.ts` on top
without changing the local-first API. Export/import (`exportDrafts`/`importDrafts`) uses a versioned
envelope and merges on `updatedAt`, so re-importing an old backup can't clobber newer work.

See also: [transfer-engine.md](transfer-engine.md) (Apply from the simulator writes a new draft here),
[chip-strategy.md](chip-strategy.md) (chip values shown inline on `/scenarios`).

## Actual points, alongside xP (`lib/scenario-actuals.ts`, Sprint 28, 2026-08-29)

`/scenarios` compared drafts on projection alone — it could say squad A projects 1.4 points better
than squad B, and nothing on the page ever said whether such a gap had been borne out. A
`Show: xP / Points scored` toggle now exposes two real figures per scenario, on the draft cards
and as two new comparison rows:

- **last finished gameweek**, on its own;
- **season to date** — the same XI and captain applied to every finished gameweek and summed.

**Both are counterfactual, and the page says so in three places.** A scenario is a hypothetical
squad; applying today's eleven and armband to a gameweek they were not picked for is not a record
of anything. Season-to-date is the stronger version of that caveat — it credits an XI for weeks
before some of its players were bought. So: `SCENARIO_ACTUALS_NOTE` behind the toggle's
`InfoTooltip`, an amber banner naming the exact gameweek range while the toggle is on, and a note
on each comparison row. Deliberately not modelled, and stated: auto-substitutions (a hypothetical
squad has no pick history for FPL's rules to run against), chips, bench points, prices and
transfer costs. A captain is always doubled, even one who did not play.

Mechanics worth knowing:

- One paged query over `player_gameweek_stats` across every finished gameweek for the union of all
  drafts' players — `loadEventPoints` per event would be a round trip per gameweek per scenario.
  Paged with `.range()` until a short page comes back, per the API's 1000-row cap.
- Merged with `player_live_stats` for the latest finished event, per player by higher minutes,
  exactly as [`lib/manager-picks.ts`](../architecture.md) already reconciles the two — a finalised
  row can itself be a stale pre-kickoff placeholder.
- Computed in a plain `useMemo`, **outside** `runCompute`'s gated batch. That batch exists to keep
  `optimiseLineup`/`squadScore` off the main thread; a few map lookups per draft do not need it,
  and folding them in would make the query's own async arrival surface as "inputs changed —
  re-run", which is a lie. The user changed nothing.

See [sprint-28.md](../sprints/sprint-28.md).
