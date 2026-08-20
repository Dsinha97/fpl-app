"use client";

import { useEffect, useRef } from "react";
import { FixtureCell } from "./fdr-badge";
import { AvailabilityBadge, RoleBadges } from "./player-status-icons";
import { ConfidenceBadge, RateBand } from "./confidence-badge";
import { Gw1Badge } from "./gw1-badge";
import type { PlayerData } from "./player-card";

const POSITION_NAME: Record<number, string> = {
  1: "Goalkeeper",
  2: "Defender",
  3: "Midfielder",
  4: "Forward",
};

const STATUS_TEXT: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};

/** Panel width and max height, also used to keep it inside the pitch. */
export const PANEL_WIDTH = 268;
export const PANEL_MAX_HEIGHT = 340;

interface PlayerDetailProps {
  player: PlayerData;
  /** Position within the anchoring container, in pixels. */
  top: number;
  left: number;
  onClose: () => void;
  /** Omitted on a read-only panel — each action's button renders only when its handler is given. */
  onSetCaptain?: (playerId: number) => void;
  onSetVice?: (playerId: number) => void;
  onRemove?: (playerId: number) => void;
  /**
   * When the panel is opened from the player picker rather than the pitch, the
   * player may not be in the squad — the actions become Add and Replace
   * instead of the armband controls.
   */
  owned?: boolean;
  onAdd?: (playerId: number) => void;
  addDisabledReason?: string | null;
  /** Overrides the add button's label — "Swap in" while replacing a squad player. */
  addLabel?: string;
  onFindReplacement?: (playerId: number) => void;
  /**
   * Position against the viewport rather than the nearest positioned ancestor.
   * The player picker is a narrow, short column — anchoring inside it would put
   * the panel on top of the very row that was clicked — so it floats alongside
   * instead.
   */
  fixed?: boolean;
}

