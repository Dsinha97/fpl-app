# GW8 check-in — the seventh read, and the first on v1.7.0

**Run 2026-10-26.** `gameweeks.finished` and `data_checked` were both `true` for GW6, GW7 and GW8 when this
ran (GW9 `false`), and the join below is also restricted to `fixtures.finished = true`. Same join as
[gw6-check-in.md](gw6-check-in.md) §1: `player_prediction_archive` to `player_gameweek_stats` on
`(season, player_code, fixture)`, 2026-27, run as SQL against the live project. Bias is actual − predicted
(negative = over-predicted), the repo's convention.

## 1. The scoreboard, GW6–8 (locked data)

| GW | model | n | bias | MAE | r | no-show bias (n) | played bias (n) |
|---|---|---|---|---|---|---|---|
| 6 | v1.5.0 | 667 | −0.091 | 1.300 | 0.463 | −0.637 (352) | +0.520 (315) |
| 7 | v1.6.0 | 667 | −0.132 | 1.259 | 0.518 | −0.631 (363) | +0.465 (304) |
| **8** | **v1.7.0** | **668** | **+0.084** | **1.280** | **0.485** | **−0.615 (365)** | **+0.926 (303)** |

- **GW6 reproduces the earlier read exactly**, so the join is the same one.
- **GW7 moved from the [gw7-check-in.md](gw7-check-in.md) figures** (bias −0.208, MAE 1.244, r 0.517 to −0.132,
  1.259, 0.518). That read was taken before `finished` flipped, with provisional bonus. These are the locked
  numbers and supersede it.
- **The first live v1.7.0 row is close to its replay.** Sprint 43's replay over GW7 read bias −0.031, r 0.508,
  Spearman 0.623 (on partial GW7 data); the live GW8 row is bias +0.084, r 0.485, Spearman 0.614. *Correction:*
  an earlier draft of this note compared the replay's 0.623 to the live Pearson r; 0.623 is a Spearman. See §4
  for the bias.
- **The bias sign flipped, from over- to under-prediction, and the played side drove it.** Played-appearance
  bias went from +0.465 to +0.926, the largest of any week on record (previous range +0.35 to +0.77). The
  no-show over-prediction is unchanged (−0.615), as it has been every week since GW2.
- **MAE is 1.280, between GW6 and GW7. r is 0.485, below GW7's 0.518.** Recorded, not interpreted: one week.

## 2. Last-5 baseline on the same rows

The GW6 check-in's baseline used the harness (`scripts/backtest-walkforward.ts`), which re-derives xP with
neutral FDR rather than reading what was shown. That cannot score v1.7.0's archived output. This run
instead scores **the archived `xp` itself against a last-5 mean on identical rows**, in SQL, so the two arms
cannot differ in cohort. Baseline = the mean `total_points` of a player's previous five 2026-27 rows
(by event, then fixture), requiring five. Two readings, because "last five" is ambiguous:

**A. Last five rows of any minutes** (zeros for no-shows included):

| GW | model | n | model bias / MAE / r | last-5 bias / MAE / r |
|---|---|---|---|---|
| 6 | v1.5.0 | 610 | −0.046 / 1.285 / 0.473 | −0.091 / 1.276 / 0.468 |
| 7 | v1.6.0 | 626 | −0.091 / 1.271 / 0.518 | −0.043 / 1.257 / 0.498 |
| 8 | v1.7.0 | 654 | +0.107 / 1.286 / 0.486 | +0.019 / 1.308 / 0.446 |

**B. Last five *played* rows** (minutes > 0), players with five prior played rows only:

| GW | model | n | model bias / MAE / r | last-5 bias / MAE / r |
|---|---|---|---|---|
| 6 | v1.5.0 | 181 | +0.422 / 2.179 / 0.209 | −0.769 / 2.603 / 0.178 |
| 7 | v1.6.0 | 236 | +0.183 / 2.204 / 0.310 | −0.407 / 2.549 / 0.169 |
| 8 | v1.7.0 | 270 | +0.658 / 2.163 / 0.288 | −0.377 / 2.593 / 0.121 |

- **A: a dead heat.** The model beat last-5 on MAE only in GW8 (1.286 vs 1.308) and lost it in GW6 and GW7,
  by 0.009 and 0.014. On r it won all three weeks, by 0.005, 0.020 and 0.040. Differences this small, at one
  gameweek each, are not a result.
- **B: the model beats last-5 on MAE and r in every week**, MAE by about 0.4 each time. This is the
  opposite of the GW6 check-in's harness read (baseline ahead, model r 0.142 vs 0.280). The two are not the
  same test: that one scored a re-derived, neutral-FDR model; this one scores what the site actually
  showed. The earlier read stands as a statement about the harness, not the shipped model.
