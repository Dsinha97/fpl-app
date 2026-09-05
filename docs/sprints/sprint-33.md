# Sprint 33 — Four page merges, and the drawer primitive that was hiding inside the nav

Built 2026-09-05. Triggered by a one-line observation from the owner: `/compare`
should be a panel on `/players`, opened by the Compare button that is already
there — plus "find me similar candidates". Four of the seventeen routes turned
out to be halves of a task the other half already owned, and the survey that
found them is recorded in §5 along with the three that were rejected.

The through-line is not tidiness. Each merge removed a duplicated loader, a
duplicated control, or a second source of truth that could disagree with the
first — and in two cases the merge exposed a real defect that only existed
because the halves were apart.

---

## 0. `SlideOver` — the primitive that already existed, once

`components/ui/` had no drawer, sheet, dialog or modal. The only real
slide-over in the app was **inlined inside `MobileNav`**
(`components/nav-links.tsx`): backdrop, `role="dialog"`/`aria-modal`, a
body-scroll lock effect, and `useDismissablePopover`.

`/players` needed the same thing on the other edge. Copying forty lines of
focus-and-scroll-trapping overlay is a bug with a delay on it, so it was lifted
into `components/ui/slide-over.tsx` first, and `MobileNav` re-expressed through
it. It takes `side`, `label`, `width` and a `triggerRef` — the last so that
clicking the trigger to *close* is not first read as an outside-click that
closes it, then a toggle that reopens it.

## 1. `/compare` → a panel on `/players`

**The two pages fetched the same five tables for the same gameweek**
(`gameweeks`, `players`, `teams`, `player_xp_horizons`, `player_predictions`,
`fixtures`), imported the same `lib/scoring` and `lib/team-state`, derived
`seasonWindow` with the same `FALLBACK_SEASON_WINDOW = 8` and the same comment,
and rendered a **byte-identical** horizon button row. `/players`' own loader
even carried a comment saying it used "the same pattern `/compare` already
uses".

The link between them carried a list of ids and nothing else. So the horizon
you had just set on `/players` was discarded crossing to `/compare`, and you
set it again on arrival. That is the whole reason to merge: **one horizon
control, not two that cannot agree.**

`components/compare-panel.tsx` is `/compare`'s body — metric table, `winnerOf`,
set-pieces and fixture rows, the `comparePlayers` ranking — lifted intact and
made **stateless**. Everything is a prop, which is what lets it live in a
slide-over.

Three things had to change on `/players`:

- **`selected` became an ordered `number[]`.** It was a `Set<number>` while its
  only job was building a query string. Compare columns are laid out in
  selection order and a Set has none.
- **The `players` select widened to the superset** (`points_per_game`, `bonus`,
  `form`, `defensive_contribution`). This fixed a real gap rather than just
  feeding the panel: `toScoredPlayer` passed `pointsPerGame: null` purely
  because the column was not fetched, and `ScoredPlayer.form` was documented as
  "only `/compare` populates it".
- **`?ids=` seeding moved here**, so `/compare`'s redirect stub and `/builder`'s
  replacement-finder deep link still open a comparison rather than dropping the
  visitor on a table with some boxes ticked.

Two small corrections made in passing, both visible only once the code was read
closely: the ranking heading printed *"Ranking over season gameweeks"* on the
season horizon (now `horizonLabel`), and the action bar appeared only from the
second selection, which reads as an unexplained state change — it shows from
one now, and one player is a legitimate thing to want a profile of.

## 2. `/chips` → the "Chip timing" tab on `/transfers`

Both plan the same draft with the same engine — `lib/chips`, `lib/chip-plan`,
`resolveRequestedDraft`, the same `lib/player-pool` cache key — and
`/transfers` already rendered a `ChipPlanEditor`. Chip timing is an *input* to
the transfer path, not a separate question. They were being read together and
edited apart.

**The one real decision was the draft.** `ChipTiming` does not resolve its own
any more; it takes `drafts`/`draftId` as props and reports writes back through
`onDraftsChanged`. Two draft selectors on one page that can disagree is worse
than one that cannot, so `/transfers`' selector moved up out of the simulator's
control row to sit beside the tabs and govern both. The horizon control stayed
with the simulator, which is the only tab that uses it.

The tab **mounts lazily**: the chip engine does its own player, prediction,
fixture and chip-definition loads, and someone only planning transfers should
not pay for them.

Three links inside the extracted component pointed at `/transfers`, which is
now the page it renders inside. "See it on Transfers →" became a button that
switches tab; two sentences name the tab rather than the route.

