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
