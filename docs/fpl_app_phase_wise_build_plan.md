# FPL Analytics & Decision Support App — Build Plan

## 1. Project Overview

This project is a personal Fantasy Premier League (FPL) analytics and decision-support application designed to help a manager answer five questions before each Gameweek deadline:

1. **Transfer:** Who should I buy or sell?
2. **Start:** Which players should be in my starting XI?
3. **Captain:** Who should I captain and vice-captain?
4. **Chip:** Should I use a chip now or save it?
5. **Wait:** Should I roll my transfer rather than make a move?

The application should begin as a read-only analytics platform and gradually evolve into an authenticated FPL management tool.

### Primary product goal

> Given my current squad, budget, available transfers, player availability, fixture schedule, expected points, and chip inventory, tell me what I should do before the next deadline and explain why.

---

# 2. Target Architecture

```text
                           GITHUB
              ┌──────────────────────────────┐
              │ Source Code                  │
              │ GitHub Actions               │
              │ CI / CD                      │
              │ Database Migrations          │
              └──────────────┬───────────────┘
                             │
                             ▼
                       GITHUB PAGES
                     Static Next.js App
                             │
                             │ HTTPS
                             ▼
                    ┌──────────────────┐
                    │    SUPABASE      │
                    │                  │
                    │ PostgreSQL       │
                    │ Authentication   │
                    │ Edge Functions   │
                    │ Cron / Scheduling│
                    │ Realtime         │
                    └─────────┬────────┘
                              │
               ┌──────────────┼──────────────┐
               │              │              │
               ▼              ▼              ▼
         Official FPL     Prediction      Alerts /
             API            Engine       Notifications
               │              │
               └───────┬──────┘
                       ▼
                 Supabase DB
                       │
                       ▼
                Decision Engine
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
       Transfers    Captain       Chips
        / XI        / Bench       Strategy
```

### Initial hosting model

- **Frontend:** Next.js with static export
- **Frontend hosting:** GitHub Pages
- **Source control:** GitHub
- **CI/CD:** GitHub Actions
- **Database:** Supabase Postgres
- **Backend/serverless logic:** Supabase Edge Functions
- **Scheduling:** Supabase Cron / `pg_cron`
- **Authentication:** Supabase Auth for the app itself
- **FPL data source:** Official FPL API
- **Optimization:** Python + OR-Tools initially, or a backend service invoked by Edge Functions

### Future hosting model

The frontend can later move from GitHub Pages to Vercel, Cloudflare, or another Next.js-compatible platform without redesigning the backend. Keep frontend, data ingestion, intelligence, and authenticated FPL actions loosely coupled.

---

# 3. Setup

## 3.1 Technology Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Recharts
- Supabase JavaScript client

### Backend

- Supabase PostgreSQL
- Supabase Auth
- Supabase Edge Functions
- Supabase Cron / `pg_cron`

### Analytics and optimization

- Python
- pandas
- NumPy
- scikit-learn where useful
- OR-Tools for constrained optimization

### Development

- Git
- GitHub
- GitHub Actions
- Supabase CLI
- ESLint
- Prettier

---

## 3.2 Repository Structure

```text
fpl-analytics/
│
├── app/
│   ├── dashboard/
│   ├── team/
│   ├── players/
│   ├── fixtures/
│   ├── transfers/
│   ├── chips/
│   └── settings/
│
├── components/
│   ├── team/
│   ├── players/
│   ├── fixtures/
│   ├── recommendations/
│   └── charts/
│
├── lib/
│   ├── supabase/
│   ├── fpl/
│   ├── analytics/
│   └── types/
│
├── public/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   │   ├── sync-bootstrap/
│   │   ├── sync-fixtures/
│   │   ├── sync-live-gameweek/
│   │   ├── sync-player-history/
│   │   ├── sync-manager/
│   │   ├── generate-predictions/
│   │   ├── optimize-transfers/
│   │   ├── optimize-chips/
│   │   └── notifications/
│   └── config.toml
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
│
├── .env.example
├── next.config.ts
├── package.json
└── README.md
```

---

## 3.3 GitHub Setup

Create a GitHub repository and configure:

- `main` as the production branch
- Pull requests for changes
- GitHub Actions for CI
- GitHub Pages for initial frontend deployment
- Environment variables/secrets through GitHub Secrets where CI requires them

### CI workflow

