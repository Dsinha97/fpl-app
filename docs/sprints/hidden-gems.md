# Hidden Gems — value-discovery filter (Sprint 15.5, built 2026-08-11)

**Status: built.** `player_rate_profile` (migration), `lib/hidden-gems.ts`, `components/gem-badge.tsx`,
filters on `/players` and the builder's Replacement Finder panel.

## Why this exists

The owner pointed at [JaseZiv/worldfootballR_data](https://github.com/JaseZiv/worldfootballR_data)
and a video describing three "hidden gem" archetypes (a budget defensive-contribution defender, a
cheap defensive-contribution midfielder, an under-£7.5m breakout attacker), asking whether the repo
could feed the cold-start prior and whether the archetypes could be built as a discovery filter.

**worldfootballR does not help the cold-start prior.** Three independent, each individually fatal
findings, checked directly rather than assumed:

1. **Both the package and its data repo are archived and unmaintained.** `worldfootballR_data` was
   archived 18 Sept 2025, read-only; the author's own notice says neither will be maintained further.
2. **It is Big-5-league only — no English Championship.** The player-level advanced datasets are
   `fb_big5_advanced_season_stats` and `fb_big5_advanced_statsbomb`. This repo already has the exact
   same gap recorded for `soccerdata` (below) — of the 99 players in `players` with zero Premier
   League minutes, **54 sit at COV (24), HUL (21) and IPS (9)**, the promoted clubs. The largest
   newcomer cluster remains the least covered by any Big-5-only source.
3. **The underlying data no longer exists.** On 20 Jan 2026, Sports Reference removed all
   Opta-sourced advanced statistics from FBref and Stathead — including history — after its data
   provider terminated the feed (Opta became FIFA's exclusive betting-data distributor) and demanded
   deletion. Only goals, assists and appearances remain on FBref. Every metric this idea wanted
   (tackles, interceptions, blocks, clearances, xG, xA per 90) is gone at the source, not merely hard
   to scrape.

**Cold-start phase 2 stays deferred**, per [cold-start-patch.md](cold-start-patch.md#phase-2--external-league-enrichment-deferred-gated) —
this closes out FBref as a phase-2 candidate rather than reopening the question.

**The Hidden Gems half needs no external data.** Everything the archetypes require —
`defensive_contribution`, `clearances_blocks_interceptions`, `tackles`, `recoveries`,
`expected_goals`, `expected_assists` — is already ingested into `player_season_history` and read by
no code path (`XDC_MODEL_NOTE` in `lib/scoring.ts` already says so). Verified against the live DB
before building: 2025/26 has all five components populated for ~370–400 players; 2024/25 has the
aggregate `defensive_contribution` only (FPL didn't expose the CBIT/CBIRT split until 2025/26).

## What was built

### `player_rate_profile` (migration `20260811120000_player_rate_profile.sql`)

A read-only view, not new columns on `players` — `xp-model.ts` already derives per-90 rates for the
projection (`xg90`, `xa90`, `dc90` in `player_predictions.rates`), and a second, independently
computed copy would be a second implementation of the same numbers. The view mirrors `deriveRates`
in `xp-model.ts` closely enough that the two should never disagree about what `dc90` means:

- Recency-weighted per-90 rates off `player_season_history`, weighted 0.6/0.3/0.1 over the three most
  recent seasons with any minutes (`MODEL_PARAMS.seasonWeights`).
- `dc90` uses its own eligible-minutes denominator, mirroring `deriveDcEligibleSeasons` — restricted
  to seasons where anyone recorded a real `defensive_contribution`, since FPL only tracks the stat
  from 2024/25 and blending earlier seasons in halves the rate.
- `cbit90` (clearances + blocks + interceptions + tackles, the defender-scoring split) and `cbirt90`
  (the same plus recoveries, the midfielder/forward split) come from the single most recent season
  only, and only when it is the season the API populated those components for — `null`, never a
  substitute `0`, outside it.
- `xgi90` = weighted (xG + xA) per 90.
- `observed_minutes` — the weighted-minutes evidence figure, exposed so callers can gate on it.

Verified against live data (`Anderson`, `Semenyo`, `Senesi` — the video's three named examples):

| Player | Pos | Price | dc90 | cbit90 | cbirt90 | xgi90 |
|---|---|---|---|---|---|---|
| Anderson | MID | £6.5m | 13.77 | 5.65 | 13.91 | 0.203 |
| Semenyo | MID | £8.5m | 6.93 | 2.64 | 6.64 | **0.390** |
| Senesi | DEF | £6.0m | 11.20 | **11.47** | 15.71 | 0.163 |

All three land in their described archetype's per-90 rate on real 2025/26 data — the CBIT figure is the
archetype-defining one for Senesi (DEF), CBIRT/dc90 for Anderson (MID), xGI/90 for Semenyo. **None of
the three clears `detectGems`' default price band**, though, and that turned out to be the correct
call rather than a bug to chase: at today's real prices (2026-08-11) all three sit above the median
for their position — Senesi (£6.0m) is above the DEF median (£4.5m), Anderson (£6.5m) above the MID
median (£5.5m), Semenyo (£8.5m) above the 80th-percentile attacking-price cutoff. The market has
already re-priced them since the video was made; a filter that kept flagging a player once his price
caught up to his output would not be finding hidden value, it would be finding *known* value. This is
what motivated making the price tiers percentile-based against the position's own live distribution
(`budgetPricePercentile` / `breakoutPriceLowPercentile` / `breakoutPriceHighPercentile` in `GemCuts`)
rather than the video's literal `≈£5.0m` / `£7.0–7.5m` figures, which were themselves already stale by
the time this shipped — hardcoding them would have repeated the exact mistake the percentile-based
*metric* thresholds were designed to avoid, just on the price axis instead of the rate axis.

A verification harness (kept out of the commit — `npx tsx` against live data, per the project rule)
also confirmed: zero `reliability: "low"` players ever reach a gem verdict; the `defcon_defender` set
is not dominated by promoted clubs (2 of 8 at COV/HUL/IPS, not all of them, confirming the evidence
floor is actually biting); and `player_rate_profile.dc90` diverges from
`player_predictions.rates.dc90` only for players below the 450-minute evidence floor (all 31
divergent players checked had `reliability: "low"` or under 410 observed minutes) — expected, since
the model's stored rate is the *shrunk* (prior-blended) figure while the view's is the *raw* own-rate,
and gems only ever reads the raw rate for players evidence already vouches for.

RLS: `Public read` to `anon, authenticated` — confirmed with both roles simulated in a rolled-back
transaction, matching every pre-Sprint-14 table's shape.

### `lib/hidden-gems.ts`

`detectGems(pool, horizon, cuts, seasonWindow)` — three archetypes (`defcon_defender`,
`defcon_midfielder`, `breakout_attacker`), each a **percentile filter against this season's own
player pool**, not the video's literal numbers (`defcons/90 ≥ 10.5`, `≥ 12.0`, `xGI/90 ≥ 0.45`).
Those are someone else's fitted coefficients with nothing in this repo to check them against —
shipping them verbatim would break the standing rule that an acceptance threshold must come from a
backtest, not a round number that sounds right. The default is the 85th percentile of the actual
pool at that position and price; every cut point is a plain, overridable field on `GemCuts`
(`DEFAULT_GEM_CUTS`), following the `decisionMargin` precedent, so the video's own figures can still
be dialled in deliberately.

**The evidence gate is the load-bearing part.** A candidate resting on the cold-start prior is not
evidence of anything — the prior gives every promoted-club player at a price near-identical rates
drawn from position and price alone, so a naive per-90 filter would flag an entire newly-promoted
defence at once and hand the prior's own output back as a "discovery". This is the same failure mode
that got a supplied CSV rejected outright
(`cold-start-patch.md`, 2026-08-05). So every archetype requires `reliability` of `"high"` or
`"medium"` and a minimum observed-minutes floor (450, the model's own `minFitMinutes`); a
`"low"`-reliability player can never be labelled a gem.

**No composite score.** The video's own draft scores archetypes with incompatible formulas
(`dc90 * 1.5` for one, `xgi90 * 100` for another) that cannot be compared or ranked against each
other. Ranking instead runs through the app's one xP/value implementation — `xpFor` and
`valuePerMillion` (`lib/scoring.ts`) — with the percentile, ownership, and xP/£m surfaced as their
own stated terms in `GemVerdict.reasons`, never pre-summed.

**Defcon defender's clean-sheet term is `fixtureScore`**, not a computed per-team clean-sheet
probability — deriving the latter from `player_predictions.xp_clean_sheet` would require unwinding
a position-specific points multiplier the front end doesn't have cheaply, and `fixtureScore` is
already the vetted "how kind is the run" figure the risk engine and `/compare` use. Disclosed in
`GEMS_MODEL_NOTE`.

### UI

- `/players` — a "Gems only" checkbox plus an archetype dropdown in the filter bar, a `GemBadge`
  next to each qualifying player's name, and an `InfoTooltip` carrying `GEMS_MODEL_NOTE`. While
  here, the page's two independent inline implementations of `xP / £m` (one for sorting, one for
  display) were unified into a single `valueOf` helper that delegates to `valuePerMillion`.
- Builder's Replacement Finder panel — an archetype dropdown alongside the existing min-start/
  max-price filters, threaded through `ReplacementFilters.archetypeIds` (`lib/scoring.ts`) as a
  plain `Set<number>` of matching player ids rather than teaching `findReplacements` to recompute
  archetypes itself (it operates on `ScoredPlayer`, which carries no per-90 rate data — recomputing
  there would be a second implementation of `detectGems`'s own filtering). A matching candidate also
  gets a `"matches the Hidden Gems filter"` rationale line and a `GemBadge` in the result list.

Neither call site changes `findReplacements`' or the transfer optimiser's behaviour when the filter
is untouched — `archetypeIds` is optional and additive, following every other filter in
`ReplacementFilters`.

## What was deliberately left out

- **CBIT/CBIRT split inside the xP model itself** (`xp-model.ts`, `XDC_MODEL_NOTE`'s open gap) — the
  rate profile view surfaces the position-correct figure for discovery, but fixing the projection
  itself needs a model-version bump and a fresh backtest (bias/MAE/Pearson r), which is its own
  piece of work, not a rider on this one.
- **A fourth "buy the dip" archetype** (historical price-delta vs performance) mentioned in the
  original brief — no code path currently tracks a player's price trajectory across seasons; out of
  scope for this pass.
