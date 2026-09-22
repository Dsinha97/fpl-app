"use client";

import { useCallback, useEffect, useState } from "react";
import { PlayerModal } from "@/components/player-modal";
import { loadPositionRanks, type PositionRanks } from "@/lib/player-ranks";
import { loadPriceProgress, type PriceProgress } from "@/lib/price-watch";
import type { PlayerData } from "@/components/player-card";

/**
 * The profile modal's plumbing, for pages that open it from a pitch popover.
 *
 * `/players` wires the modal itself, because it holds the player pool and can
 * build rank cohorts for free, and because it owns the `?player=` deep link.
 * `/team`, `/deadline` and `/builder` open it from `PitchView` and need none
 * of that — so rather than repeat state, rank loading and the render three
 * times, they take this.
 *
 * Ranks load lazily on first open, not on mount: a page that never opens a
 * profile should not pay for a pool it does not otherwise need.
 */
export function useProfileModal({
  season,
  currentEvent,
  teamShortById,
  ranks: providedRanks,
}: {
  season: string | null;
  currentEvent: number | null;
  teamShortById: Map<number, string>;
  /** Pass a pool-built set if the page already has one; otherwise it loads. */
  ranks?: PositionRanks;
}) {
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [loadedRanks, setLoadedRanks] = useState<PositionRanks | undefined>(undefined);
  // Keyed by the code it was loaded for, not reset eagerly on every player
  // change — a synchronous setState at the top of an effect body cascades an
  // extra render. Instead the stale reading is simply never handed to the
  // modal below, via the code comparison.
  const [loadedPriceProgress, setLoadedPriceProgress] = useState<
    { code: number; progress: PriceProgress | undefined } | undefined
  >(undefined);

  const ranks = providedRanks ?? loadedRanks;
  const priceProgress =
    player?.code && loadedPriceProgress?.code === player.code ? loadedPriceProgress.progress : undefined;

  useEffect(() => {
    if (player === null || season === null || providedRanks || loadedRanks) return;
    let live = true;
    loadPositionRanks(season)
      .then((r) => live && setLoadedRanks(r))
      // Captions are absent rather than wrong if this fails — the rest of
      // the card is unaffected, so this is not worth surfacing as an error.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [player, season, providedRanks, loadedRanks]);

  // Price watch, lazily on first open — same pattern as ranks above. Only
  // /players, /transfers and /shortlist loaded this for the modal (DSI-181);
  // /team, /deadline and /builder all route through this shared hook, so
  // loading it here once covers all three rather than repeating the fetch
  // per page.
  useEffect(() => {
    if (player === null || season === null || !player.code) return;
    const code = player.code;
    let live = true;
    loadPriceProgress(season, [code])
      .then((m) => live && setLoadedPriceProgress({ code, progress: m.get(code) }))
      .catch(() => live && setLoadedPriceProgress({ code, progress: undefined }));
    return () => {
      live = false;
    };
  }, [player, season]);

  const openProfile = useCallback((p: PlayerData) => setPlayer(p), []);
  const closeProfile = useCallback(() => setPlayer(null), []);

  const modal =
    player && season ? (
      <PlayerModal
        player={player}
        season={season}
        teamShortById={teamShortById}
        currentEvent={currentEvent}
        ranks={ranks}
        priceProgress={priceProgress}
        onClose={closeProfile}
      />
    ) : null;

  return { openProfile, closeProfile, modal };
}
