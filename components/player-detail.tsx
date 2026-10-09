"use client";

import { useEffect, useRef } from "react";
import { DataCell, DataRow } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, UserMinus, UserRound } from "lucide-react";
import { FixtureRun, HeroStat, StatStrip, type StatStripItem } from "@/components/ui/stat-strip";
import { ConfidenceBadge, RateBand } from "./confidence-badge";
import type { PlayerData } from "./player-card";
import { liveStatLabel } from "@/lib/fixture-stats";

const POSITION_SHORT: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/** The armband letter in a ring, as on the pitch card's own armband. */
function ArmbandGlyph({ letter }: { letter: "C" | "V" }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 items-center justify-center rounded-full border-2 border-current text-[10px] font-bold"
    >
      {letter}
    </span>
  );
}

/** One 48px action row in the mobile sheet. */
function ActionRow({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex min-h-12 w-full items-center gap-3 px-1 text-left text-base transition-colors active:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:active:bg-purple-950/60 ${
          danger ? "text-danger" : "text-zinc-900 dark:text-zinc-100"
        }`}
      >
        <span className={danger ? "" : "text-zinc-500 dark:text-zinc-400"}>{icon}</span>
        {label}
      </button>
    </li>
  );
}


/**
 * Panel width and max height, also used to keep it inside the pitch.
 * Raised from 340 to 480 (Sprint 39, DSI-181): the metric grid grew from two
 * rows to four (Exp. mins/Start %/Owned all landed after the Sprint 21 cap
 * was set) and an owned squad player can render three stacked action rows
 * (Set C/Set VC/Remove, Replace, Full profile) — together they exceed 340px
 * even with the live breakdown and "Show full details" content both absent,
 * so the action row was being pushed below the cap and required scrolling to
 * reach on every squad player, not just an edge case. Both PitchView's
 * positioning and the picker's `fixed` placement read these constants
 * directly, so they stay in sync automatically. `overflow-y-auto` stays as a
 * safety net for the live-breakdown case and short viewports, not the normal
 * path.
 */
export const PANEL_WIDTH = 320;
export const PANEL_MAX_HEIGHT = 480;

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


  const fmt = (n: number | null | undefined, digits = 0) =>
    n !== undefined && n !== null ? n.toFixed(digits) : "—";
  const live = player.live_breakdown && player.live_breakdown.length > 0;
  const hasSquadActions = !!(onSetCaptain || onSetVice || onRemove || onFindReplacement);

  /*
   * Sprint 41 — the five numbers that decide a pitch tap, in one strip. The
   * other five that used to share a 3-column grid with them (goals, assists
   * and minutes for the viewed gameweek, xP 5, start %) are either in the live
   * breakdown above when they apply, or in the full profile. Ten equal cells
   * at 10px was a table, not a summary.
   */
  // A stat the caller has no value for is left out rather than shown as a
  // dash — a strip of five with two blanks reads as a loading failure.
  const strip: StatStripItem[] = ([
    { label: "Price", value: `£${(player.now_cost / 10).toFixed(1)}m` },
    { label: "Total pts", value: fmt(player.season_total_points), accent: true },
    { label: "Form", value: fmt(player.form, 1) },
    {
      label: "Owned",
      value: player.ownership !== undefined && player.ownership !== null ? `${player.ownership}%` : "—",
    },
    {
      label: "Exp. mins",
      value: fmt(player.expected_minutes),
      title:
        player.start_probability !== undefined && player.start_probability !== null
          ? `${Math.round(player.start_probability * 100)}% chance to start`
          : undefined,
    },
  ] satisfies StatStripItem[]).filter((item) => item.value !== "—");
  // The viewed gameweek's own returns, when the caller has them (/team).
  // Not merged into the strip: they describe one gameweek, the strip the season.
  const gwLine =
    player.gw_minutes !== undefined && player.gw_minutes !== null
      ? `${player.gw_minutes}′ · ${fmt(player.gw_goals)} G · ${fmt(player.gw_assists)} A`
      : null;

  return (
    <div
      ref={panel}
      role={inline ? undefined : "dialog"}
      aria-label={inline ? undefined : `${player.web_name} details`}
      style={inline ? undefined : { top, left, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
      className={
        inline
          ? "min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-1"
          : `z-40 overflow-x-hidden overflow-y-auto rounded-lg border border-zinc-200 bg-card p-3 shadow-2xl dark:border-purple-700 ${
              fixed ? "fixed" : "absolute"
            }`
      }
    >
      {/*
        Header. Identity on the left, the headline number pinned to the right
        corner (Sprint 41, after the official FPL app's player sheet): the one
        number this panel exists to answer is found in the same place every
        time, away from the body of stats. It was a 3xl row of its own in
        Sprint 19 — still the dominant number, now without costing a row.
      */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
            {player.team_short && (
              <span className="text-zinc-500 dark:text-zinc-400">{player.team_short}</span>
            )}
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-800 dark:bg-primary/15 dark:text-primary">
              {POSITION_SHORT[player.element_type] ?? "—"}
            </span>
          </div>
          <p className="mt-1 truncate text-lg font-bold leading-tight text-zinc-900 dark:text-zinc-100">
            {player.web_name}
          </p>
          {gwLine && (
            <p className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{gwLine}</p>
          )}
        </div>
        <HeroStat
          label={player.value_note ? "Points" : "xP"}
          title={player.value_note ?? "Expected points (xP) over the selected horizon"}
          value={fmt(player.expected_points, player.value_decimals ?? 1)}
          caption={
            player.reliability || player.rate_lower !== undefined ? (
              <span className="flex flex-col items-end gap-1">
                <ConfidenceBadge reliability={player.reliability} priorWeight={player.prior_weight} />
                <RateBand lower={player.rate_lower} upper={player.rate_upper} />
              </span>
            ) : undefined
          }
        />
        {!inline && (
          <Button
            type="button"
            onClick={onClose}
            aria-label="Close"
            variant="ghost"
            size="icon-xs"
            className="-mr-1 -mt-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-purple-950/60 dark:hover:text-zinc-200"
          >
            ×
          </Button>
        )}
      </div>

      {/*
        Live points breakdown — FPL's own explain array (lib/gameweek-state.ts),
        never recomputed from scoring_rules. Only populated by a caller that
        has already loaded a live gameweek's detail (currently /team) — hidden
        entirely elsewhere, same "undefined hides the section" convention as
        the rest of this panel.
      */}
      {live && (
        <div className="mt-3 border-t border-zinc-100 pt-2.5 dark:border-purple-900/40">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Live points this gameweek
          </div>
          <table className="mt-1 w-full text-xs">
            <tbody>
              {player.live_breakdown!.map((line) => (
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
                  {player.live_breakdown!.reduce((sum, l) => sum + l.points, 0)}
                </DataCell>
              </DataRow>
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3">
        <StatStrip items={strip} />
      </div>

      {player.upcoming && player.upcoming.length > 0 && (
        <div className="mt-3">
          <FixtureRun fixtures={player.upcoming} />
        </div>
      )}

      {/*
        Everything else — recent form, club system, availability, set pieces,
        news, per-gameweek history — is in the full profile modal, which loads
        that context itself. This panel is for the fast pitch taps.
      */}

      {/* actions — pool player: add, or find a swap for an owned one */}
      {!owned && onAdd && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-purple-900/40">
          <Button
            type="button"
            onClick={() => onAdd(player.id)}
            disabled={addDisabledReason !== null}
            title={addDisabledReason ?? `${addLabel}: ${player.web_name}`}
            size={inline ? "lg" : "xs"}
            className={`w-full disabled:opacity-40 ${inline ? "h-11 text-base" : ""}`}
          >
            {addLabel}
          </Button>
          {addDisabledReason && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">{addDisabledReason}</p>
          )}
        </div>
      )}

      {/*
        Each action renders only when its handler was passed. A read-only
        pitch (the squad sections on /deadline and /team) passes none and gets
        an information panel with no controls, rather than buttons that would
        edit a squad it isn't showing.

        On a phone (inline, inside the bottom sheet) they are full-width rows
        — a 48px target per action, labelled in words, the way the official
        app does it. The desktop popover keeps its compact button row: there
        the pointer is precise and the panel is 320px wide.
      */}
      {owned && hasSquadActions && inline && (
        <ul className="mt-3 divide-y divide-zinc-100 border-y border-zinc-100 dark:divide-purple-900/40 dark:border-purple-900/40">
          {onSetCaptain && (
            <ActionRow
              icon={<ArmbandGlyph letter="C" />}
              label={player.is_captain ? "Captain" : "Make captain"}
              disabled={player.is_captain}
              onClick={() => {
                onSetCaptain(player.id);
                onClose();
              }}
            />
          )}
          {onSetVice && (
            <ActionRow
              icon={<ArmbandGlyph letter="V" />}
              label={player.is_vice_captain ? "Vice-captain" : "Make vice-captain"}
              disabled={player.is_vice_captain}
              onClick={() => {
                onSetVice(player.id);
                onClose();
              }}
            />
          )}
          {onFindReplacement && (
            <ActionRow
              icon={<ArrowLeftRight aria-hidden="true" className="size-5" />}
              label="Replace"
              onClick={() => onFindReplacement(player.id)}
            />
          )}
          {onRemove && (
            <ActionRow
              icon={<UserMinus aria-hidden="true" className="size-5" />}
              label="Remove from squad"
              danger
              onClick={() => {
                onRemove(player.id);
                onClose();
              }}
            />
          )}
        </ul>
      )}

      {owned && hasSquadActions && !inline && (
        <>
          {(onSetCaptain || onSetVice || onRemove) && (
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
          {onFindReplacement && (
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
        </>
      )}

      {onOpenProfile &&
        (inline ? (
          // On the phone this is the prominent way on, as in the official
          // app: the sheet is deliberately shallow and the profile is where
          // everything it leaves out lives.
          <Button
            type="button"
            onClick={() => onOpenProfile(player)}
            size="lg"
            className="mt-3 h-11 w-full text-base"
          >
            <UserRound aria-hidden="true" className="size-4" />
            Full profile
          </Button>
        ) : (
          // A link rather than a button variant on desktop, because it
          // navigates to more rather than acting on the squad.
          <button
            type="button"
            onClick={() => onOpenProfile(player)}
            className="mt-2 w-full rounded py-1 text-center text-xs font-medium text-purple-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-primary"
          >
            Full profile →
          </button>
        ))}
    </div>
  );
}
