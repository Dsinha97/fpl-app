# Sprint 25 — Domain cutover + UI defect sweep

**Built** 2026-08-23. Two unrelated pieces of work landed together: `fpldecision.com` was
registered (Cloudflare Registrar) and cut over as the live domain, and eleven UI defects
observed across `/deadline`, `/team`, `/fixtures`, `/chips`, `/players` and the nav shell were
fixed — mostly truncation, dead space and duplicated text the Sprint 22–24 density/expansion
work didn't reach on every surface.

## Domain cutover

Canonical host is the apex, `https://fpldecision.com`; `www.fpldecision.com` redirects to it
(Cloudflare Redirect Rule, 301). The original `fpl-app.deepayansinha.workers.dev` URL keeps
resolving — Cloudflare has no clean off switch for a Git-integration Worker's default domain —
so it stays a live fallback, no longer linked from any doc, still present in the Supabase Auth
redirect allowlist alongside the new domain.

- `wrangler.jsonc` declares both hosts as `custom_domain` routes rather than leaving them as
  dashboard-only state, matching this project's config-in-repo convention.
- Supabase Auth's Site URL and Redirect URLs were updated to include the new origin —
  `app/signin/page.tsx`'s `redirectTo` already derives from `window.location.origin`, so no code
  change there, but the origin still has to be allowlisted or Supabase silently falls back to
  Site URL. Google's OAuth redirect is Supabase's own callback URL and needed no change.
  Edge Function CORS (`Access-Control-Allow-Origin: *`) needed no change either.
  **The owner completed these dashboard steps** — not something a commit can carry.
- Three Deno Edge Functions' `User-Agent` strings (`_shared/fpl.ts`, `sync-news`,
  `fpl-my-team`) now identify the app as `fpl-app/0.1 (+https://fpldecision.com)` — redeployed
  through the Supabase MCP integration.
- Retires a documented blocker: Sprint 14.1 recorded custom SMTP as impossible because sender
  verification wants a domain the app doesn't own. That premise is gone; custom SMTP itself is
  not built this sprint (see roadmap "Next up") — Google OAuth remains the primary sign-in path
  regardless, so this isn't urgent.
- `app/layout.tsx` gained `metadataBase: new URL("https://fpldecision.com")` — previously
  absent (harmless with no OG image or absolute URLs today), but the one place a canonical
  origin belongs in the app itself.

Docs updated: `CLAUDE.md`, `README.md`, [deployment.md](../wiki/deployment.md) (new "Custom
domain" section, privacy note broadened to both hosts), `sprint-14.md` (dated reconciliation
note, body left unedited per the historical-doc convention), `app/signin/page.tsx`'s docstring.

## UI defect sweep

- **`/deadline` live match cards** (`components/live-fixtures.tsx`) now show short team codes
  (ARS, COV) instead of full names, which were truncating unpredictably in a
  `sm:w-[calc(50%-0.375rem)]` card and shifting the crest/score layout. `LiveFixtureTeam`
  already carried `short_name`; it was only feeding `TeamCrest` before. Full name moved to
  `title`. `components/fixture-schedule.tsx`'s `FixtureRow` had the identical issue and got the
  same fix while in the file.
- **`/deadline` Team news** now shows 5 headlines (was rendering 15 while its own summary line
  counted the unsliced total — could read "37 headlines" above a 15-row list) with an "All N
  headlines →" link to `/news` when there are more.
- **`/fixtures` schedule** (`components/fixture-schedule.tsx`) was the last raw `⌃` glyph in the
  codebase — Sprint 24 converted `CollapsibleCard`, `LiveFixtureCard` and `ClubTacticsGrid` but
  missed this file. `FixtureRow` (per-match) now uses `ExpandToggle` + the grid-rows accordion,
  matching the rest of the app. The gameweek section header got the `ExpandToggle` chevron too,
  but deliberately **kept** mount/unmount for its body — animating up to 38 sections would mount
  every gameweek's `FixtureRow`s (each running `parseFixtureStats`) at once instead of only the
  ones actually opened. Sections snap, rows glide.
- **`/team` squad view** cards were overlapping the pitch. Root cause wasn't the pitch layout —
  `player-card.tsx` renders a much taller, centered value block when `next_fixture` is absent,
  and `/team`'s `toCard` never set it (unlike `/deadline` and `/builder`, which do). `/team` now
  fetches each picked gameweek's fixtures and attaches the opponent/H-A/FDR chip keyed by
  `selectedEvent`, not "next" — a historical gameweek shows the fixture it actually played.