export function PlayerDetail({
  player,
  top,
  left,
  onClose,
  onSetCaptain,
  onSetVice,
  onRemove,
  owned = true,
  onAdd,
  addDisabledReason = null,
  addLabel = "Add to squad",
  onFindReplacement,
  fixed = false,
}: PlayerDetailProps) {
  const panel = useRef<HTMLDivElement>(null);

  // Any click outside the panel dismisses it, as does Escape. The listener is
  // bound to the panel rather than the pitch, so clicking the grass closes it
  // too — previously the whole pitch counted as "inside".
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const statusCode = player.status ?? "a";
  const statusLabel = STATUS_TEXT[statusCode] ?? statusCode;
  const chance = player.chance_of_playing_next_round;

  const stat = (label: string, value: string, accent = false) => (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`text-sm font-semibold tabular-nums ${
          accent ? "text-purple-800 dark:text-primary" : "text-zinc-900 dark:text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={`${player.web_name} details`}
      style={{ top, left, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
      className={`z-40 overflow-y-auto rounded-lg border border-zinc-200 bg-card p-3 shadow-2xl dark:border-purple-700 ${
        fixed ? "fixed" : "absolute"
      }`}
    >
      {/* header */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {player.web_name}
          </p>
          <p className="text-[11px] text-zinc-500">
            {player.team_short ? `${player.team_short} · ` : ""}
            {POSITION_NAME[player.element_type] ?? "—"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-purple-950/60 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>

      {/*
        xP is the headline number the whole app is built to produce, but it
        used to sit in a 3-column grid at the same text-sm weight as Price —
        second slot, no larger than anything else. Promoted to its own row at
        3xl, with ConfidenceBadge/RateBand surfaced beside it: the detail
        panel is exactly where a reader inspects the number, and it previously
        showed no provenance or uncertainty at all here (Sprint 19, Stage 4b).
      */}
      <div className="mt-2.5 flex items-start justify-between gap-2 border-t border-zinc-100 pt-2.5 dark:border-purple-900/40">
        <div>
          <div
            className="text-[10px] uppercase tracking-wide text-zinc-500"
            title={player.value_note ?? "Expected points (xP) over the selected horizon"}
          >
            {player.value_note ? "Points" : "Expected points"}
          </div>
          <div className="text-3xl font-bold tabular-nums text-purple-800 dark:text-primary">
            {player.expected_points !== undefined && player.expected_points !== null
              ? player.expected_points.toFixed(1)
              : "—"}
          </div>
        </div>
        {(player.reliability || player.rate_lower !== undefined) && (
          <div className="flex flex-col items-end gap-1 pt-0.5">
            <ConfidenceBadge reliability={player.reliability} priorWeight={player.prior_weight} />
            <RateBand lower={player.rate_lower} upper={player.rate_upper} />
          </div>
        )}
      </div>

      {/* supporting numbers */}
      <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-2.5 dark:border-purple-900/40">
        {stat("Price", `£${(player.now_cost / 10).toFixed(1)}m`)}
        {stat("xP 5", player.xp5 !== undefined && player.xp5 !== null ? player.xp5.toFixed(1) : "—")}
        {stat(
          "Exp. mins",
          player.expected_minutes !== undefined && player.expected_minutes !== null
            ? Math.round(player.expected_minutes).toString()
            : "—",
        )}
        {stat(
          "Start %",
          player.start_probability !== undefined && player.start_probability !== null
            ? `${Math.round(player.start_probability * 100)}%`
            : "—",
        )}
        {stat(
          "Owned",
          player.ownership !== undefined && player.ownership !== null
            ? `${player.ownership}%`
            : "—",
        )}
      </div>

      {/* club system — Sprint 12.5, context only, never folded into xP */}
      {player.system && (
        <p
          className="mt-2.5 truncate border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-500 dark:border-purple-900/40 dark:text-zinc-400"
          title={`System: ${player.system} — tactical context, not applied to xP.`}
        >
          <span className="font-medium text-zinc-600 dark:text-zinc-300">System</span> · {player.system}
        </p>
      )}

      {/* GW1 predicted lineup — affects the risk figure and the badges only, never xP */}
      {player.gw1_tier && (
        <div className="mt-2.5 flex items-start gap-2 border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-500 dark:border-purple-900/40 dark:text-zinc-400">
          <Gw1Badge
            tier={player.gw1_tier}
            note={player.gw1_note}
            inPredictedXi={player.gw1_in_predicted_xi ?? undefined}
            className="mt-0.5"
          />
          <span>
            {player.gw1_in_predicted_xi === false ? "Not in the GW1 predicted XI" : "In the GW1 predicted XI"}
            {player.gw1_note ? ` — ${player.gw1_note}` : ""}
            {" · affects risk, not xP"}
          </span>
        </div>
      )}

      {/* availability */}
      <div className="mt-2.5 flex items-start gap-2 border-t border-zinc-100 pt-2.5 dark:border-purple-900/40">
        <AvailabilityBadge
          status={player.status}
          chanceOfPlaying={chance}
          news={player.news}
          size="w-4 h-4"
        />
        <div className="min-w-0 flex-1 text-[11px]">
          <span
            className={
              statusCode === "a"
                ? "font-medium text-emerald-700 dark:text-emerald-400"
                : "font-medium text-amber-700 dark:text-amber-400"
            }
          >
            {statusLabel}
            {chance !== null && chance !== undefined && chance < 100 ? ` · ${chance}%` : ""}
          </span>
          {player.news && <p className="mt-0.5 text-zinc-500">{player.news}</p>}
        </div>
      </div>

      {/* set-piece roles */}
      {(player.is_penalty_taker || player.is_freekick_taker || player.is_corner_taker) && (
        <div className="mt-2.5 flex items-center gap-2 border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-500 dark:border-purple-900/40">
          <RoleBadges
            penaltyOrder={player.is_penalty_taker ? 1 : null}
            freeKickOrder={player.is_freekick_taker ? 1 : null}
            cornerOrder={player.is_corner_taker ? 1 : null}
            size="w-4 h-4"
          />
          <span>
            {[
              player.is_penalty_taker ? "penalties" : null,
              player.is_freekick_taker ? "free kicks" : null,
              player.is_corner_taker ? "corners" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      )}

      {/* fixtures */}
      {player.upcoming && player.upcoming.length > 0 && (
        <div className="mt-2.5 border-t border-zinc-100 pt-2.5 dark:border-purple-900/40">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Next fixtures</div>
          <div className="mt-1.5 flex gap-1.5">
            {player.upcoming.map((f) => (
              <FixtureCell
                key={f.event}
                opponent={f.opponent_short_name}
                home={f.is_home}
                fdr={f.fdr}
                gw={f.event}
                team={player.team_short ?? undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* sub probability, bench only */}
      {player.sub_probability !== undefined && player.sub_probability !== null && (
        <p className="mt-2.5 border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-500 dark:border-purple-900/40">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">
            {Math.round(player.sub_probability * 100)}%
          </span>{" "}
          chance of being subbed on
        </p>
      )}

      {/* actions — pool player: add, or find a swap for an owned one */}
      {!owned && onAdd && (
        <div className="mt-3 flex gap-1.5 border-t border-zinc-100 pt-2.5 text-xs dark:border-purple-900/40">
          <button
            type="button"
            onClick={() => onAdd(player.id)}
            disabled={addDisabledReason !== null}
            title={addDisabledReason ?? `${addLabel}: ${player.web_name}`}
            className="flex-1 rounded bg-primary px-2 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            {addLabel}
          </button>
        </div>
      )}
      {!owned && addDisabledReason && (
        <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          {addDisabledReason}
        </p>
      )}

      {/*
        Each action renders only when its handler was passed. A read-only
        pitch (the squad sections on /deadline and /team) passes none and gets
        an information panel with no controls, rather than buttons that would
        edit a squad it isn't showing. Flex rather than grid-cols-3 so one or
        two buttons still fill the row.
      */}
      {owned && (onSetCaptain || onSetVice || onRemove) && (
      <div className="mt-3 flex gap-1.5 border-t border-zinc-100 pt-2.5 text-xs dark:border-purple-900/40">
        {onSetCaptain && (
        <button
          type="button"
          onClick={() => {
            onSetCaptain(player.id);
            onClose();
          }}
          disabled={player.is_captain}
          className="flex-1 rounded border border-input px-2 py-1 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 dark:hover:border-primary dark:hover:text-primary"
        >
          {player.is_captain ? "Captain" : "Set C"}
        </button>
        )}
        {onSetVice && (
        <button
          type="button"
          onClick={() => {
            onSetVice(player.id);
            onClose();
          }}
          disabled={player.is_vice_captain}
          className="flex-1 rounded border border-input px-2 py-1 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 dark:hover:border-primary dark:hover:text-primary"
        >
          {player.is_vice_captain ? "Vice" : "Set VC"}
        </button>
        )}
        {onRemove && (
        <button
          type="button"
          onClick={() => {
            onRemove(player.id);
            onClose();
          }}
          className="flex-1 rounded border border-input px-2 py-1 font-medium text-danger transition-colors hover:border-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Remove
        </button>
        )}
      </div>
      )}

      {owned && onFindReplacement && (
        <button
          type="button"
          onClick={() => onFindReplacement(player.id)}
          className="mt-1.5 min-h-9 w-full rounded border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:border-purple-700 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:border-primary dark:hover:text-primary"
        >
          Replace
        </button>
      )}
    </div>
  );
}
