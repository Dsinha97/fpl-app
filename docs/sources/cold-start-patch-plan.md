FPL Analytics & Decision Support App
====================================

Cold-Start Player Prediction Patch — Implementation Plan
========================================================

> **Status: phase 1 built (2026-08-04). This document is kept unedited as the source; what was
> actually implemented, and where it deviates, is recorded under "Cold-Start Patch" in
> [roadmap.md](../roadmap.md).**
>
> In short: the Bayesian prior and minutes-based updating of §23–§29 shipped, fitted from variance
> components measured off `player_season_history`. Coverage went from 380 of 567 players to all 567.
>
> Four sections are superseded rather than pending. **§15–§21** argue for replacing a formula this
> repo never had — `xp-model.ts` was already component-wise with position-specific scoring, Poisson
> defensive-contribution thresholds and per-component fixture multipliers, so the cold-start layer
> needed only to produce the existing `Rates` shape. **§13**'s team context has no data source (FPL
> reports team strength as zero for all 20 clubs pre-season). **§33**'s four prediction tables
> collapse to one, since two of them duplicated `player_predictions`. And **§25**'s gameweek decay
> schedule is replaced by minutes-based effective sample size, as §25 itself recommends.
>
> **§4–§14 and §30–§40 — external data, league translation, the bridge cohort — remain the
> reference for phase 2, which is not built.** It is blocked on a data source, not on effort: see the
> roadmap for why API-Football carries no xG, why soccerdata does not cover the Championship, and why
> a translation cohort drawn from this database would be survivor-biased.
>
> **Reconciliation note, 2026-09-02 — §13's stated reason has partly expired.** The line above
> says team context has no data source because "FPL reports team strength as zero for all 20 clubs
> pre-season." Checked live against `teams` on 2026-09-02 (GW3): `strength_overall_home`/`_away`
> **are** populated for all 20 clubs, on a coarse 2–4 scale. It is only `strength_attack_*` and
> `strength_defence_*` — and `strength` itself, still `NULL` — that stay zero once the season is
> under way. So §13 is not blocked outright: an overall home/away team-context term has data behind
> it today, while an attack/defence split still does not. The body below is left unedited, as this
> file's convention requires. See [wiki/fpl-api-constraints.md](../wiki/fpl-api-constraints.md).

1. Patch Objective

------------------

### Problem

The existing FPL prediction engine is primarily trained on Premier League data.

This creates a cold-start problem for:

* Players transferred into the Premier League

* Players promoted from the Championship

* Players arriving from European leagues

* Players returning to the Premier League after a long absence

* Players promoted from lower divisions

* Young players with limited senior-level data

For these players, the application may have:
    0–5 Premier League Gameweeks

of relevant evidence.

The existing model therefore risks either:
    A. Overreacting to a tiny Premier League sample

or:
    B. Treating the player as a league-average player

Neither is desirable.

### Objective

Build a **Cold-Start Prediction Layer** that creates an informed prior from historical player data, translates that prior into a Premier League context, and gradually replaces the prior with observed Premier League evidence.

The resulting architecture should be:
    External Player History
            │
            ▼
    Identity Resolution
            │
            ▼
    Role Classification
            │
            ▼
    League Translation
            │
            ▼
    Translated Player Prior
            │
            ├──────────────┐
            │              │
            ▼              ▼
    Team Context      PL Fixtures
            │              │
            └──────┬───────┘
                   ▼
           Prior xP Distribution
                   │
                   ▼
         Premier League Evidence
                   │
                   ▼
         Bayesian Updating Layer
                   │
                   ▼
           Cold-Start xP Model
                   │
                   ▼
             Existing xP Engine

The core design principle is:

> **Do not create a separate xP model for new players. Create a prior that feeds the existing xP model and progressively shrinks toward the Premier League evidence.**

* * *

2. Recommended Patch Architecture
   =================================

Add a new layer between the external data ingestion process and the existing xP engine.
                        Player Data
                           │
              ┌────────────┴─────────────┐
              │                          │
       Premier League Data       External League Data
              │                          │
              │                    Historical Metrics
              │                          │
              │                    League Translation
              │                          │
              │                    Role Translation
              │                          │
              │                    Team Context
              │                          │
              └────────────┬─────────────┘
                           ▼
                  Cold-Start Prior Layer
                           │
                           ▼
                  Bayesian Update Layer
                           │
                           ▼
                    Existing xP Model
                           │
                           ▼
                     Final xP Output

