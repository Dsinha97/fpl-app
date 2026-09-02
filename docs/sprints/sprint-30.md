# Sprint 30 — xP form-blend attempt 2, plus a real-money accounting bug found using the shipped build

Built 2026-08-30/09-02. Two unrelated threads: the roadmap's "attempt 2" on
blending current-season form into the xP model (planned, scoped
2026-08-29), and a chain of defects in how the app tracks a real imported
squad's money — found, fixed, and then found to run deeper, all inside the
same owner session.

---

## 0. xP comparison layer: restore the form term (`/compare`)

`lib/scoring.ts`, `app/compare/page.tsx`.

`docs/roadmap.md`'s "attempt 2" was scoped in two steps. Step 1: fix the
expired premise in `COMPARISON_WEIGHTS`, which dropped FPL's `form` term
and renormalised over 0.90 on the grounds that FPL zeroes `form` between
seasons — true pre-season, expired the moment GW1 was scored.

`ScoredPlayer` gained an optional `form?: number | null` field, following
the existing pattern of `reliability`/`priorWeight` being optional so every
other construction site (builder, chips, transfers, deadline, scenarios,
players, `lib/transfers.ts`) needs no change — `comparePlayers` is only
ever called from `/compare`. When `form` is present, `comparePlayers` uses
the plan's full five-term weighting (0.40 xP / 0.20 fixture / 0.15 value /
0.15 minutes / 0.10 form, normalised against the compared group's own max,
same as xP and value); every other caller keeps the renormalised four-term
weights unchanged. `/compare` already fetched `players.form` for its own
informational column (added when form read zero for everyone) — populated
the new field from that same query, and refreshed the column's hint text,
which still said form "reads 0 for everyone pre-season."

Verified live: comparing Haaland vs. Palmer, Form showed 7.5 vs. 10.0 and
folded into each player's score with the note rendering the new text.

## 1. Current-season blend, attempt 2: per-position bias correction

`scripts/backtest-walkforward.ts`, `docs/phase-4-model.md`.

