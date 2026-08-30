# Sprint 29 — Price sampling, leagues, transfer tracking, layout and feed fixes

Built 2026-08-30. Six independent fixes plus one new page, planned together
because they were all filed in the same owner session. `lib/ownership.ts`
and `supabase/functions/sync-league-picks` turned out to have shipped
complete in Sprint 10 with nothing calling them — the leagues item is
wiring, not new maths.

---

## 0. Price-change prediction, steps 1 and 2

`supabase/migrations/20260830191442_sprint29_price_watchlist.sql`,
`lib/price-watch.ts`, `app/players/page.tsx`, `app/transfers/page.tsx`.

`player_ownership_history` was gated to one sample per ~20 hours for every
player (`record_player_snapshots`, Phase 1) — a data-accrual clock, since
FPL's price algorithm keys on transfer *velocity*, and a daily snapshot
cannot reconstruct sub-daily velocity after the fact. Fixed the sampling
first: a bounded watchlist (`cost_change_event <> 0`, or
`selected_by_percent` / net-transfer thresholds read from `game_settings`,
never hardcoded) now samples at ~2 hours while the rest of the population
stays at ~20h. Verified live: watchlist size came back 111 players, not the
~700-player full population — bounded as intended.

Shipped the descriptive tool on top: `priceProgress()` reads net transfers
since a player's last recorded price change and reports a direction and a
0–1 progress toward a threshold — itself a documented, user-adjustable
input (`DEFAULT_RISE_THRESHOLD` / `DEFAULT_FALL_THRESHOLD`), never a fitted
coefficient, per CLAUDE.md's "make the missing quantity an input" rule.
Returns `"unknown"`, not a guess, below two post-change samples — verified
against Cherki, who repriced the same day and correctly reads unknown
rather than a fabricated percentage. Surfaced as a column on `/players` and
inline on `/transfers`' incoming-player rows.

Step 3 (fitting a classifier on the accumulated history) stays out, gated
on beating a naive top-N-by-net-transfers baseline — not built here.

## 1. `/leagues` — mini-league standings and effective ownership

`app/leagues/page.tsx`, `lib/leagues.ts`, `components/manager-leagues.tsx`.

`lib/ownership.ts` (`computeLeagueOwnership`, `differentialScore`,
`rankGain`) and `supabase/functions/sync-league-picks` both shipped
complete in Sprint 10's exact slice; `sync-league-picks` had never once
been invoked from the app. This page is that wiring: a league picker
(extended `ManagerLeagues` with an optional `onSelect`, so `/team` keeps
its original read-only rows), standings and EO paged past the API's
1000-row cap (`lib/leagues.ts`'s `loadLeagueStandings` /
`loadLeagueEntryPicks`), a sync button as the first real caller of
`sync-league-picks`, and an EO table carrying differential and rank-gain
per player.

Two things learned running it against real data:

- Standings and picks sync independently — a league can have
  `league_entries` rows (from a prior sync) with zero `league_entry_picks`
  for the gameweek in question. The first cut only handled "no standings at
  all"; a real test against the owner's "Qwerty" league surfaced a table
  with headers and zero rows, which reads as broken. Added a second empty
  state: "standings are in, picks aren't — sync above."
- Verified end to end against production data: synced Qwerty (5 entries,
  75 picks rows), and EO/captain counts checked out (B.Fernandes captained
  by 1 of 2 owners in a 5-entry league reads 60% EO, matching `Σ multiplier
  / numEntries`).

`OWNERSHIP_MODEL_NOTE` (a league's EO is exact for that league, not the
game) and the entry cap (`game_settings.league_ownership_entry_cap`,
2000) are both disclosed inline rather than presenting a bare "EO".

## 2. Import replaces the squad in place; transfers are tracked

`lib/fpl-squad.ts` (`resolveImportTarget`), `lib/manager-transfers.ts`,
`lib/squad-diff.ts`, `app/settings/page.tsx`, `app/team/page.tsx`.

Re-importing used to always mint a new draft: both importers built a fresh
`TeamState` (a new `draftId` from `emptyTeamState`) and called
`uniqueDraftName`, so a second import became "DS United (FPL) (2)" instead
of updating the first — even though `saveDraft` already updates in place
when a `draftId` matches. `resolveImportTarget` finds the existing import
using the same entryId-then-name precedence `resolveRequestedDraft` already
uses; both importers now overwrite that draft's id instead of minting a
new one. History comes free: `saveDraft` already snapshots on every save,
so the pre-import squad is the previous entry in that same draft's history.

