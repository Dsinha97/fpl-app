# Sprint 31 — Chip awareness end to end, a display-only custom FDR, and the public-repo pre-flight

Built 2026-09-03. Triggered by a one-line report: the owner played Triple
Captain for GW3, pasted the fresh `my-team` JSON, and nothing in the app
acknowledged it. The parse turned out to be fine; everything downstream of it
was not. Three further items rode along, each re-checked against live data
rather than against what the docs claimed.

---

## 0. The bug behind the report

`teamStateFromMyTeamJson` (`lib/fpl-squad.ts`) already matched
`status_for_entry === "active"` and set `state.activeChip = "3xc"`. Three
separate failures sat downstream of that:

1. **Nothing rendered it.** Every consumer of `TeamState.activeChip` treated it
   as a validator input. `/deadline` passed it to `ChipPlanEditor` purely to
   reject a *plan* that contradicted it; `/transfers` and `/review` printed the
   raw slug `3xc` in user-facing sentences. Bench Boost was equally invisible.
   Only Wildcard and Free Hit surfaced at all, and only indirectly, as `FT ∞`
   in the ContextBar.
2. **The model ignored it.** `chipAt` (`lib/chip-plan.ts`) — the function whose
   own docstring states that FPL's fact beats the plan — had **zero callers**.
   `/deadline`'s `chipPlanUsable` came from `team.chipPlan` alone, so the "Chip
   call" card still offered Triple Captain as an unplayed option carrying a
   `+gain`, and `chipContext` never carried its bonus into the projection. The
   squad was being scored as if the captain were merely doubled.
3. **The chip had no gameweek of its own.** `played_by_entry` (`[3]` in the real
   payload) was declared on `MyTeamChip` and discarded; `chipAt` fell back to
   `state.gameweek`, stamped with whatever `nextEvent` was at import time. Once
   that deadline passed, the same saved draft would have claimed the chip was
   live in the *following* gameweek. Reproduced in the harness below.

## 1. `activeChipEvent`, and a chip proven twice over

`lib/team-state.ts`, `lib/fpl-squad.ts`, `lib/chip-plan.ts`.

`TeamState.activeChipEvent?: number | null` records the gameweek the active
chip belongs to. Optional in the same way `entryId` is — drafts saved before it
existed keep parsing and fall back to `gameweek`, which is exactly what they
were already doing. `sameSquadState` compares it normalised (`?? null`), or a
draft carrying `undefined` would read as dirty against a fresh import forever.

The more interesting half is how the chip is now established.
`picks[].multiplier` was declared on `MyTeamPick` and read nowhere, while the
`status_for_entry` comment openly admitted its active enum had never been
confirmed against a live example. The payload proves the chip twice: element
411 is `is_captain` with `multiplier: 3`. New `activeChipFromMyTeam` reads both
signals:

- **The picks' own arithmetic**, which cannot be wrong about itself — a captain
  carrying `multiplier: 3` is Triple Captain by definition; a bench where every
  pick carries `multiplier >= 1` rather than the usual 0 is Bench Boost by
  definition.
- **`chips[].status_for_entry === "active"`**, as before.

Agreement is `"confirmed"`. Where only one fires it is still trusted, but on
disagreement the arithmetic wins, because it is arithmetic. Wildcard and Free
Hit leave no multiplier trace at all — they change the squad, not the
multipliers — so they stay status-only, and the comment says so rather than
implying the cross-check covers all four chips. A payload claiming both
multiplier signatures at once is self-contradictory (FPL allows one chip per
gameweek) and falls back to the status enum rather than picking a winner.
Nothing is inferred from `is_pending`, so an unrecognised state still fails
closed.

The event comes from the matching chip's own `played_by_entry` (a history, so
the highest entry is the current play), falling back to the import's gameweek
when FPL reports none.

`chipAt` split into two: `fplActiveChipAt` is the fact half on its own, and
`chipAt` is that plus the plan. The split exists because a status badge must
not label an intention as something that has happened — and splitting was the
only way to have one implementation of the rule rather than two.

## 2. `chipEntriesInForce` — the fact reaches the numbers

