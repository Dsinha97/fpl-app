# Wiki index

The topic map for this app — organised by *what* each thing is, not *when* it was built. For "what's
next" or the chronological build record, start at [../roadmap.md](../roadmap.md) and
[../README.md](../README.md) instead; this wiki is a companion layer on top, not a replacement.

Every page opens with a one-line summary, links related pages, and attributes non-obvious claims
back to the sprint file or source spec they came from. See [AGENTS.md](AGENTS.md) for how this wiki
is maintained, and [log.md](log.md) for the edit history.

## Engines & model

| Page | What it covers |
|---|---|
| [xp-model.md](xp-model.md) | The expected-points engine: components, Poisson counts, calibration history, squad reconciliation |
| [cold-start-priors.md](cold-start-priors.md) | How players with thin/no PL evidence still get a projection — empirical-Bayes shrinkage, the Championship λ fit, rejected data drops |
| [risk-scoring.md](risk-scoring.md) | The one risk formula and its shared exchange rate |
| [squad-optimizer.md](squad-optimizer.md) | Full-squad building under budget/formation rules — the knapsack fill-order bug and its fix |
| [lineup-captain-bench.md](lineup-captain-bench.md) | XI, captain/vice, bench substitution order |
| [transfer-engine.md](transfer-engine.md) | The manual basket simulator and the automated weekly roll/spend/hit recommendation |
| [chip-strategy.md](chip-strategy.md) | Bench Boost / Triple Captain / Free Hit / Wildcard valuation and joint scheduling |
| [chip-plan.md](chip-plan.md) | Pinning a chip to a gameweek, the chip-aware deadline optimiser, and the bounded forward transfer path |
| [fixture-difficulty.md](fixture-difficulty.md) | Three generations of FDR — official, strength-derived (display-only forever), results-derived (measured, unshipped, and why) |

## Features & surfaces

| Page | What it covers |
|---|---|
| [squad-score-and-scenarios.md](squad-score-and-scenarios.md) | The composite draft-ranking score and the Scenario Lab |
| [hidden-gems.md](hidden-gems.md) | The value-discovery archetype filter and why it needed no external data |
| [manager-profile.md](manager-profile.md) | The owner's own career percentile profile |
| [club-tactical-profiles.md](club-tactical-profiles.md) | PL head-coach tactical data, shipped as disclosed context rather than an xP term |
| [deadline-and-matchday.md](deadline-and-matchday.md) | The pre-deadline decision hub and the live-matchday hub (one route, two phases), plus `/review` — what a finished gameweek's decisions actually cost |
| [ownership-and-leagues.md](ownership-and-leagues.md) | Exact mini-league effective ownership, the league-314 top-1k sample, and adding rivals from a league's standings |
| [decision-analytics.md](decision-analytics.md) | Season-wide scoring of decisions already made — captain success, transfer success, chip ROI, rank progression |

## Platform

| Page | What it covers |
|---|---|
| [data-pipeline.md](data-pipeline.md) | Edge Functions, cron cadence, change-detected snapshotting |
| [news-feed.md](news-feed.md) | RSS ingestion, table-driven feed config, tiered player/club entity resolution, where headlines surface |
| [database-and-rls.md](database-and-rls.md) | The two RLS shapes this schema uses, and how to verify a new policy |
| [edge-function-security.md](edge-function-security.md) | Who may call `/functions/v1/*` — three caller classes, Vault-held secrets, the rate limit as an input |
| [notifications-and-bot.md](notifications-and-bot.md) | The Telegram bot both ways — the outbox dedupe key, the chat-id allowlist, and the line the Deno boundary draws |
| [fpl-api-constraints.md](fpl-api-constraints.md) | Row caps, pre-season placeholder fields, asset URL shapes |
| [fpl-authentication.md](fpl-authentication.md) | Why credential login is blocked, and the three generations of workaround |
| [deployment.md](deployment.md) | Static export on Cloudflare Workers — build-vs-runtime variables, routing gotchas |
| [performance.md](performance.md) | Measured latency baseline, the serial-pagination and `/team` sync-on-load fixes, and what a generic web-perf playbook does/doesn't apply here |

## Cross-cutting

| Page | What it covers |
|---|---|
| [frontend-conventions.md](frontend-conventions.md) | `TeamState`, horizons, theme, shared helpers, static-export traps |
| [design-system.md](design-system.md) | Tokens, semantic colour, button/state vocabulary, the busy-state pattern, card hierarchy, disclosure |
| [methodology.md](methodology.md) | The standing rules this codebase is built and corrected under |
| [blocked-and-data-gaps.md](blocked-and-data-gaps.md) | The single answer to "why isn't X built" |
| [timeline.md](timeline.md) | Chronological pointer into `sprints/` |
| [glossary.md](glossary.md) | Terms used without redefinition across the wiki |