The cold-start layer should only be activated when required.

* * *

3. Player Classification
   ========================

Before calculating a prior, classify each player.
Tier A — Existing Premier League Player
---------------------------------------

The player has meaningful historical PL data.
    Use Existing PL Model

No cold-start translation required.

* * *

Tier B — Returning PL Player
----------------------------

The player has previous PL experience but has spent one or more seasons elsewhere.

Use:
    Previous PL Data
    +
    Recent External League Data
    +
    Current Team Context

Suggested weighting:
    Previous PL Data
         +
    Recent External Data

Do not treat these players as complete newcomers.

* * *

Tier C — Championship / Promoted Player
---------------------------------------

The player has primarily played in the EFL Championship or another lower division.

Use:
    Championship Prior
    +
    League Translation
    +
    New PL Club Context

* * *

Tier D — Foreign League Transfer
--------------------------------

Examples:
    La Liga
    Bundesliga
    Serie A
    Ligue 1
    Eredivisie
    Liga Portugal
    MLS
    Other

Use:
    External Prior
    +
    League Translation
    +
    New Club Context

* * *

Tier E — Youth / Limited Senior Data
------------------------------------

Very little reliable historical senior-level data.

Use:
    Position Prior
    +
    Role Prior
    +
    FPL Price Prior
    +
    Team Context
    +
    Expected Minutes

This should have the widest uncertainty interval.

* * *

4. External Data Source Strategy
   ================================

The system should use a source hierarchy.

| Priority | Source                   | Primary Use                                                      |
| -------- | ------------------------ | ---------------------------------------------------------------- |
| 1        | Official FPL data        | PL player data, price, position, status, scoring                 |
| 2        | FBref / Opta-backed data | Historical player and team performance                           |
| 3        | API-Football             | Broader league coverage, player stats, transfers, injuries, odds |
| 4        | Understat                | Secondary xG/xA validation for covered major leagues             |
| 5        | Transfermarkt            | Transfer and market-value metadata                               |
| 6        | Opta / StatsBomb direct  | Premium high-granularity data if budget permits                  |

FBref currently provides player and team statistics across the Big Five European leagues and has expanded domestic-league coverage to more than 40 countries, with Opta-provided expected-goals data on covered competitions. However, FBref explicitly notes that player records may be incomplete when players come from leagues it does not cover.

API-Football is a useful broad-coverage fallback: its current coverage page lists more than 1,200 leagues and cups, with player statistics, transfers, injuries and odds among the available data categories. However, coverage varies by competition and season, so the implementation should check availability before requesting a metric.

Understat is best treated as a supplemental source for covered top leagues rather than the main cross-league data provider. Community tooling exposes historical data for competitions including the Premier League, La Liga, Bundesliga, Serie A and Ligue 1, but access is commonly implemented through unofficial extraction tools.

Transfermarkt should be considered optional metadata rather than a foundational modeling dependency. The integrations I found are primarily unofficial wrappers or scraping-based services rather than a documented public developer API.

### Recommended implementation

For the first version:
    Official FPL
        +
    FBref / Opta-backed data
        +
    API-Football

Use:
    Understat

as a validation source where useful.

Do not make the model dependent on Transfermarkt.

* * *

5. Critical Data Normalization Requirement
   ==========================================

Do not combine xG or xA values from different providers as though they were identical.

For example:
    Provider A xA

may not have exactly the same definition as:
    Provider B xAG

Therefore, every external metric should carry:
    provider
    metric_name
    metric_definition
    league
    season
    position
    role
    minutes

Recommended storage:
    player_external_metrics

    player_id
    provider
    competition_id
    season
    metric
    value
    per90_value
    minutes
    metric_definition
    retrieved_at

The initial model should ideally use one primary provider for each metric across as many leagues as possible.

If multiple providers are required, calibrate them against each other before using them in the same model.

* * *

6. Metrics to Collect
   =====================

The cold-start layer should collect more than goals and assists.
Attacking
---------

    xG / 90
    npxG / 90
    xA / 90
    Shots / 90
    Shots in Box / 90
    Big Chances
    Touches in Box
    Key Passes
    Shot-Creating Actions
    Goal-Creating Actions

Passing / Progression
---------------------

    Progressive Passes
    Progressive Carries
    Final Third Passes
    Passes into Box
    Crosses

