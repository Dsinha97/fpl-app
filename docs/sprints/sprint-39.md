# Sprint 39 — Player-profile bug sweep, prediction-pipeline reliability, expected-minutes cohort split

**Started 2026-09-21.** Scoped from the 2026-09-21 `/linear-sync` review: three ready-now items
with no data or owner-decision gate, tracked under parent
[DSI-182](https://linear.app/dsinha-org/issue/DSI-182). DSI-53 was canceled the same day (its
precondition answered "don't refit," rescoped into DSI-178 below); DSI-55 was reviewed alongside
this sprint and found stale — [rescoped separately](https://linear.app/dsinha-org/issue/DSI-55),
not part of this sprint's build.

## Scope

### DSI-181 — Sprint 38 UI bugs (7 sub-items)

1. Player-profile card cuts off action buttons, forces scrolling to reach them —
   `components/player-detail.tsx`.
2. Tooltip popup hidden behind the player card (z-index) — `components/info-tooltip.tsx`'s
   `TapToReveal` portal sits below `components/player-modal.tsx`'s `DesktopDialog` panel.
3. Full player card outside `/players` doesn't show price watch — `/builder`, `/team`,
   `/deadline` open `PlayerModal` without loading `priceProgress`, unlike `/players`,
   `/transfers`, `/shortlist`.
4. Club-crest fallback for players with no profile photo — extend
   `components/player-identity.tsx`'s existing photo→kit `onError` chain.
5. Add "# Owned" to the player card's transfers tab —
   `components/player-modal/overview-tab.tsx`.
6. Sort-by-Price-Watch on `/players` — `app/players/page.tsx`'s `SortKey`/`sorted` logic.
7. Notify when a squad or shortlist player nears a price-change threshold — extends
   `supabase/functions/notify/index.ts` to read `lib/price-watch.ts`'s existing
   `isNearThreshold()`/`priceProgress()` against squad and shortlist.

### DSI-142 — generate-predictions 401s

`supabase/functions/_shared/cron-auth.ts`'s `verifyCron` fails closed on any RPC error with
no retry, and a refused run writes no `sync_runs` row — a third bug-report of the shape
Sprint 36 named: "work that silently does not happen and renders as absence." Fix: bounded
retry around the RPC call, and a `sync_runs` row written even on refusal so `/settings` →
Pipeline stops reporting the function as healthy through a third of its dropped runs.

### DSI-178 — expected-minutes discrimination

Pooled GW5 bias (−0.080, n=2,587) hides two cancelling cohorts: appeared players
+0.627 (n=1,223), no-shows −0.714 (n=1,364) — a discrimination failure in `expectedMinutes`/
`startProbability`, not a calibration offset `positionCalibration` could reach (this is why
DSI-53 was canceled rather than run). Gate: score `scripts/backtest-walkforward.ts`'s existing
backtest per cohort as well as pooled, using the same `accuracyStats` (`lib/stats.ts:108`) the
live scoreboard shares — plus a secondary discrimination metric (AUC or Brier on "started"),
since the pooled bias is demonstrably blind to this. Also open: GKP bias −0.319 (n=281,
t=−2.78) is the one position-level bias surviving the cohort split — worth checking whether
it's the same minutes story or something in the saves/clean-sheet terms. Sized for the M7
GW10 batch; this sprint adds the harness capability, not a refit.

## Status

**Built and shipped 2026-09-21.** All three items done, verified, and deployed; DSI-182 and
its three children closed in Linear.

- **DSI-181** — all 7 items implemented and verified live in the preview browser, signed in:
  panel no longer needs scrolling for the worst-case action-button set (439px content under a
  480px cap), tooltip renders above the modal (z-60 vs the modal's z-50), price watch now
  loads from `/team`/`/deadline`/`/builder` (confirmed via a live modal open on `/team`), sort
  by Price Watch orders by proximity magnitude regardless of direction (confirmed live), and
  the "Nearing a price change" notification toggle renders in Settings. The migration
  (`20260921220000_sprint39_price_watch_notify.sql`) and the `notify` function redeploy both
  applied to the live project; RLS verified in a rolled-back transaction (zero cross-user
  reads/writes on `user_notification_prefs` and `notification_outbox`).
- **DSI-142** — `cron-auth.ts`'s retry and `generate-predictions`' denial-path `sync_runs` row
  both deployed (function version 21). Static verification only: the deployed bundle was
  downloaded back and diffed against local source after two transcription errors were caught
  and fixed mid-deploy (a corrupted `applySquadScale` field name, then a literal placeholder
  string left in `xp-model.ts`) — both introduced and caught within the same session, before
  being reported. Live confirmation is a `sync_runs` check over the following day's cron runs,
  not yet done as of this entry.
- **DSI-178** — `scripts/backtest-walkforward.ts` changes run live against real data across all
  four backtest seasons; the new `byAppearance`/`gkpByAppearance`/`startBrier` fields print
  correctly and show the same cancelling appeared/no-show pattern DSI-50 found. Harness
  capability only — no calibration change shipped, matching the issue's own scope.

Gate: `npx tsc --noEmit`, `npm run lint` (pre-existing unrelated failures only, in
`.claude/helpers/*.cjs` and two other files untouched this sprint), `npm run build` — all
clean on every commit boundary this sprint touched.