- **`/chips`** had two issues. First, dead space: the left column (`Chip sequences`) was a short
  2–3 row list next to a right rail running two tall schedule sections, bottoming out well above
  the row height. The columns were swapped — sequences → schedules → fixture flatness now run
  down the main column, and the four per-chip shortlists (trimmed top-5→top-3, blocked windows
  behind their own disclosure) moved into the narrow rail, which they actually fit. Second, the
  Fixture flatness card was passing the same ~10-sentence `result.note` as both its collapsed
  summary and its always-rendered body (`CollapsibleCard` uses a grid accordion, not
  mount/unmount) — expanding it showed the same paragraph twice. `lib/chips.ts` gained
  `chipModelNoteSummary`, a genuinely separate one-sentence summary, alongside the unchanged
  `chipModelNote`; `ChipEngineResult` carries both as `note`/`noteSummary`.
- **`/players`** — three label fixes. xG/xA columns read `xG (${gwPlayed} GW)` over
  season-to-date totals, which is accurate but not what "xG"/"xA" implies elsewhere in football;
  they're now per-90 rates (`xG/90`/`xA/90`), `—` below 45 minutes, dimmed with the raw total in
  `title` below 180 (a 12-minute cameo reading 7.5 xG/90 isn't a real rate). The `historySeason`
  string ("2025/26") is now run through a new `shortSeason()` helper (`lib/utils.ts`) at all four
  render sites → "25/26". `ConfidenceBadge` gained a `compact` prop pinning it to the two-letter
  `OR`/`PP`/`PR` form at every width, not just below `sm`, passed only from the `xP {horizon}`
  cell — `player-detail.tsx`'s wide panel keeps the full words.
- **Navigation.** Mobile drawer header is now the app's own Monogram + Wordmark (Gmail-sidebar
  style) instead of a plain "Navigation" label, with the dedicated `×` close button removed —
  backdrop tap, Escape, and the hamburger itself (already an `×` while open) were three existing
  ways out; a fourth was redundant. Desktop nav groups now open on hover (translucent
  `bg-popover/80 backdrop-blur-md`) and "solidify" to opaque `bg-popover` on click — a controlled
  `Menu.Root` with `openOnHover`/`delay`/`closeDelay` on `Menu.Trigger` and `modal={false}` (the
  default `true` would have locked page scroll on mere hover, which the old click-only menu
  never triggered).

## Files touched

`wrangler.jsonc`, `app/layout.tsx`, `app/signin/page.tsx`, `supabase/functions/_shared/fpl.ts`,
`supabase/functions/sync-news/index.ts`, `supabase/functions/fpl-my-team/index.ts`,
`components/live-fixtures.tsx`, `components/fixture-schedule.tsx`, `app/team/page.tsx`,
`app/chips/page.tsx`, `lib/chips.ts`, `app/players/page.tsx`, `lib/utils.ts`,
`components/confidence-badge.tsx`, `app/deadline/page.tsx`, `components/nav-links.tsx`.
Plus `CLAUDE.md`, `README.md`, `docs/roadmap.md`, `docs/README.md`,
[deployment.md](../wiki/deployment.md), `sprint-14.md`.

## Verification

`npx tsc --noEmit`, `npm run lint` (0 errors — every warning shown pre-dates this sprint,
confirmed via `git stash`), `npm run build` all green. `chipModelNote`'s body is byte-identical
to before (confirmed by diff, not just re-reading it) — only additive changes, verified with a
throwaway `npx tsx` harness printing both functions' output for a flat-fixtures case and a
blank/double case, kept out of the commit. Browser-verified without auth (no credentials
available in this session for the signed-in `/team`/`/deadline`/`/chips` surfaces):
- `/players` — subtitle, `XG/90`/`XA/90` headers, `PTS 25/26` etc., `OR`/`PP` badges, `—` for
  sub-45-minute players, all confirmed via page text extraction.
- `/fixtures` — short team codes rendering with full name in `title` (confirmed via the
  accessibility tree showing "Arsenal" as the computed name against "ARS" as visible text), no
  `⌃` glyph left in the DOM, zero console errors (checked for the exact hydration failure this
  pattern caused once before, task_ee2fcd44).
- Nav — mobile drawer opens with the wordmark and no close button, backdrop-click-to-close
  confirmed; desktop menu confirmed solid (`bg-popover`) on a real click and translucent
  (`bg-popover/80 backdrop-blur-md`) on a simulated hover-with-movement pointer sequence; body
  scroll confirmed unlocked (`modal={false}`) while a menu is open.

**Known verification gap**: `/deadline`, `/team` and `/chips` need a signed-in manager with an
imported squad — no credentials were available in this session, so the visual results there
(card overlap fix, dead-space repack, team-news trim) are verified by code/type-check and by the
`/fixtures`+`/players` patterns they share, not by looking at the actual pages. Worth a real
pass before considering this fully closed. The desktop hover-open menu is also only verified via
synthetic pointer events with coordinate deltas approximating hover-intent — worth a manual
mouse check too, per `components/ui/action-menu.tsx`'s recorded caution about Base UI's
press-then-drag model making controlled menus less predictable than they look on paper.