- **Neither arm has a standard error, n is one gameweek per row, and arm B is selected on players with a
  long playing record.** This is not the out-of-sample gate DSI-186 names (the GW10 batch, ~2026-11-09),
  and nothing here is an accuracy claim.

## 3. What drove the GW8 bias (`scripts/component-residuals.ts`, 2026-10-26)

Run as `npx tsx scripts/component-residuals.ts` against the live project; it reproduced the scoreboard
(GW8 n=668, bias +0.084, MAE 1.280, r 0.485).

**The played-cohort jump (+0.465 to +0.926) is mostly the model's mean level falling by design, and the
rest is a defence-heavy week.** The cohort figures are a decomposition of the pooled bias, so start there.
Mean calibrated xP and mean realised points per player-fixture, all positions:

| | GW7 (v1.6.0) | GW8 (v1.7.0) | change |
|---|---|---|---|
| predicted xP | 1.458 | 1.305 | **−0.153** |
| realised | 1.327 | 1.389 | **+0.062** |
| bias (realised − predicted) | −0.132 | +0.084 | +0.216 |

About 71% of the swing is the prediction level dropping and 29% is realised points rising. The drop is what
v1.7.0 was built to do: its raw component sum is no longer multiplied by `positionCalibration` (`raw sum`
equals `calibrated xP` in every v1.7.0 block; in v1.6.0 it was 1.184 to 1.458). The cohorts then follow
mechanically: with about 45% of rows played, the pooled move of +0.216 is a played move of +0.46 and a no-show
move of +0.016. No-shows are predicted near zero either way, so a lower level moves the played side almost
alone.

**Which components, GW8, mean predicted / realised per player-fixture (realised − predicted):**

| component | predicted / realised | gap |
|---|---|---|
| clean sheet | 0.180 / 0.296 | **+0.116** |
| goals | 0.189 / 0.121 | **−0.068** |
| assists | 0.106 / 0.076 | −0.030 |
| defensive contribution | 0.103 / 0.129 | +0.026 |
| appearance | 0.733 / 0.768 | +0.035 |
| goals conceded | −0.061 / −0.045 | +0.016 |
| bonus, saves, cards | within 0.003 | ~0 |
| **sum** | | **+0.086** (bias +0.084) |

- **Clean sheets are the whole story on the positive side**, concentrated in DEF (0.358 / 0.571) and GKP
  (0.256 / 0.438). GW8 had 8 clean-sheet sides out of 20, a rate of 0.40, the highest of GW2–8 (range 0.10 to
  0.35), and the fewest goals per fixture (1.90, against 2.3 to 3.6). A low-scoring week raises realised clean
  sheets and lowers realised goals together, which is the pattern in the table: clean sheet +0.116 against
  goals and assists −0.098.
- **The clean-sheet term has been under-predicted every week** (+0.025 over GW2–6, +0.049 in GW7), but by far
  less. v1.7.0 did not touch it (`p60` is unchanged), so GW8's +0.116 is mostly the week, not a new defect.
  Whether the small standing gap is real is not testable from eight weeks of 10 fixtures each.
- **Goals and assists are over-predicted for MID and FWD** (MID goals 0.227 / 0.117, assists 0.153 / 0.110;
  FWD goals 0.425 / 0.354, assists 0.109 / 0.076), the mirror of the same low-scoring week. v1.7.0 raised
  assists (ALL 0.077 to 0.106 predicted); over GW2–6 it still sits under realised (0.106 / 0.124), so the
  GW8 over-prediction should not be read as that fix overshooting.
- **The replay on GW8's own archived inputs gives bias +0.041** (MAE 1.297, r 0.482). The shipped output and
  the replay agree, so the live pipeline is doing what `predict()` does; nothing here points to a deploy
  fault.
- **The replay's level is stable at +0.04 to +0.10:** GW2–6 +0.103, GW7 +0.045, GW8 +0.041. v1.7.0 reads
  slightly low on average (under-predicts) on all seven scored gameweeks (GW2–8), where v1.5.0 and v1.6.0 read high. That is a
  small, consistent offset, not a GW8 event. The Sprint 43 GW7 replay figure (−0.031) was taken on partial
  GW7 data; on locked data the same replay reads +0.045.
- **The minutes side did not get worse.** Appearance is 0.733 / 0.768 (gap +0.035, was +0.049 in GW7). Calibration
  by P(appear) bucket: the 0.2–0.4 bucket still under-predicts appearances (0.292 / 0.494), as in GW7 (0.284 /
  0.482), the 0.8–1.0 bucket over-predicts (0.976 / 0.900).

