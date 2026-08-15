# FPL Analytics & Decision Support App

> **Its roadmap is superseded by [roadmap.md](../roadmap.md).** The phase table and sprint ordering below
> were replaced by the revised feature set in [update-aug3.md](update-aug3.md). This document is kept
> for what it still does best: the formulas, weights, worked examples, and schema sketches in Parts
> 1–3. Where a formula here disagrees with `roadmap.md`, `roadmap.md` wins.

## Updated Build Plan (Post Phase 4)

> Current Status:
> 
> - ✅ Phase 1 – FPL Data Ingestion
> - ✅ Phase 2 – Team & Manager Data
> - ✅ Phase 3 – Player & Fixture Intelligence
> - ✅ Phase 4 – Expected Points (xP) Model

The next objective is to build a **fully functional Team Builder** before implementing the FPL authentication layer.

This allows users to:

- Build squads
- Compare players
- Optimize transfers
- Simulate scenarios
- Plan chips

without depending on the FPL API's authenticated endpoints.

---

# Design Philosophy

The application's intelligence should **not depend on authentication**.

Instead, every squad should be represented internally using a common object called:

```text
TeamState
```

The source of this object can be:

```
Manual Team Builder
```

or

```
Authenticated FPL Account
```

Everything else in the application should consume this object instead of raw API responses.

---

# High-Level Architecture

```text
                    FPL API
                       │
                       ▼
               Data Collection Layer
                       │
                       ▼
                Supabase Database
                       │
                       ▼
             Intelligence Engine
        (xP • FDR • Injury • Fixtures)
                       │
                       ▼
                  TeamState Layer
          ┌────────────┴────────────┐
          │                         │
     Team Builder             FPL Account
          │                         │
          └────────────┬────────────┘
                       ▼
               Decision Engine
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
 Player Compare  Transfer Engine  Chip Engine
      │              │              │
      └──────────────┼──────────────┘
                     ▼
             Gameweek Decision Center
                     │
                     ▼
            Execute on FPL (Later)
```

---

# Updated Development Roadmap

| Phase | Status | Description                   |
| ----- | ------ | ----------------------------- |
| 1     | ✅      | FPL Data Ingestion            |
| 2     | ✅      | Team & Manager Data           |
| 3     | ✅      | Player & Fixture Intelligence |
| 4     | ✅      | Expected Points Model         |
| 5     | ⭐      | Team Builder & Scenario Lab   |
| 6     |        | Player Comparison             |
| 7     |        | Transfer Optimizer            |
| 8     |        | Starting XI + Captain + Bench |
| 9     |        | Chip Optimizer                |
| 10    |        | FPL Authentication            |
| 11    |        | Execute Transfers             |
| 12    |        | Notifications & Automation    |

---

# Why Build Team Builder Before Authentication?

Unfortunately, the official FPL API doesn't reliably expose the live squad before each Gameweek deadline.

That means:

- recommendations can't always use the latest team
- transfer simulations become unreliable
- optimization depends on stale data

Instead, the app should let users build their intended squad manually.

Advantages:

- Works year-round
- No authentication required
- Easier testing
- Supports unlimited scenarios
- Future authentication becomes optional

---

# Phase 5 — Team Builder

## Goals

The Team Builder should allow users to:

- Create a legal squad
- Save multiple drafts
- Optimize squads
- Compare squad structures
- Evaluate expected points
- Select captain
- Arrange bench
- Simulate transfers

---

# Manual Team Builder

Start with:

```text
Budget
£100.0m
```

Squad status

```text
GK   0 / 2

DEF  0 / 5

MID  0 / 5

FWD  0 / 3
```

Validation rules:

- Exactly 15 players
- 2 Goalkeepers
- 5 Defenders
- 5 Midfielders
- 3 Forwards
- Maximum 3 players per club
- Budget respected

All rules should come from a configuration table rather than being hardcoded.

---

# Optimized Team Builder

Instead of manually selecting players, users should be able to choose:

```text
Planning Horizon

○ 1 GW

○ 3 GW

○ 5 GW

○ 8 GW
```

Strategy

```text
○ Maximum Points

○ Balanced

○ Long-Term

○ Value

○ Differential

○ Aggressive

○ Safe
```

Risk

```text
Low

Medium

High
```

Budget

```text
£100.0m
```

Then click

```
Optimize Squad
```

The optimizer builds a complete legal squad.

---

# Team Builder Workflow

```text
Empty Squad

↓

Search Players

↓

Add Players

↓

Budget Updates

↓

Validate Squad

↓

Optimize Remaining Players

↓

Generate Projection

↓

Save Draft

↓

Compare Drafts
```

