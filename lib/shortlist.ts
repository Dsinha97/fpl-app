// The player shortlist: players the owner has marked to come back to.
//
// Named "shortlist", not "watchlist". "Watchlist" already means the bounded
// set of players sampled every ~2h for price movement (lib/price-watch.ts,
// game_settings.price_watch_*) — a sampling budget the system chooses, not a
// set the owner picked. Two meanings for one word in one app is a bug with a
// delay on it.
//
// Owner-scoped and signed-in only. There is deliberately no localStorage
// fallback: a shortlist that lives in one browser and silently fails to
// appear on a phone is worse than one that says "sign in first", and a
// shadow copy that vanishes or conflicts on sign-in is worse still. The
// button links to /signin rather than no-opping.
//
// Keyed on `player_code`, which survives a season rollover — `players.id` is
// reassigned by FPL between seasons.

import { supabase } from "./supabase/client";

export interface ShortlistEntry {
  playerCode: number;
  note: string | null;
  createdAt: string;
}

/** Every shortlisted player for the signed-in user this season, newest first. */
export async function loadShortlist(season: string): Promise<Map<number, ShortlistEntry>> {
  const out = new Map<number, ShortlistEntry>();

  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return out;

  const { data, error } = await supabase
    .from("user_shortlist")
    .select("player_code, note, created_at")
    .eq("season", season)
    .order("created_at", { ascending: false });
  // RLS scopes this to the signed-in user; no explicit user_id filter is
  // needed and adding one would imply the policy is not the boundary.
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    out.set(row.player_code as number, {
      playerCode: row.player_code as number,
      note: (row.note as string | null) ?? null,
      createdAt: row.created_at as string,
    });
  }
  return out;
}

/** Adds a player. Idempotent — re-adding updates the note rather than erroring. */
export async function addToShortlist(
  season: string,
  playerCode: number,
  note?: string | null,
): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error("Sign in to use your shortlist.");

  const { error } = await supabase
    .from("user_shortlist")
    .upsert(
      { user_id: userId, season, player_code: playerCode, note: note ?? null },
      { onConflict: "user_id,season,player_code" },
    );
  if (error) throw new Error(error.message);
}

export async function removeFromShortlist(season: string, playerCode: number): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) throw new Error("Sign in to use your shortlist.");

  const { error } = await supabase
    .from("user_shortlist")
    .delete()
    .eq("season", season)
    .eq("player_code", playerCode);
  if (error) throw new Error(error.message);
}
