# Sprint 26 — Casual-user on-ramps and load staging

Not a numbered sprint at the time either commit landed (2026-08-23/24) — recorded here
retroactively during the post-GW1 docs reconciliation pass (2026-08-27), since neither had a
sprint file or a roadmap row despite being real, user-facing changes. Both are bug-fix/polish
passes prompted by using the app, in the same vein as "Rivals fixes & card density" and "Mobile
one-handed reachability" above — grouped into one sprint number here because they share a theme
(making the app usable for someone who isn't the owner, and fast enough to not feel broken while
predictions load), not because they were planned together.

## `45ff633` — casual-user on-ramps

A casual tester (not the owner) found three real problems:

- **The empty-slot builder gave no affordance to add a player.** Fixed with a "+" on empty pitch
  slots, mirroring the existing replace-picker flow rather than inventing a second picker UI.
- **The squad-import CTA was buried.** Surfaced in the `ContextBar`, the home page, the account
  menu, and the `/team` header — four places someone might reasonably be looking for it, rather
  than one.
- **Pages were slow.** Root cause: `/transfers` and `/chips` each hand-copied a serial
  `player_predictions` paging loop — the same "page past the API's 1000-row cap" logic
  independently written twice. Replaced with `lib/player-pool.ts`, a single parallelized,
  memoized loader. Measured: the paged series that used to take a ~5s serial staircase now
  finishes in ~1.7s via concurrent requests, and `/transfers → /chips` client-side navigation
  issues zero `player_predictions` requests (served from the cache) instead of a full redundant
  refetch.
- `/scenarios`' per-draft engines gained the same `setTimeout(0)` busy-state gating `/transfers`
  and `/chips` already used, fixing a real main-thread freeze on every horizon click.

Also ran the `wiki-ingest` pass for Sprint 25 (the domain-cutover half was already ingested; the
UI-defect-sweep half wasn't) and cleared stale leftovers from `.pending-ingest`.

## `ca7dc04` — staged deadline load, squad value, not-played disclosure

- **`/deadline` no longer blocks the whole page behind the sequential `player_predictions` paging
  loop.** The squad view paints as soon as its own batch lands; predictions load in two stages
  (the deadline gameweek first, then the rest of the horizon) with skeletons/spinners over
  sections still waiting. The transfer optimiser and transfer path stay disabled until the full
  per-event series is in — running either against a partial series would silently price moves
  wrong for the events not yet loaded.
- **Squad Value** joins Bank in the persistent context bar, via a new `squadSellValue` helper —
  FPL's own selling-price rule (not `now_cost`, which overstates a squad that's had a price rise).
- **`/team` shows `–` instead of a misleading `0`** for a player whose fixture hasn't kicked off
  yet, reusing the existing `matchStatusForTeam` check rather than a second not-started test.
- `player-card`'s xP slot can show an explicit "still calculating" shimmer instead of an ambiguous
  em dash while a page's predictions are still in flight — the em dash was already used for "no
  prediction exists", so the two states needed to look different.

## Files touched

`45ff633`: `components/pitch-view.tsx`, `components/context-bar.tsx`, `app/page.tsx`,
`components/account-menu.tsx`, `app/team/page.tsx`, `lib/player-pool.ts` (new),
`app/transfers/page.tsx`, `app/scenarios/page.tsx`, `components/player-card.tsx`, plus
`app/compare`/`app/fixtures`/`app/players`/`app/deadline` pulled onto the same `lib/player-pool.ts`
loader.

`ca7dc04`: `app/deadline/page.tsx`, `lib/squad-budget.ts` (`squadSellValue`),
`components/context-bar.tsx`, `app/team/page.tsx`, `components/player-card.tsx`,
`components/transfer-path.tsx`.
