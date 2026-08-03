# FPL Analytics & Decision Support App

# Implementation Roadmap (Post Sprint 4)

> **Current Status**
> 
> ✅ Sprint 1 – TeamState Architecture
> ✅ Sprint 2 – Team Builder
> ✅ Sprint 3 – Squad Projection (Expected Points Engine)
> ✅ Sprint 4 – Squad Optimizer
> 
> **Current Capability**
> 
> - Player & Fixture Data Pipeline
> - Historical Data Storage (Supabase)
> - xP Model
> - Fixture Intelligence
> - Squad Optimization
> - Draft Team Builder
> - TeamState Abstraction
> 
> The remaining work now shifts from **building an optimizer** to building an **intelligent FPL decision-support platform**.

---

# Remaining Product Roadmap

```text
Current State

          ▼

Squad Builder
          │
          ▼

Decision Intelligence
          │
          ▼

Gameweek Optimizer
          │
          ▼

Ownership Intelligence
          │
          ▼

Live Matchday Hub
          │
          ▼

Authenticated Team Sync
          │
          ▼

Automation & Notifications
```

---

# Phase Overview

| Sprint | Theme                           | Priority |
| ------ | ------------------------------- | -------- |
| 5      | Scenario Lab & Draft Management | ⭐⭐⭐⭐⭐    |
| 6      | Player Comparison Engine        | ⭐⭐⭐⭐⭐    |
| 7      | Replacement Finder              | ⭐⭐⭐⭐⭐    |
| 8      | Transfer Simulator              | ⭐⭐⭐⭐⭐    |
| 9      | Transfer Optimizer              | ⭐⭐⭐⭐⭐    |
| 10     | Ownership Intelligence (Top 1%) | ⭐⭐⭐⭐⭐    |
| 11     | Captain & Bench Optimizer       | ⭐⭐⭐⭐     |
| 12     | Chip Strategy Engine            | ⭐⭐⭐⭐     |
| 13     | Live Matchday Hub               | ⭐⭐⭐⭐     |
| 14     | Authentication & Team Sync      | ⭐⭐⭐⭐     |
| 15     | Action Layer                    | ⭐⭐⭐      |
| 16     | Notifications & Automation      | ⭐⭐⭐      |
| 17     | Historical Analytics & ML       | ⭐⭐       |

---

# Sprint 5 — Scenario Lab & Draft Management

## Objective

Allow managers to create, save and compare multiple squads before making decisions.

## Features

- Save unlimited drafts
- Clone draft
- Rename draft
- Delete draft
- Import optimized squad
- Manual editing
- Budget tracking
- Team validation

## New Components

```text
Draft Manager

Draft Card

Draft Comparison

Draft Timeline
```

## Supabase

```
team_drafts

draft_players

draft_lineups
```

## Deliverable

Users can maintain multiple team ideas simultaneously.

---

# Sprint 6 — Player Comparison Engine

## Objective

Compare any players across multiple planning horizons.

## Inputs

- Player A
- Player B
- Horizon

```
1 GW

3 GW

5 GW

8 GW

Season
```

## Metrics

- xP
- Price
- Ownership
- EO
- Fixture Rating
- Form
- Minutes
- Risk
- xP / £

## Formula

```
Comparison Score

=

0.40 xP

+

0.20 Fixture

+

0.15 Value

+

0.15 Minutes

+

0.10 Form

-

Risk
```

## Deliverable

Interactive comparison dashboard.

---

# Sprint 7 — Replacement Finder

## Objective

Automatically identify the best replacements for any player.

Workflow

```
Player

↓

Budget

↓

Constraints

↓

Optimizer

↓

Top Candidates
```

Filters

- Position
- Budget
- Club Limit
- Availability
- Expected Minutes

Outputs

- Top 10 replacements
- Expected gain
- Fixture comparison
- Risk comparison
- Explanation

---

# Sprint 8 — Transfer Simulator

## Objective

Allow managers to simulate transfers before making them.

Simulation

```
Current Team

↓

Transfer

↓

Updated Team

↓

New Projection
```

Outputs

- Team xP
- Captain impact
- Fixture impact
- Bench impact
- Budget
- Remaining bank

Formula

```
Transfer Gain

=

New Team xP

-

Old Team xP

-

Transfer Cost

-

Risk Change
```

Deliverable

Interactive transfer simulator.

---

# Sprint 9 — Transfer Optimizer

## Objective

Recommend the optimal transfer strategy.

Evaluate

```
Roll

1 Transfer

2 Transfers

Hit

Wildcard
```

Decision Formula

```
Transfer Value

=

Expected Gain

-

Transfer Cost

-

Risk
```

Also calculate

```
Roll Value

=

Future Flexibility

+

Expected Future Gain
```

Recommendation

```
Transfer

if

Transfer Value

>

Roll Value
```

## NEW

Support **up to five banked transfers** according to the current FPL rules.

Track

- Current FT
- Banked FT
- FT expiry logic (if applicable by season rules)
- Wildcard / Free Hit interactions

Deliverable

Complete transfer decision engine.

---

# Sprint 10 — Ownership Intelligence Engine

## Objective

Introduce ownership-based decision making.

Instead of maximizing points alone,

maximize

```
Expected Rank Gain
```

---

## Top 1% Benchmark Pipeline

After every deadline

```
League 314

↓

Top 10k Managers

↓

Batch Fetch Picks

↓

Calculate EO

↓

Template Squad

↓

Store Snapshot
```

Store

```
template_snapshots

top10k_managers

top10k_picks

ownership_metrics

eo_metrics
```

---