---

# TeamState

Every feature should consume a normalized squad object.

Example

```text
TeamState

source

manager_id

draft_id

gameweek

players[15]

starting_xi

bench_order

captain

vice_captain

bank

team_value

budget

free_transfers

active_chip
```

---

# Sources of TeamState

## Draft Team

```
Team Builder

↓

TeamState
```

## Live Team

```
FPL Authentication

↓

FPL API

↓

TeamState
```

The rest of the application doesn't need to know where the data originated.

---

# Why TeamState Matters

Without TeamState:

```
Optimizer

↓

Needs FPL Authentication

↓

Cannot run offline
```

With TeamState:

```
Optimizer

↓

Receives TeamState

↓

Works with:

• Drafts

• Live Teams

• Saved Scenarios

• Future Simulations
```

This abstraction makes every downstream feature reusable.

---

# Scenario Lab

Users should be able to maintain multiple squad drafts.

Example:

```
Premium Attack

Balanced

No Haaland

Differentials

Wildcard GW6
```

Each draft stores:

- squad
- captain
- bench
- budget
- expected points
- optimization strategy
- notes

---

# Squad Score

The application should compute an overall quality score.

```
SquadScore

=

ExpectedPoints

+

FixtureQuality

+

BenchStrength

+

Value

-

Risk
```

Suggested UI

```
Overall

88 / 100

Expected Points

91

Fixtures

84

Value

80

Bench

77

Risk

18
```

This is only a summary metric.

The optimizer itself should still maximize expected points subject to constraints.

---

# Local Storage Strategy

Initially:

```
Browser

↓

localStorage
```

Benefits:

- no login required
- instant loading
- easy testing

Later:

```
Supabase Auth

↓

Cloud Sync

↓

Multiple Devices
```

FPL authentication should remain completely independent of application authentication.

---

# End of Part 1

The next section covers:

- Mathematical optimization
- Expected Points formulation
- Player Comparison Engine
- Replacement Finder
- Transfer Optimizer
- Roll vs Transfer logic

# Part 2 — Intelligence Engine & Optimization

This section describes the mathematical models that power the recommendation engine.

The philosophy is:

> Every recommendation should be explainable.

Rather than saying **"Transfer Player A to Player B"**, the application should explain:

- Why?
- How many points are expected?
- How much risk is involved?
- How much fixture quality improves?
- Whether it's worth rolling the transfer instead.

---

# Intelligence Pipeline

The recommendation engine should process information in stages.

```text
FPL Data
      │
      ▼
Historical Data
      │
      ▼
Feature Engineering
      │
      ▼
Expected Points Model (xP)
      │
      ▼
Fixture Rating Engine
      │
      ▼
Availability Engine
      │
      ▼
Risk Engine
      │
      ▼
Player Comparison
      │
      ▼
Transfer Optimizer
      │
      ▼
Gameweek Recommendation
```

Each module should produce reusable outputs for downstream models.

---

# Expected Points (xP) Model

The xP model estimates the number of fantasy points a player is expected to score over one or more Gameweeks.

Instead of relying on one statistic, combine multiple weighted signals.

## Inputs

### Player Form

Recent attacking or defensive contributions.

Example metrics:

- Goals
- Assists
- Saves
- Clean Sheets
- Bonus
- BPS
- xG
- xA

---

### Expected Minutes

Expected minutes are one of the strongest predictors.

Suggested scale:

```text
90 minutes
= 1.00

75 minutes
= 0.83

60 minutes
= 0.67

30 minutes
= 0.33
```

Expected minutes should incorporate:

- Recent starts
- Manager rotation
- European matches
- Cup matches
- Injury news
- Suspension

---

### Fixture Difficulty

Transform FDR into a weighted score.

Example:

| Official FDR | Weight |
| ------------ | ------:|
| 1            | 1.30   |
| 2            | 1.15   |
| 3            | 1.00   |
| 4            | 0.85   |
| 5            | 0.70   |

This multiplier increases or decreases projected points.

---

### Home Advantage

Typical multiplier:

```text
Home

1.05

Away

0.95
```

---

### Team Strength

Stronger teams create more opportunities.

Possible inputs:

- Goals scored
- xG
- Possession
- Clean sheets
- Shots

---

### Opponent Strength

Defensive metrics:

- Goals conceded
- xGA
- Shots conceded
- Big chances conceded

---

### Availability

Availability score:

```text
100%

No injury

Likely start

↓

75%

Minor concern

↓

50%

Doubtful

↓

25%

Bench risk

↓

0%

Unavailable
```

