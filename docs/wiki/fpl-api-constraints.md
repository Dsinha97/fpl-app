# FPL API constraints

Behaviors of the official FPL API and Supabase REST layer that have caused real bugs, verified
against the live endpoints rather than assumed from documentation.

## Response size

**Supabase's REST API caps every response at 1000 rows regardless of `.limit()`** — a larger limit
truncates silently and still returns `200`. Anything that needs a full series (e.g. per-gameweek
predictions across the whole player pool) must page with `.range()` until a short page comes back.
See [data-pipeline.md](data-pipeline.md#player_predictions-and-the-row-cap).

## Pre-season zeroed/placeholder fields

- **Team strength** (`strength_attack_*`/`strength_defence_*`) is `0`/`null` for all 20 clubs
  pre-season — blocks a custom FDR and any `TeamAttackStrength` term (see
  [risk-scoring.md](risk-scoring.md), [lineup-captain-bench.md](lineup-captain-bench.md)).
- **`total_players`** (bootstrap-static) is a pre-season snapshot, not a stable field size — it
  climbs roughly 4× before GW1 (2,889,243 in early August toward ~11M). Nothing consumes it yet;
  `game_settings.updated_at` is the sample-time record.
- **`defensive_contribution`** is only tracked from 2024/25 onward — every earlier
  `player_season_history` row reads a real `0`, not a missing value, which silently deflated `dc90`
  until `deriveDcEligibleSeasons` restricted its denominator to seasons where the stat is genuinely
  populated. See [xp-model.md](xp-model.md).

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