```text
git push
   ↓
Install dependencies
   ↓
Lint
   ↓
Type-check
   ↓
Run tests
   ↓
Build
```

### Deployment workflow

```text
main branch
   ↓
GitHub Action
   ↓
Next.js static export
   ↓
Deploy generated static assets
   ↓
GitHub Pages
```

---

## 3.4 Supabase Setup

Create a Supabase project and configure:

- PostgreSQL database
- Row Level Security (RLS)
- Supabase Auth
- Edge Functions
- Scheduled functions
- Database migrations

### Core principle

Supabase Postgres is the **system of record** for the application.

The FPL API is an **external data source**.

The frontend reads from Supabase rather than directly depending on FPL's API response structure whenever practical.

---

## 3.5 Environment Variables

### Browser-safe configuration

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

### Server-side / Edge Function secrets

```text
FPL_AUTH_SECRET
FPL_SESSION_TOKEN
EXTERNAL_API_KEY
NOTIFICATION_TOKEN
```

Never commit:

```text
.env
.env.local
Supabase service-role keys
Supabase secret keys
FPL credentials
FPL session cookies
```

Use Supabase secrets for runtime backend credentials and GitHub Secrets for CI/CD credentials.

---

# 4. Data Architecture

## 4.1 Core Tables

### FPL reference data

```text
gameweeks
teams
players
fixtures
```

### Historical FPL data

```text
player_gameweek_stats
player_price_history
player_status_history
player_news
fixture_changes
```

### Manager data

```text
fpl_accounts
manager_gameweek_picks
manager_transfers
manager_chip_usage
manager_history
```

### Intelligence

```text
player_predictions
fixture_scores
recommendations
optimization_runs
chip_scenarios
```

### Suggested common metadata

Add these fields wherever useful:

```text
created_at
updated_at
observed_at
model_version
data_source
```

`model_version` is particularly important for comparing prediction model performance over time.

---

## 4.2 Historical Snapshots

Do not overwrite all data with only the current API response.

Instead of storing only:

```text
player.current_price
```

store:

```text
player_price_history

player_id | price | observed_at
----------|-------|----------------
123       | 10.3  | Aug 1 10:00
123       | 10.4  | Aug 2 10:00
123       | 10.5  | Aug 3 10:00
```

This enables:

- Price change tracking
- Ownership trends
- Transfer momentum
- Injury/status change detection
- Historical analysis
- Model backtesting
- "What changed since my last visit?"

---

# 5. Build Phases

# Phase 0 — Foundation

## Goal

Create the repository, deployment pipeline, Supabase project, and application shell.

## Tasks

1. Create GitHub repository.
2. Create Next.js + TypeScript application.
3. Configure Tailwind and shadcn/ui.
4. Create Supabase project.
5. Connect frontend to Supabase.
6. Add database migration workflow.
7. Configure GitHub Actions.
8. Deploy static frontend to GitHub Pages.
9. Add basic environment variable handling.
10. Create initial README and architecture documentation.

## Deliverable

A working URL hosted through GitHub Pages showing a basic application shell and successfully connecting to Supabase.

---

# Phase 1 — FPL Data Ingestion

## Goal

Build a reliable data pipeline that turns official FPL data into a historical data warehouse in Supabase.

## Initial data sources

Use the official FPL endpoints needed for:

- Bootstrap data
- Fixtures
- Player history
- Live Gameweek information

Add manager endpoints once the basic data pipeline is stable.

## Edge Functions

```text
sync-bootstrap
sync-fixtures
sync-live-gameweek
sync-player-history
sync-manager
```

## Scheduling

Suggested initial schedule:

```text
Bootstrap data      Every 30–60 minutes
Fixtures            Every 60 minutes
Player histories    Daily / after Gameweek completion
Live Gameweek data  More frequently during live matches
Manager data        On demand + around deadlines
```

Avoid unnecessarily aggressive polling.

## Deliverable

Supabase contains:

- Current players
- Current clubs
- Positions
- Current Gameweek
- Fixtures
- Fixture deadlines
- Player prices
- Player status
- Historical player performance
- Historical snapshots

---

# Phase 2 — My Team Dashboard

## Goal

Allow a user to connect an FPL Manager ID and view their team.

## Initial approach

Start with **read-only Manager ID integration**.

Do not initially attempt to submit transfers or authenticate against the FPL site.

## Dashboard information

