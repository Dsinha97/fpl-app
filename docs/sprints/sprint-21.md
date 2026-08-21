# Sprint 21 — Squad-view fix, Leagues, FDR sorting, League table

**Built** 2026-08-21. Four fixes/additions that surfaced from using the app against a rival
tool (app.fplweekly.com) on GW1 deadline day.

## 1. `/team`'s "Current squad" pitch was silently dropping players

The pitch rendered 13 of 15 players with no error. Root cause: `TeamState.startingXI`/
`benchOrder` can drift out of sync with `state.players` — **no mutation in
`lib/team-state.ts` maintained them**. `addPlayer` only appended to `players`; `removePlayer`
only filtered `players` plus the armbands. Neither touched the XI/bench split.

This was a known failure mode, patched locally twice before but never fixed at the source:
`lib/squad-budget.ts` already carried a comment ("`startingXI`/`benchOrder` can go stale
relative to `players` after a transfer... one real draft's `benchOrder` referenced a playerId
no longer in `players` at all") and its own `isValidSplit` guard; `/deadline` carried a
separate inline consistency check. `/team` only checked `startingXI.length === 11` — which
*passes* on a stale id, since the array is the right length, just wrong content.

The owner's real "DS United" draft was corrupt: `startingXI` referenced Muharemović (334, not
in the 15-man squad) and player 496 appeared in **both** `startingXI` and `benchOrder`;
`benchOrder` referenced Alysson (52, also not in the squad); Groß (124) and Rodon (329) sat in
`players` placed nowhere. `PitchView` does `layout.starters.map(id => byId.get(id)!).filter
(Boolean)`, so the mismatch silently dropped rather than erroring.

**Fix:**
- `lib/team-state.ts` gained `hasConsistentLineup(state)` — the one implementation of "does
  startingXI/benchOrder exactly reconstitute players", replacing the two divergent local
  copies in `lib/squad-budget.ts` and `app/deadline/page.tsx`.
