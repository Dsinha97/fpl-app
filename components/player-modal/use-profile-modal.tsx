"use client";

import { useCallback, useEffect, useState } from "react";
import { PlayerModal } from "@/components/player-modal";
import { loadPositionRanks, type PositionRanks } from "@/lib/player-ranks";
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

  const ranks = providedRanks ?? loadedRanks;

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
        onClose={closeProfile}
      />
    ) : null;

  return { openProfile, closeProfile, modal };
}
