# Change Plan — Manager Intelligence & Rank Normalization Alongside Sprint 12

> **Sprint 12A is built** — see "Sprint 12A — Manager Percentile Profile" in
> [roadmap.md](roadmap.md) for what shipped and why, and the measurements behind each call. Briefly:
>
> - **§4/§5 (season_field_sizes, the percentile formula) are superseded.** FPL's own `rank_percentage`
>   is already ingested and already at sub-1% precision; no field-size table was built.
> - **§7's composite volatility index is not implemented.** Its 0.50/0.30/0.20 weights cannot be
>   calibrated on the 7 managers loaded. The three components (spread, std dev, trend) are shown
>   separately instead.
> - **§8 (archetypes), §9/§10 (risk profile, historical strategy) are blocked, not merely deferred.**
>   The FPL API exposes no past-season picks, transfers or chips, and `manager_picks` cannot store
>   them even if it could fetch them. They become buildable once the *current* season accrues data
>   from GW1.
> - **§11/§12 (new tables, new Edge Functions) were not needed.** Everything shipped is a pure
>   function over rows `/team` already fetches.
> - §1–§3, §6, §14–§22 (percentile as the primary metric, rank tiers, rival gaps, UI shape) hold and
>   are reflected in what shipped.
>
> The rest of this document is kept as written for its Stage 2 material (§19, EO/template
> integration once Sprint 10 unblocks) and as the original design record.

## Purpose

This change plan adds a new **Manager Intelligence & Rank Normalization** capability alongside **Sprint 12 — Chip Strategy** in the current FPL Analytics roadmap.

The goal is to use a manager's historical performance, normalized against the size of the FPL field, to improve:

- Manager consistency and volatility analysis
- Manager archetype classification
- Personalized risk preferences
- Rival analysis
- Scenario Lab recommendations
- Transfer strategy recommendations
- Chip strategy recommendations
- Future ownership / Top 1% benchmarking integration

The current roadmap already has Sprints 5–9 and 11 built, Sprint 10 Ownership Intelligence blocked until live season data is available, and Sprint 12 Chip Strategy as the next major planned feature. This change therefore adds the Manager Intelligence work as a **parallel workstream to Sprint 12**, rather than moving it ahead of the current roadmap.

---

# 1. Current Roadmap Position

```text
Sprint 5   Scenario Lab & Draft Management             ✅ Built
Sprint 6   Player Comparison Engine                    ✅ Built
Sprint 7   Replacement Finder                          ✅ Built
Sprint 8   Transfer Simulator                          ✅ Built
Sprint 9   Transfer Optimizer                          ✅ Built
Sprint 10  Ownership Intelligence                      ⏸ Blocked pre-season
Sprint 11  Captain & Bench Optimizer                   ✅ Built

             ┌──────────────────────────────┐
             │ Sprint 11A                   │
             │ Manager Intelligence        │
             │ & Rank Normalization         │
             └──────────────┬───────────────┘
                            │
                            ├───────────────┐
                            ▼               ▼
                    Sprint 12          Manager Intelligence
                    Chip Strategy       continues into
                                        personalization

Sprint 13  Live Matchday Hub
Sprint 14  Authentication & Team Sync
Sprint 15  Action Layer
Sprint 16  Notifications & Automation
Sprint 17  Historical Analytics & ML
```

## Recommended sequencing

Treat this as a **parallel Sprint 12 workstream**:

```text
Sprint 12A — Manager Intelligence Foundation
        │
        ├── Percentile rank normalization
        ├── Manager volatility
        ├── Manager archetypes
        ├── Risk profile
        └── Basic rival analysis

Sprint 12B — Chip Strategy
        │
        ├── Chip value
        ├── Multi-Gameweek planning
        ├── Wildcard
        ├── Free Hit
        ├── Bench Boost
        └── Triple Captain

        Both feed
             │
             ▼
      Decision Strategy Layer
```

Manager Intelligence should not block the first implementation of Chip Strategy. However, once both are available, chip recommendations should be personalized using manager profile and risk preferences.

---

# 2. Why Add This Feature Now?

The current roadmap already contains a shared scoring and optimization layer:

```text
Player xP
Fixture Quality
Risk
Value
Bench Strength
        │
        ▼
Squad / Transfer / Decision Models
```

