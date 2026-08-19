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