`manager_transfers` is the transfer ledger — the table already existed and
was already written by `_shared/manager-sync.ts`, just empty because no
transfer had been made yet. `lib/manager-transfers.ts` is the one place
that reads it now (`lib/gameweek-review.ts`'s own single-event copy was
folded into this, not kept as a second implementation); `/team` renders a
season-wide "Transfers this season" list under the squad, with a
reconciliation note against the local draft-snapshot diff
(`lib/squad-diff.ts`) when the two disagree. Verified against a real
connected manager with a real synced transfer (GW2, Gibbs-White → Gakpo) —
rendered correctly end to end.

## 3. `/deadline` — inline countdown, watch cards below Live

`app/deadline/page.tsx`.

The countdown (heading, timer, full date) used to stack across three lines
inside a two-column top-strip grid alongside the Price & news watch and
Team news cards. Collapsed onto one row now that the grid is gone. The two
watch cards moved out of the top strip into the same `order`-based
sequencing Sprint 28 introduced for the Live/Upcoming split — a new
`sectionOrder` helper places them after Live (or, once Live is over, after
Upcoming; or, when there is no live section at all, before Upcoming),
using `flex flex-wrap` with a `w-[calc(50%-0.625rem)]` basis and
`self-start` on each card rather than a grid, so an expanded card no
longer stretches its still-collapsed neighbour (the exact case CLAUDE.md
warns about). Verified visually at desktop width: expanding "Price & news
watch" leaves "Team news" at its own natural height in both the live and
"GW over" ordering.

## 4. `/review` moves from Live to Strategy

`components/nav-links.tsx`.

It's last gameweek's post-mortem, not this gameweek's live state — Live is
"what's happening now", Strategy is "what should I do". No route changed;
`/leagues` took its old slot in Live.

## 5. Feed de-duplication

`supabase/migrations/20260830192000_sprint29_change_feed_dedupe.sql`,
`lib/change-feed.ts`, `lib/news-feed.ts`, `app/news/page.tsx`,
`app/deadline/page.tsx`.

Two separate bugs behind what looked like one duplicate:

- `record_player_snapshots` writes `player_status_history` and
  `player_news` in one transaction, so an FPL update touching both status
  and the news text landed on the identical `observed_at` in both tables —
  `change_feed` then emitted two rows (`status` and `news`) for one real
  event. Fixed in the view: a status event and a co-timestamped news event
  now merge into one `status` row, with the news sentence folded into
  `detail.news_new` so nothing is lost (`describe()` in `lib/change-feed.ts`
  surfaces it). Also added the `rn > 1` baseline guard to the news branch
  (the status branch already had it), so a player's first-ever news row
  stops being reported as a change. Verified live: Rodon, Caicedo and
  Ayari's previously-duplicated rows collapsed into one merged row each.
- Separately, Fantasy Football Scout is registered as three `news_sources`
  rows sharing one feed URL, so one article is upserted up to three times.
  `/news` already deduplicated by URL; `/deadline`'s Team news card read
  the same `news_feed` rows without that filter. Extracted the dedup into
  `lib/news-feed.ts`'s `dedupeByUrl` and applied it in both places. Also
  added a `season` filter to both `change_feed` queries (`/news` and
  `/deadline`), neither of which had one — harmless with one season on
  record, but would interleave a second season's rows once one exists.

## Bug found while testing: `/fixtures`' league table

Not part of the plan — surfaced by the owner mid-session. `/fixtures`'
Table tab claimed "Gameweek 1 hasn't been scored yet" with GW1 and GW2
both clearly finished. Root cause: FPL's `bootstrap-static` API never
populates `teams[].played/win/draw/loss/points/form` during a season —
verified by fetching the live endpoint directly against a season with
finished fixtures on record; every value came back 0/null regardless.
`sync-bootstrap` was trusting those fields verbatim, the same class of bug
CLAUDE.md already documents for `total_players`. `teams.position` is *not*
zeroed the same way but doesn't track played/points either, so treating it
as a real table position would have been the same mistake.

Fixed by deriving the table from `fixtures` instead — `deriveStandingsFromFixtures`
(`lib/fdr.ts`) aggregates finished results into P/W/D/L/Pts, a simple
win/draw/loss form string (last 5, disclosed as not FPL's own weighted
figure), and position by the standard points → goal difference → goals-for
tiebreak. `components/league-table.tsx` uses FPL's own fields when they're
actually populated (future-proof) and falls back to the derived table
otherwise, with the banner naming which case applies. Verified live:
Brighton now shows 1st after their GW1 win, instead of every row reading
zero.

---

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors throughout, pre-existing
warning count unchanged), `npm run build` all clean after every change in
this sprint. `/leagues`, `/team`, `/deadline`, `/players`, `/transfers`,
`/news`, `/fixtures` driven live in the preview browser against production
data (not fixtures) — league sync, transfer ledger, price watch, feed
dedup and the standings fix were all confirmed against real rows, not just
typechecked. No new console errors introduced (the one CORS error observed
against `sync-manager` predates this sprint and is unrelated to any change
here).