```text
Team Value
Money in Bank
Free Transfers
Current Gameweek
Starting XI
Bench
Captain
Vice-Captain
Transfers
Chip Usage
Historical Points
Rank
```

## Key screens

### Dashboard

- Current rank
- Gameweek points
- Team value
- Money in bank
- Free transfers
- Next deadline
- Alerts
- High-level recommendations

### My Team

Interactive pitch with:

- Player price
- Upcoming fixture
- FDR
- xP
- Availability
- Captain/vice-captain status

### History

- Gameweek points
- Rank
- Transfers
- Chip usage
- Team value
- Bench points

## Deliverable

A functional FPL dashboard with a user's current and historical team information.

---

# Phase 3 — Player and Fixture Intelligence

## Goal

Turn raw FPL data into actionable information.

## Features

### Change feed

Show:

```text
🔴 Players ruled out
🟡 Availability changes
📈 Price rises
📉 Price falls
📅 Fixture changes
⚠ Suspension / discipline concerns
```

### Player Explorer

Show:

```text
Price
Ownership
Form
Total Points
Recent Points
Expected Minutes
Start Probability
Expected Points
Fixture Run
Risk Level
```

### Fixture Matrix

Display upcoming fixtures by club and Gameweek.

Example:

```text
Team       GW1   GW2   GW3   GW4   GW5
---------------------------------------
Team A      2     3     2     4     2
Team B      2     2     3     2     2
Team C      4     3     2     3     4
```

## Deliverable

The user can quickly understand:

- What changed?
- Which players are risky?
- Which teams have attractive fixture runs?
- Which players are gaining or losing value?

---

# Phase 4 — Expected Points (xP) Engine

## Goal

Create an internal expected-points model that estimates player output over future Gameweeks.

The model should start simple, then improve through backtesting.

## Step 1: Expected Minutes

Let:

```text
M_i = expected minutes for player i
```

Let:

```text
S_i = probability of starting
```

A simple approximation is:

```text
M_i = 90 × S_i + 30 × (1 - S_i) × P(sub appearance)
```

This can be refined using:

- Recent starts
- Recent minutes
- Team rotation
- Injury status
- Suspension
- Manager selection patterns
- Fixture congestion

---

## Step 2: Appearance Points

Let:

```text
P90_i = probability of playing 60+ minutes
P1_59_i = probability of playing 1–59 minutes
```

Then:

```text
xP_appearance_i =
    2 × P90_i
  + 1 × P1_59_i
```

For a more continuous model:

```text
xP_appearance_i =
    2 × P(M_i >= 60)
  + 1 × P(0 < M_i < 60)
```

---

## Step 3: Attacking Points

For each player, estimate expected goals and assists.

```text
xG_i = expected goals
xA_i = expected assists
```

Then position-specific expected attacking points can be modeled as:

```text
xP_goals_i =
    xG_i × GoalPoints(position)
```

where:

```text
GoalPoints:
GK = 10
DEF = 6
MID = 5
FWD = 4
```

Assists:

```text
xP_assists_i =
    xA_i × AssistPoints
```

with:

```text
AssistPoints = 3
```

---

## Step 4: Clean Sheet Points

Let:

```text
CS_i = probability of a clean sheet
```

Then:

```text
xP_CS_i =
    CS_i × CleanSheetPoints(position)
```

Use the current FPL scoring rules in the production implementation and keep scoring rules configurable rather than hardcoding them throughout the application.

---

## Step 5: Bonus and Defensive Contribution

Estimate:

```text
xBonus_i = expected bonus points
xDC_i = expected defensive contribution points
```

These should be modeled using historical player rates and expected minutes.

---

## Step 6: Saves and Other Position-Specific Components

For goalkeepers:

```text
xP_saves_i =
    ExpectedSaves_i × SavePointRate
```

Add:

- Penalty saves
- Goals conceded effects
- Defensive contribution
- Other scoring components applicable to the player's position

---

## Step 7: Base Expected Points

A general formulation is:

```text
Base_xP_i =
    xP_appearance_i
  + xP_goals_i
  + xP_assists_i
  + xP_CS_i
  + xBonus_i
  + xDC_i
  + xP_saves_i
  + OtherExpectedPoints_i
```

Then apply risk and fixture adjustments.

---

## Step 8: Fixture Adjustment

