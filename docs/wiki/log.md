# Log

One line per entry, most recent first.

- 2026-08-20 — Ingested `docs/sprints/rivals-and-card-density.md`: updated `manager-profile.md`
  (rivals sync-before-write, a no-career-record rival no longer dropped, the new This season /
  Career tab) and `design-system.md` (new "Packing, not just ranking" section under Card hierarchy,
  the new `CollapsibleCard` disclosure primitive and why it didn't absorb the two existing bespoke
  note-collapses); added a `roadmap.md` row, a `docs/README.md` row, and a `timeline.md` row. No new
  page.
- 2026-08-20 — Ingested `docs/sprints/sprint-19.md`: new page `design-system.md` (tokens, semantic
  colour, button/state vocabulary, the busy-state pattern, card hierarchy, disclosure) under
  Cross-cutting; updated `frontend-conventions.md`'s Theme section to point at it, added it to
  `index.md` and a row to `timeline.md` and `roadmap.md`'s sprint table.
- 2026-08-19 — Tidy fix: backfilled two `timeline.md` rows the prior ingest passes had missed
  (2026-08-15 squad view on Deadline Hub/My Team, 2026-08-16 chip strategy planning). No page
  content changed, just the chronological index.
- 2026-08-19 — Ingested `docs/sprints/sprint-18.md` + `docs/roadmap.md`: updated
  `lineup-captain-bench.md` (new "Bench cost" section — `squad-budget.ts`'s XI/bench split, the
  stale-`benchOrder` bug it caught, the 11-call-site `totalSpend` dedup), `chip-plan.md` (the
  opening-gameweek `chipBonus: 0` bug fix, the three calendar-derived chip-sequence presets, the
  `chip_definitions` two-rows-per-half collapse bug), `transfer-engine.md` (`Replacement.exitRoutes`,
  reported not ranked), `squad-score-and-scenarios.md` (cross-link to the new bench-cost section),
  `club-tactical-profiles.md` (the refused new-manager discount, and the empirical version now
  queued), `blocked-and-data-gaps.md` (fixed a cross-reference that pointed at the wrong page), and
  `timeline.md` (two new rows). No new page.
- 2026-08-19 — Ingested `docs/architecture.md` + `docs/phase-4-model.md` +
  `docs/sprints/sprint-17a.md`: updated `xp-model.md` (new "Out-of-sample validation" section — the
  walk-forward backtest finding that the model underperforms a naive baseline out-of-sample, and why
  recalibration wasn't done in the same pass) and `data-pipeline.md` (new `ingest-fpl-archive`
  function — cursored server-side backfill, the abandoned chat-relay approach, the 1000-row-cap and
  duplicate-row bugs it caught). No new page.
- 2026-08-16 — New feature: chip strategy planning. New page `chip-plan.md`; updated
  `chip-strategy.md` (the "valued against today's squad" gap this closes) and
  `transfer-engine.md` (chip-aware branches, revised "uncovered" list); added the
  `chip-plan.md` row to `index.md` and a row to `roadmap.md`'s sprint table.
