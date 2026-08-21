# Mini-league ownership

Exact effective ownership for the classic leagues the owner is actually in — the slice of Sprint 10
(Ownership Intelligence) that unblocked at the GW1 deadline, distinct from the field-wide top-1k
sample the risk formula needs (see [risk-scoring.md](risk-scoring.md)), which is still blocked on
league 314 being rank-ordered.

## What unblocked, and when

`entry/{id}/event/{gw}/picks/` is public for **any** FPL entry once its deadline passes — verified by
probing a random league-314 member's picks at the GW1 deadline (2026-08-21 17:30 UTC), not just the
owner's own. That's a different, smaller unlock than league 314's standings becoming rank-ordered
(which needs a *scored* gameweek): it makes exact EO computable for any league today, sampled or not.
— [sprint-10.md](../sprints/sprint-10.md)

## The formulas

```
EO           = ownership × multiplier      (captain 2×, triple captain 3×, bench 0×)
Differential = xP × (1 − EO) × Upside × MinutesProbability
RankGain     = ExpectedPoints × (1 − EO)
```

`lib/ownership.ts` implements these directly off real `multiplier` values rather than re-deriving
"benched" from pick position — the raw FPL multiplier already encodes chip effects (a live Bench
Boost sets bench multiplier to 1, not 0; see [lineup-captain-bench.md](lineup-captain-bench.md)'s
note on the same trap), so it's the correct source of truth for the formula as written.

**EO is clamped to `[0, 1]` only inside `differentialScore`/`rankGain`**, not in the raw figure a
reader sees — a player captained by most of a small league can exceed 100% EO for real (each
captain's share counts twice), and `1 − EO` going negative there would flip "nobody else has him"
into a bonus. `PlayerOwnership.eo` itself stays unclamped.

**Upside is a disclosed input, not a modelled term** — nothing in this app measures a player's
ceiling above his expected points, so rather than invent a coefficient it defaults to 1 (neutral) and
is exposed for the caller to set, the same pattern `decisionMargin` uses in
[transfer-engine.md](transfer-engine.md#why-the-literal-spec-formula-isnt-implemented). See
[methodology.md](methodology.md#when-a-term-cannot-be-dropped-make-it-an-input).

## Pipeline

**`sync-league-picks`** (Edge Function, on-demand — `POST { league_id, event? }`), modelled on
`sync-manager`'s "page a list, fetch picks with bounded concurrency" shape:

1. Pages `leagues-classic/{id}/standings/` until `has_next` is false, capped at
   `game_settings.league_ownership_entry_cap` (2000 by default) — a system league like 314 ("Overall")
   or an invitational built off a YouTube channel can run to tens of thousands of members, and this
   function isn't meant to pull those in full. Raising the cap is a config change, not a redeploy.
2. Writes `league_entries` (one row per league membership: rank, total, event total).
3. Fetches picks only for members not already covered for that `(season, event)` — **an entry's picks
   are stored once, in `league_entry_picks`, keyed by `(season, entry_id, event)` rather than
   `(season, league_id, entry_id, event)`**, since a member's picks are one fact regardless of how
   many of the owner's leagues they're also in. Verified live: syncing a second league that shared one
   member with an already-synced league reported `picks_reused: 1`, not a refetch.

Both tables are public-read/service-write RLS, the same shape `manager_leagues` uses (not the
`auth.uid()` shape — this is public FPL data about other entries, not something the signed-in user
owns) — verified against `anon`: reads succeed, writes are rejected with `insufficient_privilege`. See
[database-and-rls.md](database-and-rls.md).

## Verified, not just typechecked

`computeLeagueOwnership` was run in a throwaway `npx tsx` harness against real synced picks for a
5-member league: a player captained by 4 of the 5 came out at exactly 180% EO
(`(4×2 + 1×1) / 5`), matching a hand calculation, and total owner-slots summed to `numEntries × 15`
as a sanity check. Per CLAUDE.md's precedent that engine bugs survive review and only die in a
harness against live data — see [methodology.md](methodology.md).

## Every figure carries its scope

"EO in *league name* (n=5)", never a bare "EO" — a small league's EO is exact, but it's exact about
that league, not the game. This is the same disclosure discipline
[risk-scoring.md](risk-scoring.md)'s dropped EO term and every other `*_MODEL_NOTE` in the app follow.

## Not yet built

The `/team` surface that reads any of this — the engine and pipeline exist; nothing renders them yet.

See also: [sprint-10.md](../sprints/sprint-10.md) (the source build record, including the still-
blocked top-1k sample), [sprint-21.md](../sprints/sprint-21.md) (`manager_leagues`, the
league membership list `/team` already shows and a natural future home for this page's ownership
view — UI-only, not yet ingested into a wiki page of its own), [risk-scoring.md](risk-scoring.md)
(why the field-wide EO term in the risk formula is a separate, still-blocked quantity),
[deadline-and-matchday.md](deadline-and-matchday.md) (the other build that landed the same evening,
off the same GW1 deadline).
