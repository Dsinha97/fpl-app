"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { InteractivePitch } from "./pitch";
import { EmptySlot, PlayerCard, type PlayerData } from "./player-card";
import { PANEL_MAX_HEIGHT, PANEL_WIDTH, PlayerDetail } from "./player-detail";
import type { LineupResult } from "@/lib/lineup";

const POSITION_ABBR: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

interface PitchViewProps {
  squad: PlayerData[];
  /** element_type -> required count, from the season's squad rules. */
  quota: Record<number, number>;
  /** Sprint 3 lineup, when the squad is complete. */
  lineup: LineupResult | null;
  onSetCaptain: (playerId: number) => void;
  onSetVice: (playerId: number) => void;
  onRemove: (playerId: number) => void;
  onFindReplacement?: (playerId: number) => void;
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
  lineup,
  onSetCaptain,
  onSetVice,
  onRemove,
  onFindReplacement,
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
  const complete = squad.length === squadSize && lineup !== null;

  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  const selected = menu !== null ? byId.get(menu.id) : undefined;

  const rowsIncomplete = [1, 2, 3, 4].map((type) => {
    const filled = squad.filter((p) => p.element_type === type);
    const empties = Math.max(0, (quota[type] ?? 0) - filled.length);
    return { type, filled, empties };
  });

  const starters = lineup ? lineup.starters.map((id) => byId.get(id)!).filter(Boolean) : [];
  const bench = lineup ? lineup.bench.map((id) => byId.get(id)!).filter(Boolean) : [];

  const card = (p: PlayerData, benchIndex?: number) => (
    <PlayerCard
      key={p.id}
      player={
        benchIndex !== undefined && lineup
          ? { ...p, sub_probability: lineup.subProbability.get(p.id) ?? null }
          : p
      }
      onSelect={openMenu}
      isBenchSlot={benchIndex !== undefined}
      benchIndex={benchIndex}
    />
  );

  return (
    <div ref={wrapper} className="relative flex w-full flex-col gap-3">
      <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-purple-900/40 dark:bg-[#1E0234]">
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
                    <EmptySlot key={`e-${type}-${i}`} label={POSITION_ABBR[type]} />
                  ))}
                </div>
              ))
            )}
          </InteractivePitch>
        </div>

        {complete && lineup && (
          <div className="mt-3 rounded-xl border-2 border-purple-800 bg-purple-950/80 p-3 shadow-xl backdrop-blur-md">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-purple-300">
              <span>Bench</span>
              <span className="font-normal normal-case text-purple-400">
                {lineup.formation} · starters {lineup.startersXp.toFixed(1)} xP · bench adds{" "}
                {lineup.benchExpectedContribution.toFixed(1)} via auto-subs
              </span>
            </div>
            <div className="flex items-start justify-around gap-1">
              {bench.map((p, i) => (
                <span key={p.id} className="flex flex-col items-center gap-1">
                  {card(p, i)}
                  <span
                    className="text-[9px] tabular-nums text-purple-300"
                    title="Probability this slot is used by an auto-sub"
                  >
                    {Math.round((lineup.subProbability.get(p.id) ?? 0) * 100)}% used
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && menu && (
        <PlayerDetail
          player={
            lineup
              ? { ...selected, sub_probability: lineup.subProbability.get(selected.id) ?? null }
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