- 2026-08-15 — Ingested `docs/roadmap.md` + `docs/sprints/additional-info.md`'s squad-view note:
  updated `deadline-and-matchday.md` (Deadline Hub's read-only pitch + import default, new My
  Team's Squad view section), `fpl-authentication.md` (import-naming consolidation, `entryId`),
  `frontend-conventions.md` (`resolveRequestedDraft`'s new preference, `lib/manager-picks.ts`,
  `PitchView`'s `SquadLayout` generalisation), `manager-profile.md` (back-link only). No new page.
- 2026-08-15 — Wiki created: moved 7 source specs + the API-Football PDF into `docs/sources/`,
  repaired 18 markdown links + 3 code/SQL comments, built 22 topic pages synthesising `docs/` and
  `CLAUDE.md`/`AGENTS.md`, added `index.md`/`log.md`/`AGENTS.md`.
- 2026-08-21 — Sprint 20 (RSS News Ingestion) ingested: new page `news-feed.md` (schema, the
  feed-reality-check findings, tiered entity resolution, where headlines surface, gotchas),
  linked from `index.md`'s Platform section. Updated `data-pipeline.md` to point at it and note
  `change_feed`/`news_feed` are deliberately separate views.
- 2026-08-21 — Sprint 21 (squad-view fix, leagues, FDR sort, league table) ingested:
  `frontend-conventions.md`'s `TeamState` section gained the `hasConsistentLineup` invariant —
  the root cause of `/team` dropping squad players and why a length check alone isn't enough.
  No new page; the leagues/FDR/table additions are UI-surface work already covered by
  `docs/sprints/sprint-21.md` and didn't change any engine or data-model concept this wiki
  tracks.
- 2026-08-21 — Sprint 13 (Live Matchday Hub, built and verified live) and Sprint 10's mini-league
  EO exact slice ingested, both triggered by the GW1 deadline. `deadline-and-matchday.md`'s Live
  Matchday Hub section rewritten from "staged" to built, with the `lib/gameweek-state.ts` design
  (captaincy handover, projected auto-subs, provisional BPS race) and the dry-run checklist
  results. New page `ownership-and-leagues.md` for the exact-EO pipeline
  (`sync-league-picks`, `lib/ownership.ts`) — a genuinely new topic, distinct from the still-blocked
  field-wide top-1k sample `risk-scoring.md` already covered. Updated `data-pipeline.md` (new
  self-gated `sync-fixtures` cadence — a real gap the dry run found, documented with its own
  subsection), `risk-scoring.md`, `glossary.md`, `methodology.md`, and `blocked-and-data-gaps.md`
  (league 314's blocker reworded from "empty" to "not yet rank-ordered", since the deadline changed
  what's actually blocked) to point at the new page rather than restate the old "blocked pre-season"
  claim. `index.md` and `timeline.md` updated.
- 2026-08-21 (evening) — GW1 live-hub follow-ups from real use ingested. `deadline-and-matchday.md`
  gained a new subsection (live fixture event detail shared between `/deadline` and `/fixtures`, the
  `is_next`-vs-live-gameweek collapse fix, the My Team link). New section in
  `frontend-conventions.md` for the player detail panel's live breakdown/season-stats/recent-form
  additions and its `undefined`-hides-a-section convention extended to three new fields — cross-
  linked to `xp-model.md`'s existing `XDC_MODEL_NOTE` for why `dc_actions` isn't called points.
  `news-feed.md` gained a new "Gotchas" entry for the guid-normalisation fix (46% of rows were
  re-fetched duplicates) — a real production bug, not a Sprint 20 build-time finding, so filed
  alongside the others rather than backdated into the sprint's own section. `timeline.md` updated.
- 2026-08-22 — Ingested CLAUDE.md's card-layout gotcha (the flex-row stretch fix, `self-start`
  alongside the `w-[calc(...)]` basis on `LiveFixtureCard`/`ClubTacticsGrid`) and `roadmap.md` +
  `phase-4-model.md`'s new write-up of the xP model's current-season-form gap. New subsection
  "Expandable-card stretch" in `design-system.md` under Card hierarchy, cross-linked from
  `deadline-and-matchday.md`'s live-hub section. `xp-model.md`'s "Known, disclosed gaps" rewrote the
  one-line "No current-season form" bullet with the structural finding (no read path exists at
  all, not just "hasn't accrued") and a cross-link to the gated proposal in `roadmap.md`/
  `phase-4-model.md`. `timeline.md` updated; `.pending-ingest` cleared. **Tidy note, not fixed this
  pass:** the pinned-squads feature (`TeamState.pinned`, `setPinnedDraft`), the `/players`/`/builder`
  current-season Pts/G/A/Mins columns, and the live-hub points-freeze/FT-badge bug fixes have no
  `docs/sprints/` or `roadmap.md` entry to ingest from — they shipped in code only. Also found
  `log.md`'s actual practice is append-only (newest at the bottom), which contradicts this file's
  own "most recent first" header at the top; not reordered here per the "don't restructure without
  a plan" rule.
- 2026-08-22 — Ingested `docs/sprints/design-audit-response.md` (an external "AI-coded website"
  design audit and the response to it — most of its findings verified false before acting).
  `design-system.md`: extended the "Disclosure" section with a new `## TapToReveal` subsection (the
  nine hover-only sites migrated off native `title`/`cursor-help`), closed the "Follow-on work"
  bullet under "Button and interaction states" that used to list the six pages missing focus rings,
  and added a "Two more mobile-layout bugs, neither about stretch" subsection for the `/transfers`
  order-first and `/compare` table-scroll fixes. `frontend-conventions.md`: added `fmtCountdown` to
  "Shared helpers" and a new "`/players`' own data columns" section for the current-season xG/xA and
  `xMins`/`Start %` additions. `deadline-and-matchday.md`: new subsection on the sticky app-wide
  `ContextBar` that moves the deadline countdown out of this page alone, and the `/` → `/deadline`
  signed-in redirect. `methodology.md`: new "Verify an external claim before implementing it"
  section — the audit's "critical DNS failure" was the auditor's own sandbox having no network, not
  a real outage. `deployment.md`: corrected `_headers`' stale "Cloudflare Pages" comment (this
  project deploys via Workers static assets) and noted the now-explicit HTML `Cache-Control` rule.
  `timeline.md` updated. Two entries in `.pending-ingest` (`docs/phase-4-model.md`, one of the two
  `docs/roadmap.md` lines) were stale leftovers from the prior ingest pass (562978), already fully
  reflected in `xp-model.md`/`design-system.md`/`timeline.md`/`log.md` per that commit's own message
  — treated as already-ingested, not re-processed. `.pending-ingest` cleared.

  **Tidy pass found, not fixed:** `design-system.md` cites `risk-scoring.md` twice (lines ~42, ~273)
  for "the FDR colour system's CVD validation," but `risk-scoring.md` contains no mention of CVD,
  FDR, or colour at all — a broken cross-link, not something this pass introduced. The CVD/ΔE
  validation this claim refers to lives only in `lib/fdr.ts`'s own header comment, never written up
  as wiki prose anywhere. The previously-flagged `frontend-conventions.md` panel-size stale claim
  (states 320×460, code has been 320×340 with a collapsed-by-default toggle since Sprint 21) is
  **still unfixed** — flagged twice now across two ingest passes.
- 2026-08-22 — Fixed both items from the tidy note just above, per owner request. `design-system.md`
  (two occurrences) and `methodology.md` no longer cite `risk-scoring.md` for the FDR colour system's
  CVD validation — corrected to cite `lib/fdr.ts`'s own header comment directly (12.3 ΔE protan
  adjacent-pair separation, 17.4 normal-vision floor), since `risk-scoring.md` never contained this
  content. `frontend-conventions.md`'s player-detail-panel section no longer states 320×460 as
  current — corrected to 320×340 (the real Sprint 21 value, verified directly against
  `PANEL_WIDTH`/`PANEL_MAX_HEIGHT` in `components/player-detail.tsx`), with the 320×460 figure kept
  as the intermediate step it actually was rather than deleted outright.
