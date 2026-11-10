# GW11 check-in plan

**Drafted 2026-11-10, run after GW11 is scored (expected ~2026-11-25).** The schedule has a break after GW10:
GW11 runs Sat 2026-11-21 to Mon 2026-11-23 (last kickoff 20:00 UTC), so nothing new is scoreable before then.
This is a routine read, the fourth on v1.7.0, built from the [GW10 check-in](gw10-check-in.md). It is **not** a
gate run and changes no model. The two dated follow-ups are at the end.

## 0. Ready?

All three must hold, or stop and wait:

```sql
select id, finished, data_checked from gameweeks where id in (11, 12) order by id;   -- GW11 true/true, GW12 false/false
select count(*) filter (where finished) finished, count(*) from fixtures where event = 11;   -- 10 / 10
select count(*) from player_prediction_archive where season='2026-27' and event = 11;       -- ~670 rows, all v1.7.0
```

The archive row for GW11 must be the **pre-deadline** snapshot (first `computed_at` for the event, taken ~2026-11-21
before 11:00 UTC). If `model_version` is not `v1.7.0` on every GW11 archive row, a deploy happened: say so and treat
the read as a new version's first row, as GW8 was.

## 1. The scoreboard

Same join as every earlier read (`player_prediction_archive` to `player_gameweek_stats` on
`(season, player_code, fixture)`, finished fixtures only). Run GW6–GW(N) so the earlier rows reproduce; if GW6–10 do
not match [gw10-check-in.md](gw10-check-in.md) §1–2 exactly, stop and find out why before reading GW11.

```sql
select a.event, count(*) n,
 round(avg(s.total_points - a.xp)::numeric,3) bias,
 round(avg(abs(s.total_points - a.xp))::numeric,3) mae,
 round(corr(a.xp, s.total_points)::numeric,3) r,
 round(avg(a.xp)::numeric,3) mean_xp, round(avg(s.total_points)::numeric,3) mean_real,
 round((avg(s.total_points - a.xp) filter (where s.minutes=0))::numeric,3) noshow_bias,
 count(*) filter (where s.minutes=0) n_noshow,
 round((avg(s.total_points - a.xp) filter (where s.minutes>0))::numeric,3) played_bias
from player_prediction_archive a
join player_gameweek_stats s on s.season=a.season and s.player_code=a.player_code and s.fixture=a.fixture
join fixtures f on f.id=a.fixture and f.finished
where a.season='2026-27' and a.event between 6 and 11
group by a.event order by a.event;
```

Last-5 arms A (last five rows of any minutes) and B (last five played rows, five required): the query in the GW10
session is `hist`/`hp` windows over `player_gameweek_stats` with `h.event < b.event`, `row_number() ... order by
h.event desc, h.fixture desc`, `rn <= 5`, `having count(*) = 5`, scored against the archived `xp`. Re-run it with the
event range `6..11`. (If this is needed again, move it into a script rather than pasting SQL.)

## 2. Components and cohorts, directly

```bash
npx tsx --env-file=.env.local scripts/component-residuals.ts 2026-27 11 --cohort
npx tsx --env-file=.env.local scripts/component-residuals.ts 2026-27 8-11
```

The first is GW11 alone with the played / no-show split; its pooled line must equal the SQL above. The second is the
v1.7.0 pool (GW8–11, expect n≈2,680). Record, per component, predicted / realised: **goals, assists, clean sheet**
(the DSI-221 watch), and defensive contribution and appearance (the Sprint 43 targets).

## 3. Integrity (the Sprint 43 deploy checks)

On the live `player_predictions`: `model_version` all `v1.7.0`; `appearance_probability` non-null, in 0–1, never
below `start_probability`; keeper expected minutes 89.9–90.1 per club fixture and outfield 899.8–900.2; start sums
1.00 and 10.00; `squad_consistency_violations` 0 on the latest `generate-predictions` runs (`sync_runs.details`);
`prediction_models.params` equals local `MODEL_PARAMS` key for key. Queries are in [gw10-check-in.md](gw10-check-in.md) §7
(`team_id`, not `team`, on `players`).

## 4. What to record, and how to read it

- **Report the run the same way whether or not it is good.** One gameweek carries no accuracy claim.
- **Bias.** v1.7.0's weeks so far: +0.084, +0.020, +0.067. Note which side GW11 lands, and the realised-vs-predicted
  mean level, since a low- or high-scoring week moves bias without the model changing.
- **Last-5, arms A and B.** Record who won MAE and r in each. To date: A, last-5 won MAE in 4 of 5 weeks and the model
  r in 3 of 5; B, the model won MAE in every week.
- **DSI-221 watch (goals/assists over, clean sheet under).** Add GW11 to the table of weekly gaps. Do not act.
  The decision is at GW14 (section 6).
- **Do not** tune a coefficient, refit `positionCalibration`, or reintroduce a multiplier off one week.
- **Do not** re-run the full DSI-186 gate or the blend/FDR sweeps; they were run 2026-11-09 and need weeks, not one.
  `scripts/backtest-walkforward.ts` is only re-run if section 5 triggers.

## 5. Triggers that would change the plan

| If | Then |
|---|---|
| A deploy changed `model_version` | Treat GW11 as that version's first row; compare to its own replay. |
| \|bias\| > 0.25 or MAE > 1.40 on GW11 | Check coverage first (a half-synced gameweek reads as phantom blanks, [gw5-check-in.md](gw5-check-in.md)), then FDR level and the cohort split. Still no tuning. |
| An integrity check fails | That is the finding. Diagnose before anything else; `generate-predictions` is the suspect. |
| GW11 ran short of fixtures (postponements) | Say so, as the scoreboard does ("GW11, 8 of 10 fixtures"). |

## 6. Dated follow-ups (not part of this read)

- **~2026-12-08 (GW14 scored): DSI-221 re-read.** `component-residuals.ts 2026-27 8-14 --cohort`, and the harness's
  component table. Act only if the same-sign goals/assists gap persists pooled and on the harness; fix the rate at
  source, gate on the walk-forward harness (MAE, r, |bias|, four seasons), no scalar.
- **DSI-186** stays Backlog; a re-run is worth doing only if the no-show or goalkeeper finding is addressed first.

## 7. Deliverables

1. `docs/sprints/gw11-check-in.md`, in the shape of [gw9-check-in.md](gw9-check-in.md): scoreboard GW8–11, last-5
   arms, components and cohorts, integrity, "Not done".
2. `docs/roadmap.md` "Next up" paragraph and the non-sprint work-items line; `docs/linear.md` check-in row.
3. Wiki ingest (`/wiki-ingest`): a short "GW11" subsection in `docs/wiki/xp-model.md`, log line, timeline row only if
   something changed.
4. **Propose, do not write, any Linear change** (DSI-221 comment, anything closed). Commit and push only on request.
