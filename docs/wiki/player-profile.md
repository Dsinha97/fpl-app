# Player profile & shortlist

The full three-tab player card (`components/player-modal.tsx`) and the owner-scoped shortlist
(`user_shortlist`) — Sprint 38, built 2026-09-21.

## Two surfaces, one deliberately shallow

`/players`, `/builder`, `/team` and `/deadline` already had `PlayerDetail` — a 320px popover
anchored to a pitch card, used dozens of times a session for the fast taps (set captain, check the
next fixture) and deliberately **never-fetch**: it renders only what its caller already has loaded,
which is what lets four pages show it with zero data coupling. Folding a deep-dive's worth of
queries behind every one of those taps would be a regression.

The modal is the second, purpose-built surface for the deep read instead of a second copy of the
popover's contract. Reachable from `/players`' name cell (a button, replacing dead text) and from
the other three pages via a "Full profile →" link on the popover. Opening the modal closes the
popover first — both are `aria-modal` dialogs, and leaving one open stacked two of them.

**Tabs:**

- **Overview** — snapshot, price, [price outlook](data-pipeline.md#the-reading-was-broken-since-it-shipped-and-sprint-38-found-why-2026-09-21)
  (loaded lazily on open, everywhere the modal opens from — see below), transfers, fixtures, season
  stats, recent price changes, recent form, availability, set-piece duty, club system, news.
- **Gameweeks** — every fixture, each row expanding into the points breakdown.
- **History** — past seasons, keyed on `player_code` rather than `players.id` because FPL reassigns
  element ids between seasons.

**`useProfileModal` (`components/player-modal/use-profile-modal.tsx`) is the plumbing shared by the
three pitch pages** — `/players` wires the modal directly since it already holds the player pool
and can build rank cohorts for free, but `/team`, `/deadline` and `/builder` take this hook instead
of repeating the state/loading/render three times. Extended in Sprint 39 (DSI-181) to also load
price-outlook lazily on first open: previously only `/players`, `/transfers` and `/shortlist`
loaded it before handing the modal a `priceProgress` prop, so opening "Full profile" from the other
three pages silently showed no price-watch section at all — not a rendering bug, a data-loading gap
in three specific callers.

**One source per number.** Season figures are reduced from the same gameweek lines the Gameweeks
tab itemises, so the headline and the table beside it can't disagree. This gameweek's transfers
fall back to the live ~2h ownership sample when the finalised event total doesn't exist yet, and
say so — a settled total and a live sample are different quantities, not interchangeable ones (see
[methodology.md](methodology.md#say-what-the-number-means)).

**The same card everywhere.** `loadPlayerExtras` loads availability, set-piece duty, club system
and news itself, rather than reading them off whatever `PlayerData` the caller happened to have —
the popover's caller-supplies-it contract is right for a panel four pages render with different
data to hand, but it meant the deep-dive card showed different sections depending on where it was
opened from. A "full profile" shouldn't have that property.

**Rank captions** ("#13 MID", "Top 10%") come from `lib/player-ranks.ts`. Bars normalise to the
position's 95th percentile rather than its maximum, so one outlier doesn't render everyone else as
a stub, and a caption is **omitted entirely — never a dash** — when the cohort is under 20 players
or a rate rests on under 180 minutes.

**The points breakdown is derived, not FPL-supplied** — FPL itemises a score only for the live
gameweek. Values come from the `scoring_rules` table, season-keyed and synced from FPL (see
[methodology.md](methodology.md#squad-rules-and-scoring-rules-come-from-the-database-never-hardcoded)),
never a constants file. Every breakdown reconciles against the stored total; any difference renders
as an **"Unattributed"** row rather than being silently absorbed. Verified against all 3,218
recorded player-gameweeks this season: zero unattributed. That same reconciliation pass is what
found the defensive-contribution threshold measurement — see
[xp-model.md](xp-model.md#known-disclosed-gaps).

`PlayerDetail` (the popover) dropped from 578 to 398 lines once "Show full details" — everything it
used to hold, now all here instead — was removed. Its panel height cap
(`PANEL_MAX_HEIGHT`, `components/player-detail.tsx`) was raised 340→480px in Sprint 39 (DSI-181):
the metric grid had grown two rows since the cap was set, and an owned squad player's three stacked
action rows (Set C/Set VC/Remove, Replace, Full profile) no longer fit under it, forcing a scroll
to reach the action buttons on every squad player, not just an edge case.

The rest of that DSI-181 sweep, each verified live in the preview:

- `TapToReveal`'s tooltip now renders above the modal (z-60 against the modal's z-50).
- A player with no profile photo falls back through the kit to the **club crest**
  (`components/player-identity.tsx`'s `onError` chain).
- The transfers tab shows "# Owned".
- `/players` can sort by Price Watch, ordered by how close a player is to either threshold,
  whichever direction.

— [sprints/sprint-39.md](../sprints/sprint-39.md)

## The shortlist

`user_shortlist` — players the owner marks to come back to, keyed on `player_code` (survives a
season rollover) and `season` (a shortlist is a statement about *this* season's squad-building, not
a permanent favourite). Owner-scoped on the Sprint 14 RLS shape, `auth.uid() = user_id` in **both**
directions — verified in a rolled-back transaction, not just enabled: a second user sees 0 of
another's rows, deletes 0 of them, and an insert naming another user's id is refused while their
own succeeds; anon sees 0. See [database-and-rls.md](database-and-rls.md).

**Named "shortlist", not "watchlist", deliberately.** "Watchlist" already means something else in
this schema — the bounded set of players sampled every ~2h for price movement
([data-pipeline.md](data-pipeline.md#player_ownership_historys-watchlist-sprint-290-2026-08-30)), a
sampling budget the *system* chooses. This one is a set the *owner* picked. Two meanings for one
word in one app is a bug with a delay on it.

**No `localStorage` fallback, deliberately.** A shortlist that lives in one browser and silently
fails to appear on a phone is worse than one that says "sign in first", and a shadow copy that
conflicts on sign-in is worse still. Signed out, the control is a link to `/signin` — never a
silent no-op.

The modal owns the shortlist state rather than taking it as a prop, so the star control exists on
every page instead of only where a caller remembered to wire it. `/shortlist` lists every
shortlisted player with their own price-outlook reading — a shortlist button with nowhere to read
the shortlist back would be a write-only hole. Sprint 39 (DSI-181) extended the Telegram
notification preferences to include the shortlist alongside the squad for a price-proximity alert
— see [notifications-and-bot.md](notifications-and-bot.md).

— [sprints/sprint-38.md](../sprints/sprint-38.md) §4-5, [sprints/sprint-39.md](../sprints/sprint-39.md)
