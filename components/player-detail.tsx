"use client";

import { useEffect, useRef } from "react";
import { DataCell, DataRow } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, RateBand } from "./confidence-badge";
import type { PlayerData } from "./player-card";
import { liveStatLabel } from "@/lib/fixture-stats";

const POSITION_NAME: Record<number, string> = {
  1: "Goalkeeper",
  2: "Defender",
  3: "Midfielder",
  4: "Forward",
};


/**
 * Panel width and max height, also used to keep it inside the pitch.
 * Lowered back from 460 to 340 (Sprint 21) now that everything past the
 * metric grid and live breakdown sits behind "Show full details" and is
 * collapsed by default — both PitchView's positioning and the picker's
 * `fixed` placement read these constants directly, so they stay in sync
 * automatically. The expanded state still scrolls within the panel's own
 * `overflow-y-auto` rather than growing past this cap.
 */
export const PANEL_WIDTH = 320;
export const PANEL_MAX_HEIGHT = 340;

interface PlayerDetailProps {
  player: PlayerData;
  /**
   * Position within the anchoring container, in pixels. Omitted when `inline`
   * — a sheet positions the panel, so the panel does not position itself.
   */
  top?: number;
  left?: number;
  /**
   * Render as plain content rather than a positioned dialog, for when
   * something else already owns the surface (the mobile bottom sheet, which
   * is itself a dialog — nesting a second one would announce twice).
   */
  inline?: boolean;
  onClose: () => void;
  /**
   * Opens this player's full profile modal (`components/player-modal.tsx`).
   *
   * The bridge between the two surfaces. This panel stays deliberately
   * shallow and fetch-free — it is for the taps that happen dozens of times
   * a session — and hands off to the modal for the deep read. Rendered only
   * when a handler is passed, so pages that have no modal show no dead link.
   */
  onOpenProfile?: (player: PlayerData) => void;
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
  onOpenProfile,
  onSetCaptain,
  onSetVice,
  onRemove,
  owned = true,
  onAdd,
  addDisabledReason = null,
  addLabel = "Add to squad",
  onFindReplacement,
  fixed = false,
  inline = false,
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
      role={inline ? undefined : "dialog"}
      aria-label={inline ? undefined : `${player.web_name} details`}
      style={inline ? undefined : { top, left, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
      className={
        inline
          ? "min-h-0 overflow-x-hidden overflow-y-auto px-1"
          : `z-40 overflow-x-hidden overflow-y-auto rounded-lg border border-zinc-200 bg-card p-3 shadow-2xl dark:border-purple-700 ${
              fixed ? "fixed" : "absolute"
            }`
      }
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
        <Button
          type="button"
          onClick={onClose}
          aria-label="Close"
          variant="ghost"
          size="icon-xs"
          className="text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-purple-950/60 dark:hover:text-zinc-200"
        >
          ×
        </Button>
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

      {/*
        Live points breakdown — FPL's own explain array (lib/gameweek-state.ts),
        never recomputed from scoring_rules. Only populated by a caller that
        has already loaded a live gameweek's detail (currently /team) — hidden
        entirely elsewhere, same "undefined hides the section" convention as
        the rest of this panel.
      */}
      {player.live_breakdown && player.live_breakdown.length > 0 && (
        <div className="mt-2.5 border-t border-zinc-100 pt-2.5 dark:border-purple-900/40">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            Live points this gameweek
          </div>
          <table className="mt-1 w-full text-[11px]">
            <tbody>
              {player.live_breakdown.map((line) => (
                <DataRow key={line.identifier} className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
                  <DataCell className="py-1 text-zinc-600 dark:text-zinc-400">{liveStatLabel(line.identifier)}</DataCell>
                  <DataCell className="py-1 text-zinc-500" numeric>{line.value}</DataCell>
                  <DataCell className="py-1 font-semibold text-zinc-900 dark:text-zinc-100" numeric>
                    {line.points}
                  </DataCell>
                </DataRow>
              ))}
              <DataRow>
                <DataCell className="pt-1 font-semibold text-zinc-900 dark:text-zinc-100">Total</DataCell>
                <DataCell />
                <DataCell className="pt-1 font-bold text-purple-800 dark:text-primary" numeric>
                  {player.live_breakdown.reduce((sum, l) => sum + l.points, 0)}
                </DataCell>
              </DataRow>
            </tbody>
          </table>
        </div>
      )}

      {/*
        The metric grid — everything that used to be two separate grids
        (price/xP/start-probability, then season totals), merged into one so
        the popup's always-visible surface is metrics only. Sprint 20's
        "the popup is getting too big": the rest lives behind Show full
        details, below.
      */}
      <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-2.5 dark:border-purple-900/40">
        {stat("Price", `£${(player.now_cost / 10).toFixed(1)}m`)}
        {stat(
          "Goals",
          player.gw_goals !== undefined && player.gw_goals !== null ? player.gw_goals.toString() : "—",
        )}
        {stat(
          "Assists",
          player.gw_assists !== undefined && player.gw_assists !== null
            ? player.gw_assists.toString()
            : "—",
        )}
        {stat(
          "Mins",
          player.gw_minutes !== undefined && player.gw_minutes !== null
            ? player.gw_minutes.toString()
            : "—",
        )}
        {stat(
          "Owned",
          player.ownership !== undefined && player.ownership !== null
            ? `${player.ownership}%`
            : "—",
        )}
        {stat("Form", player.form !== undefined && player.form !== null ? player.form.toFixed(1) : "—")}
        {stat(
          "Total pts",
          player.season_total_points !== undefined && player.season_total_points !== null
            ? player.season_total_points.toString()
            : "—",
          true,
        )}
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
      </div>

      {/*
        The "Show full details" disclosure that used to live here is gone.
        Everything it held — recent form, club system, availability detail,
        set-piece duty, news, the fixture ticker — is now in the full profile
        modal, which loads that context itself rather than rendering whatever
        the calling page happened to have queried. This panel is for the fast
        pitch taps; "Full profile" below is the way to the rest.
      */}

      {/* actions — pool player: add, or find a swap for an owned one */}
      {!owned && onAdd && (
        <div className="mt-3 flex gap-1.5 border-t border-zinc-100 pt-2.5 text-xs dark:border-purple-900/40">
          <Button
            type="button"
            onClick={() => onAdd(player.id)}
            disabled={addDisabledReason !== null}
            title={addDisabledReason ?? `${addLabel}: ${player.web_name}`}
            size="xs"
            className="flex-1 disabled:opacity-40"
          >
            {addLabel}
          </Button>
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
        <Button
          type="button"
          onClick={() => {
            onSetCaptain(player.id);
            onClose();
          }}
          disabled={player.is_captain}
          variant="outline"
          size="xs"
          className="flex-1 hover:border-purple-700 hover:text-purple-700 disabled:opacity-40 dark:hover:border-primary dark:hover:text-primary"
        >
          {player.is_captain ? "Captain" : "Set C"}
        </Button>
        )}
        {onSetVice && (
        <Button
          type="button"
          onClick={() => {
            onSetVice(player.id);
            onClose();
          }}
          disabled={player.is_vice_captain}
          variant="outline"
          size="xs"
          className="flex-1 hover:border-purple-700 hover:text-purple-700 disabled:opacity-40 dark:hover:border-primary dark:hover:text-primary"
        >
          {player.is_vice_captain ? "Vice" : "Set VC"}
        </Button>
        )}
        {onRemove && (
        <Button
          type="button"
          onClick={() => {
            onRemove(player.id);
            onClose();
          }}
          variant="outline"
          size="xs"
          className="flex-1 text-danger hover:border-danger"
        >
          Remove
        </Button>
        )}
      </div>
      )}

      {owned && onFindReplacement && (
        <Button
          type="button"
          onClick={() => onFindReplacement(player.id)}
          variant="outline"
          size="md"
          className="mt-1.5 min-h-9 w-full hover:border-purple-700 hover:text-purple-700 dark:hover:border-primary dark:hover:text-primary"
        >
          Replace
        </Button>
      )}

      {onOpenProfile && (
        // The visible affordance for everything this panel deliberately
        // leaves out — per-gameweek history, past seasons, the price
        // outlook. A link rather than a button variant, because it navigates
        // to more rather than acting on the squad.
        <button
          type="button"
          onClick={() => onOpenProfile(player)}
          className="mt-2 w-full rounded py-1 text-center text-xs font-medium text-purple-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-primary"
        >
          Full profile →
        </button>
      )}
    </div>
  );
}
