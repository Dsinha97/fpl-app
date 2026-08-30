# Mini-league ownership

Exact effective ownership for the classic leagues the owner is actually in, now with a real page
(`/leagues`, built 2026-08-30) — the slice of Sprint 10 (Ownership Intelligence) that unblocked at
the GW1 deadline, distinct from the field-wide top-1k sample the risk formula needs (see
[risk-scoring.md](risk-scoring.md)), which is provably unblocked as an engineering matter but not
yet sampled for real — see "The field-wide top-1k sample" below.

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

### Standings paging rewritten for scale (Sprint 29 follow-up, 2026-08-30)

Pages used to be fetched one at a time, awaited sequentially — up to 40 round-trips for the
2000-entry cap — with `league_entries` only written after the whole loop finished, so a slow or
rate-limited large league could lose everything already fetched to a platform timeout. Rewritten to
fetch pages in concurrent waves (`STANDINGS_CONCURRENCY = 5`, matching the picks fetch's own
concurrency) and upsert each wave as it completes. FPL's endpoint doesn't report a total page count
up front, so a wave requests pages speculatively; a page past the real end throws and the loop
stops there.

Load-testing this against league 314 ("Overall", 9.9M entries, capped at the same
`league_ownership_entry_cap`) surfaced two real bugs, neither visible at the owner's own
league sizes (5–7 members):

- The "already synced" existence check crammed all 2000 entry ids into one `.in()` query string,
  long enough to trip an HTTP/2 protocol error before reaching Postgres — chunked into batches of
  200.
- A 9.9M-entry league's rank ordering shifts continuously, so two pages fetched concurrently in the
  same wave could genuinely return the same entry — failing the upsert ("ON CONFLICT DO UPDATE
  command cannot affect row a second time"). Fixed with a `seenEntryIds` set tracked across the
  whole sync, not just within one wave.

Final verified run: 2000 entries, 30,000 picks, 0 failures, 47 seconds — test data deleted
afterward (this was scale verification, not a real sync the owner needs kept).

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

## `/leagues` — built 2026-08-30

The engine (this page) and pipeline had shipped complete since the GW1 deadline with nothing
rendering them — `docs/roadmap.md` recorded that gap honestly, and `sync-league-picks` had never
once been invoked from the app. `/leagues` (`app/leagues/page.tsx`, `lib/leagues.ts`) is that
wiring, not new maths: a league picker off `manager_leagues` (grouped invitational/general exactly
as `/team`'s existing `ManagerLeagues` component already did — extended with an optional
`onSelect` rather than duplicated), standings and picks paged past the 1000-row response cap (see
[fpl-api-constraints.md](fpl-api-constraints.md)), a **Sync this league** button as the first real
caller of `sync-league-picks`, and an EO table with differential/rank-gain per player.

Two things learned running it against real data:

- Standings and picks sync independently — a league can already have `league_entries` rows (from
  `manager_leagues`' own periodic sync of the owner's memberships) with zero `league_entry_picks`
  for the gameweek in question. A blank table with headers and no rows reads as broken, not as
  "nothing to show yet" — added a second empty state distinguishing "never synced at all" from
  "standings are in, picks aren't."
- Verified end to end against production data: synced the owner's smallest real league (5 entries,
  75 picks), and the EO/captain math checked out by hand.

`/team`'s own leagues section, which used to render the full grouped table inline in a 360px
sidebar (illegible at that width), now links here instead of duplicating the render.

`OWNERSHIP_MODEL_NOTE` and the entry cap (`game_settings.league_ownership_entry_cap`, 2000) are
both disclosed inline on `/leagues` rather than presenting a bare "EO" — the same discipline this
page's own "Every figure carries its scope" section describes.

See also: [sprint-10.md](../sprints/sprint-10.md) (the source build record), [sprint-21.md](../sprints/sprint-21.md)
(`manager_leagues`, the league membership list `/team` shows), [risk-scoring.md](risk-scoring.md)
(why the field-wide EO term in the risk formula is a separate, still-blocked quantity — see below),
[deadline-and-matchday.md](deadline-and-matchday.md) (the other build that landed the same evening
as this page's engine, off the same GW1 deadline).

## The field-wide top-1k sample: what's actually still blocked

`docs/roadmap.md` records league 314's rank-ordered top-1k sample (the risk formula's field-wide EO
term, distinct from this page's exact per-league EO) as blocked because `league_entries` for
`league_id=314` had 0 rows. The Sprint 29 follow-up load-test above (see "Standings paging
rewritten for scale") proved the *pipeline itself* handles league 314 at full scale — 2000 entries,
rank-ordered, zero failures — so the blocker was never really "can this be synced," it was "has
anyone kept the result." That test's rows were deleted afterward (it was verification, not a
production sync), so `league_entries` for 314 is back to 0 rows as of this writing — the honest
current state is: **provably unblocked as an engineering matter, still not sampled**, one click on
`/leagues` away from being real. [blocked-and-data-gaps.md](blocked-and-data-gaps.md)'s row is
updated to match.
