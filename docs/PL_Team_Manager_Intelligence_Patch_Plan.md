# Patch Plan — PL Team Manager Intelligence

**Version:** Patch v1.0  
**Applies After:** Sprint 12 (Chip Strategy)

## Objective
Introduce a Premier League Team Manager Intelligence layer that models how each manager's tactical system affects player output.

## Goals
### Primary
- Model each Premier League manager's tactical system
- Improve predictions for newly transferred players
- Improve expected points (xP)
- Improve transfer recommendations
- Improve explainability
- Reduce cold-start uncertainty

### Secondary
- Better Replacement Finder suggestions
- Better Team Builder recommendations
- Better Scenario Lab explanations
- Foundation for future tactical simulations

## Architecture
```text
Supabase DB (manager_profiles)
        │
        ▼
_shared/xp-model.ts
        │
        ▼
System Fit Multiplier (μ_fit)
        │
        ▼
xP Engine v1.2
        │
 ┌──────┼─────────┐
 ▼      ▼         ▼
Team  Transfer  Scenario
Builder Engine    Lab
```

## Phase 1 – Database
Create `manager_profiles` and link `clubs.manager_id`.

## Phase 2 – Tactical Knowledge Base
Store tactical traits, formations, build-up style, pressing intensity, modifiers and role preferences.

## Phase 3 – System Fit Engine
Implement `calculateSystemFitMultiplier()` for tactical role matching, position suitability, opponent context and manager modifiers.

## Phase 4 – xP Integration
```
xP = Base × Fixture × Minutes × Availability × μ_fit + Bonuses
```
Set `MODEL_VERSION = v1.2`.

## Phase 5 – Cold Start Enhancement
Integrate manager confidence into the Bayesian prior:
```
w'(N) = w(N) × (1 − C_manager)
```

## Phase 6 – Replacement Finder
Include System Fit Score in replacement ranking.

## Phase 7 – Team Builder
Add badges:
- High System Fit
- Role Risk
- Tactical Rotation Risk

## Phase 8 – Scenario Lab
Enhance "Why this transfer?" with tactical explanations.

## Phase 9 – Explainability
Break down xP into Fixture, Minutes, Manager Fit and Risk.

## Phase 10 – Research Pipeline
Maintain manager profiles using tactical reports, FBref, Understat, lineup data and periodic reviews.

## Backend
New services:
- manager-profile.service.ts
- system-fit.service.ts
- manager-research.service.ts

Updated:
- xp-model.ts
- scoring.ts
- replacement-finder.ts
- scenario-engine.ts
- cold-start.ts

## Frontend
- Player badges
- System Fit column
- Manager information panel
- Tactical explanation panel

## Testing
- Unit tests
- Integration tests
- Historical backtesting

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Subjective tactical profiles | Quantitative validation |
| Overweighting manager effects | Cap μ_fit |
| Tactical changes | Version profiles |
| Complexity | Modular implementation |
| Cold-start overconfidence | Confidence-scaled Bayesian prior |

## Deliverables
- Manager profiles database
- Club-manager mapping
- System Fit multiplier
- xP Engine v1.2
- Cold-start integration
- Team Builder badges
- Replacement Finder integration
- Scenario Lab explainability
- Validation suite

## Recommended Placement
Implement as **Sprint 12.5 (Patch 12A)** immediately after Sprint 12.
