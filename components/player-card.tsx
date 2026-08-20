"use client";

import Image from "next/image";
import { useState } from "react";
import { FDRBadge } from "./fdr-badge";
import { StatusBadge } from "./player-status-icons";
import { asRating } from "@/lib/fdr";

export interface UpcomingFixture {
  event: number;
  opponent_short_name: string;
  is_home: boolean;
  fdr: number;
}

export interface PlayerData {
  id: number;
  web_name: string;
  team_code: number | null;
  element_type: number;
  now_cost: number;
  /** The headline number on the card. xP by default — see `value_note`. */
  expected_points?: number | null;
  /**
   * What that number means, as its tooltip. The same slot shows a projection
   * on /builder and a gameweek's real points on /team, and a number that can
   * be either has to say which — CLAUDE.md's "say what the number means".
   * Defaults to the xP wording.
   */
  value_note?: string | null;
  /** Decimals for the headline number. Real points are whole; xP is not. */
  value_decimals?: number;
  status?: string | null;
  chance_of_playing_next_round?: number | null;
  is_captain?: boolean;
  is_vice_captain?: boolean;
  is_penalty_taker?: boolean;
  is_freekick_taker?: boolean;
  is_corner_taker?: boolean;
  is_rotation_risk?: boolean;
  next_fixture?: {
    opponent_short_name: string;
    is_home: boolean;
    fdr: number;
  } | null;

  // --- detail-panel extras (not rendered on the card itself) -----------
  team_short?: string | null;
  news?: string | null;
  ownership?: number | null;
  xp5?: number | null;
  expected_minutes?: number | null;
  start_probability?: number | null;
  upcoming?: UpcomingFixture[];
  /** Probability this bench slot is used by an auto-sub, when benched. */
  sub_probability?: number | null;
  /** One-line club tactical summary (Sprint 12.5), e.g. "4-3-3 · Possession control · high press". */
  system?: string | null;
  /** How much of expected_points is the player's own record vs a fitted prior — see ConfidenceBadge. Only populated where the caller already has it cheaply (currently /builder); undefined elsewhere hides the badge, it never guesses. */
  reliability?: "high" | "medium" | "low" | null;
  prior_weight?: number | null;
  /** The rate-uncertainty band around expected_points — see RateBand. */
  rate_lower?: number | null;
  rate_upper?: number | null;
  /**
   * GW1 predicted-lineup layer (lib/gw1-lineups.ts) — undefined hides the
   * badge/detail block, same convention as `reliability` above. Gone once
   * GW1 is scored.
   */
  gw1_tier?: "locked" | "medium" | "high" | null;
  gw1_in_predicted_xi?: boolean | null;
  gw1_note?: string | null;
}

interface PlayerCardProps {
  player: PlayerData;
  /** Receives the clicked element so the caller can anchor a popover to it. */
  onSelect?: (player: PlayerData, anchor: HTMLElement) => void;
  isBenchSlot?: boolean;
  benchIndex?: number;
}

/**
 * FPL's kit graphics. The path needs the size suffix — `shirt_3.png` 404s
 * while `shirt_3-110.png` resolves — and goalkeepers use a `_1` variant.
 */
