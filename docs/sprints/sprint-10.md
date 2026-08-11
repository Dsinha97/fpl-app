# Sprint 10 — Ownership Intelligence

**Status: not started, blocked.** See [../roadmap.md](../roadmap.md) for the sprint index.

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