---

# Single Gameweek xP Formula

```text
xP

=

BasePoints

×

FixtureMultiplier

×

MinutesMultiplier

×

AvailabilityMultiplier

+

FormAdjustment

+

HomeBonus

+

BonusPrediction
```

Example:

```text
Base

5.8

Fixture

1.15

Minutes

0.95

Availability

1.00

Home

+0.3

Bonus

+0.5

xP

≈7.1
```

---

# Multi-Gameweek xP

For planning horizons:

```text
3 GW

5 GW

8 GW

Season
```

Compute

```text
xP_H

=

Σ xP_i
```

across every fixture.

Double Gameweeks naturally increase projected points.

Blank Gameweeks naturally reduce them.

---

# Confidence Score

Every prediction should include confidence.

Example:

```text
Confidence

=

Historical Stability

×

Expected Minutes

×

Availability

×

Model Agreement
```

Example output:

```text
Expected Points

7.2

Confidence

91%
```

---

# Fixture Rating Engine

Rather than using raw FDR, calculate a richer fixture score.

Possible inputs:

- Official FDR
- Opponent xGA
- Goals conceded
- Home/Away
- Rest days
- Travel
- Injuries
- Bookmaker odds

Example:

```text
FixtureScore

=

0.40×OfficialFDR

+

0.25×OpponentxGA

+

0.20×Home

+

0.15×BookmakerOdds
```

Normalize to:

```text
0–100
```

---

# Availability Engine

The app should continuously estimate availability.

Signals:

- Injury status
- Suspension
- Press conference
- Predicted lineups
- Minutes history
- European rotation
- Fixture congestion

Output:

```text
Expected Minutes

Start Probability

Bench Probability

Unavailable Probability
```

---

# Risk Engine

Every player gets a risk score.

Components:

- Injury
- Rotation
- Minutes uncertainty
- Fixture volatility
- Form volatility

Example:

```text
RiskScore

=

0.35×Rotation

+

0.30×Injury

+

0.20×Minutes

+

0.15×FixtureVariance
```

Normalize:

```text
0–100
```

Lower is better.

---

# Player Comparison Engine

Users should compare two or more players across multiple horizons.

Example:

```
Palmer

vs

Saka
```

Metrics:

- Price
- Ownership
- Total Points
- Form
- Minutes
- xP
- xP/£m
- Fixture Rating
- Risk
- Start Probability

Horizons:

- Next GW
- 3 GW
- 5 GW
- 8 GW
- Season

---

# Comparison Score

Generic score:

```text
ComparisonScore

=

0.40×xP

+

0.20×FixtureScore

+

0.15×Value

+

0.15×Minutes

+

0.10×Form

-

RiskPenalty
```

This produces a ranking without relying on a single statistic.

---

# Team Fit Score

A player who is generally "better" may not improve a specific squad.

Introduce Team Fit.

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

This score should drive replacement recommendations.

> **`SquadBalance` and `FutureFlexibility` are omitted from the shipped TeamFit** — see
> `REPLACEMENT_MODEL_NOTE` in `lib/scoring.ts`, which says so in the UI. Both became computable once
> Sprint 9 loaded the per-gameweek series, but threading it into the builder's replacement panel is
> still outstanding; it is tracked under "Finishing passes" in [roadmap.md](../roadmap.md).

---

# Replacement Finder

Workflow:

```text
Choose Player

↓

Generate Eligible Replacements

↓

Filter

↓

Rank

↓

Recommend
```

Filters:

- Same position
- Affordable
- Club limit
- Available
- Expected minutes threshold

Ranking criteria:

- Highest xP
- Best fixtures
- Lowest risk
- Best value
- Team fit

---

# Example Replacement Output

```
OUT

Player A

↓

Recommended

1.

Player B

+4.2 xP

Risk ↓

2.

Player C

+3.8 xP

Better Fixtures

3.

Player D

+3.1 xP

Higher Ceiling
```

Each recommendation should include a textual explanation.

---

# Transfer Simulator

Users should simulate any transfer before committing.

Input:

```text
Player Out

Player In
```

Output:

```text
Current Squad

↓

Simulate Transfer

↓

Updated Squad

↓

Projected Gain
```

Display:

- Current xP
- New xP
- Net Gain
- Fixture change
- Risk change

---

# Transfer Gain Formula

```text
TransferGain

=

xP(New)

-

xP(Old)

-

TransferCost

-

RiskAdjustment
```

Where:

TransferCost is normally:

```text
0

or

4

or

8
```

depending on hits.

---

# Team Transfer Gain

Instead of evaluating only one player:

```text
TeamTransferGain

=

Team_xP_After

-

Team_xP_Before

-

TransferCost

-

RiskChange
```

This better captures captaincy and bench impacts.

---

# Roll vs Transfer

One of the most valuable recommendations is deciding **not** to transfer.

Transfer value:

```text
TransferNowValue

=

ImmediateGain

-

TransferCost
```

Roll value:

```text
RollValue

=

FutureFlexibility

+

ExpectedFutureGain
```

Decision rule:

```text
Transfer

if

TransferNowValue

>

RollValue

+

DecisionMargin
```

> **Not implemented as written — see the Sprint 9 section of [roadmap.md](../roadmap.md).** With a frozen
> eight-gameweek projection, `RollValue` as stated can never win: the best future basket is already
> visible today, and playing it today collects one extra gameweek of the same gain. `FutureFlexibility`
> is therefore not estimated. Rolling is priced from the two computable reasons (banking a second free
> transfer to fund a basket you cannot split into singles, and avoiding a hit), and `DecisionMargin`
> became an explicit user input labelled as an assumption rather than a fitted coefficient.

Example:

```text
Transfer Gain

2.1

Future Flexibility

3.4

Recommendation

Roll Transfer
```

---

# Multi-Gameweek Planning

The optimizer should look ahead.

```text
GW3

↓

GW4

↓

GW5

↓

GW6

↓

GW7
```

Possible actions:

- Roll
- Transfer
- Double Transfer
- Wildcard
- Free Hit

The optimizer should maximize cumulative expected points over the planning horizon rather than just the next Gameweek.

---

# Recommendation Confidence

Every recommendation should include confidence.

Example:

```text
Transfer

Player A

↓

Player B

Expected Gain

4.1

Confidence

88%

Reason

Better fixtures

Higher xP

More secure minutes
```

Users trust recommendations more when the reasoning is transparent.

---

# Explainability Layer

Every recommendation should answer:

**Why this player?**

Example:

```text
✔ +3.8 projected points

✔ Better next 5 fixtures

✔ 94% expected starts

✔ Higher xGI

✔ Lower injury risk
```

This is one of the biggest differentiators from many existing FPL tools, which often present rankings without context.

---

# End of Part 2

The next section covers:

- Starting XI Optimizer
- Captain & Vice-Captain Selection
- Bench Optimization
- Chip Strategy Optimizer
- Supabase Database Schema
- Internal API Design

# Part 3 — Gameweek Optimization, Chip Strategy, Database Design & APIs

This section builds on the intelligence engine by turning player projections into complete Gameweek decisions.

The goal is not simply to predict points, but to answer:

- Who should start?
- Who should be captain?
- What should the bench order be?
- Should I use a chip?
- How should I structure my squad over multiple Gameweeks?

---

# Phase 8 — Starting XI Optimizer

The Starting XI optimizer selects the highest projected lineup while respecting FPL formation rules.

Inputs:

- TeamState
- Player xP
- Expected Minutes
- Fixture Difficulty
- Injury Status
- Rotation Risk

Output:

- Starting XI
- Bench Order
- Captain
- Vice Captain
- Projected Team xP

---

# Legal Formation Constraints

The optimizer must always produce a legal formation.

Allowed formations:

```text
3-4-3

3-5-2

4-4-2

4-3-3

4-5-1

5-4-1

5-3-2

5-2-3
```

Constraints:

```text
1 Goalkeeper

Minimum 3 Defenders

Minimum 2 Midfielders

Minimum 1 Forward

11 Total Players
```

---

# Starting XI Objective

Maximize

```text
StartingXIValue

=

Σ ExpectedPoints_i
```

Subject to

- Formation rules
- Player availability
- Locked players (optional)

---

# Bench Optimization

The bench should not simply contain the four lowest xP players.

Instead, consider:

- Probability of substitution
- Expected minutes
- Rotation risk
- Injury uncertainty

---

## Bench Score

```text
BenchScore

=

ExpectedPoints

×

SubstitutionProbability
```

Where

```text
SubstitutionProbability

=

Probability that a starting player
fails to play enough minutes.
```

---

## Bench Order

Bench position should maximize expected auto-sub value.

Example:

```text
Bench 1

Highest expected contribution

Bench 2

Second highest

Bench 3

Third highest

GK

Reserve Goalkeeper
```

---

# Captain Optimizer

The captain doubles their points.

Therefore, captain selection has a much larger impact than ordinary player selection.