Defensive
---------

    Tackles
    Interceptions
    Clearances
    Blocks
    Recoveries
    Defensive Actions

Playing Time
------------

    Minutes
    Starts
    Starts %
    Minutes per Appearance
    Substitute Appearances
    Average Minutes When Starting

Role / Opportunity
------------------

    Position
    Role
    Penalty Duties
    Free-Kick Duties
    Corner Duties
    Set-Piece Role
    Expected Position
    Expected Role

Team Context
------------

    Team xG
    Team xGA
    Possession
    Attacking Strength
    Defensive Strength
    Expected Starting XI
    Competition for Position

* * *

7. Do Not Use Raw Goals as the Primary Prior
   ============================================

The model should prioritize:
    xG
    xA
    xGI
    Shot Volume
    Chance Creation
    Expected Minutes

over:
    Goals
    Assists

Goals and assists can still be used as secondary signals.

The purpose is to avoid importing finishing or conversion variance from a smaller league directly into the Premier League prior.

* * *

8. League Translation Model
   ===========================

The proposed fixed multipliers should not be hardcoded as production values.

For example, avoid starting production with:
    Bundesliga λG = 0.84
    La Liga λG = 0.87
    Championship λG = 0.68

unless these are derived and validated from your own historical transfer dataset.

The research I found supports the general idea that cross-league performance translation is necessary, but it does not validate those specific values. A recent football-focused preprint proposes a hierarchical Bayesian model using cross-league transfers into the Premier League, decomposing league, team and age effects and reporting uncertainty intervals. This is much closer to the methodology that should be implemented here.

* * *

9. Recommended Translation Factor Model
   =======================================

For each metric `m`, model the observed Premier League performance of transferred players relative to their previous league.

For example:
    m ∈ {

    xG90

    xA90

    Shots90

    SCA90

    xDC90

    BPS-related rate

    }

Use:
    log(Metric_PL / Metric_Origin)
    =
    α_m
    +
    β_league,m
    +
    γ_position,m
    +
    δ_role,m
    +
    η_age,m
    +
    θ_team_context,m
    +
    ε

Where:
    β_league,m
    =
    League Translation Effect

Then:
    λ_league,m
    =
    exp(β_league,m)

This produces:
    λ_xG
    λ_xA
    λ_Shots
    λ_SCA
    λ_xDC

rather than one global league coefficient.

* * *

10. Hierarchical Shrinkage for Sparse Leagues
    =============================================

For leagues with limited transfer history:
    Individual League Factor
            ↓
    Regional / Competition Tier Prior
            ↓
    Global Prior

Example:
    Eredivisie
        ↓
    North / Central European League Group
        ↓
    Global Non-PL Prior

This prevents a league with only a few historical PL transfers from producing an unstable translation factor.

The model should return:
    Translation Factor
    Lower Bound
    Upper Bound
    Sample Size
    Confidence

Example:
    Eredivisie → PL

    xG Translation

    0.71

    90% Interval

    0.61 – 0.82

    Transfer Cohort

    n = 42

    Confidence

    Medium

* * *

11. Build the Translation Dataset
    =================================

Create a historical transfer cohort.

For every eligible player:
    Season T-1
    External League
            ↓
    Transfer
            ↓
    Premier League
            ↓
    Season T

Collect:
    Origin metrics
    PL metrics
    Origin minutes
    PL minutes
    Age
    Position
    Role
    Origin team strength
    Destination team strength
    Transfer timing

Prefer players with:
    Minimum 600–900 minutes

in the source season.

For the PL season:
    Minimum 450 minutes

where possible.

Lower-minute players can be retained but should receive lower statistical weight.

* * *

12. Bridge Player Method
    ========================

The strongest source of translation data is a bridge cohort.

For example:
    Player A

    2025/26
    Bundesliga
    xG90 = 0.65

    2026/27
    Premier League
    xG90 = 0.50

Across many players:
    Bundesliga

    ↓

    Premier League

Estimate:
    Expected Translation

This is preferable to comparing league-wide averages because the same players provide the bridge between competitions.

The broader sports-analytics literature also supports estimating translation effects from players who actually move between leagues rather than relying only on raw league averages. A 2026 study on league translation methodology recommends matched or difference-in-differences approaches to reduce bias from differences in player pools and competition levels. While that paper is from basketball rather than football, its methodological principle is directly relevant to the design of this football model.

* * *

13. Add Team Context
    ====================

