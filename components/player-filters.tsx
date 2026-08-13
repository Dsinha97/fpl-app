"use client";

import { RangeSlider } from "@/components/ui/range-slider";
import { InfoTooltip } from "@/components/info-tooltip";
import { matchesPlayerQuery, type SearchableName } from "@/lib/player-search";
import { GEM_ARCHETYPE_LABELS, GEMS_MODEL_NOTE, type GemArchetype } from "@/lib/hidden-gems";

/**
 * Shared player search + filter bar for `/players` and the builder picker.
 * Both pages used to carry their own copy of this state and markup — a
 * "Gems only" checkbox on one, a different price-bound source on the other —
 * so the same task felt different depending on which page you were on. This
 * is the one implementation both consume; `matchesFilters` is the one
 * predicate both filter loops call.
 */

export type SpecialFilter = GemArchetype | "penalty_taker" | "freekick_taker" | "corner_taker";

const SPECIAL_ORDER: SpecialFilter[] = [
  "defcon_defender",
  "defcon_midfielder",
  "breakout_attacker",
  "penalty_taker",
  "freekick_taker",
  "corner_taker",
];

const SPECIAL_LABELS: Record<SpecialFilter, string> = {
  ...GEM_ARCHETYPE_LABELS,
  penalty_taker: "Penalty taker",
  freekick_taker: "Free-kick taker",
  corner_taker: "Corner taker",
};

const DEFAULT_POSITIONS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export interface PlayerFilterState {
  search: string;
  position: number | 0;
  team: number | 0;
  price: [number, number];
  /** OR within the group — "show anything that is any of these". */
  special: Set<SpecialFilter>;
}

export function defaultPlayerFilters(priceBounds: [number, number]): PlayerFilterState {
  return { search: "", position: 0, team: 0, price: priceBounds, special: new Set() };
}

/** The fields `matchesFilters` needs off a player row — both pages' `PlayerRow` satisfy this structurally. */
export interface FilterableRow extends SearchableName {
  id: number;
  element_type: number;
  team_id: number;
  now_cost: number | null;
  penalties_order: number | null;
  direct_freekicks_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
}

/** Minimal gem lookup — either page's `gemsById` map satisfies this. */
export interface GemLookup {
  get(playerId: number): { archetype: GemArchetype } | undefined;
}

export function matchesFilters(
  row: FilterableRow,
  filters: PlayerFilterState,
  gemsById: GemLookup,
): boolean {
  const q = filters.search.trim();
  if (q && !matchesPlayerQuery(row, q)) return false;
  if (filters.position !== 0 && row.element_type !== filters.position) return false;
  if (filters.team !== 0 && row.team_id !== filters.team) return false;
  const cost = row.now_cost ?? 0;
  if (cost < filters.price[0] || cost > filters.price[1]) return false;
  if (filters.special.size > 0) {
    const archetype = gemsById.get(row.id)?.archetype;
    const hit =
      (archetype !== undefined && filters.special.has(archetype)) ||
      (row.penalties_order === 1 && filters.special.has("penalty_taker")) ||
      (row.direct_freekicks_order === 1 && filters.special.has("freekick_taker")) ||
      (row.corners_and_indirect_freekicks_order === 1 && filters.special.has("corner_taker"));
    if (!hit) return false;
  }
  return true;
}

interface PlayerFiltersProps {
  value: PlayerFilterState;
  onChange: (next: PlayerFilterState) => void;
  teamOptions: [number, string][];
  priceBounds: [number, number];
  positionOptions?: Record<number, string>;
  /** Builder replace mode locks the position to the outgoing player's — shown disabled, not hidden. */
  lockedPosition?: number;
}

export function PlayerFilters({
  value,
  onChange,
  teamOptions,
  priceBounds,
  positionOptions = DEFAULT_POSITIONS,
  lockedPosition,
}: PlayerFiltersProps) {
  const activeCount =
    (value.team !== 0 ? 1 : 0) +
    (!lockedPosition && value.position !== 0 ? 1 : 0) +
    (value.price[0] !== priceBounds[0] || value.price[1] !== priceBounds[1] ? 1 : 0) +
    value.special.size;

  const toggleSpecial = (f: SpecialFilter) => {
    const next = new Set(value.special);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    onChange({ ...value, special: next });
  };

  return (
    <div className="flex flex-wrap items-start gap-3 text-sm">
      <input
        type="search"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
        placeholder="Search player…"
        className="w-44 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-zinc-900 outline-none focus:border-purple-700 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
      />

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:bg-purple-950/60">
          <span className="group-open:hidden">Filter {activeCount > 0 ? `(${activeCount})` : "+"}</span>
          <span className="hidden group-open:inline">Filter −</span>
        </summary>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={lockedPosition ?? value.position}
            disabled={lockedPosition !== undefined}
            onChange={(e) => onChange({ ...value, position: Number(e.target.value) })}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 disabled:opacity-50 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
          >
            <option value={0}>All positions</option>
            {Object.entries(positionOptions).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={value.team}
            onChange={(e) => onChange({ ...value, team: Number(e.target.value) })}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
          >
            <option value={0}>All teams</option>
            {teamOptions.map(([id, short]) => (
              <option key={id} value={id}>
                {short}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <span className="tabular-nums">
              £{(value.price[0] / 10).toFixed(1)}m – £{(value.price[1] / 10).toFixed(1)}m
            </span>
            <RangeSlider
              value={value.price}
              onValueChange={(price) => onChange({ ...value, price })}
              min={priceBounds[0]}
              max={priceBounds[1]}
              step={5}
              minLabel="Minimum price"
              maxLabel="Maximum price"
            />
            {(value.price[0] !== priceBounds[0] || value.price[1] !== priceBounds[1]) && (
              <button
                onClick={() => onChange({ ...value, price: priceBounds })}
                className="text-xs text-zinc-500 underline transition-colors hover:text-purple-700 dark:hover:text-[#00FF87]"
              >
                reset
              </button>
            )}
          </label>

          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l border-zinc-200 pl-3 dark:border-purple-900/40">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Special</span>
            {SPECIAL_ORDER.map((f) => (
              <label key={f} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={value.special.has(f)}
                  onChange={() => toggleSpecial(f)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-purple-700 focus-visible:ring-2 focus-visible:ring-purple-500 dark:border-purple-800/50 dark:text-[#00FF87]"
                />
                {SPECIAL_LABELS[f]}
              </label>
            ))}
            <InfoTooltip label="What do these special options mean?">
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                Matches any player with any of the ticked properties — not all of them.{" "}
                {GEMS_MODEL_NOTE}
              </p>
            </InfoTooltip>
          </span>
        </div>
      </details>
    </div>
  );
}
