# Hidden Gems (value-discovery filter)

An archetype filter on `/players` and the builder's Replacement Finder that flags undervalued
players by real per-90 defensive/attacking rates — Sprint 15.5, built 2026-08-11.

## Origin, and what got ruled out

The owner pointed at `worldfootballR_data` and a video describing three archetypes (a budget
defensive-contribution defender, a cheap defensive-contribution midfielder, an under-£7.5m breakout
attacker), asking whether it could also feed the cold-start prior. It couldn't, on three independent
grounds checked directly: the package/data repo is archived and unmaintained; it's Big-5-league only
(no Championship, where 54 of the 99 zero-PL-minute players actually sit); and the underlying Opta
data was deleted from FBref entirely on 2026-01-20. This closes FBref as a cold-start candidate for
good — see [cold-start-priors.md](cold-start-priors.md).

**The archetype-filter half needed no external data** — everything it requires
(`defensive_contribution`, CBIT/CBIRT components, xG, xA) was already ingested and simply unread by
any code path.

## `player_rate_profile`

A read-only **view**, not new columns — it mirrors `xp-model.ts`'s own `deriveRates` closely enough
that the two should never disagree about what `dc90` means (recency-weighted, `dc90` on its own
eligible-minutes denominator, `cbit90`/`cbirt90` from the single most recent eligible season only,
`null` rather than a substitute `0` outside it).

## Percentile filters, not the video's numbers

`detectGems` uses **percentile cuts against the current season's own player pool** (default 85th
percentile), not the video's literal thresholds (`dc90 ≥ 10.5` etc.) — those are someone else's
fitted coefficients with nothing in this repo to check them against. Verified directly: none of the
video's three named examples (Anderson, Semenyo, Senesi) clear the price-band cut today, and that's
correct, not a bug — the market has already re-priced them since the video was made, so a filter
still flagging them would be finding *known* value, not hidden value.

**The evidence gate is load-bearing.** A candidate resting purely on the cold-start prior isn't
evidence of anything — the prior gives every promoted-club player near-identical rates by position
and price, so a naive filter would flag an entire newly-promoted defence at once and hand back the
prior's own output as a "discovery," the same failure mode that got the CSV in
[cold-start-priors.md](cold-start-priors.md) rejected. Every archetype therefore requires
`reliability` of `"high"`/`"medium"` and a 450-minute evidence floor — verified with a harness that
zero `"low"`-reliability players ever reach a gem verdict.

**No composite score.** Ranking runs through the app's one xP/value implementation (`xpFor`,
`valuePerMillion` in `lib/scoring.ts`), with percentile/ownership/xP-per-£m surfaced as separate
stated terms rather than pre-summed into one number the video's own inconsistent formulas couldn't
support.

## Surfaces

`/players` (checkbox + archetype dropdown + `GemBadge`), and the builder's Replacement Finder panel
(archetype dropdown feeding `ReplacementFilters.archetypeIds` as an additive filter — it doesn't
change `findReplacements`' behaviour when untouched).

See also: [cold-start-priors.md](cold-start-priors.md), [methodology.md](methodology.md#an-invented-threshold-is-not-evidence).