A player's external production should not be transferred directly to their new club.

Use:
    Translated Player Ability
            ×
    New Team Opportunity
            ×
    Expected Role

For example:
    Player xG90 Prior

    ×

    New Team Attacking Strength

    ×

    Player Share of Team xG

    ×

    Expected Minutes

Recommended context variables:
    New Team xG / 90
    New Team Possession
    New Team Shots
    New Team Penalty Frequency
    New Team Set-Piece Volume
    Player Expected Role

* * *

14. Role Translation
    ====================

Position is not enough.

A player listed as:
    MID

could be:
    Winger
    Attacking Midfielder
    Central Midfielder
    Defensive Midfielder
    Second Striker

The model should therefore classify:
    FPL Position
    +
    Football Role

Example:
    FPL MID

    Role:
    Inverted Winger

    Prior:

    High xG
    High xA
    High SCA
    Low DC

Another:
    FPL MID

    Role:
    Defensive Midfielder

    Prior:

    Low xG
    Moderate xA
    High DC
    Moderate BPS

This is especially important given the current FPL scoring system.

* * *

15. Updated xP Integration
    ==========================

The existing cold-start formula:
    xP_prior
    =
    (
    xG × λG × 4
    +
    xA × λA × 3
    +
    BasePoints
    )
    × TeamStrength
    × FDR
    × ExpectedMinutes

should be replaced.

The reason is that FPL goal points vary by position, and the current scoring system also includes clean sheets, defensive contributions, saves and bonus points. In 2026/27, the Bonus Points System has also been modified, while defensive contribution scoring remains a core route to points.

Use component-level expected points instead.

* * *

16. Recommended Cold-Start xP Formula
    =====================================

For player `i` in Gameweek `g`:
    xP_i,g

    =

    AppearancePoints_i,g

    +

    GoalPoints_i,g

    +

    AssistPoints_i,g

    +

    CleanSheetPoints_i,g

    +

    DefensiveContributionPoints_i,g

    +

    SavePoints_i,g

    +

    BonusPoints_i,g

    -

    ExpectedNegativePoints_i,g

Each component is estimated independently.

* * *

17. Attacking Component
    =======================

Translate external attacking metrics first.
    xG90_PL

    =

    xG90_Origin
    ×
    λ_xG
    ×
    RoleAdjustment
    ×
    TeamAttackAdjustment

Then:
    ExpectedGoals_i,g

    =

    xG90_PL
    ×
    ExpectedMinutes_i,g
    /
    90

Expected goal points:
    ExpectedGoalPoints_i,g

    =

    ExpectedGoals_i,g
    ×
    GoalPoints(position)

Current FPL goal values differ by position, so these must be position-specific rather than using a single `4 × xG` multiplier.

* * *

18. Assist Component
    ====================
    
    xA90_PL
    =
    xA90_Origin
    ×
    λ_xA
    ×
    RoleAdjustment
    ×
    TeamAttackAdjustment

Then:
    ExpectedAssists_i,g

    =

    xA90_PL
    ×
    ExpectedMinutes_i,g
    /
    90

And:
    ExpectedAssistPoints_i,g

    =

    ExpectedAssists_i,g
    ×
    3

* * *

19. Defensive Contribution Prior
    ================================

For defenders:
    xDC90_PL

    =

    xDC90_Origin
    ×
    λ_xDC
    ×
    RoleAdjustment

For midfielders and forwards:
    xDC90_PL

    =

    xDCIRT90_Origin
    ×
    λ_xDC
    ×
    RoleAdjustment

The current FPL system awards two points when a defender reaches 10 qualifying defensive contributions in a match, while midfielders and forwards have a 12-action threshold that also includes recoveries. These should therefore be modeled as **probability of reaching the threshold**, rather than simply multiplying a continuous DC rate by two points.

Use:
    P(DC Threshold Reached)

Then:
    ExpectedDCPoints

    =

    2
    ×
    P(DC Threshold Reached)

* * *

20. Bonus Points Prior
    ======================

Bonus should be estimated from:
    Role
    Expected Minutes
    Team Strength
    Player Actions
    BPS-related Metrics

For a new player:
    External BPS data
            ↓
    Translate where possible
            ↓
    Role-adjust
            ↓
    Team-context adjustment

If BPS data is unavailable:
    Position Prior
    +
    Role Prior
    +
    Expected Minutes
    +
    Team Context

