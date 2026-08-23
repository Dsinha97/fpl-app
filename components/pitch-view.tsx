"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { InteractivePitch } from "./pitch";
import { EmptySlot, PlayerCard, type PlayerData } from "./player-card";
import { PANEL_MAX_HEIGHT, PANEL_WIDTH, PlayerDetail } from "./player-detail";
import type { LineupResult } from "@/lib/lineup";

const POSITION_ABBR: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

/**
 * Which eleven are on the pitch and who sits behind them.
 *
 * The pitch used to take a `LineupResult` directly, which is projection-shaped
 * — `startersXp`, `subProbability`, `benchExpectedContribution` — and so could
 * only ever draw a squad the optimiser had scored. A gameweek already played
 * has a *known* XI and *real* points; describing it as a projection would be a
 * lie about what the number means. This is the narrow shape both can produce,
 * so there is still exactly one pitch implementation.
 */
export interface SquadLayout {
  starters: number[];
  bench: number[];
  /** Left of the bench strip, e.g. "3-4-3". */
  formation: string;
  /** Auto-sub probabilities. Empty for a squad that has already been played. */
  subProbability: Map<number, number>;
  /** Right of the bench strip — the xP summary, or the actual bench points. */
  benchSummary: React.ReactNode;
}

/** The projection layout: what the optimiser expects to happen. */
export function layoutFromLineup(lineup: LineupResult): SquadLayout {
  return {
    starters: lineup.starters,
    bench: lineup.bench,
    formation: lineup.formation,
    subProbability: lineup.subProbability,
    benchSummary: `starters ${lineup.startersXp.toFixed(1)} xP · bench adds ${lineup.benchExpectedContribution.toFixed(1)} via auto-subs`,
  };
}

interface PitchViewProps {
  squad: PlayerData[];
  /** element_type -> required count, from the season's squad rules. */
  quota: Record<number, number>;
  /** XI and bench, when the squad is complete. `layoutFromLineup` for a projection. */
  layout: SquadLayout | null;
  /**
   * The armband and remove actions are optional: a read-only pitch (the squad
   * sections on /deadline and /team) simply omits them, and PlayerDetail hides
   * each button whose handler is absent. Editing stays in /builder.
   */
  onSetCaptain?: (playerId: number) => void;
  onSetVice?: (playerId: number) => void;
  onRemove?: (playerId: number) => void;
  onFindReplacement?: (playerId: number) => void;
  /**
   * Turns an empty slot into an "add a player" button, for the same reason
   * the actions above are optional: only `/builder` edits a squad, so this
   * is the only caller that passes it. Absent, `EmptySlot` stays inert.
   */
  onAddToSlot?: (elementType: number) => void;
  /** Rendered inside the pitch card, above the field. */
  header?: React.ReactNode;
}

interface MenuState {
  id: number;
  top: number;
  left: number;
}