The new feature adds a second dimension:

```text
What is mathematically optimal?

        VS.

What is optimal for this manager?
```

A manager who historically finishes in the top 1% should not necessarily receive the same recommendations as a manager who historically finishes around the middle of the field.

Likewise, raw rank deltas can be misleading across seasons and across different rank tiers. The system should therefore normalize historical outcomes against the size of the field before calculating volatility or consistency.

---

# 3. Feature Scope

## Core capabilities

The new Manager Intelligence layer should calculate:

1. Historical percentile rank
2. Manager consistency
3. Manager volatility
4. Best and worst historical percentile
5. Median historical percentile
6. Risk appetite
7. Manager archetype
8. Transfer aggressiveness
9. Captain aggressiveness
10. Differential aggressiveness
11. Chip aggressiveness
12. Hit frequency
13. Template dependence
14. Basic rival analysis

## Later integration

When Sprint 10 Ownership Intelligence becomes available, add:

- Effective Ownership (EO)
- Template similarity
- Top 1% / Top 1,000 similarity
- Differential exposure
- Captain EO exposure
- Current-season strategy vs historical strategy

The initial Manager Intelligence implementation should not depend on Sprint 10 being unblocked.

---

# 4. Rank Normalization

## Problem

Raw rank changes are not directly comparable.

For example:

```text
Rank 1,000 → 5,000
```

and:

```text
Rank 500,000 → 2,500,000
```

are both a five-fold deterioration in raw rank, but they do not represent equivalent performance outcomes relative to the field.

The application should therefore normalize each season's rank using the total field size.

---

## Canonical percentile score

Use:

```text
PercentileScore =
    1 - ((Rank - 1) / (FieldSize - 1))
```

Range:

```text
0 = Worst relative position
1 = Best relative position
```

For display:

```text
PercentileFinish = PercentileScore × 100
```

Store both values.

### Example

```text
Season    Rank       Field Size    Percentile Finish
-----------------------------------------------------
2025/26   50,000     11,500,000    99.57%
2024/25   75,000     11,500,000    99.35%
2023/24   2,000      10,900,000    99.98%
```

---

# 5. Season Field Size Data

Create a canonical source for field size.

## Table: `season_field_sizes`

```text
season
field_size
source
retrieved_at
```

This allows manager history to be normalized consistently.

## Data flow

```text
Manager History
      │
      ▼
Season
      │
      ▼
season_field_sizes
      │
      ▼
Percentile Normalization
      │
      ▼
manager_season_history
```

---

# 6. Manager Volatility Model

Do not rely on a single raw-rank metric.

Use three complementary measures.

## 6.1 Percentile Variance

```text
PercentileVariance = Variance(PercentileScore)
```

Measures how consistently the manager performs relative to the field.

---

## 6.2 Log Rank Spread

```text
LogRankSpread =
    ln(WorstRank) - ln(BestRank)
```

This is retained as a secondary descriptive feature because it captures relative multiplicative movement between best and worst finishes.

It should not be the sole volatility measure.

---

## 6.3 Percentile Floor / Ceiling Spread

For managers with enough historical seasons:

```text
VolatilitySpread =
    P90(PercentileScore) - P10(PercentileScore)
```

This helps distinguish:

```text
Consistent high performer
```

from:

```text
High ceiling / low floor manager
```

---

# 7. Composite Manager Volatility Index

Normalize the component scores to a common 0–100 scale.

Suggested model:

```text
ManagerVolatilityIndex =
    0.50 × PercentileVarianceScore
  + 0.30 × PercentileSpreadScore
  + 0.20 × LogRankSpreadScore
```

Interpretation:

```text
0   = Extremely Consistent
100 = Extremely Volatile
```

This is a product metric rather than a formally calibrated statistical measure. It should be labeled as an application-generated index.

---

# 8. Manager Archetypes

Classify managers using historical percentile distribution plus decision behavior.

## 8.1 Consistent Anchor

Characteristics:

- High median percentile
- Low volatility
- Narrow percentile spread
- Limited extreme-risk behavior

Suggested strategy:

- High xP
- Higher EO / template protection
- Lower unnecessary hit frequency

---

## 8.2 Ceiling Chaser

Characteristics:

- Very high historical ceiling
- High variance
- Meaningful exposure to aggressive decisions