## 3. `/review` → under `/team`'s gameweek selector

`/review` was the post-mortem on a finished gameweek. `/team`'s gameweek
selector **already was** a past-gameweek view — so this was the same question
asked on a second page, with a second event picker that could disagree with the
first (`loadFinishedEvents` there, `picksByEvent` here).

Now there is one picker. `GameweekReviewPanel` renders beneath the pitch, gated
on `data.finishedEvents.has(selectedEvent)` — this page's single source for
"finished", so no second list exists to disagree. A post-mortem on a match
still being played is a different and wrong claim, so a live gameweek shows
nothing rather than a provisional review.

`players` is passed in rather than re-read: `/review` fetched its own 1000-row
copy of a map `/team` was already holding.

`?event=` is honoured on `/team`, so the redirect stub keeps deep links
pointing at the gameweek they named.

**This merge depends on the `/team` past-gameweek fix landing first** (separate
commit, merged before this branch): without it the tiles above the review
showed the *current* gameweek's points while the review below showed the
selected one's — two numbers for one gameweek, on one screen, disagreeing.

## 4. `/status` → the "Pipeline" tab on `/settings`

The smallest, and the one with the trap.

Sprint 22 had already taken `/status` out of `NAV_GROUPS`, on the reasoning
that a data-freshness page belongs beside account settings rather than
competing for a nav slot — it lived in `AccountMenu`. This finished the move
instead of leaving a route reachable only from a dropdown.

**The trap: `/settings` redirects signed-out visitors to `/signin`, and
`/status` did not.** `sync_runs` and the row counts are public-read under RLS,
so folding the page in behind the gate would have quietly taken a public page
private — a merge silently removing access is exactly the kind of change that
gets noticed a month later. Caught by opening `/status/` signed-out in the
browser rather than by reasoning about it.

The auth gate is now scoped: the Pipeline tab is exempt, the other two are not,
and signed-out the page renders as "Pipeline" with no dead-end tab strip. The
gate reads the tab from `window.location.search` rather than from `tab` state,
because both mount effects run after the first render and `tab` is still its
`"account"` default when a signed-out visitor arrives on `?tab=status`.

## 5. The three merges that were rejected, and why

The survey covered all seventeen routes. These looked like candidates and are
not:

- **`/scenarios` into `/builder`** — 2570 + 1329 lines over the same drafts,
  but two genuinely different tasks (build one squad; compare several). Shared
  state is not shared purpose.
- **`/news` into `/deadline`** — the Deadline Hub already embeds the feed. The
  standalone page is the archive view, which is a different reading.
- **`/leagues` into `/team`** — manager-scoped in common and nothing else: two
  lib imports, no draft, `TeamState` or horizon coupling. The most isolated
  page in the app alongside `/review`.

`/changes` needed nothing: Sprint 20 already made it a redirect stub to
`/news`, and it is the shape all four new stubs copy.

## Verification

Run against the live database in the preview browser, not reasoned about.

- **`/players`** — three players ticked, panel opens with `form` and PPG
  populated (proving the widened select is wired), best-value highlighting
  intact, Escape and the backdrop close it.
- **Every redirect stub** hit directly under `trailingSlash: true`:
  `/compare/?ids=355,326` → `/players/?ids=355,326&panel=compare` with the
  panel open; `/chips/` → `/transfers/?tab=chips`; `/review/?event=1` →
  `/team/?event=1` with the selector on GW1; `/status/` →
  `/settings/?tab=status`.
- **`/transfers`** — the chip engine renders in-tab against a real imported
  draft with the shared Squad selector, and switching back restores the
  simulator.
- **`/team`** — GW1 selected shows the review with GW1's real figures (49 pts,
  overall rank 4,673,927, the captain counterfactual); GW3, still live, shows
  no review at all.
- **`/settings/?tab=status` signed out** — renders the pipeline log.
- **Mobile (375×812)** — the compare panel is 360px against a 404px viewport,
  so the backdrop stays tappable; body scroll is locked; the wide metric table
  scrolls inside its own container and the page itself does not scroll
  horizontally.
- `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build` all pass.

Noted while verifying, unrelated to this sprint and not fixed here:
`sync-live-gameweek` is failing with a `403` from
`fantasy.premierleague.com/api/event/3/live/`.

## Out of scope

Deleting the redirect stubs (they are 20–30 lines each and keep external links
alive); any change to the merged pages' engines — every one of these moves is a
relocation, and the numbers are the numbers they were.