The 2026/27 BPS changes should be represented explicitly in the scoring configuration rather than assuming the previous season's BPS relationship remains unchanged.

* * *

21. Fixture Adjustment
    ======================

Do not multiply the entire xP score by FDR.

Instead, adjust the underlying opportunity rates.

Example:
    xG90_PL

    ×

    FixtureAttackMultiplier

and:
    CleanSheetProbability

    ×

    FixtureDefensiveMultiplier

This avoids incorrectly changing:
    Appearance Points

based on fixture difficulty.

* * *

22. Expected Minutes Model
    ==========================

Expected minutes should be modeled separately.

Use:
    Expected Minutes

    =

    StartProbability
    ×
    ExpectedMinutesIfStarter

    +

    SubProbability
    ×
    ExpectedMinutesIfSub

Inputs:
    Historical Starts
    Historical Minutes
    Manager Rotation
    Competition for Position
    Injury Status
    Suspension
    Transfer Timing
    Squad Depth
    Fixture Congestion

Transfer fee and market value may be included as weak contextual signals, but should not be the primary proxy for expected minutes.

The model should prioritize actual evidence of role and selection.

* * *

23. Bayesian Prior
    ==================

The prior should be a distribution, not just a single xP number.

For a metric `θ`:
    θ_prior

    ~

    Normal(
        μ_prior,
        τ_prior²
    )

Where:
    μ_prior
    =
    Translated External Performance

    τ_prior
    =
    Prior Uncertainty

Prior uncertainty should depend on:
    Historical Minutes
    Number of Seasons
    Number of Leagues
    Role Stability
    Data Quality
    Provider Coverage

* * *

24. Bayesian Update
    ===================

Once the player has PL observations:
    Prior

    ↓

    Premier League Evidence

    ↓

    Posterior

For a simplified normal model:
    θ_prior ~ N(μ0, τ²)

    Observed PL mean:

    ȳ ~ N(θ, σ² / n_eff)

Posterior mean:
    μ_post

    =

    w_prior × μ0

    +

    (1 - w_prior) × ȳ

where:
    w_prior

    =

    σ²
    /
    (
    n_eff × τ²
    +
    σ²
    )

This naturally reduces the prior's influence as Premier League evidence increases.

* * *

25. Use Minutes Instead of Gameweeks for Bayesian Decay
    =======================================================

The original approach:
    GW 0 = 100% Prior

    GW 1 = 75%

    GW 2 = 50%

    GW 3 = 30%

    GW 4 = 15%

    GW 5 = 0%

is useful as an initial heuristic but should not be the final implementation.

Instead define:
    N_eff

    =

    Expected PL Minutes
    /
    90

capped at:
    5

Then estimate:
    Prior Weight

    =

    f(
    N_eff,
    Metric Variance,
    Prior Uncertainty
    )

Example:
    0 minutes

    Strong Prior

    90 minutes

    Moderate-Strong Prior

    180 minutes

    Moderate Prior

    270 minutes

    Weak-Moderate Prior

    360 minutes

    Weak Prior

    450+ minutes

    PL Model Dominant

The system can still enforce:
    Maximum Cold-Start Horizon = 5 Gameweeks

but should not automatically discard the external prior merely because the calendar reaches GW5 if the player has barely played.

* * *

26. Player-Specific Decay
    =========================

Different players should lose prior influence at different rates.

Example:
    Player A

    400 PL minutes
    Prior weight = 15%

    Player B

    90 PL minutes
    Prior weight = 65%

This is more statistically defensible than:
    GW5

    Prior = 0%

for both players.

* * *

27. Prior Reliability Score
    ===========================

Create:
    PriorReliability

based on:
    Historical Minutes
    Number of Seasons
    Role Stability
    League Data Quality
    Metric Availability
    Player Identity Confidence

Example:
    Prior Reliability

    High

    Player has:

    2,500+ minutes

    Same role

    Two seasons

    High-quality data

versus:
    Low

    Player has:

    300 minutes

    Multiple clubs

    Role uncertainty

    Limited external data

* * *

28. Cold-Start Confidence
    =========================

Return both:
    Expected xP

    Confidence Interval

Example:
    Player A

    xP

    5.8

    80% Interval

    3.8–7.9

    Confidence

    Low

After PL exposure:
    Player A

    xP

    6.1

    80% Interval

    5.3–7.0

    Confidence

    Medium

The prediction can therefore become more certain without necessarily changing dramatically.