Suggested strategy:

- Preserve upside
- Avoid stacking multiple high-risk decisions in one Gameweek
- Use selective differentials

---

## 8.3 High Volatility

Characteristics:

- High percentile variance
- Low historical floor
- Frequent aggressive decisions

Suggested strategy:

- Increase stability
- Reduce unnecessary transfer hits
- Penalize excessive rotation risk

---

## 8.4 Conservative Grinder

Characteristics:

- Low volatility
- Good median percentile
- Low differential exposure
- Low risk-taking

Suggested strategy:

- Introduce selective upside
- Avoid excessive template dependence

---

## 8.5 Adaptive Manager

Characteristics:

- Moderate historical volatility
- Strong median performance
- Risk appetite changes by rank position or league context

Suggested strategy:

- Defensive / template-oriented when protecting a lead
- Differential-oriented when chasing

---

# 9. Manager Risk Profile

Separate **historical volatility** from **risk appetite**.

A manager can be volatile because of poor outcomes, not because they deliberately take risks.

Create these dimensions:

```text
TransferAggressiveness
CaptainAggressiveness
DifferentialAggressiveness
ChipAggressiveness
HitFrequency
TemplateDependence
RiskAppetite
```

Display as 0–100 scores.

Example:

```text
Manager Risk Profile

Transfer Risk       72 / 100
Captain Risk        48 / 100
Differential Risk   82 / 100
Chip Risk           61 / 100

Overall Risk        71 / 100
```

---

# 10. Historical Strategy Detection

Where data is available, calculate:

```text
Hits per Season
Hits per Gameweek
Average Transfers per GW
Low-Ownership Captain Rate
Differential Player Exposure
Wildcard Timing
Free Hit Timing
Bench Boost Timing
Triple Captain Timing
```

This allows the app to explain volatility.

Example:

```text
High Volatility

Primary Drivers:

+ Frequent -8 / -12 hits
+ Low-ownership captains
+ High differential exposure
+ Aggressive chip timing
```

---

# 11. Manager Intelligence Database Changes

## `manager_season_history`

```text
manager_id
season
points
rank
field_size
percentile_score
percentile_finish
```

## `manager_stats`

```text
manager_id

median_percentile
mean_percentile

percentile_variance
percentile_spread

log_rank_variance
log_rank_spread

volatility_index

best_percentile
worst_percentile

archetype
```

## `manager_strategy_profile`

```text
manager_id

transfer_aggressiveness
captain_aggressiveness
differential_aggressiveness
chip_aggressiveness

hit_frequency
template_dependence

risk_appetite
```

---

# 12. Manager Intelligence Edge Functions

Add:

```text
sync-manager-history
normalize-manager-ranks
calculate-manager-volatility
classify-manager-archetype
calculate-manager-strategy
calculate-rival-strategy
```

Recommended flow:

```text
Manager ID
    │
    ▼
Historical Manager Data
    │
    ▼
Season Field Size
    │
    ▼
Percentile Normalization
    │
    ▼
Volatility Metrics
    │
    ▼
Manager Archetype
    │
    ▼
Risk Profile
    │
    ▼
Strategy Recommendation
```

---

# 13. Sprint 12 Integration — Chip Strategy

Manager Intelligence and Chip Strategy should be developed in parallel, but not tightly coupled at first.

## Sprint 12A — Manager Intelligence Foundation

Build:

- Rank normalization
- Historical percentile
- Volatility index
- Archetype
- Risk profile
- Basic rival analysis

## Sprint 12B — Chip Strategy

Build:

- Chip value
- Wildcard optimizer
- Free Hit optimizer
- Bench Boost optimizer
- Triple Captain optimizer
- Multi-Gameweek chip planning

---

# 14. Manager-Adjusted Chip Strategy

Once both workstreams are available, use Manager Intelligence to personalize chip recommendations.

The mathematical chip optimizer should remain unchanged.

Instead, Manager Intelligence adjusts the decision layer.

Example:

```text
Mathematical Recommendation

Wildcard GW8

Expected Gain
+31.4
```

Manager profile:

```text
High Volatility
High Risk Appetite
```

Decision layer:

```text
Recommendation
Wildcard GW8

Alternative
Wildcard GW9

Reason
The two options are within the model's uncertainty range.
GW9 provides a lower-risk squad transition for your historical strategy profile.
```