**Reading.** Nothing found says v1.7.0 is broken. The bias moved because the model stopped inflating its mean
and because GW8 was a clean-sheet-heavy, low-scoring week. What this note cannot do is say whether +0.04 to
+0.10 is a real residual offset or noise around zero; that needs the GW10 batch's sample, and a refit on the
strength of one week would be the mistake the GW5 check-in warned about.

## 4. Was it FDR? A preview of derived vs official (not the DSI-52 gate)

**The bias is not an FDR change.** v1.7.0 did not touch FDR; production still reads FPL's official
`team_h_difficulty` / `team_a_difficulty`. FDR is relative (it moves points between easy and hard fixtures),
so it cannot produce or correct a league-wide low-scoring week. Bias (realised − predicted) by the archived
`fdr`, GW2–7 against GW8:

| FDR | GW2–7 | GW8 (n) |
|---|---|---|
| 2 | −0.023 | −0.127 (158) |
| 3 | −0.045 | +0.111 (343) |
| 4 | −0.239 | +0.355 (142) |
| 5 | −0.210 | −0.482 (25) |

FDR 4 moved most (+0.59), which fits "tough fixtures went better than rated", but it is 142 rows in one
week and FDR 5 moved the other way. Read as noise. Whether FPL revised its official FDR between GW7 and GW8
was not checked.

**Preview run, 2026-10-26.** A throwaway copy of `scripts/backtest-walkforward.ts` (not committed) restricted
to 2026-27 with a third arm: `predict()` fed the official FDR for the player's side of the fixture, joined
from `fixtures` by fixture id, on the same rows as the neutral (`fdr=3`) and derived arms. Cohort: 235
players with ≥1,200 weighted prior minutes; GW2–8, n = 1,646 rows.

| `priorGames=4` | n | bias | MAE | r |
|---|---|---|---|---|
| neutral (fdr=3) | 1,646 | −0.274 | 2.324 | 0.231 |
| **official** | 1,646 | −0.260 | **2.310** | **0.245** |
| derived | 1,646 | −0.266 | 2.321 | 0.226 |

- **Official beats derived on MAE and r.** `priorGames` 2 and 8 order them the same way; restricting to GW5–8
  (derived has four prior games) does not change it (official 2.295 / 0.203, derived 2.306 / 0.182).
- **Derived no longer beats neutral on 2026-27.** r 0.226 against 0.231, and the harness's own derived-vs-neutral
  check reads "does not clear" at all three settings. Sprint 35's clearing was on four earlier seasons and
  early 2026-27, so this is a new data point rather than a contradiction.
- **By gameweek (`priorGames=4`) official is ahead in most weeks and derived is close in GW4–6.** GW8:
  official MAE 2.301, r 0.182; derived 2.342, 0.121.
- **Caveats.** The official values in `fixtures` are today's, not the deadline-time values, so official may carry
  a small look-ahead edge if FPL revised them. Official's gain over neutral is about 0.6% of MAE with no
  standard errors. The harness cohort uses neutral-FDR rates without prior-shrinkage or squad reconciliation.
  One season, seven gameweeks.
- **Status.** This is not the DSI-52 gate; that stays at the GW10 batch (~2026-11-09) and its gate is not
  narrowed by this. A more reactive setting (`priorGames=2`) did not do better. Nothing is wired into
  `fdrRun`.

## 5. Not done

- **The Sprint 43 deploy-time checks ([sprint-43.md](sprint-43.md) "Deployed") were only partly re-run.** The
  outcome side was covered above (§1–3). The integrity table was re-run on the 2026-10-26 `player_predictions`
  run (20,070 rows, 669 players, events 9–38, all `v1.7.0`): keeper minutes 89.9–90.1 per club fixture (600
  club-fixtures), outfield 899.9–900.5, start sums 0.999–1.001 and 9.997–10.003, and on the GW8 archive
  `appearance_probability` is non-null, within 0–1 and never below start probability (668 rows). Outfield minutes
  and starts sit 0.2 and 0.003 outside the band recorded on 2026-10-19; read as rounding, not re-examined.
  `squad_consistency_violations` and the `prediction_models.params` match were not re-checked.
- `component-residuals.ts` reports components pooled by position, not split by played / no-show cohort, so §3
  cannot attribute the cohort bias to components directly.
- **DSI-219 was not closed.** Its verification is one live row that is not yet clearly good or bad.
- DSI-51/52/54, `positionCalibration` and the GW10 batch are untouched; the GW10 batch stays at ~2026-11-09.
