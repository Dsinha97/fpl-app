# FPL API constraints

Behaviors of the official FPL API and Supabase REST layer that have caused real bugs, verified
against the live endpoints rather than assumed from documentation.

## Response size

**Supabase's REST API caps every response at 1000 rows regardless of `.limit()`** — a larger limit
truncates silently and still returns `200`. Anything that needs a full series (e.g. per-gameweek
predictions across the whole player pool) must page with `.range()` until a short page comes back.
See [data-pipeline.md](data-pipeline.md#player_predictions-and-the-row-cap).

## Pre-season zeroed/placeholder fields

- **Team strength — half of this cleared in-season (corrected 2026-09-02).** The original claim
  here was that team strength is `0`/`null` for all 20 clubs. That was true pre-season and is no
  longer true in full. Checked live against `teams` on 2026-09-02 (rows synced that morning, GW3):
  - `strength_overall_home` / `strength_overall_away` are **populated for all 20 clubs** — a coarse
    2–4 scale, three distinct home tiers. Real, differentiated data.
  - `strength_attack_home`/`_away` and `strength_defence_home`/`_away` are **still `0` for all 20**.
  - `strength` itself is **still `NULL` for all 20**.

  So the two things this blocked are no longer one blocker. A custom analytical FDR built on the
  overall home/away ratings now has data to work from; a `TeamAttackStrength` term still has none,
  because the attack/defence split is the part that never populated. See
  [blocked-and-data-gaps.md](blocked-and-data-gaps.md) for the split rows,
  [risk-scoring.md](risk-scoring.md) and [lineup-captain-bench.md](lineup-captain-bench.md) for the
  disclosures that still cite the old blanket claim in shipped `*_MODEL_NOTE` text.
- **`total_players`** (bootstrap-static) is a pre-season snapshot, not a stable field size — it
  climbs roughly 4× before GW1 (2,889,243 in early August toward ~11M). Nothing consumes it yet;
  `game_settings.updated_at` is the sample-time record.
- **`defensive_contribution`** is only tracked from 2024/25 onward — every earlier
  `player_season_history` row reads a real `0`, not a missing value, which silently deflated `dc90`
  until `deriveDcEligibleSeasons` restricted its denominator to seasons where the stat is genuinely
  populated. See [xp-model.md](xp-model.md).
- **`teams[].played`/`win`/`draw`/`loss`/`points`/`form` stay `0`/`null` all season, not just
  pre-season** — this is not a placeholder that clears once matches are played; verified live
  2026-08-30 by fetching `bootstrap-static` directly against a season with multiple gameweeks
  already finished (real scorelines in `fixtures`, these fields still zero for every team).
  `teams.position` is *not* zeroed the same way, but doesn't track played/points either, so it
  isn't a real table position — trusting it would repeat the same "field FPL doesn't actually
  carry" mistake. `components/league-table.tsx` now derives the standings table from `fixtures`
  results instead whenever FPL's own fields read empty (`lib/fdr.ts`'s
  `deriveStandingsFromFixtures`) — counting a `started` fixture (live score included, distinguished
  from `finished_provisional` so an over-but-bonus-pending match doesn't read as "still being
  played"), not just fully `finished` ones. — [sprints/sprint-29.md](../sprints/sprint-29.md)

## Fixture/gameweek shape

- **Double gameweeks are two rows sharing one `event`.** Folding predictions into a per-event map
  must accumulate, not overwrite.
- **Today's fixture list has no blanks or doubles anywhere** (measured, GW1–38) — created later by
  cup postponements. Affects every chip valuation — see [chip-strategy.md](chip-strategy.md).

## Asset URLs — several documented patterns 404

- **Kit images need a size suffix**: `shirt_{team_code}-110.png`, goalkeeper
  `shirt_{code}_1-110.png`.
- **Crests**: `resources.premierleague.com/premierleague/badges/70/t{team_code}.png`.
- **Region codes aren't all ISO** — `EN`/`S1`/`WA`/`NI` map to flagcdn's `gb-eng`/`gb-sct`/`gb-wls`/`gb-nir`.

## Authentication is a separate, larger topic

See [fpl-authentication.md](fpl-authentication.md) for why credential login is blocked and what was
built instead.

## General rule this repo follows

**Verify, don't assume** — probe the live API before designing against it, curl asset URLs before
trusting a pattern. Several of the entries above exist precisely because a documented or
widely-cited pattern (a Medium guide, a third-party write-up) turned out to be wrong when checked
directly.