```text
FixtureAdjusted_xP_i =
    Base_xP_i × FixtureMultiplier_i
```

Where:

```text
FixtureMultiplier_i
=
    HomeAwayAdjustment
  × OpponentStrengthAdjustment
  × AttackingFixtureAdjustment
  × DefensiveFixtureAdjustment
```

Keep the components explicit so the model can be debugged.

---

## Step 9: Availability Adjustment

```text
AvailabilityAdjusted_xP_i =
    FixtureAdjusted_xP_i × AvailabilityProbability_i
```

A more complete version can use expected minutes directly rather than a separate availability multiplier.

---

## Final xP Formula

A practical first implementation:

```text
xP_i =
    (
      Appearance_i
      + Goals_i
      + Assists_i
      + CleanSheet_i
      + Bonus_i
      + DefensiveContribution_i
      + Saves_i
      + Other_i
    )
    × FixtureMultiplier_i
    × AvailabilityMultiplier_i
```

For a multi-Gameweek horizon:

```text
xP_H(i) =
    Σ[xP_i,g × Availability_i,g]
    for g = 1 ... H
```

Recommended horizons:

- 1 Gameweek
- 3 Gameweeks
- 6 Gameweeks
- 8–10 Gameweeks for strategic planning

---

# Phase 5 — Fixture Difficulty Rating (FDR) Engine

## Goal

Use official FDR as a baseline but build a more analytical internal fixture score.

Do not rely exclusively on the official FDR when making recommendations.

## Base Inputs

For each fixture, consider:

```text
Official FDR
Opponent attacking strength
Opponent defensive strength
Home / Away
Recent xG / xGA
Expected goals
Clean sheet probability
Fixture congestion
```

---

## Step 1: Normalize Inputs

Convert each metric to a comparable scale.

Example:

```text
NormalizedScore =
    (Value - MinValue)
    /
    (MaxValue - MinValue)
```

For difficulty scores, higher values should represent harder fixtures.

---

## Step 2: Attacking Difficulty

For an attacking player:

```text
AttackDifficulty =
    w1 × OpponentDefensiveStrength
  + w2 × RecentOpponentxGA
  + w3 × OfficialFDR
  + w4 × HomeAwayAdjustment
```

---

## Step 3: Defensive Difficulty

For a defender or goalkeeper:

```text
DefenseDifficulty =
    w1 × OpponentAttackingStrength
  + w2 × RecentOpponentxG
  + w3 × OfficialFDR
  + w4 × HomeAwayAdjustment
```

---

## Step 4: Custom FDR

Normalize to a 1–5 scale:

```text
CustomFDR =
    1
    +
    4 × NormalizedDifficulty
```

Interpretation:

```text
1 = Very Easy
2 = Easy
3 = Medium
4 = Difficult
5 = Very Difficult
```

---

## Step 5: Fixture Multiplier

Convert FDR into an expected-points adjustment.

A simple first version:

```text
FixtureMultiplier =
    1 + α × (BaselineDifficulty - DifficultyScore)
```

A more robust implementation should use a calibrated mapping based on historical FPL outcomes.

The multiplier should be:

- Position-aware
- Team-strength-aware
- Home/away-aware
- Calibrated using historical data

---

## Multi-Gameweek Fixture Score

For a player over H Gameweeks:

```text
AvgFDR_H =
    Σ(FDR_g × Weight_g)
    /
    Σ(Weight_g)
```

where recent Gameweeks may be weighted more heavily.

Alternative:

```text
FixtureQuality_H =
    Σ(FixtureMultiplier_g × ExpectedMinutes_g)
```

This is often more useful than simply averaging FDR.

---

# Phase 6 — Transfer Optimizer

## Goal

Determine the best transfer decision for a specific squad rather than simply ranking the best players overall.

The optimizer should consider:

- Current squad
- Budget
- Money in bank
- Player prices
- Team value
- Free transfers
- Transfer costs
- Maximum players per club
- Formation constraints
- Expected points
- Fixture horizon
- Minutes risk
- Injury risk
- Chip availability

---

## Decision Variables

For each player i:

```text
x_i = 1 if player i is in the optimized squad
x_i = 0 otherwise
```

For transfers:

```text
buy_i = 1 if player i is bought
sell_i = 1 if player i is sold
```

---

## Squad Constraints

### Squad Size

```text
Σ x_i = 15
```

### Position Constraints

