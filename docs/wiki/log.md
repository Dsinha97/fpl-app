# Log

One line per entry, most recent first.

- 2026-09-02 — First RETRO pass. Added one rule to `AGENTS.md`'s (previously empty) **Folder
  conventions**: a stale claim gets fixed everywhere it lives — `roadmap.md`, shipped `*_MODEL_NOTE`
  strings, a source spec's banner — not just on the wiki page, and a punch list is the deliverable
  only when TIDY is what was asked for. Earned by the same correction landing twice: the 2026-08-27
  pass fixed a stale `roadmap.md` claim on its own initiative, and the owner asked for the same
  reach explicitly on 2026-09-02. Three other candidates were considered and rejected as either
  already-stated ground rules (correct in place with a dated note; source-spec bodies stay unedited)
  or as belonging to the TIDY job rather than to folder conventions (watching for expired premises).
  The INGEST section's "this wiki only adds and updates pages under `docs/wiki/`" was reworded in
  the same edit, since the new rule contradicted it as written. Also added the team-strength
  reconciliation note to `docs/sources/cold-start-patch-plan.md`'s banner (§13's stated reason has
  partly expired), body left unedited.

- 2026-09-02 — Tidy pass, then ingest of its two consequential findings plus the pending
  `CLAUDE.md`/`roadmap.md`/`phase-4-model.md` entries. **Team strength**: the wiki's blanket "zero
  for all 20 clubs pre-season" claim was checked against the live `teams` table and is now only half
  true — `strength_overall_home`/`_away` are populated for all 20 (2–4 scale, three distinct home
  tiers), while `strength_attack_*`/`strength_defence_*` are still `0` and `strength` still `NULL`.
  Corrected in place with dated notes rather than rewritten, across `fpl-api-constraints.md`,
  `blocked-and-data-gaps.md` (the single blocked row split into an unblocked custom-FDR row and a
  still-blocked `TeamAttackStrength` row), `glossary.md`, `lineup-captain-bench.md`,
  `risk-scoring.md`, `xp-model.md` and `methodology.md`. **Sprint 30** had no wiki presence at all:
  added its form-blend attempt 2 to `xp-model.md` (second failure on the same gap — the blend is not
  one coefficient away from working) and its `sellPrice` call-site fixes to `transfer-engine.md`,
  plus a `timeline.md` row. **New page section** in `frontend-conventions.md` for `TeamState.bank`
  becoming the stored primitive (commit `461a455`), cross-linked from `transfer-engine.md`, with a
  second `timeline.md` row. Also restated the accuracy-scoreboard blocker in terms of *scored*
  gameweeks rather than archived ones — the archive runs one gameweek ahead of what can be scored,
  so the old wording read as met when only GW2 actually has both an archive and a result.