The personalization layer should not override a large mathematical advantage.

---

# 15. Manager-Adjusted Transfer Strategy

Integrate Manager Intelligence with the existing Transfer Optimizer after the core models are stable.

The current Transfer Optimizer already evaluates roll, transfers, hits, and wildcard options using the same transfer simulation engine as manual baskets.

Manager profile can influence the risk term rather than changing the underlying expected-points calculations.

### Conservative manager

```text
Higher Risk Penalty
```

### Aggressive manager

```text
Lower Risk Penalty
Higher Differential Weight
```

### Ceiling Chaser

```text
Preserve Upside
Avoid stacking multiple high-risk actions
```

### High Volatility

```text
Increase stabilization pressure
```

The optimizer should remain mathematically transparent.

---

# 16. Suggested Team Fit Integration

Current conceptual objective:

```text
TeamFit
=
TransferGain
+
FixtureImprovement
+
SquadBalance
+
FutureFlexibility
-
TransferCost
-
Risk
```

Add manager preference as a separate layer:

```text
PersonalizedTeamFit
=
BaseTeamFit
+
ManagerPreferenceAdjustment
```

Do not permanently modify the base xP model based on historical manager behavior.

---

# 17. Rival Analysis

Add a basic rival intelligence layer during this sprint.

Instead of:

```text
Rank Difference
```

calculate:

```text
Percentile Difference
```

Example:

```text
My Percentile       97.2%
Rival Percentile    98.5%
Gap                  1.3 pts
```

This provides a more stable representation across rank tiers.

---

# 18. Rank-Tier Strategy

Create rank tiers using normalized percentile rather than absolute rank.

Suggested tiers:

```text
Elite
Top 1%

Strong
Top 1–10%

Competitive
Top 10–25%

Midfield
Top 25–50%

Chasing
Bottom 50%
```

Strategy should combine:

```text
RankTier
+
ManagerRiskProfile
+
RivalGap
```

Example:

```text
Top 1% + Defending
→ Higher EO / Template protection

Top 25% + Chasing
→ Selective differentials

Bottom 50% + Recovery mode
→ Higher-upside differentials
```

---

# 19. Sprint 10 Ownership Intelligence Integration

Sprint 10 is currently blocked until live season standings and picks become available.

Manager Intelligence should not wait for Sprint 10.

Build the historical profile now.

When Sprint 10 becomes available, add:

```text
Manager Profile
      +
Top 1% Ownership
      +
Effective Ownership
      +
Template Similarity
      +
Differential Exposure
      ↓
Complete Manager Intelligence
```

Example:

```text
Historical Profile

Top 7% median finish
Volatility 64 / 100
Risk Appetite High

Current Season

Top 4% rank
Template Similarity 28%
Differential Exposure 72%

Conclusion

Manager is currently taking a more aggressive strategy than their historical average.
```

---

# 20. Scenario Lab Integration

Manager Intelligence should feed into the existing Scenario Lab.

For each draft, compare:

```text
Scenario A
Maximum xP

Scenario B
Balanced

Scenario C
Differential

Scenario D
Your Historical Style
```

Example:

```text
Scenario              5GW xP    Risk
--------------------------------------
Maximum xP              412      High
Balanced                408      Medium
Differential             405      Very High
Historical Style         409      High
```

This answers:

> What is the mathematically optimal squad?

and:

> What is the optimal squad for how I actually play FPL?

---

# 21. Manager Profile UI

Add a Manager Status card to the manager/profile experience.

```text
┌────────────────────────────────────────┐
│ MANAGER PROFILE                        │
├────────────────────────────────────────┤
│ Archetype                              │
│ 🚀 Ceiling Chaser                      │
│                                        │
│ Median Finish                          │
│ Top 8%                                 │
│                                        │
│ Best Finish                            │
│ Top 0.1%                               │
│                                        │
│ Worst Finish                           │
│ Top 42%                                │
│                                        │
│ Volatility Index                       │
│ ███████░░░ 64 / 100                    │
│                                        │
│ Risk Preference                        │
│ Aggressive                             │
└────────────────────────────────────────┘
```

---

# 22. Recommended Implementation Sequence

## Sprint 12A — Manager Intelligence Foundation