* * *

29. FPL Price as a Fallback Prior
    =================================

FPL price should be used as a **weak prior**, not as a direct xP formula.

Do not hardcode:
    £8.5m MID
    =
    4.5–5.5 xP

Instead learn:
    E[xP | Position, Price Bucket, Role, Season]

from historical FPL data.

For example:
    MID
    £4.5–£5.0

    MID
    £5.5–£6.5

    MID
    £7.0–£8.5

    MID
    £9.0+

Then use price as:
    PricePrior

with a relatively low maximum weight.

This is justified as a supporting signal because FPL pricing reflects player expectations and role uncertainty, but the official sources do not publish a direct price-to-xP conversion rule. For example, the 2026/27 Scout analysis explicitly discusses player prices in conjunction with expected role and performance, while FPL price changes during the season are driven by transfer-market activity.

* * *

30. Bookmaker Odds as an Optional Prior
    =======================================

Where available, use:
    Anytime Goalscorer Odds

    Team Goals Odds

    Match Result Odds

Convert to implied probabilities after removing bookmaker margin.

Use:
    Bookmaker Prior

    +

    Model Prior

    +

    PL Evidence

Do not let bookmaker odds completely replace the player model.

This should be an optional feature because odds coverage and licensing/access may vary by competition and provider.

API-Football currently advertises pre-match and live odds along with player statistics, injuries and other football data, but its documentation emphasizes that coverage varies by competition and season.

* * *

31. Recommended Cold-Start Fallback Hierarchy
    =============================================

Use the following order:
    1. Previous Premier League data

    ↓

    2. Recent external league data
       + empirical league translation

    ↓

    3. Historical external data
       + hierarchical league prior

    ↓

    4. Team / role / position prior

    ↓

    5. FPL price prior

    ↓

    6. Position-level league baseline

Every fallback should increase uncertainty.

* * *

32. Final Cold-Start xP Pipeline
    ================================
    
    Identify Player
    ↓
    Classify Player Type
    ↓
    Find Historical Data
    ↓
    Resolve Player Identity
    ↓
    Identify Position
    ↓
    Identify Football Role
    ↓
    Estimate Historical Metrics
    ↓
    Estimate Historical Reliability
    ↓
    Apply League Translation
    ↓
    Apply Team Context
    ↓
    Apply Role Context
    ↓
    Generate Prior Distribution
    ↓
    Estimate Expected Minutes
    ↓
    Estimate Upcoming Fixtures
    ↓
    Calculate Prior xP
    ↓
    Observe Premier League Minutes
    ↓
    Update Posterior
    ↓
    Generate Final xP
    ↓
    Return Confidence Interval

* * *

33. Supabase Data Model
    =======================

Add:
`player_external_history`
-------------------------

    id
    player_id
    provider
    competition_id
    season
    minutes
    starts
    xg90
    xa90
    shots90
    sca90
    xdc90
    bps_rate
    role
    retrieved_at

* * *

`player_identity_map`
---------------------

    player_id
    provider
    external_player_id
    external_name
    confidence
    match_method
    verified_at

* * *

`league_translation_factors`
----------------------------

    id
    origin_competition_id
    destination_competition_id
    metric
    position_group
    role_group
    translation_factor
    lower_bound
    upper_bound
    sample_size
    method
    model_version
    trained_through_season
    created_at

* * *

`player_prior_predictions`
--------------------------

    player_id
    gameweek
    prior_xP
    prior_xP_lower
    prior_xP_upper
    
    prior_xG90
    prior_xA90
    prior_xDC90
    
    prior_minutes
    prior_start_probability
    
    prior_reliability
    model_version
    created_at

* * *

`player_posterior_predictions`
------------------------------

    player_id
    gameweek
    posterior_xP
    posterior_xP_lower
    posterior_xP_upper
    
    prior_weight
    pl_weight
    
    pl_minutes_observed
    effective_sample_size
    
    model_version
    created_at

* * *

34. Edge Functions
    ==================

Add:
    sync-external-player-history

    resolve-player-identities

    calculate-league-translation

    generate-player-priors

    generate-cold-start-xp

    update-cold-start-posterior

    backtest-cold-start-model

Recommended flow:
    New FPL Player Detected
            │
            ▼
    External Data Lookup
            │
            ▼
    Identity Resolution
            │
            ▼
    Historical Metric Aggregation
            │
            ▼
    League Translation
            │
            ▼
    Prior Generation
            │
            ▼
    xP Engine