```text
Σ GK_i = 2
Σ DEF_i = 5
Σ MID_i = 5
Σ FWD_i = 3
```

### Club Constraint

For every club c:

```text
Σ x_i,c ≤ 3
```

### Budget Constraint

```text
Σ Price_i × x_i ≤ TotalAvailableBudget
```

---

## Transfer Cost

Let:

```text
FT = number of free transfers available
T = total transfers made
```

Then:

```text
HitCost =
    max(0, T - FT) × HitValue
```

where `HitValue` is the current cost of a transfer hit under the applicable FPL rules.

---

## Transfer Objective Function

For a planning horizon H:

```text
Maximize:

Objective =
    ExpectedPoints_H
  - HitCost
  - RiskPenalty
  + FutureValue
  - StrategicPenalty
```

Where:

```text
ExpectedPoints_H =
    Σ(ExpectedPoints_i,g × StartingProbability_i,g)
```

`FutureValue` can capture:

- Expected future price value
- Fixture value beyond the initial horizon
- Flexibility created by preserving team structure

`StrategicPenalty` can capture:

- Excessive rotation risk
- Low minutes probability
- Weak bench
- Unbalanced squad
- High reliance on uncertain players

---

## Transfer Gain

For a one-for-one transfer:

```text
TransferGain =
    xP_H(NewPlayer)
  - xP_H(OldPlayer)
  - HitCost
  - RiskAdjustment
```

Example:

```text
Player A → Player B

Player B 6GW xP = 38.5
Player A 6GW xP = 30.2
Hit = 0
Risk adjustment = -1.0

Transfer Gain =
    38.5 - 30.2 - 1.0
  = +7.3 points
```

---

## Roll vs Transfer Decision

The optimizer should explicitly compare:

```text
TransferNow
vs.
RollTransfer
```

### Transfer Now

```text
ValueNow =
    CurrentHorizonGain
  - TransferCost
```

### Roll

```text
ValueRoll =
    ExpectedFutureTransferValue
  + SavedTransferFlexibility
```

Decision:

```text
Transfer if:

ValueNow > ValueRoll + DecisionMargin
```

This prevents the app from recommending transfers simply because a different player has slightly higher xP.

---

## Transfer Strategy Modes

### Balanced

```text
Maximize expected points
- moderate risk penalty
- avoid unnecessary hits
```

### Aggressive

```text
Maximize upside
- lower ownership penalty
- tolerate more variance
- accept higher risk
```

### Conservative

```text
Maximize expected points
- high risk penalty
- high minutes requirement
- minimize hits
```

### Rank Defense

```text
Maximize expected points
- penalize low-ownership options
- prioritize highly owned players
- reduce variance relative to field
```

---

# Phase 7 — Captain and Bench Optimization

## Captain

For each eligible player:

```text
CaptainValue_i =
    xP_i × 2
```

For Triple Captain:

```text
TripleCaptainValue_i =
    xP_i × 3
```

However, the chip decision should use the **incremental value**, not the full points:

```text
IncrementalTCValue_i =
    xP_i × (3 - 2)
  = xP_i
```

This captures the additional value generated by Triple Captain relative to normal captaincy.

The model should also account for:

- Minutes probability
- Ceiling
- Floor
- Fixture difficulty
- Rotation risk
- Ownership

---

## Bench Optimization

Select the starting XI that maximizes:

```text
StartingXIValue =
    Σ ExpectedPoints_i
```

subject to:

- Legal formation constraints
- Minimum goalkeeper
- Maximum/minimum position constraints
- Starting XI size

Bench order should maximize expected points from potential substitutions while considering expected minutes risk among starters.

---

# Phase 8 — Chip Optimizer

## Goal

Determine when each available chip should be used.

The optimizer should evaluate:

- Wildcard
- Free Hit
- Bench Boost
- Triple Captain

and the interaction among them.

The chip engine must use the current season's actual FPL chip rules and maintain a state model for:

```text
Available
Used
Expired
Unavailable
```

Do not hardcode one season's chip behavior into the application.

---

## Chip Value Framework

For each chip c in Gameweek g:

```text ChipValue(c,g) =
    ExpectedPoints_WithChip(c,g)
  - ExpectedPoints_WithoutChip(g)
```

The best Gameweek for a chip is:

```text
BestGW(c) =
    argmax_g ChipValue(c,g)
```

However, the final optimization should consider interactions between chips.