---

## Captain Objective

```text
CaptainValue

=

2 × xP
```

However, raw xP alone is not sufficient.

Factors:

- Expected minutes
- Fixture quality
- Penalty duties
- Team attacking strength
- Rotation risk
- Historical captain performance

---

## Captain Score

```text
CaptainScore

=

0.50 × xP

+

0.20 × FixtureScore

+

0.15 × MinutesProbability

+

0.10 × TeamAttackStrength

+

0.05 × PenaltyBonus

-

RiskPenalty
```

---

## Triple Captain

Incremental gain:

```text
TripleCaptainValue

=

3 × xP

-

2 × xP

=

xP
```

Therefore,

the expected gain equals approximately one additional captain score.

---

# Vice Captain

Choose the highest remaining player after captain selection.

Priority:

```text
High xP

↓

High Minutes Probability

↓

Low Rotation Risk
```

---

# Captain Confidence

Output should include:

```text
Captain

Salah

Expected Points

9.8

Confidence

94%

Reason

Excellent fixture

Penalty taker

96% start probability
```

---

# Team Projection

The dashboard should summarize:

```text
Starting XI

62.4 xP

Bench

11.2 xP

Captain

19.6 xP

Overall Projection

73.6 xP
```

---

# Phase 9 — Chip Strategy Optimizer

Rather than suggesting chips reactively,

the optimizer should build a season-long chip plan.

---

## Supported Chips

- Wildcard
- Free Hit
- Bench Boost
- Triple Captain

Rules should be configurable each season rather than hardcoded.

---

# Chip Objective

Each chip has an incremental value.

```text
ChipValue

=

ExpectedPoints_WithChip

-

ExpectedPoints_WithoutChip
```

---

# Wildcard

The Wildcard should maximize projected points over several Gameweeks.

```text
WildcardValue

=

OptimizedSquad_xP

-

CurrentSquad_xP
```

Planning horizon:

```text
5 GW

8 GW

10 GW
```

---

# Free Hit

Evaluate only one Gameweek.

```text
FreeHitValue

=

BestPossibleSquad

-

CurrentSquad
```

Good candidates:

- Blank Gameweeks
- Double Gameweeks
- Injury crises

---

# Bench Boost

Bench Boost uses all fifteen players.

```text
BenchBoostValue

=

All15Players_xP

-

StartingXI_xP
```

Large bench projections increase chip value.

---

# Triple Captain

```text
TripleCaptainValue

=

Captain_xP
```

Double Gameweeks generally produce the highest value.

---

# Chip Confidence

Every recommendation should include confidence.

Example

```text
Recommended

Bench Boost

Gameweek

29

Expected Gain

17.4

Confidence

89%

Reason

Strong bench

Double Gameweek

Low rotation risk
```

---

# Multi-Gameweek Chip Planning

Instead of evaluating one chip at a time,

optimize an entire season.

Decision variables:

```text
Wildcard GW6

Bench Boost GW29

Triple Captain GW34

Free Hit GW37
```

Objective

```text
Maximize

Season Expected Points
```

Subject to

- Chip availability
- Season rules
- One chip per Gameweek

---

# Scenario Comparison

The application should compare chip plans.

Example

| Scenario         | Projected Points |
| ---------------- | ----------------:|
| Early Wildcard   | 2448             |
| Late Wildcard    | 2463             |
| Aggressive Chips | 2456             |

Display:

- Best scenario
- Expected gain
- Confidence
- Key assumptions

---

# Supabase Database Design

The project should separate raw FPL data from derived analytics.

---

## Core Tables

### players

```text
id

fpl_id

name

club_id

position

price

ownership

status

photo

updated_at
```

---

### clubs

```text
id

name

short_name

strength

attack_rating

defence_rating
```

---

### fixtures

```text
id

gameweek

home_team

away_team

kickoff_time

finished

home_difficulty

away_difficulty
```

---

### player_gameweek_stats

```text
player_id

gameweek

minutes

goals

assists

clean_sheet

bonus

bps

price

total_points
```

---

### player_predictions

Stores calculated projections.

```text
player_id

gameweek

xP

fixture_score

minutes_probability

risk_score

confidence

model_version
```

---

### team_drafts

```text
id

user_id

name

strategy

budget

notes

created_at
```

---

### draft_players

```text
draft_id

player_id

purchase_price
```

---

### draft_lineups

```text
draft_id

gameweek

player_id

starting

captain

vice_captain

bench_order
```

---

### optimization_runs

```text
id

draft_id

strategy

planning_horizon

objective_score

expected_points

created_at
```