- `addPlayer` now appends a new pick to `benchOrder` when a lineup is already set (never when
  one isn't — an empty pair means "let the optimiser decide" and must stay that way).
  `removePlayer` filters the id out of `startingXI`/`benchOrder` too, and clears both arrays
  entirely if the removal breaks the 11/N split — a 10-man "XI" is worse than no XI, and every
  consumer already has a documented fallback for "none set".
- `lib/drafts.ts`'s `readAll()` sanitizes every draft it reads: `hasConsistentLineup(d) ? d :
  { ...d, startingXI: [], benchOrder: [] }`. Read-only, data-preserving (only the XI/bench
  assignment clears, no player is dropped), and heals the corrupt local draft — and anything
  pulled down from `team_drafts` via `lib/draft-sync.ts`, which reads through the same
  `listDrafts()` — the next time either is read, with no migration needed.
- `app/team/page.tsx` dropped the "Current squad" mode entirely (the radio toggle,
  `currentSquad`/`currentCards`/`currentLayout`/`currentBudget`, and the whole
  `importedDraft`-resolution effect that only fed it). "Squad view" now shows only real
  published picks, which FPL always publishes as an already-consistent XI/bench — the failure
  mode this sprint fixes can't recur there.

Verified with an offline harness against the real "DS United" payload before touching any UI:
`hasConsistentLineup` correctly returns `false` on it, and `addPlayer`/`removePlayer`
round-trips on a clean draft keep `startingXI ∪ benchOrder === players` at every step.

## 2. Leagues on `/team`

The owner's 13 classic leagues were already sitting in `managers.raw->'leagues'->'classic'` —
fetched by `sync-manager` on every sync, never surfaced. No new FPL endpoint needed.

- New table `manager_leagues` (migration `20260821165100_sprint21_manager_leagues.sql`),
  public-read/service-write like every other `manager_*` table — this is public FPL data
  about league membership, not owner-scoped, so it doesn't use the `auth.uid()` shape
  `manager_rivals` uses.
- `sync-manager` writes `entry.leagues.classic` into it alongside the existing `managers`
  upsert — same payload already fetched, no second FPL call. `_shared/fpl.ts`'s `Entry`
  interface gained a typed `leagues` field.
- **Two groups, from FPL's own `league_type` field** — `x` (invitational) and `s` (system:
  general leagues FPL creates itself, like Overall/Gameweek 1/country, *and* broadcaster
  tie-ins). FPL exposes no finer split; a three-way Broadcaster/Invitational/General split
  (matching some third-party tools) would require a hardcoded id list — NBC Sports (431163)
  and Adobe Express (431170) are ordinary system leagues with no API flag distinguishing them
  from Overall or Gameweek 1. Rejected in favour of the honest two-way split.
- Every `entry_rank`/`rank_count` reads `0`/`null` pre-season (verified live, same
  zeroed-until-GW1 pattern CLAUDE.md documents for team strength) — rendered as "—" with a
  one-line note, not a fake `#0`.
- `components/manager-leagues.tsx` renders the two groups; `/team` fetches once per connected
  entry via a small `manager_leagues` query.
- **Standings drill-in is out of scope**, by the owner's choice: Sprint 10 probed
  `/leagues-classic/{id}/standings/` on 2026-08-03 and got an empty array pre-season — building
  it now would mean building against a still-empty endpoint. Revisit after GW1 is scored.

Backfilled live: 13/13 leagues written for entry 274486 on the first `sync-manager`
invocation after deploy — 6 invitational (`x`), 7 general/broadcaster (`s`).

## 3. FDR matrix — search and sort

`components/fdr-matrix.tsx` gained a team search box (name/short-name substring) and a sort
control: Table position · Team A–Z · Easiest run · Hardest run. Default stays easiest-first
(unchanged behaviour). The easiest/hardest labels now read against the *selected* window
("Easiest 8-GW run" when the 8-GW window is active) rather than a hardcoded "next 5", which had
drifted out of sync with the window control that already existed.

**Table position is disabled pre-season** — every `teams.position` reads `0` until GW1 is
scored, so sorting by it would just be "sorted by zero, tie-broken arbitrarily." The option is
present but disabled with a "(not published yet)" suffix, rather than silently sorting by a
column of zeros.

The fixture → per-team-per-gameweek cell mapping was extracted out of `FdrMatrix`'s `useMemo`
into `lib/fdr.ts` (`fixtureCellsByTeam`, `averageFdr`) so the new League Table tab (below) uses
the exact same blanks/doubles handling rather than a second copy.

## 4. Premier League table — new `/fixtures` tab

New `components/league-table.tsx`, rendered from a fourth "Table" tab alongside
Schedule/FDR/Clubs. Columns: `#`, team (crest + name), P/W/D/L/Pts/Form, then next-5 fixture
chips using the same `FixtureCell` component the FDR tab uses (via the same
`fixtureCellsByTeam` extraction).

**Pre-season disclosure banner**: when every row has `played === 0` (true today, verified
live), the table states plainly that GW1 hasn't been scored and FPL has published no
standings, and falls back to alphabetical order instead of a meaningless `position` sort. The
wide table scrolls inside its own `overflow-x-auto` container — confirmed no page-level
horizontal scroll at 375px width.

## Verification

- Offline `npx tsx` harness against the real corrupt "DS United" payload — `hasConsistentLineup`
  and the `addPlayer`/`removePlayer` invariant, before any UI change. Kept out of the commit.
- `verify-rls` on `manager_leagues` — both `anon` and `authenticated`, select allowed, writes
  refused, inside a rolled-back transaction.
- Live `sync-manager` invocation for entry 274486 confirmed the 13/6/7 league split.
- Browser: `/team` (squad view shows only the real-picks empty state, no dropped-player pitch,
  leagues section renders both groups with "—" ranks) and `/fixtures` (search filters rows,
  each sort order reorders correctly, Table position disabled with its note, the Table tab
  renders 20 rows with next-5 chips and the pre-season banner) — desktop/light and
  mobile/dark, no console errors beyond pre-existing dev-server HMR noise, no horizontal
  overflow.
- `ship-check` (tsc, lint, build) — all three pass.

## Explicitly not in scope

- League standings drill-in (deferred to after GW1 is scored).
- Any re-derivation of FDR itself — still FPL's own difficulty rating; team strength stays
  zero pre-season.
