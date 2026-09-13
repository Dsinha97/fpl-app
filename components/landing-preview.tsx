"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Delta } from "@/components/ui/delta";

/**
 * The "show, don't tell" half of DSI-118.
 *
 * A signed-out visitor previously saw one sentence and two buttons — no
 * evidence that "decided with data, not vibes" means anything. This renders
 * the app's actual captaincy call for the upcoming gameweek from live rows:
 * the two highest-projected players, the gap between them, and the number the
 * recommendation rests on.
 *
 * Real data rather than a mockup, deliberately. A screenshot of a captaincy
 * card would go stale the first time the model changed, and a fabricated one
 * would be a claim the app has to live up to. This is the same
 * `player_xp_horizons` read /players makes, so if it disagrees with the rest
 * of the app that is a bug worth seeing on the front page.
 *
 * Renders nothing at all if the data isn't there — an empty frame on the
 * landing page is worse than no frame.
 */
interface Pick {
  name: string;
  team: string;
  xp: number;
}

export function LandingPreview() {
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      const gw = await supabase
        .from("gameweeks")
        .select("season")
        .eq("is_next", true)
        .limit(1)
        .maybeSingle();
      if (gw.error || !gw.data) return setFailed(true);

      const [xpRes, teamRes] = await Promise.all([
        supabase
          .from("player_xp_horizons")
          .select("player_id, xp_1")
          .eq("season", gw.data.season)
          .order("xp_1", { ascending: false })
          .limit(2),
        supabase.from("teams").select("id, short_name").eq("season", gw.data.season),
      ]);
      if (xpRes.error || !xpRes.data?.length) return setFailed(true);

      const ids = xpRes.data.map((r) => r.player_id as number);
      const playerRes = await supabase
        .from("players")
        .select("id, web_name, team_id")
        .in("id", ids);
      if (playerRes.error || !playerRes.data?.length) return setFailed(true);

      const byId = new Map(playerRes.data.map((p) => [p.id as number, p]));
      const teamById = new Map((teamRes.data ?? []).map((t) => [t.id as number, t.short_name as string]));

      const rows = xpRes.data
        .map((r) => {
          const p = byId.get(r.player_id as number);
          if (!p || r.xp_1 === null) return null;
          return {
            name: p.web_name as string,
            team: teamById.get(p.team_id as number) ?? "",
            xp: Number(r.xp_1),
          };
        })
        .filter((r): r is Pick => r !== null);

      if (rows.length < 2) return setFailed(true);
      setPicks(rows);
    })();
  }, []);

  if (failed) return null;

  if (!picks) {
    return (
      <div className="w-full max-w-sm rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-7 w-full" />
        <Skeleton className="mt-2 h-7 w-full" />
      </div>
    );
  }

  const [best, runnerUp] = picks;
  const gap = best.xp - runnerUp.xp;

  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-card/80 p-4 text-left backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          This week&apos;s captain call
        </span>
        <Badge tone="accent">model</Badge>
      </div>

      <ol className="mt-3 space-y-1.5">
        {picks.map((p, i) => (
          <li
            key={p.name}
            className={`flex items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5 ${
              i === 0 ? "bg-primary/[0.08]" : ""
            }`}
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">{p.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{p.team}</span>
              {i === 0 && (
                <span className="shrink-0 rounded bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  C
                </span>
              )}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
              {p.xp.toFixed(1)}
              <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">xP</span>
            </span>
          </li>
        ))}
      </ol>

      {/* Per CLAUDE.md's "say what the number means": the gap is stated as a
          gap, in its own unit, not folded into a bare verdict. */}
      <p className="mt-2.5 flex items-center gap-1.5 px-2.5 text-[11px] text-muted-foreground">
        <Delta value={gap} unit="xP" goodDirection="up" showArrow={false} className="font-semibold" />
        <span>
          ahead of {runnerUp.name} over one gameweek
        </span>
      </p>
    </div>
  );
}
