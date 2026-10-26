# GW7 check-in — the sixth read, and the first on v1.6.0

**Run 2026-10-20.** Same join as [gw6-check-in.md](gw6-check-in.md) §1: `player_prediction_archive` to
`player_gameweek_stats` on `(season, player_code, fixture)`, 2026-27. Bias is actual − predicted (negative =
over-predicted), the repo's convention. `gameweeks.finished` for GW7 was still `false` when this ran, so the
rows are matched per fixture, not by that flag.

## 1. The scoreboard, GW2–7

| GW | model | n | bias | MAE | r | no-show bias (n) | played bias |
|---|---|---|---|---|---|---|---|
| 2 | v1.5.0 | 620 | −0.150 | 1.396 | 0.518 | −0.846 (312) | +0.554 |
| 3 | v1.5.0 | 652 | −0.089 | 1.323 | 0.468 | −0.693 (345) | +0.590 |
| 4 | v1.5.0 | 656 | −0.079 | 1.379 | 0.501 | −0.670 (349) | +0.593 |
| 5 | v1.5.0 | 659 | −0.006 | 1.348 | 0.490 | −0.662 (358) | +0.774 |
| 6 | v1.5.0 | 667 | −0.091 | 1.300 | 0.463 | −0.637 (352) | +0.520 |
| **7** | **v1.6.0** | **667** | **−0.208** | **1.244** | **0.517** | **−0.651 (373)** | **+0.354** |

- **GW7 is the first archived snapshot from v1.6.0.** MAE is the best of the six and r is the second best.
- **Aggregate bias got worse (−0.208, the largest of the six) while the played-side error shrank** (+0.520 to
  +0.354). The no-show over-prediction did not move (−0.637 to −0.651), so the new minutes model fixed
  appearances, not the no-show half. Recorded as measured.
- n = 1 gameweek on the new model. This is not a gate result and says nothing about DSI-186.
- The v1.7.0 replay over this same GW7 (bias −0.031, r 0.623) is in [sprint-43.md](sprint-43.md) and was not
  re-run here; v1.7.0 has no archived snapshot until GW8.

## 2. Not done

- The last-5 baseline comparison (needs the walk-forward harness to ingest GW7, which waits on the
  `finished` flag). A harness run today scored the positionCalibration arms only and was not a GW7 read.
- GW10 batch re-read stays at ~2026-11-09.