After each Gameweek:
    PL Data Updated
            │
            ▼
    Update Player Exposure
            │
            ▼
    Bayesian Posterior Update
            │
            ▼
    Recalculate xP
            │
            ▼
    Evaluate Prior Weight

* * *

35. Model Backtesting
    =====================

This patch should not go directly to production without historical validation.

Build a historical transfer cohort.

For example:
    Players who moved into PL

    Season T

Pretend the model only knew:
    Data available before PL debut

Then simulate:
    Pre-season Prediction

    ↓

    GW1 Prediction

    ↓

    GW2 Prediction

    ↓

    GW3 Prediction

    ↓

    GW4 Prediction

    ↓

    GW5 Prediction

Compare against actual outcomes.

* * *

36. Benchmark Models
    ====================

Compare at least five versions.

### Model A

PL baseline only.
    No external prior

### Model B

Raw external statistics.
    No league translation

### Model C

Fixed league multipliers.
    Manual λ values

### Model D

Empirically estimated league translation.
    Historical bridge cohorts

### Model E

Hierarchical Bayesian model.
    League

    +

    Position

    +

    Role

    +

    Age

    +

    Team Context

    +

    Uncertainty

The production model should only advance if it meaningfully improves out-of-sample performance.

* * *

37. Evaluation Metrics
    ======================

Measure:
    xP MAE

    xP RMSE

    Rank Correlation

    Top-10 Player Accuracy

    Start Probability Brier Score

    Minutes Prediction MAE

    Calibration of Prediction Intervals

Analyze separately by:
    Origin League

    Position

    Role

    Player Age

    Transfer Type

    Minutes Exposure

* * *

38. Critical Leakage Prevention
    ===============================

When backtesting a historical player transfer:

Only use information that was available before the player's first PL Gameweek.

Do not use:
    Future PL performance

    End-of-season transfer value

    Future injuries

    Future lineups

    Future team strength

Allowed:
    Previous season statistics

    Transfer fee

    Pre-season role information

    New club strength available pre-season

    FPL starting price

    Pre-season odds

This is essential for measuring whether the model would have actually helped a manager.

* * *

39. Additional Improvement — Context-Adjusted Metrics
    =====================================================

Where possible, normalize external statistics for:
    Game State

    Home/Away

    Red Cards

    Team Strength

This is particularly useful because raw xG and shot production can vary with match state and tactical context. Recent research using data from Europe's top five leagues found meaningful nonlinear effects from score difference, red cards and home advantage on offensive metrics, supporting the use of context-adjusted rather than purely raw rates.

* * *

40. Recommended Implementation Sprints
    ======================================

Sprint A — External Data Foundation
-----------------------------------

Build:
    Provider Integrations

    Player Identity Mapping

    League Mapping

    External Metric Schema

Deliverable:
    Any new FPL player

    ↓

    External history successfully resolved

* * *

Sprint B — Translation Dataset
------------------------------

Build:
    Historical Transfer Cohort

    League Mapping

    Position Mapping

    Role Mapping

    Translation Dataset

Deliverable:
    Historical PL translation factors

* * *

Sprint C — Translation Model
----------------------------

Implement:
    League Translation

    Position Effects

    Role Effects

    Age Effects

    Team Effects

Start with empirical regression.

Then add hierarchical Bayesian modeling.

Deliverable:
    Translated External Prior

* * *

Sprint D — Bayesian Cold-Start Layer
------------------------------------

Implement:
    Prior Distribution

    Prior Reliability

    PL Evidence

    Effective Sample Size

    Posterior Update

Deliverable:
    Prior → Posterior

* * *

Sprint E — xP Integration
-------------------------

Connect:
    Translated Prior

    ↓

    Existing xP Engine

    ↓

    Final Cold-Start xP

Add:
    Expected Minutes

    Expected xG

    Expected xA

    Expected DC

    Expected Bonus

Deliverable:
    New player receives xP prediction
    before PL debut

* * *

Sprint F — Backtesting
----------------------

Test:
    Baseline

    vs

    Fixed λ

    vs

    Empirical λ

    vs

    Bayesian Translation

Deliverable:
    Model Performance Report

* * *

Sprint G — Production Rollout
-----------------------------

Activate the system for:
    New Transfers

    Promoted Players

    Returning Players

Show:
    Cold-Start Model

    xP

    Confidence

    Prior Weight

    PL Evidence