---

## Follow-up — six defects found using the shipped build

Filed by the owner from screenshots after the above shipped. All fixes,
plus two real bugs surfaced while verifying one of them.

**`/team`** — the inline "Your Leagues" table was illegible squeezed into
the 360px rail; replaced with a compact link into `/leagues` (extended
`ManagerLeagues` with an optional `onSelect`, so `/team` now uses the
plain non-interactive render path while `/leagues` uses the clickable
one). "GW{event} as picked" relocated from the main squad column to the
rail, directly below the leagues link, at the owner's explicit choice
over leaving the two in their independent desktop columns.

**`/leagues` affordance** — clickable rows and static rows rendered
identical markup; added a trailing `ChevronRight` (lucide-react) plus
explicit `cursor-pointer`, shown only on the `onSelect` (clickable)
variant.

**Large-league sync** — `supabase/functions/sync-league-picks` paged
standings sequentially (up to 40 round-trips for the 2000-entry cap) and
only wrote after the whole loop finished. Rewrote to fetch pages in
concurrent waves (`STANDINGS_CONCURRENCY = 5`, speculative — FPL's
endpoint doesn't report a page count up front) and upsert each wave as
it completes. Verified against league 314 ("Overall", 9.9M entries,
capped at 2000): **two real bugs** surfaced only at this scale, both
fixed and reverified end to end:
- The existence-check `.in()` query crammed all 2000 entry ids into one
  URL, tripping an HTTP/2 protocol error — chunked into batches of 200,
  matching `lib/leagues.ts`'s own convention.
- A large league's live rank shifts mid-fetch, so two concurrently-fetched
  pages could return the same entry, failing the upsert
  ("ON CONFLICT DO UPDATE command cannot affect row a second time") —
  fixed with a `seenEntryIds` set tracked across the whole sync.
  Final verified run: 2000 entries, 30,000 picks, 0 failures, 47s (test
  data cleaned up afterward — this was verification only, not a real
  sync the owner needs).

**`/deadline` layout** — split the `{gameweekName} deadline` label onto
its own line, separated from the countdown+date block below it (was one
unseparated flex row). Folded "Imported from your real FPL team." into
`IMPORTED_SQUAD_NOTE`'s tooltip content instead of a second always-visible
line.

**`/fixtures` live table** — `deriveStandingsFromFixtures` only counted
`finished` fixtures; extended to count any `started` fixture (live score
included) so the table updates during a gameweek, matching `/deadline`'s
own `livePhase` pattern. Found while verifying against real data: the
first cut flagged a fixture as "still being played" based on `!finished`,
but `finished_provisional` flips at the final whistle well ahead of
`finished` (which waits on bonus confirmation) — a provisional-bonus
match isn't still live. Fixed the `live` signal to key on
`!finished_provisional` instead; reverified against real GW2 fixtures
that are over but still bonus-provisional, which now correctly do *not*
trigger the "still being played" banner.

**Chip plan wiped on re-import** — `teamStateFromPicks`/
`teamStateFromMyTeamJson` build a fresh `TeamState` from
`emptyTeamState`, which never carried forward `chipPlan`, `pinned`,
`notes`, or `strategy` — all four are user intent a fresh FPL pull can't
know. Both import call sites (`app/team/page.tsx`, `app/settings/page.tsx`)
now merge those four fields forward from the draft being overwritten.
Verified live: set a wildcard-GW8 chip plan and a test note on an
imported draft, re-imported, confirmed both survived under the same
`draftId` (no "(2)" duplicate).

**Sell-price accuracy** — `teamStateFromPicks` (the `manager_picks`
import path) fell back every player's `purchasePrice` to current cost,
so `sellPrice()` overstated proceeds for anyone who'd risen in value
since being bought. `lib/manager-transfers.ts`'s already-loaded season
ledger carries `element_in_cost` — the real price paid — for any player
transferred in this season; `teamStateFromPicks` gained an optional
`purchasePriceOf` parameter that takes precedence over the now-cost
fallback when a transfer record exists. A player never transferred this
season (the original squad) still falls back to current cost, same as
before — `IMPORTED_SQUAD_NOTE` updated to describe both cases rather
than one.

### Verification

Same gate (`tsc`, `lint`, `build`, all clean) plus live browser
verification of every item against real production data — including the
two bugs above, which only a real 9.9M-entry league surfaced. No
regressions found; test data created purely for the large-league
verification was cleaned up from the database afterward.