- 2026-09-02 — Follow-up to the pass above, once `sprints/sprint-30.md` was written. `roadmap.md`'s
  blocked table split the same way this wiki'''s did (custom FDR unblocked; `TeamAttackStrength`
  still blocked, and now correctly attributed to the attack/defence split rather than to
  pre-season). The shipped `*_MODEL_NOTE` strings were the user-facing half of the same stale
  claim and were corrected in code — `CAPTAIN_MODEL_NOTE` (`lib/lineup.ts`) no longer promises the
  data arrives "until matches are played", and `COLD_START_NOTE` (`lib/scoring.ts`) and
  `hidden-gems.ts`'''s note now say "in-season as much as pre-season". Sprint 30'''s own detail was
  ingested from the new sprint file rather than the roadmap row: `xp-model.md` gained why attempt 2
  failed (a leave-one-season-out per-position intercept, which overshoots 2023-24 into +0.514 bias
  while clearing the other two — a finding about cross-season bias instability, not a tuning miss,
  and the three-season gate was deliberately not narrowed), and `risk-scoring.md` gained
  `/compare`'''s restored five-term `COMPARISON_WEIGHTS` — "drop, renormalise, disclose" running in
  reverse, since an expired premise leaves a stale disclosure behind. `timeline.md` and
  `transfer-engine.md` re-pointed from the roadmap row to the sprint file. Also **reordered
  `log.md` itself**: 15 entries dated 2026-08-21 and later had been appended at the bottom,
  contradicting this file'''s own "most recent first" rule. Content unchanged and verified
  block-for-block; only order moved.

- 2026-08-30 — Ingested `docs/sprints/latency.md` + `docs/sources/website-optimization.md`, found
  genuinely un-ingested despite sitting in `.pending-ingest` since 2026-08-27 — the ingest passes
  between then and Sprint 28 (2026-08-29) covered Sprints 26/27/28 but skipped this one, confirmed
  by grepping the wiki for `sync-claimed-managers`/`loadPredictionSeries` and finding zero hits
  before this pass. New page `performance.md` (Platform section): the two-pass latency baseline, the
  notebook-recommendations table checked against this app's actual architecture, and what's still
  open (route splitting, unidentified bundle chunks, remaining serial waterfalls on `/players`/
  `/transfers`). `data-pipeline.md` gained a "`/team` no longer syncs on every load" section (the
  `sync-claimed-managers` cron, `_shared/manager-sync.ts` extraction, `hasLiveFixture` shared with
  `sync-live-gameweek`) and an updated function/cadence table row. `deadline-and-matchday.md` gained
  a pointer to `performance.md` from the Deadline Hub section for the serial-pagination fix.
  `deployment.md` cross-linked from its static-export section. `index.md`/`timeline.md` updated.

- 2026-08-30 — Ingested Sprint 29 (`sprint-29.md`, `roadmap.md`, `architecture.md`, `CLAUDE.md`) and
  its same-day follow-up (six defects filed from screenshots after Sprint 29 shipped, appended to
  the same sprint file). `ownership-and-leagues.md` rewritten: "Not yet built" replaced with `/leagues`
  built 2026-08-30 (Sprint 10's EO engine and `sync-league-picks` pipeline had shipped complete with
  nothing calling them), a new "Standings paging rewritten for scale" section documenting the
  concurrent-wave rewrite and two real bugs a 9.9M-entry load test surfaced (an oversized `.in()`
  query, a live-rank-shift duplicate-key crash), and a new "field-wide top-1k sample" section
  correcting `blocked-and-data-gaps.md`'s stale "never synced" reason — the pipeline is now provably
  capable at that scale, just not currently sampled (test data was deleted after verification).
  `risk-scoring.md`'s EO-term explanation corrected to match. `data-pipeline.md` gained a
  `player_ownership_history` watchlist section (the ~20h→~2h bounded-watchlist sampling fix and
  `lib/price-watch.ts`'s progress-to-threshold tool) and a `change_feed` status+news merge section
  (one FPL update no longer double-reports as two rows). `fpl-api-constraints.md` gained a new
  pre-season-field entry for `teams[].played`/`win`/etc. never populating in-season at all (not just
  pre-season) — verified live against the real API — and the derived-standings fix this drove.
  `frontend-conventions.md` gained a section on re-import now overwriting the same draft (previously
  always minted a new one) and preserving `chipPlan`/`pinned`/`notes`/`strategy`, plus real purchase
  price from `manager_transfers` replacing the current-price fallback. `design-system.md` extended
  the Sprint 28 `order`-pattern section to Sprint 29's three-section generalisation, the countdown/
  heading split, and the `/leagues` chevron affordance. `news-feed.md` gained a gotcha for the FFS
  URL-triplication dedup extracted to a shared `dedupeByUrl` and applied to `/deadline` (previously
  only `/news` had it). `deadline-and-matchday.md`'s Review section corrected a stale claim
  (`manager_transfers` "0 rows" — real rows exist since 2026-08-25) and gained a "Transfer ledger"
  section. `index.md`/`timeline.md` updated. `.pending-ingest` cleared — its remaining entries
  (`sprint-26.md`, `sprint-27.md`, `latency.md`, `website-optimization.md`, `sprint-28.md`) were
  confirmed stale leftovers already covered by the two log entries directly above, not re-processed.

  **Tidy pass, not fixed this round:** none of `/leagues`, `performance.md`'s still-open items, or
  the price-watchlist tool have their own `blocked-and-data-gaps.md` row — none currently need one
  (nothing there is blocked), but worth checking once price-change step 3 (the classifier) is
  scoped, since that item is explicitly gated and will belong on that page.

- 2026-08-29 — Ingested `docs/sprints/sprint-28.md` (Live/upcoming split, one transfer answer,
  scenario actuals). New `deadline-and-matchday.md` subsection superseding Sprint 23's live-hub
  rail description — the two-section split, the `livePhase` table, and why `liveStarted` could not
  detect "over" while `data_checked` is the wrong flag to use for it. New `design-system.md`
  subsection for `CollapsibleCard`'s controlled mode and `section` tier, recording two measured
  findings: the `onTransitionEnd`-then-`overflow-visible` fix for the clipped `PlayerDetail`
  popover was built and **does not work** (Chrome resolves an interpolating `fr` track in an
  indefinite-height grid to 0px and never fires `transitionend` for `grid-template-rows`), and
  collapsed accordion bodies had been sitting in the tab order since Sprint 24. New
  `transfer-engine.md` section "One answer per deadline", documenting the three defects in
  `planTransferPath` that were fixed *before* it became the sole recommendation — including the
  roll-branch squad leak, a genuine correctness bug rather than a presentation one. New
  `squad-score-and-scenarios.md` section for `lib/scenario-actuals.ts`, with the counterfactual
  framing stated as a requirement rather than a caveat. `timeline.md` updated.

- 2026-08-27 — Ingested Sprints 26 and 27 (post-GW1 reckoning). `xp-model.md`'s "known, disclosed
  gaps" current-season-form entry rewritten from "proposed, not built" to the measured result: MAE
  and Pearson r improve in every backtest season, but 2024-25's bias worsens, so it wasn't shipped.
  `blocked-and-data-gaps.md`'s League 314 row corrected (the "ties on 0" reason expired with GW1
  being scored; the real current reason is the league has never been synced at all) and a new row
  added for the accuracy-scoreboard panel (data layer done, UI held for ≥2 archived gameweeks).
  `data-pipeline.md` gained a `player_prediction_archive` subsection. `deadline-and-matchday.md`
  gained a "Review" section for the new `/review` route. `timeline.md` and `index.md` updated.
  Also corrected a stale claim this pass found in `roadmap.md` itself (not this wiki, but flagged
  here since it's the same kind of drift): its Blocked table said `sync-live-gameweek`'s write
  path had "never executed", though this wiki's own `data-pipeline.md` already correctly recorded
  it writing 600 real rows at GW1 kickoff — `roadmap.md` just hadn't been updated to match.

- 2026-08-23 — Ingested `docs/sprints/sprint-25.md`'s UI defect sweep half (the domain-cutover
  half was already ingested into `deployment.md`'s "Custom domain" section in a prior pass — only
  `.pending-ingest`'s clear hadn't caught up). New "UI defect sweep (Sprint 25, 2026-08-23)"
  subsection in `design-system.md`: short team codes on `live-fixtures.tsx`/`fixture-schedule.tsx`,
  `FixtureRow`'s last raw `⌃` glyph converted to `ExpandToggle`, `/chips`' dead-space swap and new
  `chipModelNoteSummary` (cross-linked into `chip-strategy.md`), `/players`' xG/xA relabelled to
  per-90, and the mobile drawer wordmark + desktop hover-open nav. New "Two small defects fixed"
  subsection in `deadline-and-matchday.md` (Team news headline cap, `/team`'s fixture-chip fix).
  Added a `timeline.md` row. **Tidy-pass correction**: `frontend-conventions.md`'s "`/players`' own
  data columns" section still described the pre-Sprint-25 `xG (N GW)`/`xA (N GW)` labelling as
  current — corrected in place with a dated note rather than silently rewritten, per this wiki's
  own rule against dropping history.

- 2026-08-23 — `.pending-ingest` cleared. Its remaining entries (`CLAUDE.md`, `docs/roadmap.md`,
  `docs/sprints/sprint-14.md`, and duplicate `docs/sprints/sprint-22.md`/`sprint-23.md`/
  `sprint-24.md` lines) were stale leftovers already covered by prior ingest passes — confirmed by
  `git log`'s ingest entries below and by `grep` finding no un-ingested claims in the current text
  of any of them.

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

- 2026-08-22 — Ingested `docs/sprints/sprint-22.md` (Navigation & shell): new `design-system.md`
  subsection "Grouped nav, a left drawer, and one shared anchored-panel hook" — the new
  `useAnchoredPanel`/`useDismissablePopover` hook consolidating `TapToReveal`'s vertical-only flip
  and `FilterDisclosure`'s horizontal-only clamp into one viewport-clamped-on-both-axes
  implementation, the 11-link nav grouped into three `@base-ui/react/menu` dropdowns
  (Live/Strategy/Statistics), `/status` moved into `AccountMenu`, and the FT tooltip's `CLAUDE.md`
  self-reference removed from user-facing copy. **Corrected two stale claims found while writing
  this up**, both predating this sprint: the "Bottom sheet" subsection (added the same day, one
  sprint earlier) is now superseded by the left drawer this section describes, and
  `frontend-conventions.md`'s `NavLinks` split section referenced a "10-item desktop row" that no
  longer exists. Both corrected in place, not deleted. `timeline.md` updated;
  `.pending-ingest` cleared (its two stale entries, `docs/roadmap.md` and
  `docs/sprints/mobile-reachability.md`, were already fully reflected by the prior ingest pass per
  `log.md`'s own entry above — not re-processed).

- 2026-08-22 — Ingested `docs/sprints/sprint-23.md` (Page density): new `design-system.md`
  subsection "Packing, continued" documenting the `grid-cols-[minmax(0,1fr)_360px]` two-column
  template (already used by `/builder`/`/transfers`) rolling out to `/deadline`, `/team`,
  `/transfers`'s replace-picker anchoring, and `/chips`. **Corrected a genuinely stale claim
  predating this session**: `deadline-and-matchday.md`'s "My Team's Squad view" section still
  described a "Current squad / Gameweek result" mode switch that Sprint 21 (2026-08-21) removed
  entirely — an ingest gap from that pass, since Sprint 21's own log entry only mentioned updating
  `frontend-conventions.md`'s `TeamState` section. Corrected in place with a dated note, plus a new
  subsection for this sprint's actual change (the redundant squad list deleted, not just the mode
  switch). New `deadline-and-matchday.md` subsection for the Live hub's own two-column repack
  (BPS-race card narrowed, Price & news watch / Team news moved into the freed rail). `timeline.md`
  updated.

- 2026-08-22 — Ingested `docs/sprints/sprint-24.md` (Expand/collapse polish): new `design-system.md`
  subsection "A real `ExpandToggle`, and a grid-rows accordion" — the new 36px circular toggle
  primitive (`interactive={false}` mode for when a different element already owns the click, to
  avoid nesting a `<button>` inside a `<button>`), and the `grid-template-rows: 0fr → 1fr` animation
  replacing mount/unmount on every card expander in the app. Documents the real hydration-error bug
  this caught in `/transfers`' replace-candidate picker (a button nested inside a button, pre-dating
  this sprint, relocated verbatim by Sprint 23) and how it was fixed. Also records that the
  animation itself wasn't independently visually verified this session — the browser preview ran
  backgrounded (`document.visibilityState === "hidden"`) throughout, which broke
  `getBoundingClientRect()` measurements after any CSS class toggle; reproduced with multiple
  unrelated techniques, pointing at the tooling rather than the CSS. `timeline.md` updated.

- 2026-08-22 — Ingested `CLAUDE.md`'s "Next" line fix: it named Sprint 13/15 specifically, both
  long stale (Sprint 13 shipped 2026-08-21, Sprint 15 is still blocked per `roadmap.md`) — reworded
  to defer to `roadmap.md`'s own "Next up" section instead of pinning a sprint name that goes stale
  every time the roadmap moves. No wiki page references this line directly, so no cross-link
  update needed.

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
