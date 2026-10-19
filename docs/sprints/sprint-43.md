# Sprint 43 — xP component fixes (v1.7.0): fix what `positionCalibration` was hiding

**Built 2026-10-19**, on `sprint-43-xp-components` from `main`. Linear
[DSI-219](https://linear.app/dsinha-org/issue/DSI-219) (M7 · GW10 model batch). Prompted by an
external audit of the model, [sources/ml-model-audit.md](../sources/ml-model-audit.md). The owner
asked for it to be checked and for whatever held up to be implemented. **Deployed 2026-10-19** as
`generate-predictions` v23, at the owner's instruction (§6).

## 1. What the audit got right and wrong

The audit's headline was that v1.6.0 leaks minutes to bench players, that this explains the
−0.714 / +0.627 appeared/no-show split from the [GW5 check-in](gw5-check-in.md), and that it
should be gated on |bias(no-show)| < 0.15. **That part doesn't hold.** A split by the *realised*
outcome is opposite-signed for any honest forecast, as [dsi-185-minutes-model.md](dsi-185-minutes-model.md)
§1 already recorded. Bucketed by *predicted* play probability, mean xP tracked actual points closely
(0.10/0.11, 1.01/0.85, 1.74/1.83, 2.44/2.32, 3.52/3.22). The proposed gate can't be met by any
model that doesn't know who will play, so it isn't adopted (noted on DSI-186).

Also out of date or not comparable:
- the n_eff-weighted water-fill it asks for shipped in v1.3.0;
- its external benchmark (MAE 1.03, ρ 0.695) is a different cohort and metric;
- bonus needs no BPS rebuild: raw bonus is calibrated (0.084/0.085 DEF, 0.094/0.097 MID, 0.147/0.150 FWD).

**What did hold up** is that a single multiplicative `positionCalibration` was papering over real
component errors. The audit pointed at the wrong ones. Scoring each component separately showed which.

## 2. The diagnostics (built first, model untouched)

- **`lib/component-reconciliation.ts`**: realised points per model component, derived through
  `breakdownFor` (the player card's own derivation, so there is one stats→points mapping). Also
  calibration by predicted P(appear) bucket.
- **`scripts/component-residuals.ts`**: the shipped archive scored per component, plus a replay of
  archived production inputs through the current rules (§4).
- **`scripts/backtest-walkforward.ts`**: the same tables per target season, plus Spearman ρ
  (`spearman` in `lib/stats.ts`) and the calibration arms in §5.

Live 2026-27 GW2–6 as shipped (v1.5.0 inputs), raw component mean vs realised, per player-fixture:

| | DEF | MID | FWD | GKP |
|---|---|---|---|---|
| Defensive contribution | **0.058 / 0.210** | **0.022 / 0.084** | 0.000 / 0.005 | — |
| Assists | 0.062 / 0.090 | 0.115 / 0.170 | **0.042 / 0.148** | 0.002 / 0.008 |
| Appearance | 0.824 / 0.875 | 0.717 / 0.806 | 0.542 / 0.707 | **0.705 / 0.559** |
| Goals | 0.113 / 0.141 | 0.229 / 0.263 | 0.396 / 0.415 | — |
| Raw sum → ×cal → actual | 1.31 → 1.60 → 1.52 | 1.20 → 1.47 → 1.44 | 1.09 → 1.37 → 1.35 | 1.08 → **1.36 → 0.98** |

The walk-forward harness shows the same shape in every season (e.g. 2025-26: DEF DC 0.143/0.331,
MID 0.076/0.192). The ×1.22–1.27 scalar inflated goals, bonus and saves, which were already right,
to cover three components that weren't. That is also GKP's −0.352 bias at the GW5 check-in.

## 3. The fixes

**Minute states (`minuteStates`, `predict()`).** Every component was evaluated once at mean minutes:
`dc90 × expectedMinutes/90`. For a threshold count that is a Jensen gap. A 50%-likely starter has
half the *tail* of a full match, not the tail of half a match, which is nearly all of the DC
shortfall. Expected minutes are now split into a start state (P = start probability, minutes =
`MINUTES_MODEL.minutesGivenStart`) and a cameo state (the remaining expected minutes at
`cameoMinutes` each, capped at availability − P(start)). Expected minutes are preserved exactly, so
goals, assists, bonus and cards keep the same expectation. DC, saves and goals conceded are averaged
over the states. P(appear) is the states' total, not `expectedMinutes / 72`; that rule read 0.30
where 0.41 of such players appeared.

**Negative-binomial DC tail (`negBinAtLeast`, `dcDispersion`).** Fitted, small: within-player
variance/mean is 1.3–1.4 over 85+ minute games, so r = 20 for DEF and 31 for MID+FWD (pooled, same
CBIRT rule). This is 2025-26 only, the one season with per-game DC. `null` means Poisson.

**Assists per xA (`assistsPerXa`, `fitAssistsPerXa`).** FPL credits assists xA doesn't see. The ratio
is stable season to season:

| | 2022/23 | 2023/24 | 2024/25 | 2025/26 | pooled |
|---|---|---|---|---|---|
| DEF | 1.12 | 1.25 | 1.26 | 1.36 | **1.27** |
| MID | 1.42 | 1.34 | 1.33 | 1.30 | **1.34** |
| FWD | 2.55 | 2.49 | 2.31 | 2.28 | **2.40** |

Goals/xG is ~1 for MID/FWD, so goals are left alone. Keepers stay at 1.

**Keeper minutes (`reconcileClubSquad`/`reconcileClubSquadWeighted`).** Confirmed before fixing:
in the archive, keepers' start probabilities summed to 0.99 per club fixture, but their expected
minutes summed to **116.7 against 88.2 played**. The minutes water-fill pooled keepers with
outfielders in one 990-minute budget, so a backup keeper could absorb outfield minutes. Minutes now
split like starts, 90 + 900, with a `goalkeeperMinutesFit` and a fourth `squad_status` field.

**`positionCalibration` → 1.0.** See §5.

Every fitted constant comes from `scripts/component-params-fit.ts`, which prints cameo minutes
(18.7; 19.38/18.62/18.44 by season, n=5,602), the DC sizes and the assists table above. Re-run it and
re-paste; don't edit the numbers by hand.

## 4. Archive replay: the production population

The harness can't see FPL's availability flags, the prior-shrinkage layer or squad reconciliation.
The archive can, but it stores only part of each player's rates, so the replay reconstructs the
rest. Goals, bonus and cards are linear and scale exactly. Clean sheet depends only on p60, which is
unchanged. Assists scale by the factor. Appearance and DC are recomputed from stored fields. Saves
and goals conceded are recovered by inverting `expectedFloorDiv`. Keeper minutes are re-filled to
90 with the stored prior weights, approximately: it starts from already-reconciled minutes. The
GW2–6 rows predate the in-season minutes model, so they don't include it.

| 2026-27 | n | bias | MAE | r | Spearman |
|---|---|---|---|---|---|
| GW2–6 as shipped (v1.5.0) | 3,254 | −0.082 | 1.348 | 0.488 | 0.623 |
| GW2–6 replayed, v1.7.0 rules | 3,254 | +0.103 | **1.281** | **0.493** | **0.631** |
| GW7 as shipped (v1.6.0, partial GW) | 667 | −0.208 | 1.244 | **0.517** | **0.625** |
| GW7 replayed, v1.7.0 rules | 667 | **−0.031** | **1.184** | 0.508 | 0.623 |

Over GW2–6 every targeted gap narrows and no other component gets worse:
- DEF DC 0.058 → 0.167 (actual 0.210);
- MID DC 0.022 → 0.100 (actual 0.084);
- FWD assists 0.042 → 0.100 (actual 0.148);
- keeper appearance 0.705 → 0.595 (actual 0.559);
- DEF goals conceded −0.123 → −0.153 (actual −0.200).

**Recorded, not hidden:**
- GW2–6 |bias| grows 0.082 → 0.103, now under-predicting rather than over.
- On GW7 alone (one partial gameweek), r dips by 0.009, MID DC overshoots (0.103 vs 0.034) and keeper saves read 0.177 vs 0.110.
- Pooled over GW2–7, |bias| improves 0.103 → 0.080.

## 5. Gate: walk-forward, four target seasons

The standing sweep gate ([phase-4-model.md](../phase-4-model.md) §4): MAE and Pearson r no worse,
|bias| no larger, in **every** target season, against the v1.6.0 run of the same harness. Three
calibration arms were scored on the same raw predictions. The rule for choosing between them was
written into the harness **before** the run: the LOSO arm is fitted on a cohort with no
availability flags, so it would absorb an error production doesn't have. If both pass, `unit` ships.

| Season | v1.6.0 bias / MAE / r | v1.7.0 `unit` (1.0) | v1.7.0 `loso` | v1.7.0 + old factors |
|---|---|---|---|---|
| 2023-24 | −0.227 / 2.311 / 0.233 | **+0.039 / 2.199 / 0.243** | +0.190 / 2.151 / 0.239 | −0.479 / 2.420 / 0.242 |
| 2024-25 | −0.451 / 2.359 / 0.201 | **−0.094 / 2.203 / 0.205** | +0.051 / 2.153 / *0.196* | −0.660 / 2.457 / 0.207 |
| 2025-26 | −0.657 / 2.547 / 0.153 | **−0.229 / 2.352 / 0.155** | −0.155 / 2.335 / *0.143* | −0.845 / 2.626 / 0.153 |
| 2026-27 | −0.654 / 2.526 / 0.217 | **−0.264 / 2.352 / 0.224** | −0.142 / 2.304 / 0.224 | −0.872 / 2.620 / 0.223 |

**`unit` passes in all four seasons**: MAE down 0.11–0.20, r up, |bias| down 0.19–0.43. `loso`
fails r in 2024-25 and 2025-26. Keeping the old factors on top of the fixed components is worse
everywhere, because they were compensating for errors that no longer exist. Spearman (reported, not
gated): 0.252/0.213/0.139/0.203 → 0.272/0.213/0.141/0.211.

Walk-forward honesty, per target season:
- `assistsPerXa` is refitted from seasons before the target.
- The DC dispersion stays Poisson for targets up to 2025-26, since it was fitted on 2025-26.
- `cameoMinutes` is used as-is. It is 18.4–19.4 in every season measured, so the leakage is
  negligible, and it is disclosed here.

The two final runs gave byte-identical JSON (deterministic). The model is still well behind the
naive last-5 baseline on the harness (2025-26 MAE 2.352 vs 2.061, r 0.155 vs 0.341). This sprint
removes component errors; it doesn't close that gap, and DSI-186 stays blocked.

**An unplanned finding, recorded on DSI-51 and not acted on.** On v1.7.0, the dormant `scope=minutes`
current-season blend clears its gate in **4/4 seasons at every weight**. On v1.6.0 it cleared 2–3/4.
That's early support for the audit's one testable claim: the blend failed on bias because the
calibration scalar was compensating. The ship decision stays with DSI-51 at the GW10 batch.

## 6. Shipping

`MODEL_VERSION` v1.6.0 → **v1.7.0**. `COLD_START_MODEL_NOTE` and `COLD_START_NOTE` gain the keeper
sentence and are re-synced; they had drifted in two phrases before this sprint. `XDC_MODEL_NOTE`
describes the new DC method. The `prediction_models` description gains v1.7.0.

**Bench odds read the model's own P(appear)**, added later the same day on this PR at the owner's
request. Until then `lib/lineup.ts`'s `playProbability` used `expectedMinutes / 72`, the model's
pre-v1.7.0 rule, so one quantity had two implementations.
- Migration `20261019230642_prediction_appearance_probability` (applied) adds a nullable
  `appearance_probability` to `player_predictions` and `player_prediction_archive`. RLS is unchanged,
  and anon can read it (checked).
- `generate-predictions` writes `Prediction.appearanceProbability`.
- `LineupCandidate`, `ScoredPlayer`, `EventPrediction` and `PredictionSeriesRow` carry it as a
  required field, so the compiler found every constructor. It is threaded through
  `lib/player-pool.ts`, `lib/chip-plan.ts`, `lib/transfers.ts`, `/builder`, `/deadline`, `/players`,
  `/scenarios`, `/transfers` and `chip-timing`.
- The builder's double-gameweek aggregate takes the max, the same convention as start probability.
- `playProbability` uses it when present and falls back to `/72` only for a row written before
  v1.7.0, which is every row until the function deploys.
- Checked in the preview against an imported draft: `/builder`, `/deadline` and `/transfers` render
  their lineup and bench figures with no errors, and all three new select shapes return 200 from
  PostgREST. Not checkable before the deploy: non-null values, and the bench odds actually moving.

### Deployed (2026-10-19)

`generate-predictions` **v23** went out through the Supabase MCP with `verify_jwt: true`, the same as
v22 and `config.toml`. The upload was the five files, comment-stripped with the TypeScript printer
as the earlier deploys were. Nothing else had changed in them since v22 (`git log` since 3fc97b4).
The stripped model was proved equivalent before upload: same 29 exports and constants, 0
differences over 20,000 random `predict()` cases, identical reconciliation.

First scheduled run (23:35 UTC, run 161131): **success**, 21,376 rows, 668 players, 235 on the
minutes model.

| Check | Result |
|---|---|
| `model_version` | v1.7.0 on every row |
| `appearance_probability` | non-null on every row, 0–1, never below start probability |
| Keeper expected minutes per club fixture | **89.9–90.1** (was 116.7 on the archive); outfield 899.7–900.3 |
| Start sums | keepers 0.999–1.001, outfield 9.99–10.00 |
| `squad_consistency_violations` | **0** (v22: 9) |
| `prediction_models.params` | matches local `MODEL_PARAMS` key for key |

Known players, v1.6.0 → v1.7.0, next gameweek:
- **Nailed defenders**: DC rises (Gabriel 0.385 → 0.504, Guéhi 0.280 → 0.425, Calafiori 0.068 →
  0.146), but total xP falls (Gabriel 5.99 → 5.08). That's the ×1.22 scalar coming off, not the DC
  change.
- **Backup keepers**: expected minutes collapse (Benda 64.1 → 15.4, King 55.6 → 12.2) and xP with
  them (Benda 1.83 → 0.60).
- **Rotation players**: P(appear) is now well above start probability (Cherki 0.49 start → 0.78
  appear).
- Next-gameweek position means (GKP 0.93, DEF 1.41, MID 1.33, FWD 1.23) sit just under GW2–6's
  realised rates (0.98 / 1.52 / 1.44 / 1.35), consistent with the replay's small under-prediction.

The GW7 archive is frozen (deadline passed), so the first archived v1.7.0 snapshot is GW8's.
Rollback is redeploying v22's files from commit 3fc97b4.

## 7. Checks after ship

- First v1.7.0 archive (GW8): re-run `scripts/component-residuals.ts` and confirm the DC, assists and
  keeper-appearance gaps stay closed on real v1.7.0 output, not a replay.
- Check per club that keeper expected minutes sum to 90.
- Check that `player_predictions.appearance_probability` is non-null on the first v1.7.0 run, and that a
  rotation-heavy bench's auto-sub odds move up from the `/72` reading.
- GW10: re-check the FWD assists ratio and MID DC (slightly over in the replay).
- When 2026-27 completes: refit `dcDispersion` with a second season.
