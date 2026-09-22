"use client";

import { useState } from "react";
import { AvailabilityBadge } from "./player-status-icons";
import type { PlayerData } from "./player-card";

/**
 * The player header shared by the anchored popover (`PlayerDetail`) and the
 * full profile modal (`PlayerModal`).
 *
 * Extracted so the two cannot drift: they are deliberately different surfaces
 * — a fast popover for pitch taps, a modal for a deep dive — but a player's
 * name, club, position and availability should read identically in both.
 */

const POSITION_NAME: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/**
 * FPL's player headshots. Verified: `p{code}.png` resolves at both 110x140
 * and 250x250; the same paths without the `p` prefix 403. Per CLAUDE.md,
 * these were probed rather than assumed — several documented patterns don't
 * resolve.
 */
function photoUrl(code: number | null | undefined, size: "110x140" | "250x250"): string | null {
  if (code === null || code === undefined) return null;
  return `https://resources.premierleague.com/premierleague/photos/players/${size}/p${code}.png`;
}

/** FPL's kit graphics. The size suffix is required — `shirt_3.png` 404s. */
function kitUrl(teamCode: number | null, isGk: boolean): string | null {
  if (teamCode === null) return null;
  return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}${
    isGk ? "_1" : ""
  }-110.png`;
}

/** FPL's club crests, per CLAUDE.md's Gotchas — the final fallback, below. */
function crestUrl(teamCode: number | null): string | null {
  if (teamCode === null) return null;
  return `https://resources.premierleague.com/premierleague/badges/70/t${teamCode}.png`;
}

/**
 * Headshot, falling back to the club kit, falling back to the club crest,
 * falling back to nothing.
 *
 * Three independent failures to survive: a player with no photo on file (a
 * January signing, most pre-season), a photo that 404s, and — added for
 * DSI-181 — a kit graphic that also fails to resolve for that club/season.
 * The crest is the one graphic that's essentially guaranteed to exist for any
 * top-flight club, so it's the true last resort before the card shows a
 * broken-image glyph.
 */
function PlayerPortrait({ player, size }: { player: PlayerData; size: number }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [kitFailed, setKitFailed] = useState(false);
  const [crestFailed, setCrestFailed] = useState(false);

  const isGk = player.element_type === 1;
  const photo = photoFailed ? null : photoUrl(player.code, "250x250");
  const kit = kitFailed ? null : kitUrl(player.team_code, isGk);
  const crest = crestFailed ? null : crestUrl(player.team_code);
  const src = photo ?? kit ?? crest;

  return (
    <div
      className="flex shrink-0 items-end justify-center overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-black/5 dark:bg-purple-950/50 dark:ring-white/10"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- static export: no next/image optimisation
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-top"
          onError={() => {
            if (photo) setPhotoFailed(true);
            else if (kit) setKitFailed(true);
            else setCrestFailed(true);
          }}
        />
      ) : null}
    </div>
  );
}

export function PlayerIdentityHeader({
  player,
  size = 56,
  className = "",
}: {
  player: PlayerData;
  /** Portrait edge in px. The popover uses a small one; the modal a large one. */
  size?: number;
  className?: string;
}) {
  return (
    // `min-w-0` on the text column, not just the row: a long name beside a
    // fixed-width portrait is exactly the shape that has twice pushed a page
    // into sideways scroll (DSI-138, DSI-141). Flex items default to
    // min-width:auto and refuse to shrink below their content without it.
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <PlayerPortrait player={player} size={size} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {player.web_name}
        </p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {player.team_short ? `${player.team_short} · ` : ""}
          {POSITION_NAME[player.element_type] ?? "—"}
        </p>
        {(player.status ?? "a") !== "a" && (
          <div className="mt-1">
            <AvailabilityBadge
              status={player.status}
              chanceOfPlaying={player.chance_of_playing_next_round}
              news={player.news}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export { POSITION_NAME };
