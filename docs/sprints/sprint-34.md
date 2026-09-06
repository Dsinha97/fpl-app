# Sprint 34 — Post-GW3: accuracy scoreboard, 2026-27 in the model, Sprint 32 deploys

**Built 2026-09-06**, the evening GW3's last fixture finished. Prompted by a single question —
"GW3 is over, what can we do next, and can we get 2026-27 into the xP model?" — which turned out
to have three separable answers.

## 0. What GW3 finishing actually changed

Checked live rather than assumed:

| | Before (2026-09-03) | After GW3 |
|---|---|---|
| `player_prediction_archive` | GW2, GW3 | unchanged |
| `player_gameweek_stats` (2026-27) | GW1, GW2 | GW1, GW2, **GW3** |
| Usable intersection | GW2 alone, n=1 | **GW2 + GW3, n=2** |

`roadmap.md`'s Blocked table named the bar exactly — ≥2 gameweeks both archived *and* scored — so
the accuracy scoreboard unblocked on its own stated condition, with no judgement call.

One nuance worth recording: at the time of the build all ten GW3 fixtures were
`finished_provisional = true` but `finished = false` — bonus calculated, not confirmed. The panel
says so rather than presenting the residuals as final.

## 1. The accuracy scoreboard (`/settings` → Pipeline)

`lib/prediction-accuracy.ts` shipped in Sprint 27 with **zero callers**, deliberately. This is the
caller: `components/accuracy-scoreboard.tsx`, rendered by `PipelineStatus` under "Warehouse
contents", on the tab that is the deliberate exception to `/settings`' sign-in wall.