Step 2 of "attempt 2." The existing current-season blend (built and swept
2026-08-27, [phase-4-model.md](../phase-4-model.md#4-honest-limitations))
beats prior-only on MAE and Pearson r in every one of the three backtest
seasons at every weight tested, but fails the standing three-season gate on
bias alone — 2024-25's `|bias|` grows from 0.329 to 0.375–0.390. That
read like a fixable calibration offset rather than a broken feature, so a
per-position additive intercept was swept alongside `currentSeasonWeight`,
fit **leave-one-season-out**: each held-out season's correction is the mean
residual (`actual - pred`, per position) from the *other* two seasons'
blended arm only, never its own. Pearson r is invariant to an additive
shift, so this sweep can only move bias/MAE, never r — isolating exactly
the term the gate was failing on.

**Verdict: no weight clears the gate in all three seasons.** The
correction learned from 2024-25 and 2025-26 (both blend arms
under-predicting, strongly negative bias) is itself strongly negative per
position; applied to 2023-24 — whose blend arm was already near-zero or
slightly *over*-predicting (+0.015 to +0.079 depending on weight) — it
overshoots into a large positive bias (+0.46 to +0.51) instead of
correcting it:

| wCur | 2023-24 bias before → after | 2024-25 before → after | 2025-26 before → after |
|---|---|---|---|
| 0.3 | +0.042 → **+0.514 (fails)** | −0.359 → −0.035 (clears) | −0.539 → −0.360 (clears) |
| 0.6 | +0.016 → **+0.486 (fails)** | −0.375 → −0.050 (clears) | −0.523 → −0.325 (clears) |
| 1.0 | −0.013 → **+0.457 (fails)** | −0.390 → −0.063 (clears) | −0.510 → −0.293 (clears) |

This is itself a finding, not a tuning failure: bias direction and
magnitude aren't stable enough across seasons for one global per-position
constant to fix — whatever makes 2023-24 read differently from the other
two would need to be understood first. Per CLAUDE.md, the null result
stands as-is; the gate isn't narrowed (e.g. two-of-three) to let it
through. `MODEL_VERSION` stays `v1.5.0`; nothing wired into
`generate-predictions`. The sweep itself is kept permanently in
`scripts/backtest-walkforward.ts` (not scratch) — `npx tsx
scripts/backtest-walkforward.ts` reproduces both the blend sweep and this
correction sweep on every run.

## 2. Three defects filed from the shipped app

Filed by the owner from a live screenshot of `/builder`'s picker panel.

**Replacement finder ignored the price shift on sale.**
`replacementLegality` (`lib/scoring.ts`) computed what selling the outgoing
player frees up as `team.budget - totalSpend(squad) +
outgoing.purchasePrice` — his original **purchase** price, not his **sell**
price. FPL's profit-on-sale rule (`sellPrice`, `lib/transfers.ts`, the
app's one implementation of it) was being skipped entirely, so a candidate
above what the squad could actually afford could pass the ceiling once a
held player's price had moved (the reported case: replacing E.Le Fee,
5.9m, showed 6.0m candidates as affordable). Routed the ceiling through
`sellPrice`. `/builder`'s replace-picker had an independent duplicate of
the same wrong formula computing the slider ceiling — replaced with a
direct call to `replacementLegality(...).priceCeiling` instead of
recomputing it, removing the duplicate.

**Squad value — checked, not changed (this pass).**
`components/context-bar.tsx` already computed squad value via
`squadSellValue` (`lib/squad-budget.ts`), which sums `sellPrice(purchasePrice,
nowCost)` per player, not raw `now_cost` — the formula was already correct.
Flagged as needing a live check with the real signed-in squad rather than a
code change. (It wasn't: see §3 below — the bug was one level deeper, in
what `budget` itself held.)

**Builder table showed the xP-5 value regardless of the selected sort
metric.** The sort comparator (`app/builder/page.tsx`) already branched
correctly on the 8-way `sortKey` dropdown — sorting worked. The rendered
column header and cell value were hardcoded to `xpAt(xpOf(p.id), horizon)`
and never read `sortKey`, so switching to "Points" re-ordered the rows but
kept showing the xP figure. Added a `sortKey`-aware switch for both the
header label and the cell value (price → `£`, ownership → `%`,
points/goals/assists/minutes → raw integer, xp5/xp1 unchanged). Verified
live: switching to Points showed each player's real total (25, 22, 20…)
with the header reading "POINTS"; switching to Ownership showed percentages
with the header reading "OWNED."

### Verification

`npx tsc --noEmit`, `npm run lint` (0 errors, pre-existing warning count
unchanged), `npm run build` all clean. `/builder` and `/compare` driven
live in the preview browser — the sort-column fix and the form-blend score
were both confirmed against rendered output, not just typechecked.

---

## 3. The real bug: `Bank` and the price-shift fix were both symptoms of a units mismatch

The owner re-imported their real squad after §2 shipped and the "squad
value already correct" conclusion turned out to be wrong live: Value read
£100.1m and Bank read £0.1m on a squad with `£0.0m` bank per FPL. Tracing
it surfaced a chain of three related defects, fixed as three separate
commits before the real root cause (§4) was found.

**`Bank`/affordability mixed a sell-value-basis total against a
purchase-price-basis sum.** For an imported squad, `TeamState.budget` was
set to *(real sell value + real bank) at sync time* — but both
`components/context-bar.tsx`'s Bank figure and `replacementLegality`'s
affordability ceiling (the same function fixed in §2, still not far enough)
computed `budget - totalSpend(squad)`, where `totalSpend` sums raw
**purchase price**. Whenever any held player had a real gain or loss since
purchase, that unit mismatch leaked the sum of every OTHER held player's
unrealised gain/loss into "spendable money" — exactly why the replace panel
kept showing a phantom £0.1m left even on an even-value trade. Both fixed
to subtract the live-recomputed **sell value** (`squadSellValue`) instead
of `totalSpend`.

**FPL's own `transfers.value` field disagreed with the real per-player
selling prices.** Verified against the owner's actual pasted my-team JSON:
`transfers.value` read 1001 (tenths) while every one of the 15 picks had
`purchase_price == selling_price` — no gain or loss anywhere in the squad
to explain a gap — and summing the 15 `selling_price` values by hand gave
999. FPL's aggregate field was simply wrong for that payload; each pick's
own `selling_price` is what FPL will actually credit on a sale, and this
file already treats it as ground truth (the existing `sellPriceMismatches`
cross-check). `teamStateFromMyTeamJson` (`lib/fpl-squad.ts`) now sums
`picks[].selling_price` directly for budget instead of trusting
`transfers.value`. Verified in a throwaway harness against the real pasted
squad: budget now comes out to exactly 999 (£99.9m), matching the hand
sum.

**`validateSquad`'s over-budget check had the same units mismatch, plus
`freeTransfers` was reading `limit` instead of `limit − made`.**
`validateSquad` (`lib/team-state.ts`) summed raw `purchasePrice` against
the same sell-value-basis `budget` — a held player who'd dropped in price
(the reported case: E.Le Fee) wasn't having that real loss counted, so the
budget bar could read over even on a legal squad. Fixed to sum real sell
value (`sellPrice(purchasePrice, nowCost)`) per pick via the `lookup` it
already receives, falling back to purchase price only when live price data
isn't available. Separately, `teamStateFromMyTeamJson`'s `freeTransfers`
used `transfers.limit` on its own, ignoring `transfers.made` — a transfer
already used this gameweek was still counted as free. Now `limit - made`,
clamped at 0 — verified against the real payload (`limit=2, made=1` → 1,
not 2).

### Verification

`npx tsc --noEmit`, `npm run lint`, `npm run build` clean after each of the
three commits. The selling-price and free-transfer fixes were each
verified in a throwaway `npx tsx` harness against the owner's real pasted
my-team JSON (kept out of the commits, per CLAUDE.md's harness rule) before
being trusted; the `validateSquad`/Bank fixes were typechecked, built, and
smoke-tested live in the preview browser (no console errors, no crash from
the new `lib/team-state.ts → lib/transfers.ts` import edge) rather than
reproduced pixel-for-pixel, since the specific numbers live in the owner's
own browser localStorage, not a database this session can query.

## 4. Bank becomes the stored primitive, not a derived residual

`lib/squad-budget.ts`, `lib/team-state.ts`, `lib/scoring.ts`,
`lib/transfers.ts`, `lib/transfer-path.ts`, `components/context-bar.tsx`,
`app/builder/page.tsx`, `lib/fpl-squad.ts`, `CLAUDE.md`. Commit `461a455`.

§3's three fixes each patched a call site to subtract sell value instead of
purchase-price sum — better, but still deriving "how much cash is left"
from a **frozen** `budget` total that never moves. That derivation is
invariant under a transfer (selling frees exactly what the replacement
costs against it) but **not** under an ordinary price change: when a held
player's price rises, his sell value rises but the frozen total doesn't,
so the difference comes out of the derived bank — a *per-player* price
move charged to the *team's* cash. Real symptom, on a legal 15-player
squad: Bank reading `£-0.1m` and a red over-budget bar. A price fall did
the mirror thing and credited cash that doesn't exist.

The actual fix: **`TeamState.bank` is now the stored primitive**; total
budget is derived (`bank + squadSellValue`), never the other way round.
Cash only moves when the squad actually buys or sells — matching how FPL
itself behaves.

- `squadBank`/`bankFrom`/`teamBudget` (`lib/squad-budget.ts`) are the one
  implementation, replacing three copies that disagreed with each other:
  `budget - Σ purchasePrice` in `metricsFor` and the transfer path's
  funder sort, and `budget - Σ sellPrice` in `validateSquad`,
  `replacementLegality`, and the context bar (§3's fixes, superseded by
  this one).
- `addPlayer` debits the live price from bank; `removePlayer` now takes
  the outgoing player's live price and credits `sellPrice` (half of any
  rise), not what was originally paid. All four call sites (`app/builder`,
  `lib/transfer-path.ts`, `lib/transfers.ts`) pass it through.
- `teamStateFromMyTeamJson` stores FPL's own `transfers.bank` directly;
  `teamStateFromPicks` stores `last_deadline_bank` when FPL reports both
  halves.
- `budget` is still written on every new state and is still what
  `squadBank` falls back to, so a draft saved before this field existed
  keeps parsing and keeps the old drifting behaviour — that cash was never
  persisted and can't be recovered after the fact; such a draft needs one
  re-import to pick up a real stored bank.
- New CLAUDE.md ground rule ("Bank is stored cash, not a residual") records
  the failure mode so it isn't rediscovered.

### Verification

Verified in a throwaway `npx tsx` harness against real player rows before
shipping: a +£0.2m rise moved value (125.1 → 125.2) and total (126.6 →
126.7) with bank flat at 1.5 throughout; a −£0.2m fall dropped value and
total with bank still flat; a sale-plus-purchase moved bank by exactly
`sellPrice(out) - nowCost(in)`. The legacy derivation on the same squad
read 1.6 instead of the correct 1.5 — a live reproduction of the exact
class of bug reported. `tsc`, `lint`, `build` all clean.
