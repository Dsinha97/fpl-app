# Sprint 10 — Ownership Intelligence

**Status: exact-slice built 2026-08-21; top-1k sample still blocked.** See [../roadmap.md](../roadmap.md)
for the sprint index.

## Exact-slice mini-league EO — built 2026-08-21

The GW1 deadline (2026-08-21 17:30 UTC) made **any** entry's picks public for the first time — not
just the top-1k template's, which is a separate blocker (below). That's enough to compute exact
effective ownership for the leagues the owner is actually in (`manager_leagues`), so that slice was
built without waiting on 314's standings to rank-order.

- **`sync-league-picks`** (Edge Function, on-demand) — pages a classic league's standings and fetches
  every member's picks with bounded concurrency, modelled on `sync-manager`'s own "page a list, fetch
  picks" shape. Capped via `game_settings.league_ownership_entry_cap` (2000 default) so a huge system
  league (314 itself, or an invitational built off a YouTube channel) isn't pulled in full — raising the
  cap is a config change, not a redeploy, per this file's own instruction below.
- **`league_entries` / `league_entry_picks`** (new tables, public-read/service-write, RLS verified
  against `anon`) — picks are stored once per `(season, entry_id, event)`, not once per league
  membership, so an entry in several of the owner's leagues isn't fetched or stored twice. Verified live:
  a shared entry's second league sync reused its already-stored picks (`picks_reused: 1`) rather than
  refetching.
- **`lib/ownership.ts`** — the formulas below, implemented and verified against real synced picks in an
  `npx tsx` harness (a captain owned by 4 of 5 league entries came out at exactly 180% EO by hand
  calculation, matching the code).

Every figure is scoped to its league and entry count in the label — "EO in *league name* (n=5)", never
a bare "EO" (CLAUDE.md: "say what the number means"). A small league's EO is *exact*, but it is exact
about that league, not the game.

**Not yet built:** the `/team` ownership card / differentials surface that reads this. The engine and
pipeline exist; nothing renders them yet.

**The risk formula's EO term stays dropped.** `RISK_WEIGHTS` in `lib/scoring.ts` renormalises over 0.90
because that formula needs *the field's* template, and a several-hundred-person mini-league is not that.
It stays dropped until the top-1k sample below exists.

## Top-1k sample — still blocked

League 314 ("Overall")'s standings are no longer empty (verified populated at the GW1 deadline), but
every entry ties on 0 points until GW1 is actually scored, so a "top 1,000" slice is arbitrary until
then. Once it unblocks, build on the exact-slice's own pipeline — same standings pager, same picks
fetcher (`sync-league-picks`, `_shared/fpl.ts`'s `getClassicLeagueStandings`) — pointed at league 314's
first ~20 pages, **sampled at the top 1,000, not the top 10,000**:

```
EO           = ownership × multiplier      (captain 2×, triple captain 3×, bench 0×)
Differential = xP × (1 − EO) × Upside × MinutesProbability
RankGain     = ExpectedPoints × (1 − EO)
```

Ten thousand managers is ~10,000 requests per gameweek against an unauthenticated API — earn that
gradually. The cap lives in `game_settings.league_ownership_entry_cap`, raised only once real
rate-limit behaviour is known.

Every EO figure from this sample must be labelled a top-1k **sample**, never as "top 10k" — and once it
exists, the risk formula's EO term goes back in (`0.30/0.25/0.20/0.15/−0.10`, un-renormalised), which
changes every risk score in the app and is its own commit.