---

### transfer_recommendations

```text
id

draft_id

player_out

player_in

expected_gain

confidence

reason

created_at
```

---

# Storage Philosophy

Separate:

```text
Raw Data

↓

Derived Metrics

↓

Recommendations
```

Never overwrite historical information.

Historical snapshots improve future model training.

---

# Internal API Design

The frontend should never query Supabase tables directly for complex logic.

Instead,

use server endpoints.

---

## Draft APIs

Create

```http
POST /api/drafts
```

Retrieve

```http
GET /api/drafts/{id}
```

Update

```http
PUT /api/drafts/{id}
```

Delete

```http
DELETE /api/drafts/{id}
```

---

## Team Builder

```http
POST /api/team/validate
```

Returns

- Budget status
- Club limits
- Position validation
- Errors

---

## Squad Optimizer

```http
POST /api/team/optimize
```

Inputs

```text
Strategy

Budget

Planning Horizon

Locked Players

Excluded Players

Risk Preference
```

Outputs

```text
Optimized Squad

Expected Points

Confidence

Squad Score
```

---

## Starting XI

```http
POST /api/team/starting-xi
```

Returns

```text
Starting XI

Bench

Captain

Vice Captain

Projected Points
```

---

## Player Comparison

```http
GET /api/players/compare
```

Inputs

```text
Player IDs

Planning Horizon
```

Outputs

- Comparison metrics
- Rankings
- Strengths
- Weaknesses

---

## Replacement Finder

```http
GET /api/players/replacements
```

Inputs

```text
Player Out

Budget

Planning Horizon

Strategy
```

Outputs

Top replacement candidates.

---

## Transfer Simulator

```http
POST /api/transfers/simulate
```

Returns

```text
Current Team

↓

New Team

↓

Expected Gain

↓

Risk Change

↓

Fixture Change
```

---

## Transfer Optimizer

```http
POST /api/transfers/optimize
```

Returns

```text
Roll

Transfer

Take Hit

Recommended Action

Confidence

Reason
```

---

## Chip Optimizer

```http
POST /api/chips/optimize
```

Returns

```text
Recommended Chip

Recommended Gameweek

Expected Gain

Confidence
```

---

# Caching Strategy

Because FPL data changes at different rates, use multiple cache durations.

| Data           | Refresh              |
| -------------- | -------------------- |
| Bootstrap data | Every few hours      |
| Fixtures       | Hourly               |
| Injuries       | 15–30 minutes        |
| Price changes  | Daily                |
| Predictions    | After each model run |

This reduces API load while keeping recommendations fresh.

---

# Model Versioning

Every prediction should store the model version.

Example

```text
Model

v1.0

↓

v1.1

↓

v2.0
```

Benefits:

- Compare model performance
- Roll back bad updates
- Evaluate historical accuracy

---

# Future AI Opportunities

Once the optimization engine is stable, AI can provide natural-language explanations.

Examples:

- "Why is Palmer recommended over Saka?"
- "Why should I roll my transfer?"
- "Should I use Bench Boost this week?"
- "Explain why my squad score dropped."

This turns raw analytics into actionable advice for users.

---

# End of Part 3

The next section covers:

- FPL Authentication & Team Sync
- Secure Architecture with Supabase Edge Functions
- Notifications & Automation
- Final System Architecture
- Sprint-by-Sprint Development Plan
- Long-term Product Vision

# Part 4 — Authentication, Automation, Final Architecture & Development Roadmap

This final section explains how authentication fits into the application, how recommendations are executed safely, and how the project should evolve from a team builder into a complete FPL assistant.

---

# Phase 10 — FPL Authentication

Authentication should be added **after** the Team Builder and optimization engine are complete.

At this point, every feature should already work using a manually created `TeamState`.

Authentication simply provides another source for that data.

---

# Why Authentication Comes Later

The FPL API has several limitations:

- Some endpoints require login.
- Live squad data is not always available before deadlines.
- Authentication methods may change.
- Session cookies expire.

By treating authentication as a **data source** instead of a core dependency, the app remains fully usable even if the authenticated endpoints are unavailable.

---

# Authentication Flow

```text
User

↓

Login with FPL Credentials

↓

Supabase Edge Function

↓

FPL Authentication

↓

Session Cookie

↓

Retrieve Team

↓

Normalize

↓

TeamState
```

The rest of the application consumes `TeamState` exactly as it would for a manually created draft.

---

# TeamState Sources

```text
Manual Draft
        │
        ▼
   TeamState
        ▲
        │
Authenticated FPL Team
```