function kitUrl(teamCode: number | null, isGk: boolean): string | null {
  if (teamCode === null) return null;
  return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}${
    isGk ? "_1" : ""
  }-110.png`;
}

/** Neutral jersey for players whose kit fails to load or has no team code. */
function KitFallback() {
  return (
    <svg viewBox="0 0 64 72" className="h-full w-full" aria-hidden="true">
      <path
        d="M22 8 L10 16 L4 30 L14 36 L16 30 L16 66 L48 66 L48 30 L50 36 L60 30 L54 16 L42 8 L32 16 Z"
        className="fill-purple-300 stroke-purple-800 dark:fill-purple-800 dark:stroke-purple-500"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayerCard({ player, onSelect, isBenchSlot = false, benchIndex }: PlayerCardProps) {
  const [kitFailed, setKitFailed] = useState(false);

  const isGk = player.element_type === 1;
  const src = kitUrl(player.team_code, isGk);

  const specialRole =
    player.is_penalty_taker ||
    player.is_freekick_taker ||
    player.is_corner_taker ||
    player.is_rotation_risk;

  const statusIssue =
    (player.status !== undefined && player.status !== null && player.status !== "a") ||
    (player.chance_of_playing_next_round !== null &&
      player.chance_of_playing_next_round !== undefined &&
      player.chance_of_playing_next_round < 100);

  const hasXp = player.expected_points !== undefined && player.expected_points !== null;

  return (
    <button
      type="button"
      onClick={(e) => onSelect?.(player, e.currentTarget)}
      title={player.web_name}
      className="group relative flex w-16 cursor-pointer select-none flex-col items-center justify-center rounded-md transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-20"
    >
      {/* Captain / vice badge */}
      {player.is_captain && (
        <span className="absolute -left-1 -top-1 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 border-emerald-400 bg-purple-950 text-[10px] font-extrabold text-emerald-400 shadow-md">
          C
        </span>
      )}
      {player.is_vice_captain && !player.is_captain && (
        <span className="absolute -left-1 -top-1 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 border-purple-500 bg-purple-950 text-[9px] font-extrabold text-slate-200 shadow-md">
          VC
        </span>
      )}

      {/* Availability / role indicator */}
      {(statusIssue || specialRole) && (
        <span className="absolute -right-1 -top-1 z-20 rounded-full border border-purple-700 bg-purple-950/90 p-0.5 shadow-md">
          <StatusBadge
            status={player.status}
            chanceOfPlaying={player.chance_of_playing_next_round}
            isPenaltyTaker={player.is_penalty_taker}
            isFreeKickTaker={player.is_freekick_taker}
            isCornerTaker={player.is_corner_taker}
            isRotationRisk={player.is_rotation_risk}
            size="w-4 h-4"
          />
        </span>
      )}

      {/* Kit */}
      <span className="relative flex h-12 w-11 items-center justify-center drop-shadow-lg sm:h-14 sm:w-13">
        {src && !kitFailed ? (
          <Image
            src={src}
            alt=""
            width={64}
            height={72}
            className="object-contain"
            unoptimized
            // At most 15 small kits, all within the pitch: lazy-loading only
            // risks blank shirts on first paint.
            loading="eager"
            onError={() => setKitFailed(true)}
          />
        ) : (
          <KitFallback />
        )}
        {isBenchSlot && benchIndex !== undefined && (
          <span className="absolute bottom-0 right-0 rounded border border-purple-700 bg-purple-950/90 px-1 font-mono text-[9px] text-purple-200">
            {benchIndex === 0 ? "GK" : `${benchIndex}`}
          </span>
        )}
      </span>

      {/* Name */}
      {/* xP used to be smaller than the name it sits under (9px vs 10px) on
          the one screen that exists to show it — inverted within the same
          64-80px budget rather than growing the card (Sprint 19, Stage 4b). */}
      <span className="w-full rounded-t-md border border-purple-700/80 bg-purple-950/90 px-1 py-0.5 text-center shadow-md backdrop-blur-sm">
        <span className="block truncate text-[9px] font-semibold text-white">{player.web_name}</span>
      </span>

      {/* xP + next fixture. Always xP, never price — mixing the two units in
          one column made a no-projection player look like a cheap one. */}
      <span className="flex w-full items-center justify-between rounded-b-md border-x border-b border-purple-700/80 bg-purple-900/90 px-1 py-0.5 text-[9px] text-purple-200 shadow-md dark:bg-slate-900/95">
        {hasXp ? (
          <span
            className="text-[10px] font-bold text-emerald-400"
            title={player.value_note ?? "Expected points (xP) over the selected horizon"}
          >
            {player.expected_points!.toFixed(player.value_decimals ?? 1)}
          </span>
        ) : (
          <span
            className="text-[10px] font-bold text-purple-400"
            title="No xP projection — not enough prior-season minutes to model"
          >
            —
          </span>
        )}
        {player.next_fixture && (
          <FDRBadge
            rating={asRating(player.next_fixture.fdr)}
            className={`px-1 py-0 text-[8px] font-bold ring-1 ${
              player.next_fixture.is_home ? "ring-green-400" : "ring-red-400"
            }`}
          >
            {player.next_fixture.opponent_short_name}
            {/* Home/away as text only from sm up — below that this single span,
                shown or hidden as a whole, is the only way to keep the venue
                ring (kept at every width) from also needing wrappable text. A
                bare " (H)" text node next to the opponent code is a legal
                line-break point inside this 64px card. */}
            <span className="hidden sm:inline">
              {player.next_fixture.is_home ? " (H)" : " (A)"}
            </span>
          </FDRBadge>
        )}
      </span>
    </button>
  );
}

/** Dashed outline for an unfilled squad slot. */
export function EmptySlot({ label }: { label: string }) {
  return (
    <span className="flex w-16 flex-col items-center justify-center sm:w-20">
      <span className="flex h-12 w-11 items-center justify-center rounded-md border-2 border-dashed border-purple-200/50 sm:h-14 sm:w-13 dark:border-purple-400/30">
        <span className="text-[10px] font-semibold text-purple-100/70 dark:text-purple-300/60">
          {label}
        </span>
      </span>
      <span className="mt-1 h-[1.1rem] w-full rounded border border-dashed border-purple-200/40 dark:border-purple-400/25" />
    </span>
  );
}