Deliverable:
    Production Cold-Start Engine

* * *

41. User-Facing UI
    ==================

For a new player, display:
    PLAYER A

    Premier League Experience

    0 matches

    External Prior

    Bundesliga

    Prior xP

    6.1

    Current PL Evidence

    0 minutes

    Confidence

    Low

    Projected xP

    5.8



After two Gameweeks:
    PLAYER A

    Prior Weight

    50%

    PL Evidence

    50%

    Projected xP

    6.4

    Confidence

    Medium

After sufficient PL exposure:
    PLAYER A

    Prior Weight

    10%

    PL Evidence

    90%

    Projected xP

    6.7

    Confidence

    High

This makes the model explainable.

* * *

42. Key Model Governance
    ========================

Every output should store:
    model_version

    translation_model_version

    external_data_version

    prior_weight

    pl_weight

    data_sources

    confidence

    created_at

This allows you to answer:

> Why did the model predict this player to score 5.8 points before his PL debut?

* * *

43. Acceptance Criteria
    =======================

The patch is ready for production when:
    ✓ New players are automatically identified

    ✓ Player identity is resolved across providers

    ✓ Historical external metrics are retrieved

    ✓ Metrics are normalized

    ✓ League translation factors are estimated empirically

    ✓ Translation uncertainty is available

    ✓ Player role is identified

    ✓ Team context is incorporated

    ✓ Expected minutes is modeled separately

    ✓ Prior xP is generated before PL debut

    ✓ Bayesian updating occurs after PL exposure

    ✓ Prior influence decreases with actual minutes

    ✓ Current PL data eventually dominates

    ✓ xP includes current FPL scoring components

    ✓ Model performance is backtested

    ✓ No future information leaks into predictions

    ✓ Model versions are stored

* * *

44. Final Recommended Architecture
    ==================================
    
                          FPL API
                             │
                             ▼
                      Player Discovery
                             │
                             ▼
                    Is Player Cold-Start?
                        /          \
                      No            Yes
                      │              │
                      ▼              ▼
             Existing PL Model   External History
                                      │
                                      ▼
                              Identity Resolution
                                      │
                                      ▼
                                 Role Mapping
                                      │
                                      ▼
                               League Translation
                                      │
                                      ▼
                                 Team Context
                                      │
                                      ▼
                               Prior Distribution
                                      │
                                      ▼
                             Expected Minutes Model
                                      │
                                      ▼
                                 Prior xP
                                      │
                                      ▼
                      Premier League Evidence
                                      │
                                      ▼
                           Bayesian Posterior
                                      │
                                      ▼
                              Final xP Engine
                                      │
                                      ▼
                            Decision / Optimizer

* * *

45. Final Recommendation
    ========================

Implement this patch as a **Cold-Start Prior & Translation Engine**, not as a separate "new player xP model."

The recommended production methodology is:
    External Data
           +
    League Translation
           +
    Role Translation
           +
    Team Context
           +
    Expected Minutes
           ↓
    Bayesian Prior
           ↓
    Premier League Evidence
           ↓
    Bayesian Posterior
           ↓
    Existing xP Engine

The biggest change from the initial proposal should be replacing:
    Fixed League Multipliers

    +

    Fixed GW Weight Schedule

with:
    Empirically Estimated Translation Factors

    +

    Hierarchical Bayesian Shrinkage

    +

    Minutes-Based Evidence Weighting

Your original 0.75 → 0.50 → 0.30 → 0.15 weighting schedule can still be retained as an **initial heuristic for prototyping and backtesting**, but I would not make it the final production model.

The same applies to the proposed league coefficients. Treat them as **initial priors or sanity-check ranges**, not ground truth. The most compelling path is to build a historical transfer cohort and estimate the coefficients from actual players moving into the Premier League. The recent Premier League-focused Bayesian translation work provides a useful methodological template for that approach, although it is still a preprint rather than an established production standard.

Finally, I would make the cold-start system **component-aware**. The current FPL scoring environment means that a player can generate points through more than goals and assists: defensive contributions and BPS/bonus mechanics matter, and the BPS methodology changed again for 2026/27. The cold-start model should therefore estimate priors for **xG, xA, minutes, clean sheets, defensive contributions and bonus probability** separately, then convert those components into FPL points. That will make the model much more robust across positions and player roles than simply translating xG90 and xA90 into a single xP value.