## Effective Ownership

Captain

```
2×

```

Triple Captain

```
3×

```

Bench

```
0×

```

EO

```
EO

=

Ownership

×

Multiplier
```

---

## Differential Score

```
Differential

=

xP

×

(1−EO)

×

Upside

×

Minutes Probability
```

---

## Rank Gain

```
Rank Gain

=

Expected Points

×

(1−EO)
```

---

## Template Similarity

Calculate

```
My Squad

↓

Template %

↓

Similarity %
```

Outputs

- Template %
- Differential %
- Captain similarity
- Unique players

Deliverable

Complete ownership intelligence engine.

---

# Sprint 11 — Captain & Bench Optimizer

## Objective

Optimize the starting XI.

Features

- Formation optimizer
- Captain
- Vice Captain
- Bench order

Captain Formula

```
Captain Score

=

0.50 xP

+

0.20 Fixture

+

0.15 Minutes

+

0.10 Team Attack

+

0.05 Pens

-

Risk
```

Bench

```
Bench Score

=

Expected Points

×

Sub Probability
```

Outputs

- Starting XI
- Captain
- Bench
- Team Projection

---

# Sprint 12 — Chip Strategy Engine

## Objective

Plan chips over multiple Gameweeks.

Supported

- Wildcard
- Free Hit
- Bench Boost
- Triple Captain

Chip Formula

```
Chip Value

=

Points With Chip

-

Points Without Chip
```

Optimize over

```
5 GW

8 GW

Season
```

Outputs

- Best GW
- Confidence
- Alternative plan

---

# Sprint 13 — Live Matchday Hub

## Objective

Provide live decision support during matches.

New Object

```
GameweekState
```

Contains

- Live score
- Bonus
- Live rank
- Pending auto subs
- Captain EO
- Safety score

Dashboard

```
Live Rank

Projected Rank

Captain EO

Green Arrow %

Red Arrow %

Bonus Pending

Auto Subs

DEFCON Alerts
```

Deliverable

Real-time Gameweek dashboard.

---

# Sprint 14 — Authentication & Team Sync

## Objective

Connect the optimizer to a real FPL account.

Flow

```
FPL Login

↓

Supabase Edge Function

↓

FPL API

↓

TeamState
```

Features

- Import team
- Sync transfers
- Compare draft vs live
- Detect differences

Deliverable

Live team synchronization.

---

# Sprint 15 — Action Layer

Allow execution of recommendations.

Supported

- Lineup
- Captain
- Transfers
- Chips

Architecture

```
Frontend

↓

Edge Function

↓

FPL API
```

Always require confirmation before execution.

---

# Sprint 16 — Notifications & Automation

Notification Events

- Deadline
- Injury
- Suspension
- Price Rise
- Price Drop
- Fixture Change
- New Recommendation

Channels

- Email
- Push
- Telegram
- Discord

Users configure notification preferences.

---

# Sprint 17 — Historical Analytics & ML

## Historical Analytics

Track

- Captain success
- Transfer success
- Chip ROI
- xP accuracy
- Rank progression
- Team value
- Recommendation accuracy

## Future Machine Learning

Potential models

- Gradient Boosting
- XGBoost
- LightGBM
- Ensemble xP

Potential outputs

- Better minutes prediction
- Better injury prediction
- Personalized transfer recommendations

---

# Cross-Cutting Improvements

These enhancements should be incorporated throughout Sprints 5–17.

## Intelligence Engine v2

```text
Expected Points Engine

Fixture Engine

Availability Engine

Risk Engine

Ownership Engine

Template Engine

Differential Engine

Decision Engine
```

---

## Updated Risk Formula

```
RiskScore

=

0.30 Rotation

+

0.25 Injury

+

0.20 Minutes

+

0.15 Fixture Variance

-

0.10 Effective Ownership
```

---

## Updated Squad Score

```
Squad Score

=

Expected Points

+

Fixture Quality

+

Bench Strength

+

Value

-

Risk Score
```

---

## Decision Outputs

Every recommendation should return

- Recommendation
- Expected Gain
- Confidence
- Risk
- Explanation
- Alternative Options

---

# Recommended Development Order

```text
Current State
      │
      ▼
Scenario Lab
      │
      ▼
Player Comparison
      │
      ▼
Replacement Finder
      │
      ▼
Transfer Simulator
      │
      ▼
Transfer Optimizer
      │
      ▼
Ownership Intelligence
      │
      ▼
Captain & Bench
      │
      ▼
Chip Strategy
      │
      ▼
Live Matchday Hub
      │
      ▼
Authentication
      │
      ▼
Action Layer
      │
      ▼
Notifications
      │
      ▼
Historical Analytics
      │
      ▼
Machine Learning
```

---

# Final Product Vision

At the completion of this roadmap, the application will provide:

- **Manual Team Builder** for pre-deadline planning
- **Scenario Lab** for comparing multiple drafts
- **Advanced xP & Risk Models** with explainable recommendations
- **Player Comparison & Replacement Finder**
- **Transfer Simulator & Optimizer** with support for up to five banked free transfers
- **Ownership Intelligence**, including Top 1% template tracking, Effective Ownership (EO), differential scoring, and expected rank gain
- **Captain, Bench & Chip Optimization**
- **Live Matchday Hub** with projected rank, auto-sub predictions, and live EO insights
- **Secure FPL Authentication & Team Synchronization**
- **One-click Action Layer** for transfers and lineup changes
- **Historical Analytics** to evaluate model accuracy and decision quality
- **A modular intelligence platform** capable of evolving into a machine-learning-assisted FPL strategy engine.
