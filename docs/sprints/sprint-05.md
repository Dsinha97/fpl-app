# Sprint 5 — Scenario Lab & Draft Management

**Status: built.** See [../roadmap.md](../roadmap.md) for the sprint index.

`/scenarios` — every draft as a card ranked by SquadScore, with inline rename, clone, delete, open
(`/builder?draft=<id>`), a save timeline, and 2–4 draft comparison.

**SquadScore** (`lib/squad-score.ts`):

```
SquadScore = ExpectedPoints + FixtureQuality + BenchStrength + Value − RiskScore
```

The terms arrive in incompatible units — expected points is in the hundreds, fixture quality is 0–1,
risk is 0–100 — so each is converted to points-equivalent before summing, and `squadScore` returns the
per-term breakdown so the comparison table can show what drove the total. Bench strength comes from
`optimiseLineup`'s `benchExpectedContribution`, computed against **each draft's own best XI** rather
than whatever lineup happens to be stored, so one draft having been through the lineup optimiser and
another not does not decide the comparison.

Two presentation rules worth keeping: metrics that are context rather than merit (spend, squad size)
carry no best-marker — spending less is not a virtue in FPL — and a marker is suppressed when the
*formatted* values tie, since a ▲ beside two cells both reading "0.5" claims a winner the reader
cannot verify.

Drafts stay in `localStorage` (`fpl_drafts_v1`, with `fpl_draft_history_v1` holding the last 20 saves
per draft for the timeline). The `team_drafts` / `draft_players` / `draft_lineups` tables belong with
Sprint 14, when Supabase Auth gives them an owner — a cloud table with no user column would have to be
rebuilt.

The "import as a new draft" gap is now covered by the transfer simulator's Apply.