Every optimization engine should accept only a `TeamState` object.

This keeps the business logic independent from authentication.

---

# Team Synchronization

Once authenticated, the user should be able to compare:

```text
Draft Team

vs

Actual FPL Team
```

Example

| Player  | Draft | Actual |
| ------- |:-----:|:------:|
| Haaland | ✅     | ✅      |
| Salah   | ✅     | ❌      |
| Palmer  | ❌     | ✅      |

The dashboard can then calculate:

- Difference in projected points
- Remaining budget
- Free transfers
- Suggested transfers to match the draft

---

# Synchronization Options

Users should choose between:

```text
Import Once

Sync Automatically

Replace Draft

Merge Changes
```

Avoid automatically overwriting user-created drafts.

---

# Phase 11 — Executing FPL Actions

Once authentication is working, the application can submit actions directly to FPL.

Potential actions:

- Update Starting XI
- Change Captain
- Change Vice Captain
- Make Transfers
- Activate Chips

These actions should always require explicit confirmation.

---

# Safe Action Flow

```text
Recommendation

↓

Preview

↓

Show Expected Gain

↓

Show Transfer Cost

↓

User Confirmation

↓

Execute

↓

Success / Failure
```

Never execute transfers automatically.

---

# Secure Architecture

Sensitive operations should never happen in the browser.

Recommended architecture:

```text
Frontend

↓

Supabase Edge Function

↓

FPL Authenticated Request

↓

FPL API
```

Never expose:

- Session cookies
- Service role keys
- Authentication tokens

Everything sensitive should remain server-side.

---

# Suggested Edge Functions

```text
authenticate

get-team

submit-transfer

update-lineup

activate-chip

refresh-session
```

Each function should validate the user's identity before making requests to the FPL API.

---

# Notifications & Automation

Once recommendations become reliable, the app should proactively notify users.

Possible notification events:

- Deadline reminder
- Price rise
- Price fall
- Injury news
- Suspension
- Fixture changes
- Predicted rotation
- Captain recommendation changes
- Chip opportunities
- New transfer recommendation

---

# Notification Channels

Initially:

- Email

Future additions:

- Push Notifications
- Telegram
- Discord
- Slack
- SMS (optional)

Users should be able to customize:

- Frequency
- Quiet hours
- Alert types

---

# Gameweek Decision Center

The dashboard should summarize everything a manager needs before the deadline.

Example:

```text
GW12

Deadline

1d 08h 14m

Projected Points

66.3

Captain

Salah

Vice Captain

Palmer

Bench Order

Robinson

Konsa

Andersen

Recommended Transfer

Eze → Bowen

Expected Gain

+4.1

Chip

Save

Confidence

91%
```

Everything should be visible on a single screen.

---

# Historical Performance

Track recommendation accuracy over time.

Examples:

```text
Captain Success

Transfer Success

Average xP Error

Best Chip Timing

Season Rank Progression
```

This helps users evaluate how well the model performs over an entire season.

---

# Recommendation Feedback Loop

Every completed Gameweek should update the model.

Workflow:

```text
Prediction

↓

Actual Result

↓

Calculate Error

↓

Improve Model
```

Metrics:

- Predicted xP
- Actual Points
- Absolute Error
- Mean Absolute Error (MAE)
- Root Mean Squared Error (RMSE)

This enables continuous improvement.

---

# Long-Term Machine Learning Roadmap

Future versions can incorporate more advanced models.

Potential features:

- Gradient Boosting
- XGBoost
- LightGBM
- Bayesian models
- Ensemble predictions

Possible inputs:

- Historical xG
- xA
- Expected minutes
- Bookmaker odds
- Team strength
- Fixture congestion
- Rest days
- Weather (optional)

The application architecture should allow the prediction engine to be replaced without changing the rest of the system.

---

# Final System Architecture

```text
                     FPL API
                        │
                        ▼
                Data Collection Layer
                        │
                        ▼
                  Supabase Database
                        │
        ┌───────────────┴───────────────┐
        │                               │
 Historical Data                  Live Data
        │                               │
        └───────────────┬───────────────┘
                        ▼
                 Feature Engineering
                        │
                        ▼
              Expected Points Model
                        │
                        ▼
              Intelligence Engine
        ┌───────────┬───────────┬───────────┐
        │           │           │
      xP Model     FDR      Availability
        │           │           │
        └───────────┼───────────┘
                    ▼
                TeamState Layer
        ┌───────────┴───────────┐
        │                       │
  Manual Team Builder     Authenticated Team
        │                       │
        └───────────┬───────────┘
                    ▼
             Decision Engine
        ┌───────────┼───────────┐
        ▼           ▼           ▼
 Comparison   Transfer      Chip
   Engine     Optimizer    Optimizer
        │           │           │
        └───────────┼───────────┘
                    ▼
          Gameweek Decision Center
                    │
                    ▼
            FPL Action Layer
```

