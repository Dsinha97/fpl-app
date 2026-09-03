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

**Flipping the repo to public remains the owner's action.** This sprint settled
the blockers, not the switch. The hardening runbook below is the other half.

### Branch-protection runbook (written 2026-09-03, not yet applied)

roadmap.md enumerated the intent; these are the concrete steps. **Order
matters** — apply the ruleset *before* flipping to public, so there is no window
where the repo is public and `main` is unprotected.

**Status: steps 1–2 applied 2026-09-03. Steps 3–4 are refused by GitHub while
the repo is private and must run *after* the flip** — not a preference, an API
error each way:

```
GET  /repos/…/actions/permissions/fork-pr-contributor-approval
  422  "Fork PR approval is not allowed for private repositories."
PATCH /repos/…  security_and_analysis[secret_scanning][status]=enabled
  422  "Secret scanning is not available for this repository."
```

So the real sequence is **1 → 2 → flip → 3 → 4 → re-verify**, not the 1–5 the
first draft of this runbook implied. The window that ordering was written to
avoid does not open: the ruleset is live before the repo is visible.

Two facts to settle first, because they change what you click:

- **`ci.yml` already runs on PRs.** It triggers on `pull_request: branches:
  [main]` and runs lint → `tsc --noEmit` → `npm run build`. Verified on
  [PR #1](https://github.com/Dsinha97/fpl-app/pull/1) (green, 1m24s). What is
  missing is only that the check is not *required* — it reports, it does not
  block. The status-check name to require is **`build`** (the job id), not
  "CI" (the workflow name).
- **A solo owner cannot approve their own PR.** GitHub does not count the PR
  author as a reviewer, so "Required approvals: 1" on a one-person repo means
  *nothing can ever merge* except by bypass — which defeats the no-bypass rule
  it is paired with. This is the one place the roadmap's original sketch does
  not survive contact. Resolution below.

**Step 1 — `.github/CODEOWNERS`. Done** (this sprint): `* @Dsinha97`, with the
reasoning in the file's own header.

Note what this does and does not buy on a solo repo. It makes ownership
explicit and auto-requests review from the owner on any PR, including one from
an outside contributor's fork — that much works today. But "Require review from
Code Owners" is subject to the same self-approval problem as any approval rule,
so the *rule* stays off. The file is added; the enforcement waits for a second
maintainer.

**Step 2 — the ruleset. Applied 2026-09-03** as ruleset `22227209`, via the
`gh api` call below. Verified: `GET /repos/…/rules/branches/main` returns
`["deletion", "non_fast_forward", "pull_request", "required_status_checks"]`,
and the ruleset reports `bypass_actors: []` with
`current_user_can_bypass: "never"`. PR #1 stayed `MERGEABLE`/`CLEAN` under it,
which is the check that matters — a ruleset that locks the owner out of their
own repo is the failure mode this design was written to avoid.

One thing GitHub adds on its own and it is worth knowing about:
`require_extra_approval_for_unattributed_changes: true` appears in the created
ruleset even though it was not in the payload. It did not block PR #1 —
confirmed against the live mergeable state, not assumed — but it is the rule
most likely to bite later, since this repo's commits are authored as
`Dsinha-altiora <deepayan@altiorasystems.com>` rather than the `Dsinha97`
account that owns it.

To create it by hand instead: Settings → Rules → Rulesets → New ruleset → New
branch ruleset.

- **Name:** `main protection`
- **Enforcement status:** Active
- **Bypass list:** *empty.* This is the "no administrator bypass" requirement,
  and it is the whole point — a rule an admin can wave through is documentation,
  not a control. Note the consequence: you will push to `main` only through a
  PR, exactly as this sprint did.
- **Target branches:** Add target → Include default branch.
- **Rules to enable:**
  - **Restrict deletions** — `main` cannot be deleted.
  - **Block force pushes** — history cannot be rewritten.
  - **Require a pull request before merging** — with **Required approvals: 0**.
    Zero is deliberate, not a weakening: the PR requirement itself is what
    forces the diff through CI and leaves a reviewable record, and a non-zero
    count on a one-person repo is unsatisfiable (see above). Raise it to 1 and
    enable "Dismiss stale pull request approvals when new commits are pushed"
    and "Require review from Code Owners" the moment a second maintainer
    exists — that is the trigger, not a date.
  - **Require status checks to pass** — add **`build`**, and enable **Require
    branches to be up to date before merging**. Cloudflare's own
    `Workers Builds: fpl-app` check also reports on PRs; requiring it too is
    reasonable but couples merges to a third party's availability, so it is a
    judgement call rather than a default.
  - **Restrict creations** is listed in roadmap.md but does **not** belong on a
    ruleset targeting only the default branch — it governs creating branches
    matching the target pattern, and `main` already exists. Skip it, or give it
    its own ruleset targeting a `release/*`-style pattern if that ever matters.

Equivalent as one API call, if the UI is tedious:

```bash
gh api repos/Dsinha97/fpl-app/rulesets --method POST --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      } },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [ { "context": "build" } ]
      } }
  ]
}
JSON
```

**Step 3 — fork-PR workflow approval.** Settings → Actions → General → Fork
pull request workflows from outside collaborators → **Require approval for all
external contributors**. This is not cosmetic: `ci.yml`'s build step reads
`secrets.NEXT_PUBLIC_SUPABASE_URL` and
`secrets.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, so an unapproved fork PR would
otherwise get a workflow run with those in its environment. Both are public
values, but the principle stands and the next secret added might not be.

**Step 4 — secret scanning + push protection.** Settings → Code security →
enable **Secret scanning** and **Push protection**. Worth knowing: these are
free on *public* repos, so this step becomes available at the moment of the
flip rather than before it. The Sprint 31 sweep found no JWTs, `sk-` keys, PEM
blocks or `password =` anywhere in tracked files; push protection is what keeps
that true going forward.

**Step 5 — flip to public**, then re-verify: open a throwaway PR and confirm it
cannot merge with a failing `build`, and that a direct push to `main` is
rejected.

### The flip has an unsettled blocker: history (found 2026-09-03)

**§5's items 1 and 3 above are working-tree fixes only, and publishing exposes
git history.** Confirmed by `git log`:

- The FootyStats CSV blob is reachable in `9d4fe99` ("Sprint 15.6: Championship
  cold-start priors") — `git rm --cached` untracked it going forward, it did
  not unpublish it.
- The owner's email is reachable in `cfc5c17` ("Measure and fix real latency").

So the redaction and the untracking each fix what a *fresh clone's working tree*
contains and what gets added from here on — real, and worth having — but
neither changes what someone can recover from a public clone's history. Both
pre-flight items were written and closed against the wrong scope, this one
included. The sweep that found "no JWTs, no `sk-` keys, no PEM blocks" also ran
against tracked files, not history, so its clean result carries the same
caveat.

Three ways out, none free:

1. **Accept.** A 58-row derived CSV and one email address are low-stakes, and
   the working-tree fixes still mean nothing new accumulates. Cheapest, and
   defensible — but it means saying plainly that the pre-flight's items 1 and 3
   are mitigations, not removals.
2. **Rewrite history** (`git filter-repo`) before publishing. Actually removes
   the blobs. Costs: every commit SHA changes, the open PR is invalidated, and
   the `non_fast_forward` rule just applied has to come off and go back on
   around the force-push. Do it before the flip or not at all.
3. **Publish a fresh repo** from a squashed or orphan history, keeping this one
   private as the full record. Clean disclosure boundary, loses the public
   commit history that is arguably the portfolio's point.

Unresolved at the time of writing. The flip is blocked on this decision, not on
steps 3–4.

## 6. A blocked row that stated the wrong condition

roadmap.md's accuracy-scoreboard row said the panel was waiting on "≥2 archived
gameweeks." That bar is now met and is still not enough. Checked live
2026-09-03: `player_prediction_archive` holds GW2 and GW3;
`player_gameweek_stats` for 2026-27 holds GW1 and GW2. The intersection —
gameweeks both archived *and* scored, which is what the scoreboard actually
needs — is **GW2 alone, n = 1**. The row now states the real condition. It
unblocks when GW3 is scored.
