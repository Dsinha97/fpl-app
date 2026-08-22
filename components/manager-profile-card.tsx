"use client";

import { useState } from "react";
import type { ManagerProfile, RivalRow } from "@/lib/manager-profile";
import { TapToReveal } from "@/components/info-tooltip";

const CONFIDENCE_STYLE: Record<ManagerProfile["confidence"], string> = {
  high: "text-emerald-700 dark:text-emerald-400",
  medium: "text-zinc-600 dark:text-zinc-400",
  low: "text-amber-700 dark:text-amber-400",
};

/** Percentile score (0-100, higher better) as a filled bar out of 100. */
function PercentileBar({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="img"
        aria-label={`${label}: percentile score ${score.toFixed(1)} out of 100`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-purple-950/60"
      >
        <div
          className="h-full rounded-full bg-purple-700 transition-[width] duration-300 motion-reduce:transition-none dark:bg-[#00FF87]"
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-500">
        {score.toFixed(0)}
      </span>
    </div>
  );
}

/**
 * Career percentile profile: tier, best/median/worst, spread and trend.
 *
 * Deliberately no archetype and no composite volatility index — see
 * "Manager Intelligence" in docs/roadmap.md for why. The three volatility
 * components are shown side by side rather than blended, so a reader can see
 * which season drove the spread instead of trusting a weighted number whose
 * weights nobody could calibrate on this few managers.
 */
export function ManagerProfileCard({ profile }: { profile: ManagerProfile }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Career Percentile Profile
        </h3>
        <span
          role="status"
          className={`text-xs font-medium ${CONFIDENCE_STYLE[profile.confidence]}`}
          title={profile.confidenceReason}
        >
          {profile.confidence} confidence
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-zinc-500">Tier (career median)</div>
          <div className="mt-0.5 text-lg font-semibold text-purple-900 dark:text-[#00FF87]">
            {profile.tier}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Seasons of record</div>
          <div className="mt-0.5 text-lg font-semibold text-purple-900 dark:text-[#00FF87]">
            {profile.seasons}
          </div>
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
            <span>Best — {profile.bestSeason}</span>
            <span className="tabular-nums">{profile.best.toFixed(0)}</span>
          </div>
          <PercentileBar score={profile.best} label="Best season" />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
            <span>Median</span>
            <span className="tabular-nums">{profile.median.toFixed(1)}</span>
          </div>
          <PercentileBar score={profile.median} label="Median season" />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
            <span>Worst — {profile.worstSeason}</span>
            <span className="tabular-nums">{profile.worst.toFixed(0)}</span>
          </div>
          <PercentileBar score={profile.worst} label="Worst season" />
        </div>
      </dl>

      {profile.spread !== null && profile.stdev !== null && profile.trend !== null ? (
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3 text-center dark:border-purple-900/40">
          <div>
            <dt>
              <TapToReveal
                label="What is Spread?"
                triggerClassName="text-[10px] uppercase tracking-wide text-zinc-500 underline decoration-dotted underline-offset-2"
                trigger="Spread"
              >
                <p>
                  P90 minus P10 of percentile score across all seasons — the gap between a strong
                  year and a weak one, ignoring the single best and worst outliers.
                </p>
              </TapToReveal>
            </dt>
            <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">
              {profile.spread.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt>
              <TapToReveal
                label="What is Std dev?"
                triggerClassName="text-[10px] uppercase tracking-wide text-zinc-500 underline decoration-dotted underline-offset-2"
                trigger="Std dev"
              >
                <p>Standard deviation of percentile score across all seasons.</p>
              </TapToReveal>
            </dt>
            <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">
              {profile.stdev.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt>
              <TapToReveal
                label="What is Trend?"
                triggerClassName="text-[10px] uppercase tracking-wide text-zinc-500 underline decoration-dotted underline-offset-2"
                trigger="Trend"
              >
                <p>
                  Least-squares slope of percentile score across seasons, oldest to newest.
                  Positive means improving over the career shown.
                </p>
              </TapToReveal>
            </dt>
            <dd
              className={`tabular-nums ${
                profile.trend > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : profile.trend < 0
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-zinc-800 dark:text-zinc-200"
              }`}
            >
              {profile.trend > 0 ? "+" : ""}
              {profile.trend.toFixed(1)}/yr
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-purple-900/40">
          {profile.confidenceReason}
        </p>
      )}
    </div>
  );
}

/** A gap that may not exist yet (no career record on one side, or no gameweeks played) — never fabricated as 0. */
function GapCell({ gap, decimals = 1 }: { gap: number | null; decimals?: number }) {
  if (gap === null) {
    return <td className="py-1.5 text-right tabular-nums text-zinc-400">—</td>;
  }
  return (
    <td
      className={`py-1.5 text-right tabular-nums font-medium ${
        gap > 0
          ? "text-emerald-700 dark:text-emerald-400"
          : gap < 0
            ? "text-amber-700 dark:text-amber-400"
            : "text-zinc-500"
      }`}
    >
      {gap > 0 ? "+" : ""}
      {gap.toFixed(decimals)}
    </td>
  );
}

type RivalTab = "season" | "career";

/**
 * Other managers already loaded, compared two ways: this season's points
 * (once any gameweek has been played) and career median percentile. Rivals
 * with no history for a given half render "—" rather than being dropped —
 * a first-season manager still belongs on the this-season tab.
 */
export function RivalTable({ rivals }: { rivals: RivalRow[] }) {
  const anySeasonData = rivals.some((r) => r.season !== null);
  const [tab, setTab] = useState<RivalTab>(anySeasonData ? "season" : "career");

  if (rivals.length === 0) return null;

  const tabButton = (id: RivalTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-current={tab === id ? "page" : undefined}
      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        tab === id
          ? "bg-purple-950 text-white dark:bg-emerald-950/60 dark:text-[#00FF87] dark:ring-1 dark:ring-[#00FF87]/40"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-purple-950/50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-[#1E0234]">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rivals</h3>
        <div className="flex gap-1 rounded-lg border border-zinc-200 p-0.5 dark:border-purple-900/40">
          {tabButton("season", "This season")}
          {tabButton("career", "Career")}
        </div>
      </div>

      {tab === "season" ? (
        anySeasonData ? (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                <th className="py-1.5">Manager</th>
                <th className="py-1.5 text-right">GW pts</th>
                <th className="py-1.5 text-right">Total</th>
                <th className="py-1.5 text-right">Rank</th>
                <th className="py-1.5 text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              {[...rivals]
                .sort((a, b) => (b.season?.pointsGap ?? -Infinity) - (a.season?.pointsGap ?? -Infinity))
                .map((r) => (
                  <tr
                    key={r.entryId}
                    className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30"
                  >
                    <td className="py-1.5 text-zinc-800 dark:text-zinc-200">{r.teamName}</td>
                    {r.season ? (
                      <>
                        <td className="py-1.5 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                          {r.season.lastEventPoints}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">
                          {r.season.totalPoints}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">
                          {r.season.overallRank?.toLocaleString() ?? "—"}
                        </td>
                        <GapCell gap={r.season.pointsGap} decimals={0} />
                      </>
                    ) : (
                      <td colSpan={4} className="py-1.5 text-right text-xs text-zinc-400">
                        No gameweeks played yet
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            Nobody has played a gameweek yet — this-season comparisons appear once GW1 results
            are in.
          </p>
        )
      ) : (
        <>
          <p className="mt-1 text-xs text-zinc-500">Full career records, oldest to newest.</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                <th className="py-1.5">Manager</th>
                <th className="py-1.5 text-right">Seasons</th>
                <th className="py-1.5 text-right">Median</th>
                <th className="py-1.5 text-right">Best</th>
                <th className="py-1.5 text-right">Worst</th>
                <th className="py-1.5 text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              {[...rivals]
                .sort((a, b) => (b.career?.gap ?? -Infinity) - (a.career?.gap ?? -Infinity))
                .map((r) => (
                  <tr
                    key={r.entryId}
                    className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30"
                  >
                    <td className="py-1.5 text-zinc-800 dark:text-zinc-200">{r.teamName}</td>
                    {r.career ? (
                      <>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">
                          {r.career.seasons}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                          {r.career.median.toFixed(1)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">
                          {r.career.best.toFixed(0)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">
                          {r.career.worst.toFixed(0)}
                        </td>
                        <GapCell gap={r.career.gap} />
                      </>
                    ) : (
                      <td colSpan={4} className="py-1.5 text-right text-xs text-zinc-400">
                        First season
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