---

# Recommended Sprint Plan

## Sprint 1

- TeamState model
- Draft creation
- Player search
- Budget validation

Deliverable:

Basic Team Builder

---

## Sprint 2

- Squad optimization
- Formation validation
- Expected points integration

Deliverable:

Optimized Squad Generator

---

## Sprint 3

- Starting XI optimizer
- Captain optimizer
- Bench ordering

Deliverable:

Gameweek Optimizer

---

## Sprint 4

- Player comparison
- Replacement finder

Deliverable:

Comparison Dashboard

---

## Sprint 5

- Transfer simulator
- Roll vs Transfer logic

Deliverable:

Transfer Decision Engine

---

## Sprint 6

- Chip optimizer
- Multi-week planning

Deliverable:

Season Strategy Planner

---

## Sprint 7

- Draft comparison
- Scenario Lab
- Save and clone drafts

Deliverable:

Scenario Planning

---

## Sprint 8

- User accounts
- Supabase Auth
- Cloud draft sync

Deliverable:

Persistent User Profiles

---

## Sprint 9

- FPL authentication
- Team import
- Draft vs Actual comparison

Deliverable:

Live Team Synchronization

---

## Sprint 10

- Submit transfers
- Update lineup
- Activate chips

Deliverable:

Complete FPL Integration

---

## Sprint 11

- Notifications
- Deadline reminders
- Injury alerts

Deliverable:

Proactive Assistant

---

## Sprint 12

- Analytics dashboard
- Recommendation accuracy
- Model evaluation

Deliverable:

Performance Insights

---

# Suggested Tech Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- Zustand (state management)

---

## Backend

- Supabase
- PostgreSQL
- Edge Functions (Deno)
- Row Level Security (RLS)

---

## Data & Scheduling

- Official FPL API
- Cron jobs (GitHub Actions or Supabase Scheduled Functions)
- Historical snapshots stored in Supabase

---

## Optimization

- JavaScript/TypeScript optimization engine
- OR-Tools (optional, for advanced optimization)
- Custom heuristic algorithms for fast squad generation

---

## Charts & Visualization

- Recharts
- Tremor
- Nivo

Suggested dashboards:

- xP trends
- Team value history
- Fixture difficulty timeline
- Price change history
- Squad composition
- Chip timeline

---

# Stretch Goals

After the core product is complete, consider adding:

### AI Assistant

Ask natural-language questions such as:

- "Should I captain Salah or Haaland?"
- "Is it worth taking a -4 this week?"
- "Why is my squad score low?"
- "Plan my next five Gameweeks."

---

### League Analytics

Compare against:

- Mini-leagues
- Friends
- Global averages
- Top 10k managers

---

### Differential Finder

Automatically identify:

- Low ownership players
- High upside picks
- Hidden value
- Budget enablers

---

### Fixture Planner

Interactive fixture calendar with:

- Color-coded FDR
- Blank Gameweeks
- Double Gameweeks
- Rotation warnings

---

### Season Review

At the end of the season, generate a report:

- Best transfers
- Worst transfers
- Captain accuracy
- Chip effectiveness
- Total points gained from recommendations
- Model prediction accuracy

---

# Success Metrics

Measure the application's effectiveness using:

| Metric                           | Target                            |
| -------------------------------- | --------------------------------- |
| xP Prediction Error (MAE)        | Minimize                          |
| Transfer Recommendation Accuracy | >70% positive gain                |
| Captain Recommendation Accuracy  | Outperform average captain choice |
| User Engagement                  | Weekly active usage               |
| Squad Optimization Runtime       | <5 seconds                        |
| API Response Time                | <500 ms                           |
| Team Builder Validation          | Instant                           |

---

# Product Vision

The long-term goal is to build an intelligent FPL platform that combines:

- Data collection
- Statistical modeling
- Optimization
- Decision support
- Automation

Unlike many existing FPL tools that only present data, this application should answer the most important question:

> **"What should I do this Gameweek, and why?"**

By keeping the architecture centered around the `TeamState` abstraction, every feature—from manual drafts to authenticated teams—shares the same intelligence engine. This makes the platform modular, easier to maintain, and ready for future enhancements such as machine learning models and AI-powered strategy explanations.