- 2026-08-22 — Ingested `docs/sprints/mobile-reachability.md` (a follow-on to the design-audit
  response, prompted by the owner's phone screenshot of the mobile nav trigger floating mid-header).
  `design-system.md`: new "Bottom sheet" subsection under Disclosure — the nav drawer's dropdown
  became a bottom-docked sheet (the app's first backdrop, first bottom-anchored popover), and
  `TapToReveal` gained a tap-target floor (a `before` pseudo-element hit-area halo, 16px→36px
  effective on the "?" trigger) plus a flip-up when short on room below. `frontend-conventions.md`:
  new sections for the `NavLinks` → `DesktopNav`/`MobileNav` split (moving a breakpoint-gated
  trigger independently of its sibling desktop row) and `freeTransfersDisplay` in "Shared helpers."
  `timeline.md` updated. `roadmap.md`/`README.md` gained a row each.

  Also fixed a real bug found live, not in a source file this ingest reads: the sticky `ContextBar`
  built the same session as `design-audit-response.md` rendered `TeamState.freeTransfers` raw,
  showing "FT 15" — 15 being `teamStateFromMyTeamJson`'s sentinel for FPL's pre-deadline "unlimited"
  transfer state, not a real count. `freeTransfersDisplay` (`lib/transfers.ts`) is now the one
  shared interpretation; `/deadline`/`/transfers`' FT selects persist via `saveDraft` instead of
  evaporating on navigation, and `/team` gained its own FT control (that page previously never
  loaded drafts at all, only created them). `deadline-and-matchday.md`'s ContextBar section — the
  page the *previous* ingest wrote up — is corrected in place rather than left stale: its old "FT —"
  honesty-gap description no longer matches what the bar actually does since the owner's own rule
  (default 1, shown plainly, ∞ on a wildcard) replaced it.
