"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { InteractivePitch } from "./pitch";
import { EmptySlot, PlayerCard, type PlayerData } from "./player-card";
import { bestStartingXi } from "@/lib/formation";

const POSITION_ABBR: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

interface PitchViewProps {
  squad: PlayerData[];
  /** element_type -> required count, from the season's squad rules. */
  quota: Record<number, number>;
  onSetCaptain: (playerId: number) => void;
  onSetVice: (playerId: number) => void;
  onRemove: (playerId: number) => void;
  /** Rendered inside the pitch card, above the field. */
  header?: React.ReactNode;
}

export function PitchView({
  squad,
  quota,
  onSetCaptain,
  onSetVice,
  onRemove,
  header,
}: PitchViewProps) {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menuFor === null) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const squadSize = Object.values(quota).reduce((a, b) => a + b, 0);
  const complete = squad.length === squadSize;

  // Once the squad is legal, show a provisional best XI so the pitch reads
  // like a real lineup rather than a pool of fifteen.
  const xi = useMemo(() => {
    if (!complete) return null;
    return bestStartingXi(
      squad.map((p) => ({
        playerId: p.id,
        elementType: p.element_type,
        xp: p.expected_points ?? 0,
      })),
    );
  }, [squad, complete]);

  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);

  const selected = menuFor !== null ? byId.get(menuFor) : undefined;

  const rowsIncomplete = [1, 2, 3, 4].map((type) => {
    const filled = squad.filter((p) => p.element_type === type);
    const empties = Math.max(0, (quota[type] ?? 0) - filled.length);
    return { type, filled, empties };
  });

  const starters = xi ? xi.starters.map((id) => byId.get(id)!).filter(Boolean) : [];
  const bench = xi ? xi.bench.map((id) => byId.get(id)!).filter(Boolean) : [];

  const card = (p: PlayerData, benchIndex?: number) => (
    <PlayerCard
      key={p.id}
      player={p}
      onSelect={() => setMenuFor(p.id === menuFor ? null : p.id)}
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
            {complete && xi ? (
              <>
                <PitchRow players={starters.filter((p) => p.element_type === 1)} render={card} />
                <PitchRow players={starters.filter((p) => p.element_type === 2)} render={card} />
                <PitchRow players={starters.filter((p) => p.element_type === 3)} render={card} />
                <PitchRow players={starters.filter((p) => p.element_type === 4)} render={card} />
              </>
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

        {complete && xi && (
          <div className="mt-3 rounded-xl border-2 border-purple-800 bg-purple-950/80 p-3 shadow-xl backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-purple-300">
              <span>Bench</span>
              <span className="font-normal normal-case text-purple-400">
                Auto XI by xP · {xi.formation} · starters {xi.startersXp.toFixed(1)} xP
              </span>
            </div>
            <div className="flex items-center justify-around gap-1">
              {bench.map((p, i) => card(p, i))}
            </div>
          </div>
        )}
      </div>

      {/* Action menu for the tapped player */}
      {selected && (
        <div
          role="dialog"
          className="absolute left-1/2 top-1/2 z-40 w-56 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-purple-700 dark:bg-[#1E0234]"
        >
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {selected.web_name}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
            <button
              onClick={() => {
                onSetCaptain(selected.id);
                setMenuFor(null);
              }}
              className="rounded border border-zinc-300 px-2 py-1 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/60 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
            >
              Set C
            </button>
            <button
              onClick={() => {
                onSetVice(selected.id);
                setMenuFor(null);
              }}
              className="rounded border border-zinc-300 px-2 py-1 font-medium transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/60 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
            >
              Set VC
            </button>
            <button
              onClick={() => {
                onRemove(selected.id);
                setMenuFor(null);
              }}
              className="rounded border border-zinc-300 px-2 py-1 font-medium text-red-600 transition-colors hover:border-red-500 dark:border-purple-800/60 dark:text-red-400"
            >
              Remove
            </button>
          </div>
        </div>
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