New in `lib/chip-plan.ts`, and `chipAt`'s first caller in the codebase. It
merges FPL's fact into `validateChipPlan`'s `usable` output, synthesising a
`source: "fpl"` entry (a third `ChipPlanEntry["source"]` value, since nothing
reads `.source` today) for a chip already in play. `validateChipPlan` has
already rejected any plan entry conflicting with the active chip, so it cannot
double up.

The reasoning it encodes: a chip already in play is not a *choice* the optimiser
can still make, but it is very much a term in this gameweek's points. Leaving it
out is what made the projection quietly score a Triple Captain squad as if the
captain were only doubled.

`/deadline` wraps `chipPlanUsable` in it, so `chipContextFor`,
`planTransferPath`'s `plan` and `TransferPath`'s `hasChipPlan` all see it from
one change.

## 3. Surfacing it

- **`/deadline`** — an amber `TRIPLE CAPTAIN ACTIVE · GW3` pill beside the
  countdown, matching the existing Provisional marker rather than the green a
  recommendation would use: this is a fact about the squad, not advice.
- **"Chip call" card** — the chip in force shows an `ACTIVE` marker instead of a
  signed gain, with its value stated as already taken ("Already played this
  gameweek — worth +6.9 xP, and counted in the projection above"). A signed
  figure there reads as an offer. The other chip's card is untouched.
- **ContextBar** — a `Chip` field between Bank and FT, on every page. Uses
  `fplActiveChipAt`, never `chipAt`, for the same fact-not-intent reason.
- **`chipLabel`** — one fail-closed slug→label helper, replacing the raw `3xc`
  that `/transfers` and `/review` were printing in user-facing sentences.

Verified in the browser against a seeded copy of the real payload, both themes
and at mobile width: pill renders, ContextBar carries `Chip Triple Captain` on
`/deadline` and `/players`, the Chip call card marks Triple Captain ACTIVE while
Bench Boost keeps its `+4.4` recommendation.

### Harness (not committed)

An `npx tsx` run of the real modules against the real payload, per CLAUDE.md's
rule about verifying engine changes outside the UI:

```
activeChip: 3xc  activeChipEvent: 3  gameweek: 3
reading: { chip: '3xc', event: 3, evidence: 'confirmed' }
fplActiveChipAt(3): 3xc   (4): null
usable: [] -> inForce: [ { chip: '3xc', event: 3, source: 'fpl', … } ]
chipContextFor(3..5): {"excluded":[],"bonus":[{"event":3,"chip":"3xc"}]}
stale fallback (no activeChipEvent, gameweek 4) -> fplActiveChipAt(4): 3xc
multiplier-only: { chip: '3xc', event: 3, evidence: 'multipliers' }
status-only:     { chip: '3xc', event: 3, evidence: 'status' }
```

The `stale fallback` line is the bug `activeChipEvent` fixes, reproduced: with
the field absent and `gameweek` bumped to 4, the old rule reports GW3's chip as
live in GW4. With the field present it does not.

## 4. Custom FDR — built, shown, and deliberately kept out of the model

`lib/fdr.ts`, `components/fdr-matrix.tsx`, `components/fdr-badge.tsx`,
`components/league-table.tsx`, `app/fixtures/page.tsx`.

roadmap.md unblocked this on 2026-09-02 (`strength_overall_home`/`_away` became
populated for all 20 clubs), and the FDR matrix carried a note saying it "just
hasn't been built."

**It is display-only, and the reason is a data fact, not caution.** `teams`
holds one season's rows and `strength_overall_*` is a live snapshot with no
history — verified: 20 rows, season `2026-27`, and nothing else. So
`scripts/backtest-walkforward.ts` has nothing to walk forward over, and a
strength-based FDR **cannot be measured against the standing gate at all**.
`ScoredPlayer.fdrRun` feeds `fixtureScore` and `riskScore`'s `fixtureVariance`,
so swapping it would move ranked output on no evidence whatsoever — CLAUDE.md's
"an acceptance threshold you invented is not evidence", with the threshold
missing outright.

So: `strengthFdr` derives a fixture's difficulty from the opponent's own overall
strength *at the venue they are playing*, `FdrCell` gains a second optional
rating rather than having `fdr` replaced, and `/fixtures` gets an
Official/Strength toggle defaulting to Official. `averageFdr` takes the source
and skips unrated cells rather than substituting the official rating, so the two
scales never mix. `FixtureCell` gains an opt-in `unratedReason` so a missing
strength renders neutral instead of falling through `asRating` to a yellow
invented `3`; existing callers are unaffected.

Containment is checkable statically: every `fdrRun` writer in the codebase
(`app/builder`, `app/compare`, `app/deadline`, `app/players`, `app/scenarios`,
`app/transfers`, `lib/transfers`) reads `c.fdr`, and `strengthFdr` appears only
in `lib/fdr.ts` and the matrix component.

**Disclosed coarseness** (`STRENGTH_FDR_NOTE`, shown under the matrix in the
Strength view): measured live 2026-09-03, `strength_overall_home` takes only
{2, 3, 4} across all 20 clubs and `strength_overall_away` only {2, 3, 4, 5} —
three home tiers and four away, painted onto a five-step ramp. The ramp is finer
than its input, and the note says so.

**Not built, and worth recording as the honest next step:** a *results*-derived
FDR built on `deriveStandingsFromFixtures`, which reads real scorelines. That
one **is** backtestable against four seasons of `player_gameweek_stats` and is
the only path to a model-grade custom FDR. It is its own sprint.

Sanity-checked live: CRY away at FUL renders `Strength FDR 2 — Easy`, matching
FUL's `strength_overall_home` of 2.

## 5. Public-repo pre-flight

The three items roadmap.md scoped, each re-checked and now settled.

1. **PII — fixed.** `docs/sprints/latency.md` named the owner's email beside a
   `user_profiles` description; redacted to the manager ID, which is public by
   construction. A repo-wide sweep now returns no email addresses. Noted but not
   changed: `fpl-app.deepayansinha.workers.dev` appears in `sprint-25.md` and
   `wiki/deployment.md` — a public URL that happens to carry the owner's name.
2. **Hardcoded publishable key — consciously accepted, no migration.** The
   original header argued public-by-design, which holds for disclosure but not
   for abuse. The decision, recorded in the migration itself: moving it to Vault
   would be **theatre**, because the identical key already ships in the deployed
   browser bundle and is readable off fpldecision.com today regardless of who
   can read this repo. A Vault read would change nothing about who can call the
   endpoint while adding a failure mode where every scheduled sync silently
   401s. The real mitigation is `verify_jwt` or rate limiting on the Edge
   Functions — its own work, now on the roadmap rather than half-done here.
3. **FootyStats material — two files untracked.** Of the four files tracked
   under `docs/Promoted Team Data/`, only two are genuinely FootyStats-derived:
   `extracted/footystats_championship_2025_26.csv` (58 rows of transcribed
   per-player stats, each naming the FootyStats PDF it came from) and
   `extracted/insert.sql` (the same values as SQL). Both `git rm --cached`'d and
   added to `.gitignore`. `premier_league_new_players.csv` is plain roster fact
   (name / fpl_id / club / position) and `match_report.json` is this repo's own
   matching output; neither is FootyStats' to withhold, and both stay. Nothing
   about the shipped cold-start priors becomes unauditable — the data lives in
   `external_player_seasons`, and `championship-priors.md` documents the drop,
   the three-check gate it passed and the fitted λ per metric.

**Flipping the repo to public remains the owner's action**, along with the
branch-ruleset hardening roadmap.md already enumerates. This sprint settled the
blockers, not the switch.

## 6. A blocked row that stated the wrong condition

roadmap.md's accuracy-scoreboard row said the panel was waiting on "≥2 archived
gameweeks." That bar is now met and is still not enough. Checked live
2026-09-03: `player_prediction_archive` holds GW2 and GW3;
`player_gameweek_stats` for 2026-27 holds GW1 and GW2. The intersection —
gameweeks both archived *and* scored, which is what the scoreboard actually
needs — is **GW2 alone, n = 1**. The row now states the real condition. It
unblocks when GW3 is scored.
