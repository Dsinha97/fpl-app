# GW6 check-in — the fifth read, and the first last-5 baseline

**Run 2026-10-13.** GW5 and GW6 were both 10/10 fixtures `finished` with minutes landed (checked
per fixture, not by the `finished` flag — see [gw5-check-in.md](gw5-check-in.md) §0), so unlike the
GW5 run nothing here is partial. GW7 had not landed. Linear [DSI-50](https://linear.app/dsinha-org/issue/DSI-50) (M6).

## 1. The scoreboard, GW2–6

`player_prediction_archive` joined to `player_gameweek_stats` on `(season, player_code, fixture)`,
2026-27.

| GW | n | bias | MAE | r | no-show bias (n) | played bias (n) |
|---|---|---|---|---|---|---|
| 2 | 620 | −0.150 | 1.396 | 0.518 | −0.846 (312) | +0.554 (308) |
| 3 | 652 | −0.089 | 1.323 | 0.468 | −0.693 (345) | +0.590 (307) |
| 4 | 656 | −0.079 | 1.379 | 0.501 | −0.670 (349) | +0.593 (307) |
| 5 | 659 | −0.006 | 1.348 | 0.490 | −0.662 (358) | +0.774 (301) |
| **6** | **667** | **−0.091** | **1.300** | **0.463** | **−0.637 (352)** | **+0.520 (315)** |
| pooled | 3,254 | −0.082 | 1.348 | 0.488 | −0.698 (1,716) | +0.605 (1,538) |

- **GW5 locked at −0.006**, matching the provisional read: confirmed bonus moved nothing.
- **The aggregate did not converge to zero or flip.** GW5 was a dip, GW6 is back at −0.091.
- **The split held for a fifth week.** No-shows over-predicted by −0.64 to −0.85 every week, appearances
  under-predicted by +0.52 to +0.77 every week; neither ever crosses zero. This is a stable
  expected-minutes discrimination failure, not noise — the case [DSI-185](https://linear.app/dsinha-org/issue/DSI-185) was written for.
- GW6 has the best MAE (1.300) and the worst r (0.463) of the five. One week; recorded, not interpreted.

## 2. The first last-5 baseline on 2026-27

`npx tsx scripts/backtest-walkforward.ts` (harness only, not committed). The baseline needs six played
gameweeks, so GW6 is the first row-matched gameweek: **n = 234**, i.e. one gameweek of the ≥1200-weighted-minutes cohort.

| | n | bias | MAE | r |
|---|---|---|---|---|
| model (matched) | 234 | −0.703 | 2.560 | 0.142 |
| last-5 baseline | 234 | −0.097 | 2.179 | 0.280 |

**On this slice the last-5 baseline beats the harness model on MAE and r.** Read it with its limits:

- n = 234, one gameweek, no standard errors — below the sample the GW10 batch is meant to supply.
- The harness runs `deriveRates` with neutral FDR, not production's `deriveRatesWithPrior` +
  squad reconciliation (scope cut disclosed at the top of the script), so it validates the core
  component model, not `generate-predictions`' exact output.
- It is consistent with [sprint-17a.md](sprint-17a.md)'s earlier finding that the model underperforms
  last-5 out-of-sample; it does not newly establish it.

Harness minutes cohort split, 2026-27 (all 1,408 cohort rows): appeared bias +0.219, no-show
**−2.737** (n=406), GKP no-show −2.717; start-probability Brier **0.2151** against a 0.25 coin-flip.
The start-probability model is barely better than a coin flip, which is the number DSI-185 has to move.

Nothing in the GW10 batch gates changed: the blend sweep still clears 2–3 of 4 seasons per setting,
the bias correction still clears no setting in all four, and derived FDR vs neutral still clears 4/4
(official FDR comparison is still DSI-52).

## 3. What carries forward

1. **DSI-50 closes.** Both branches of its gate are answered; the "next read GW6" is this document.
2. **DSI-185 is promoted** (Backlog/Medium → Todo/High). Five stable weekly splits and a ~coin-flip
   start Brier are the evidence. It is buildable on the four historical seasons now; gate unnarrowed.
3. **DSI-186 stays blocked** on DSI-185 and on the GW10 batch (~2026-11-09). The first last-5 read
   says the bar is real, not that it has been met or missed at adequate n.
4. **Not touched:** `positionCalibration` (still no refit), DSI-51/52/54.
5. GKP's separate bias gets re-read inside the DSI-185 work, not separately.