---

## Wildcard Value

A Wildcard changes the squad structure over a planning horizon.

```text WildcardValue(g) =
    ExpectedPoints_OptimizedSquad(g ... H)
  - ExpectedPoints_CurrentSquad(g ... H)
```

Subtract any strategic cost associated with:

- Using the chip too early
- Losing flexibility for future fixtures
- Consuming a limited chip opportunity

---

## Free Hit Value

For a Free Hit in Gameweek g:

```text FreeHitValue(g) =
    ExpectedPoints_OptimalOneWeekSquad(g)
  - ExpectedPoints_NormalSquad(g)
```

The model should focus on the single Gameweek improvement while preserving the original squad after the Free Hit.

This makes Free Hit particularly useful when the current squad is poorly positioned for a specific Gameweek.

---

## Bench Boost Value

```text BenchBoostValue(g) =
    ExpectedPoints_All15Players(g)
  - ExpectedPoints_StartXI(g)
```

The value is driven primarily by the expected points of the bench.

The optimizer should therefore seek:

- 15 players with high expected minutes
- Strong fixtures for the entire squad
- Low rotation risk
- High bench xP

---

## Triple Captain Value

```text TripleCaptainValue(g) =
    xP_Captain(g) × (3 - 2)
```

Equivalent:

```text TripleCaptainValue(g) =
    xP_Captain(g)
```

For multiple-fixture Gameweeks:

```text xP_Captain(g) =
    Σ xP_Player,Fixture
```

The model should also apply a probability adjustment for:

- Starting both matches
- Rotation
- Injury risk
- Minutes

---

## Multi-Chip Optimization

Define:

```text z_c,g = 1
```

if chip c is used in Gameweek g.

The objective becomes:

```text Maximize:

TotalExpectedSeasonPoints
+
Σ ChipIncrementalValue(c,g) × z_c,g
-
ScenarioRisk
```

Subject to:

### One chip per Gameweek

```text
Σ_c z_c,g ≤ 1
```

### Chip availability

```text
z_c,g = 0
```

if the chip is already used or unavailable.

### Season-specific expiration rules

Apply the current season's rules for chip availability and expiry.

### Consecutive-use rules

Apply any restrictions, such as rules around consecutive Free Hit usage.

---

## Scenario-Based Chip Strategy

Generate multiple scenarios:

```text
Scenario A
Wildcard GW8
Bench Boost GW10
Triple Captain GW29
Free Hit GW34

Scenario B
Wildcard GW5
Free Hit GW12
Bench Boost GW29
Triple Captain GW34

Scenario C
Save all possible chips for later opportunities
```

Calculate:

```text ScenarioValue =
    ExpectedSeasonPoints
  + ChipBenefits
  - OpportunityCost
```

Return:

```text
Recommended Scenario
Alternative Scenario
Confidence
Most Uncertain Decision
```

The system should explain:

> "Wildcard GW8 is currently optimal, but this recommendation is sensitive to injuries and fixture changes in GW6–GW7."

---

# Phase 9 — Authenticated FPL Actions

## Goal

Allow users to execute decisions after validating the recommendation.

Keep this as a separate service layer.

```text
Frontend
   ↓
Supabase Edge Function
   ↓
FPL Authenticated Client
   ↓
FPL Account
```

Potential operations:

```text
fpl-authenticate
fpl-get-my-team
fpl-submit-transfer
fpl-update-lineup
fpl-activate-chip
```

Never expose credentials or private session tokens to the browser.

## Confirmation flow

```text
User clicks "Execute Recommendation"
             ↓
Show proposed change
             ↓
Validate budget and transfer cost
             ↓
User confirms
             ↓
Edge Function submits action
             ↓
Confirm success
             ↓
Refresh Supabase data
```

There should always be an explicit confirmation before a transfer or chip action is submitted.

---

# Phase 10 — Notifications and Deadline Center

## Goal

Make the app proactive instead of requiring the user to check it manually.

## Deadline dashboard

```text
GW3 Deadline
Saturday 11:00 AM

Time Remaining
02d 14h 31m

Team Status
🔴 1 injury
🟡 2 rotation risks

Recommendation
Player A → Player B

Captain
Player C

Chip
Save
```

## Notification events

- 24-hour deadline reminder
- 2-hour deadline reminder
- Player injury update
- Availability probability change
- Price change
- Fixture change
- New transfer recommendation
- Chip strategy update