### Step 1 — Historical Data

- Confirm manager-history data availability
- Build season field-size lookup
- Persist historical manager seasons

### Step 2 — Rank Normalization

- Calculate percentile score
- Calculate percentile finish
- Add historical rank context

### Step 3 — Volatility

- Percentile variance
- Percentile spread
- Log rank spread
- Composite volatility index

### Step 4 — Archetypes

- Consistent Anchor
- Ceiling Chaser
- High Volatility
- Conservative Grinder
- Adaptive Manager

### Step 5 — Risk Profile

- Transfer aggressiveness
- Captain aggressiveness
- Differential aggressiveness
- Chip aggressiveness
- Hit frequency
- Template dependence

### Step 6 — Rival Analysis

- Percentile gap
- Rank-tier classification
- Basic defensive vs attacking strategy

### Step 7 — Scenario Lab Integration

- Historical Style scenario
- Manager-adjusted risk preference
- Comparison against Maximum xP / Balanced / Differential

---

## Sprint 12B — Chip Strategy

Continue with the original Sprint 12 scope:

- Chip value calculation
- Wildcard
- Free Hit
- Bench Boost
- Triple Captain
- 5 GW planning
- 8 GW planning
- Season planning
- Scenario comparison

Then add a final personalization pass:

```text
Mathematical Chip Plan
        │
        ▼
Manager Risk Profile
        │
        ▼
Personalized Recommendation
```

---

# 23. Acceptance Criteria

The Manager Intelligence work is complete when:

```text
✓ Historical manager seasons are loaded

✓ Field size is stored by season

✓ Historical rank is normalized to percentile

✓ Percentile is the canonical cross-season performance metric

✓ Raw rank is retained for display only

✓ Volatility is calculated using normalized metrics

✓ Log-rank metrics are secondary, not primary

✓ Manager archetype is generated

✓ Risk profile is generated separately from volatility

✓ Basic rival analysis uses percentile gaps

✓ Manager profile is visible in the UI

✓ Historical Style scenario is available in Scenario Lab

✓ Manager preferences can influence risk weighting

✓ Core xP remains unchanged by personalization

✓ Chip Strategy can consume Manager Intelligence

✓ Sprint 10 EO data can be integrated later without redesign
```

---

# 24. Out of Scope for This Change

Do not include in Sprint 12A:

- Full Top 1% / Top 10k ownership pipeline
- Live Effective Ownership
- Live captain EO
- Real-time rank prediction
- Authenticated FPL team sync
- Automated transfers
- Machine-learning-based manager archetypes

Those remain part of later roadmap work.

---

# 25. Final Architecture After This Change

```text
                 Historical Manager Data
                           │
                           ▼
                 Rank Normalization
                           │
                           ▼
                  Manager Intelligence
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Volatility     Archetype    Risk Profile
              │            │            │
              └────────────┼────────────┘
                           ▼
                 Personalization Layer
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
         Scenario       Transfer       Chip
           Lab           Optimizer     Optimizer
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                    Decision Center
                           │
                           ▼
             Sprint 10 Ownership Layer
                    (when unblocked)
```

---

# 26. Summary

The recommended change is to add **Sprint 12A — Manager Intelligence & Rank Normalization** alongside Sprint 12 rather than delaying it until Authentication or Historical Analytics.

The feature should be built in two stages:

```text
Stage 1 — Now

Historical Rank
→ Percentile
→ Volatility
→ Archetype
→ Risk Profile
→ Rival Analysis
→ Scenario Lab Personalization
```

```text
Stage 2 — When Sprint 10 Unblocks

Manager Profile
+
Top 1% / Top 1,000 Benchmark
+
EO
+
Template Similarity
+
Differential Exposure
```

The most important methodological choice is to make **field-relative percentile the primary measure of historical performance**. Log-rank variance remains useful as a secondary metric, while a fixed absolute-rank volatility gate should be avoided.

The resulting product evolution is:

```text
Generic FPL Optimizer
        ↓
Personalized FPL Decision Engine
        ↓
Manager-Aware Strategy Engine
        ↓
Manager + Ownership + EO Intelligence
```

This keeps the existing optimizer mathematically stable while allowing the application to adapt its recommendations to the individual manager's historical behavior and current strategic situation.
