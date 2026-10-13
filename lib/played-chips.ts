// The one loader for chips FPL's own history (`manager_chips`) reports played
// this season. Kept out of `lib/chip-plan.ts` so that module stays a leaf with
// no Supabase dependency.

import { CHIP_KINDS, type PlayedChip } from "./chip-plan";
import { supabase } from "./supabase/client";
import type { ChipKind } from "./team-state";

/** Null on a read error — callers keep whatever they had rather than treating a failed read as "nothing played". */
export async function loadPlayedChips(season: string, entryId: number): Promise<PlayedChip[] | null> {
  const { data, error } = await supabase
    .from("manager_chips")
    .select("event, name")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event");
  if (error) return null;
  return (data ?? [])
    .filter((r) => CHIP_KINDS.includes(r.name as ChipKind))
    .map((r) => ({ chip: r.name as ChipKind, event: r.event as number }));
}