Potential channels:

- Email
- Telegram
- Discord
- Push notifications later

---

# 6. Intelligence Layer

The intelligence layer is the core differentiator of the application.

The recommended architecture is:

```text
Official FPL Data
      │
      ▼
Historical Supabase Data
      │
      ├───────────────┐
      ▼               ▼
Expected Points   Fixture Model
      │               │
      └───────┬───────┘
              ▼
        Risk / Availability
              │
              ▼
        Optimization Engine
              │
        ┌─────┼─────┐
        ▼     ▼     ▼
    Transfer Captain Chip
    Engine    Engine  Engine
        │     │     │
        └─────┼─────┘
              ▼
       Decision Engine
              │
              ▼
       User Recommendation
```

---

## 6.1 Intelligence Outputs

Every Gameweek, generate:

```text
Recommended Transfer
Expected Gain
Transfer Cost
Recommended Starting XI
Captain
Vice-Captain
Bench Order
Chip Recommendation
Roll / Transfer Decision
Risk Level
Confidence
```

---

## 6.2 Recommendation Confidence

Each recommendation should include:

```text
Confidence =
    ModelConfidence
  × DataQuality
  × AvailabilityConfidence
```

This does not need to be a mathematically perfect probability initially. It can be a calibrated score.

Example:

```text
82% confidence

Reasons:
✓ Strong fixture advantage
✓ High expected minutes
✓ Low injury risk
✓ Positive xP difference
```

---

## 6.3 Risk Score

Create a standardized risk score using:

```text
RiskScore =
    w1 × InjuryRisk
  + w2 × RotationRisk
  + w3 × SuspensionRisk
  + w4 × MinutesUncertainty
  + w5 × FixtureUncertainty
```

Use this in:

- Transfer recommendations
- Starting XI
- Captain selection
- Chip decisions

---

## 6.4 Model Backtesting

The intelligence engine should be measured against actual results.

For every Gameweek:

```text
Prediction
    ↓
Store predicted xP
    ↓
Wait for actual result
    ↓
Compare
    ↓
Calculate error
```

Useful metrics:

```text
MAE
RMSE
Rank correlation
Calibration
Top-N accuracy
Captain hit rate
Transfer recommendation hit rate
```

Example:

```text
Model predicted:
Player A = 7.5 xP

Actual:
Player A = 8 points

Absolute error = 0.5
```

Track performance by:

- Position
- Player price tier
- Home/away
- Fixture difficulty
- Minutes probability

---

# 7. Deployment Plan

## Initial deployment

```text
GitHub
    │
    ├── Next.js code
    ├── Supabase migrations
    ├── Edge Functions
    └── GitHub Actions
          │
          ▼
      GitHub Pages
```

Supabase runs independently:

```text
Supabase
├── Database
├── Auth
├── Edge Functions
└── Scheduled jobs
```

---

## GitHub Actions

### `ci.yml`

```text
Install
  ↓
Lint
  ↓
Type-check
  ↓
Test
  ↓
Build
```

### `deploy.yml`

```text
Build static Next.js export
  ↓
Upload artifact
  ↓
Deploy to GitHub Pages
```

---

## Branching Strategy

Use:

```text
main
  ↓
Production

feature/*
  ↓
Pull Request
  ↓
CI
  ↓
Merge
```

For database changes:

```text
supabase/migrations/
```

Every schema change should be a versioned migration committed to GitHub.

---

# 8. Recommended Release Roadmap

## Release 0.1 — Foundation

- GitHub repository
- Next.js app
- Supabase project
- GitHub Pages deployment
- CI/CD
- Database migrations

## Release 0.2 — Data Platform

- FPL API ingestion
- Players
- Fixtures
- Gameweeks
- Price snapshots
- Status snapshots

## Release 0.3 — My FPL

- Manager ID
- Squad view
- Starting XI
- Bench
- Captain
- History
- Transfers
- Chips

## Release 0.4 — Intelligence

- Change feed
- Player explorer
- Fixture matrix
- Custom FDR
- Availability tracking

## Release 0.5 — Prediction

- xP model
- xP history
- Backtesting
- Model versioning

## Release 0.6 — Optimization

- Transfer optimizer
- Roll vs transfer
- Captain
- Bench
- Strategy modes

## Release 0.7 — Chips