**A real bug fixed first, which would have made the panel wrong from its first render.**
`loadArchivedEvents` did a single unpaged `.select("event")` on `player_prediction_archive`. That
table holds ~640 rows *per gameweek* and stood at 1,285 — past the API's hard 1000-row cap
(CLAUDE.md's own gotcha), so it would have reported **GW2 only** and quietly halved the sample
while looking healthy. Replaced with a distinct-event walk
(`.gt("event", last).order("event").limit(1)`), which costs one single-row round trip per event
rather than reading ~24,000 rows by season's end to learn 38 integers. `loadPositionByCode` was
added alongside it so the ~700-row `players` read is paged in the same place rather than in the
component.

**What it reports** (verified in the browser against the same figures computed independently in
SQL — n=1272, bias −0.248, MAE 1.392, r 0.460, and every per-position row matching):

| Cohort | n | bias | MAE | RMSE | r |
|---|---|---|---|---|---|
| All players | 1,272 | −0.248 | 1.392 | 2.190 | 0.460 |
| GKP | 139 | −0.541 | 1.210 | 1.798 | 0.515 |
| DEF | 420 | −0.185 | 1.631 | 2.426 | 0.368 |
| MID | 562 | −0.213 | 1.309 | 2.143 | 0.500 |
| FWD | 151 | −0.282 | 1.208 | 1.987 | 0.532 |

That `events` renders as **GW2, GW3** is itself the proof the cap fix works — unfixed, it reads
GW2 alone.

Per CLAUDE.md's "say what the number means", the panel states the scored gameweeks, the residual
count, and the bias **direction in words** next to every signed figure; carries
`ACCURACY_MODEL_NOTE` through `InfoTooltip`; names GW3's bonus as provisional; and says GW1 is
permanently absent because the archive did not exist before its deadline. It is framed as a
running count, not a verdict.

**A sign-convention bug in the docs, found while writing that.** `accuracyStats` (`lib/stats.ts`)
is `mean(actual − predicted)`, so **negative bias means the model over-predicts**.
`phase-4-model.md` stated it both ways: §2 reads "−0.485 … under-predicted by 0.49" (that section
predates the shared helper and uses `predicted − actual`), while the walk-forward section calls
−0.375 "over-generous" and then, three paragraphs later, says the same negative biases mean the
arms "under-predict". The code was never ambiguous. Corrected, with the convention now stated
once where the walk-forward tables begin.

## 2. 2026-27 in the xP model — measured, does not clear the gate, not shipped

Two changes to `scripts/backtest-walkforward.ts` and one to `_shared/xp-model.ts`. Full measured
tables and reasoning: [phase-4-model.md](../phase-4-model.md#honest-limitations) ("Attempt 3").

- **2026-27 added as a fourth walk-forward target**, and reported as the weak season it is rather
  than averaged in silently: the last-5 baseline cannot fire below six played gameweeks, so it now
  prints `n=0 — not enough played gameweeks yet` instead of a line of `NaN`; the blend arm has
  events 2 and 3 only (n=468 vs 703 prior-only).
- **`ShrinkInput.currentSeasonScope`** (`"all" | "minutes"`, defaulting to `"all"` so every
  existing caller and every earlier sweep is untouched). `"minutes"` lets the current season move
  `mpg`/`start_share` and holds the per-90 scoring rates at prior-only — on the reasoning that the
  full blend fails on *bias*, bias is a level error, and level is set far more by expected minutes
  than by a per-90 rate, while playing time is also the one thing a prior season genuinely cannot
  know.

**Verdict: `scope=all` clears 2 of 4 seasons; `scope=minutes` clears 3 of 4. Neither ships.** The
narrow hypothesis survives — it fixes exactly the season the full blend breaks (2023-24, bias
−0.040 → −0.114 blending rates, → +0.002 blending minutes only) — and fails only on 2026-27, where
prior-only already over-predicts by 0.719 and every blend arm makes it worse. Re-run once 2026-27
has 8–10 scored gameweeks, which is also when the last-5 baseline starts producing rows for it.

**Not done, deliberately: the `positionCalibration` refit.** Three gameweeks is far too thin — the
shipped factors were fitted on a 209-player full-season cohort, and refitting on ~1,200
player-fixtures would bake this season's noise into a permanent constant. The +0.248 production
over-prediction measured in §1 is partly those factors being wrong for 2026-27; worth recording,
not worth acting on before ~GW10-12.

### The harness finding that matters more than the sweep

**`phase-4-model.md`'s published walk-forward tables are no longer reproducible, and the cause is
the harness, not the model.** A copy of the *unmodified* HEAD script run on today's data
reproduces this pass's `scope=all` and prior-only arms **digit for digit** — so the refactor is
equivalent — but both differ from what was published on 2026-08-30 (2023-24 prior-only bias +0.079
then, −0.040 now; 2024-25 −0.329 then, −0.488 now; 2025-26 barely moved). 2023-24's *verdict*
flipped with it: the full blend was recorded as clearing that season and now does not.

The mechanism is `fetchAll("players", "id,code,element_type")` (line 133) — **no season filter**,
against a table that only ever holds the current season's roster. Every historical season's cohort
is filtered through today's Premier League squad list, so a player who has since left the league
is dropped from seasons he actually played. Recorded and spun out rather than patched inside the
pass that found it.

## 3. Sprint 32's remaining deploys — the blocker was smaller than recorded

sprint-32.md §5b attributed the stall to the MCP integration retyping ~300 KB of function source
by hand, which is correct, and concluded the deploy was the owner's to run. Checked: the Supabase
CLI is installed locally (2.116.0) and the *only* owner-interactive step is `supabase login` —
everything after it is non-interactive.

Two wrinkles worth recording for next time:

- `npx supabase login` fails from PowerShell with a `PSSecurityException` on the `npx.ps1` shim
  (execution policy). `npx.cmd supabase login` bypasses it; so does Git Bash.
- The automatic login flow cannot run from a non-TTY environment at all
  (`LegacyLoginMissingTokenError`), so it has to be the owner's terminal regardless.

Once logged in, `npx supabase projects list` confirms the session and `FPL-App`
(`fyxyqxpscmqjyjxsyhms`, ACTIVE_HEALTHY). The deploys themselves were blocked by the agent
harness's own permission classifier — a production deploy to a live project — so they remain an
owner command, but a one-line one rather than a workflow.

**`verify_jwt` left exactly as found**, on purpose. `config.toml` records `false` for `sync-news`
and `generate-predictions` and `true` for the other eight, and its own header says that posture is
a record of past deploys rather than a decision, flagging that "someone should decide
deliberately". A CLI deploy *applies* the file, so deploying as-found changes nothing about the
gateway posture — which keeps that decision out of an ordered deploy whose failure mode is silent
401s on every cron job. It stays open.

## Verification

- **Scoreboard:** dev server via the preview tools, `/settings?tab=status`, signed out (confirming
  the tab is still public). Panel figures cross-checked against an independent SQL computation of
  the same join; `events` renders `[2, 3]`, proving the cap fix. Dark theme checked.
- **Model:** `npx tsx scripts/backtest-walkforward.ts` against live data, per CLAUDE.md. The
  equivalence check above (unmodified HEAD script vs. refactor, digit for digit) is what
  establishes the refactor didn't move anything; the four-season table is the result.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Out of scope

The results-derived FDR (Phase 3 of the plan) — its one prerequisite was checked and corrected
here: `fixtures` holds **only 2026-27**, so `deriveStandingsFromFixtures` cannot be walked over
past seasons at all and the backtest must reconstruct scorelines from `player_gameweek_stats`
(`team_h_score`/`team_a_score`/`opponent_team`/`was_home`, four seasons). FPL reassigns team ids
alphabetically each season, so the rating must be computed within a season — which is all a
rolling in-season FDR needs.