export function PitchView({
  squad,
  quota,
  layout,
  onSetCaptain,
  onSetVice,
  onRemove,
  onFindReplacement,
  onAddToSlot,
  header,
}: PitchViewProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  /**
   * Which player's panel was open when the current mousedown began. The
   * panel's own outside-click handler fires on mousedown and clears the menu
   * before this click lands, so without remembering it a second click on the
   * same card would reopen rather than toggle shut.
   */
  const closingId = useRef<number | null>(null);

  const closeMenu = useCallback(() => {
    closingId.current = menu?.id ?? null;
    setMenu(null);
    // Only suppress the immediately following click.
    setTimeout(() => {
      closingId.current = null;
    }, 0);
  }, [menu]);

  /** Place the panel beside the clicked card, clamped inside the pitch card. */
  const openMenu = (player: PlayerData, anchor: HTMLElement) => {
    if (closingId.current === player.id) return;

    const wrap = wrapper.current;
    if (!wrap) return;

    const a = anchor.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();

    const left = Math.max(
      4,
      Math.min(a.left - w.left + a.width / 2 - PANEL_WIDTH / 2, w.width - PANEL_WIDTH - 4),
    );

    // Prefer below the card, flip above when there is not enough room.
    const below = a.bottom - w.top + 8;
    const top =
      below + PANEL_MAX_HEIGHT <= w.height
        ? below
        : Math.max(4, a.top - w.top - PANEL_MAX_HEIGHT - 8);

    setMenu({ id: player.id, top, left });
  };

  const squadSize = Object.values(quota).reduce((a, b) => a + b, 0);
  const complete = squad.length === squadSize && layout !== null;

  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  const selected = menu !== null ? byId.get(menu.id) : undefined;

  const rowsIncomplete = [1, 2, 3, 4].map((type) => {
    const filled = squad.filter((p) => p.element_type === type);
    const empties = Math.max(0, (quota[type] ?? 0) - filled.length);
    return { type, filled, empties };
  });

  const starters = layout ? layout.starters.map((id) => byId.get(id)!).filter(Boolean) : [];
  const bench = layout ? layout.bench.map((id) => byId.get(id)!).filter(Boolean) : [];

  const card = (p: PlayerData, benchIndex?: number) => (
    <PlayerCard
      key={p.id}
      player={
        benchIndex !== undefined && layout
          ? { ...p, sub_probability: layout.subProbability.get(p.id) ?? null }
          : p
      }
      onSelect={openMenu}
      isBenchSlot={benchIndex !== undefined}
      benchIndex={benchIndex}
    />
  );

  return (
    <div ref={wrapper} className="relative flex w-full flex-col gap-3">
      <div className="rounded-2xl border border-zinc-200 bg-card p-3 shadow-sm dark:border-purple-900/40">
        {header}

        <div className="mt-3">
          <InteractivePitch>
            {complete ? (
              [1, 2, 3, 4].map((type) => (
                <PitchRow
                  key={type}
                  players={starters.filter((p) => p.element_type === type)}
                  render={card}
                />
              ))
            ) : (
              rowsIncomplete.map(({ type, filled, empties }) => (
                <div
                  key={type}
                  className="flex w-full flex-wrap items-center justify-center gap-1 px-1 sm:gap-2"
                >
                  {filled.map((p) => card(p))}
                  {Array.from({ length: empties }).map((_, i) => (
                    <EmptySlot
                      key={`e-${type}-${i}`}
                      label={POSITION_ABBR[type]}
                      onAdd={onAddToSlot ? () => onAddToSlot(type) : undefined}
                    />
                  ))}
                </div>
              ))
            )}
          </InteractivePitch>
        </div>

        {complete && layout && (
          <div className="mt-3 rounded-xl border-2 border-purple-800 bg-purple-950/80 p-3 shadow-xl backdrop-blur-md">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-purple-300">
              <span>Bench</span>
              <span className="font-normal normal-case text-purple-400">
                {layout.formation} · {layout.benchSummary}
              </span>
            </div>
            <div className="flex items-start justify-around gap-1">
              {bench.map((p, i) => {
                // Only a projection has auto-sub probabilities. A gameweek
                // that has already been played has none, and inventing a
                // "0% used" caption for it would read as a real forecast.
                const used = layout.subProbability.get(p.id);
                return (
                  <span key={p.id} className="flex flex-col items-center gap-1">
                    {card(p, i)}
                    {used !== undefined && (
                      <span
                        className="text-[9px] tabular-nums text-purple-300"
                        title="Probability this slot is used by an auto-sub"
                      >
                        {Math.round(used * 100)}% used
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selected && menu && (
        <PlayerDetail
          player={
            layout
              ? { ...selected, sub_probability: layout.subProbability.get(selected.id) ?? null }
              : selected
          }
          top={menu.top}
          left={menu.left}
          onClose={closeMenu}
          onSetCaptain={onSetCaptain}
          onSetVice={onSetVice}
          onRemove={onRemove}
          onFindReplacement={
            onFindReplacement &&
            ((id) => {
              // The replacement finder lives well below the pitch (often off
              // -screen on mobile), so the page scrolls to it. Leaving this
              // popover open would leave it floating, stranded over wherever
              // the pitch happened to scroll to.
              closeMenu();
              onFindReplacement(id);
            })
          }
        />
      )}
    </div>
  );
}

function PitchRow({
  players,
  render,
}: {
  players: PlayerData[];
  render: (p: PlayerData) => React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-around gap-1 px-1">
      {players.map((p) => render(p))}
    </div>
  );
}