- Wildcard
- Free Hit
- Bench Boost
- Triple Captain
- Multi-chip scenario optimization

## Release 0.8 — Actions

- FPL authentication
- Transfer submission
- Lineup changes
- Chip activation
- Confirmation workflow

## Release 0.9 — Notifications

- Deadline alerts
- Injury alerts
- Fixture alerts
- Price alerts
- Recommendation alerts

## Release 1.0 — Decision Center

```text
                 MY FPL DECISION CENTER

Transfer
    Player A → Player B
    +7.3 projected points

Starting XI
    Recommended lineup

Captain
    Player C
    8.2 xP

Chip
    Save
    Best future Wildcard: GW8

Strategy
    Roll transfer

Confidence
    82%
```

---

# 9. Recommended MVP Scope

The first public version should stop at **Release 0.4**.

That means the MVP contains:

```text
✓ GitHub-hosted frontend
✓ Supabase Postgres
✓ FPL data ingestion
✓ Historical snapshots
✓ Manager team dashboard
✓ Player explorer
✓ Fixture matrix
✓ Injury/status tracking
✓ Price change tracking
✓ "What changed?" feed
✓ Basic custom FDR
```

The next release should add:

```text
xP model
Transfer recommendations
Captain recommendations
Bench optimization
```

Only after those recommendations are validated through backtesting should you add:

```text
Chip optimization
FPL authenticated actions
Automated transfer execution
```

---

# 10. Highest-Value Product Improvements

The application should not become a collection of disconnected FPL statistics.

The strongest product experience is a **Decision Center**.

## Recommended decision hierarchy

```text
1. What changed?
       ↓
2. Is my team affected?
       ↓
3. Should I transfer?
       ↓
4. Should I roll?
       ↓
5. Who should I start?
       ↓
6. Who should I captain?
       ↓
7. Should I use a chip?
       ↓
8. What is the best strategy for the next 3–6 Gameweeks?
```

This creates a clear user journey from data → analysis → recommendation → action.

## Suggested home screen

```text
┌──────────────────────────────────────────────┐
│                 FPL DECISION CENTER          │
├──────────────────────────────────────────────┤
│ GW3   Rank 1.2M   1 FT   £1.7m ITB           │
├──────────────────────────────────────────────┤
│ MY TEAM                                       │
│ [Interactive Pitch]                           │
├──────────────────────────────────────────────┤
│ GAMEWEEK PLAN                                 │
│ Transfer: Player A → Player B                │
│ Start: Recommended XI                        │
│ Captain: Player C                             │
│ Chip: Save                                    │
│ Roll: No — projected gain +7.3               │
├──────────────────────────────────────────────┤
│ CHANGES                                      │
│ 🔴 1 injury                                  │
│ 🟡 2 availability concerns                   │
│ 📈 3 price changes                            │
│ 📅 1 fixture change                           │
├──────────────────────────────────────────────┤
│ STRATEGY                                     │
│ Next Wildcard: GW8                            │
│ Next Bench Boost: GW29                        │
│ Confidence: 82%                               │
└──────────────────────────────────────────────┘
```

---

# 11. Final Recommended Architecture

The recommended initial implementation is:

```text
                    NEXT.JS
               Static Frontend
                     │
                     ▼
                 GITHUB PAGES
                     │
                     ▼
                  SUPABASE
         ┌───────────┼────────────┐
         │           │            │
      Postgres     Auth      Edge Functions
         │                        │
         │                        ├── FPL ingestion
         │                        ├── Prediction
         │                        ├── Optimization
         │                        └── Notifications
         │
         ▼
  Historical FPL Dataset
         │
         ▼
   Intelligence Layer
         │
  ┌──────┼───────┐
  ▼      ▼       ▼
 xP     FDR   Risk Model
  │      │       │
  └──────┼───────┘
         ▼
   Decision Engine
         │
  ┌──────┼────────┐
  ▼      ▼        ▼
Transfer Captain  Chips
Optimizer Engine  Strategy
  │      │        │
  └──────┼────────┘
         ▼
  Personalized Advice
```

## Core design principle

> **The FPL API provides the data. Supabase stores the history. The intelligence layer turns data into predictions. The optimization layer turns predictions into decisions. The frontend turns decisions into actions.**

That separation should make the application easier to maintain, test, and eventually scale beyond a personal FPL tracker into a more general FPL analytics platform.
