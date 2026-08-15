# Glossary

Short definitions for terms that recur across the wiki without being redefined each time.

**xP** — expected points. The model's central output; see [xp-model.md](xp-model.md).

**Horizon** — `1 | 3 | 5 | 8 | 19 | "season"`, a page-level control driving projection length. See
[frontend-conventions.md](frontend-conventions.md#horizon-is-a-page-level-control-and-season-is-a-string).

**`n_eff`** — effective sample size behind a player's rate (`weightedMinutes / 90`), the evidence
volume that decides how much a prior shrinks a player's own rate. See
[cold-start-priors.md](cold-start-priors.md).

**Reliability** — `"low" | "medium" | "high"`, a stated confidence label attached to every
projection, derived from `n_eff`. `"low"`-reliability players are excluded from Hidden Gems
verdicts and weighted down by the squad optimiser's Low risk setting.

**`riskPoints`** — the one risk→points exchange rate, shared by SquadScore and TransferGain. See
[risk-scoring.md](risk-scoring.md).

**`decisionMargin`** — the disclosed user input standing in for "value of news not yet known" in the
transfer optimiser's roll-vs-spend decision. See [transfer-engine.md](transfer-engine.md).

**`TeamState`** — the one shared squad shape every page consumes. See
[frontend-conventions.md](frontend-conventions.md).

**EO** — effective ownership (captain 2×, triple captain 3×, bench 0×). Blocked until league 314
populates; see [blocked-and-data-gaps.md](blocked-and-data-gaps.md).

**FDR** — fixture difficulty rating. Currently the official FPL rating; a custom analytical version
is blocked on team strength being zero pre-season. See [fpl-api-constraints.md](fpl-api-constraints.md).

**DC / `dc90`** — defensive contribution, an FPL scoring category since 2024/25 (2 points for
clearing a per-match action threshold). See [xp-model.md](xp-model.md).

**CBIT / CBIRT** — the component actions behind defensive contribution: Clearances + Blocks +
Interceptions + Tackles (defenders' scoring rule), plus Recoveries for midfielders/forwards
(CBIRT). The model currently applies one aggregate count to both rules — a disclosed gap. See
[xp-model.md](xp-model.md#known-disclosed-gaps).

**λ (league-translation factor)** — a fitted, per-metric ratio converting a Championship-league rate
to a PL-equivalent one. Never invented or shared across metrics. See
[cold-start-priors.md](cold-start-priors.md#phase-2--external-league-enrichment).

**`μ_fit`** — the club tactical-fit multiplier proposed for xP integration; blocked, not built. See
[club-tactical-profiles.md](club-tactical-profiles.md).

**Two "manager" senses** — the FPL fantasy manager (the owner, ID 274486; see
[manager-profile.md](manager-profile.md)) vs. a real-world PL club's head coach (see
[club-tactical-profiles.md](club-tactical-profiles.md)). Named collision, resolved by using entirely
different table/file names for the second sense.

**RLS** — Row Level Security, Postgres's row-level access-control mechanism. See
[database-and-rls.md](database-and-rls.md) for the two shapes this schema uses.

**`*_MODEL_NOTE` / `*_NOTE`** — the disclosure-string convention: whenever a term is dropped,
approximated, or blocked, a note constant states so next to the number it affects. See
[methodology.md](methodology.md#drop-renormalise-disclose).
