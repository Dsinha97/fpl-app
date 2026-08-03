"use client";

import { useEffect, useRef } from "react";
import type { DraftSnapshot } from "@/lib/drafts";

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

interface Change {
  added: number[];
  removed: number[];
  captainChanged: boolean;
  renamed: boolean;
}

function diff(prev: DraftSnapshot | undefined, next: DraftSnapshot): Change | null {
  if (!prev) return null;
  const before = new Set(prev.playerIds);
  const after = new Set(next.playerIds);
  return {
    added: next.playerIds.filter((id) => !before.has(id)),
    removed: prev.playerIds.filter((id) => !after.has(id)),
    captainChanged: prev.captain !== next.captain || prev.viceCaptain !== next.viceCaptain,
    renamed: prev.name !== next.name,
  };
}

/**
 * The save history for one draft, newest first.
 *
 * Shows what changed between consecutive saves rather than just listing them —
 * "swapped Mbeumo for Saka" is the reason anyone opens a timeline, and a column
 * of identical squad totals is not.
 */
export function DraftTimeline({
  draftName,
  history,
  nameOf,
  onClose,
}: {
  draftName: string;
  history: DraftSnapshot[];
  nameOf: (playerId: number) => string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = [...history].reverse();

  return (
    <section
      ref={panel}
      className="mt-6 rounded-xl border border-purple-300 bg-white p-4 dark:border-[#00FF87]/40 dark:bg-[#1E0234]"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {draftName} · timeline
          <span className="ml-2 font-normal text-xs text-zinc-500">
            {entries.length} save{entries.length === 1 ? "" : "s"} recorded
          </span>
        </h2>
        <button
          onClick={onClose}
          aria-label="Close timeline"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-purple-950/60 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          Nothing recorded yet. History starts from the next save — earlier saves predate the
          timeline.
        </p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {entries.map((entry, i) => {
            // entries is newest-first, so the previous save is the next index.
            const change = diff(entries[i + 1], entry);
            return (
              <li key={`${entry.at}-${i}`} className="flex gap-3 text-xs">
                <span className="w-28 shrink-0 tabular-nums text-zinc-500">
                  {formatWhen(entry.at)}
                </span>
                <span className="flex-1">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {entry.size} players · {money(entry.spent)}
                  </span>
                  {change === null ? (
                    <span className="ml-2 text-zinc-400">first recorded save</span>
                  ) : (
                    <span className="ml-2 text-zinc-500">
                      {change.added.length === 0 && change.removed.length === 0 ? (
                        change.captainChanged ? (
                          "armband changed"
                        ) : change.renamed ? (
                          "renamed"
                        ) : (
                          "no squad change"
                        )
                      ) : (
                        <>
                          {change.added.length > 0 && (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              +{change.added.map(nameOf).join(", ")}
                            </span>
                          )}
                          {change.added.length > 0 && change.removed.length > 0 && " · "}
                          {change.removed.length > 0 && (
                            <span className="text-red-600 dark:text-red-400">
                              −{change.removed.map(nameOf).join(", ")}
                            </span>
                          )}
                          {change.captainChanged && " · armband changed"}
                        </>
                      )}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
