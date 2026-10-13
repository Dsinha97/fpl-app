"use client";

// Which chips each manager has already spent, plus the chip windows needed to
// say which half a spend belongs to — for pages that value a chip at one
// gameweek (/scenarios, /builder) and must not offer one that is gone.

import { useEffect, useMemo, useState } from "react";
import type { ChipDefinitionRow, PlayedChip } from "./chip-plan";
import { loadPlayedChips } from "./played-chips";
import { supabase } from "./supabase/client";

export function useChipAvailability(
  season: string | null,
  entryIds: (number | null | undefined)[],
): { chipDefinitions: ChipDefinitionRow[]; playedByEntry: Map<number, PlayedChip[]> } {
  const [chipDefinitions, setChipDefinitions] = useState<ChipDefinitionRow[]>([]);
  const [playedByEntry, setPlayedByEntry] = useState<Map<number, PlayedChip[]>>(new Map());
  // A stable key, so a fresh array each render doesn't refetch.
  const key = useMemo(
    () => [...new Set(entryIds.filter((e): e is number => typeof e === "number"))].sort((a, b) => a - b).join(","),
    [entryIds],
  );

  useEffect(() => {
    if (!season) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chip_definitions")
        .select("name, start_event, stop_event")
        .eq("season", season);
      if (cancelled) return;
      setChipDefinitions(
        (data ?? []).map((r) => ({
          name: r.name as string,
          startEvent: r.start_event as number,
          stopEvent: r.stop_event as number | null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [season]);

  useEffect(() => {
    if (!season || key === "") return;
    let cancelled = false;
    (async () => {
      const next = new Map<number, PlayedChip[]>();
      await Promise.all(
        key.split(",").map(async (id) => {
          const played = await loadPlayedChips(season, Number(id));
          if (played) next.set(Number(id), played);
        }),
      );
      if (!cancelled) setPlayedByEntry(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [season, key]);

  return { chipDefinitions, playedByEntry };
}
