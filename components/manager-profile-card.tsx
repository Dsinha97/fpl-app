"use client";

import { useState } from "react";
import { DataCell, DataHeadCell, DataRow, DataTable } from "@/components/ui/data-table";
import type { ManagerProfile, RivalRow } from "@/lib/manager-profile";
import { TapToReveal } from "@/components/info-tooltip";
import { AnnotatedLabel } from "@/components/ui/model-note";
import { SegmentedControl } from "@/components/ui/segmented-control";

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
          // DSI-120: these bars used the same --primary as every CTA in the
          // app. Using the primary interactive colour for a static data
          // visualisation dilutes the buttons — the eye stops reading it as
          // "this is actionable". --chart-1 is the visualisation ramp's own
          // first slot, which is what it is there for.
          className="h-full rounded-full bg-chart-1 transition-[width] duration-base ease-slide motion-reduce:transition-none"
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
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-card">
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
          <div className="mt-0.5 text-lg font-semibold text-purple-900 dark:text-primary">
            {profile.tier}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Seasons of record</div>
          <div className="mt-0.5 text-lg font-semibold text-purple-900 dark:text-primary">
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
                <p>
                  Standard deviation (spread of season-to-season variation) of percentile score —
                  higher means a less consistent career.
                </p>
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
    return <DataCell className="py-1.5 text-zinc-400" numeric>—</DataCell>;
  }
  return (
    <DataCell
      numeric
      className={`py-1.5 font-medium ${
        gap > 0
          ? "text-emerald-700 dark:text-emerald-400"
          : gap < 0
            ? "text-amber-700 dark:text-amber-400"
            : "text-zinc-500"
      }`}
    >
      {gap > 0 ? "+" : ""}
      {gap.toFixed(decimals)}
    </DataCell>
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

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-purple-900/40 dark:bg-card">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rivals</h3>
        <SegmentedControl
          label="Rival comparison period"
          size="sm"
          value={tab}
          onValueChange={(v) => setTab(v as RivalTab)}
          options={[
            { value: "season", label: "This season" },
            { value: "career", label: "Career" },
          ]}
        />
      </div>

      {tab === "season" ? (
        anySeasonData ? (
          /* DSI-141: these two tables were bare `<table>`s inside the card, so
             their min-content width pushed the *document* sideways on a phone
             rather than scrolling themselves — the career half, at six columns,
             is where it showed. DataTable is exactly this wrapper; the border
             and background are dropped because the card already draws them. */
          <DataTable
            minWidth="30rem"
            label="Rivals this season"
            wrapperClassName="mt-3 rounded-none border-0 bg-transparent"
          >
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                <DataHeadCell className="py-1.5">Manager</DataHeadCell>
                <DataHeadCell className="py-1.5" numeric>GW pts</DataHeadCell>
                <DataHeadCell className="py-1.5" numeric>Total</DataHeadCell>
                <DataHeadCell className="py-1.5" numeric>Rank</DataHeadCell>
                {/* "Gap" alone never said whose (DSI-120). The sign is right —
                    it is mine minus theirs, so green is genuinely ahead — but a
                    reader seeing a negative number had no way to learn that from
                    the screen. The direction now travels with the column. */}
                <DataHeadCell className="py-1.5" numeric>
                  <AnnotatedLabel
                    label="What the Gap column means"
                    align="right"
                    note="Your total points minus theirs. Positive (green) means you are ahead; negative (amber) means you are behind."
                  >
                    Gap
                  </AnnotatedLabel>
                </DataHeadCell>
              </tr>
            </thead>
            <tbody>
              {[...rivals]
                .sort((a, b) => (b.season?.pointsGap ?? -Infinity) - (a.season?.pointsGap ?? -Infinity))
                .map((r) => (
                  <DataRow key={r.entryId} className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
                    <DataCell className="py-1.5 text-zinc-800 dark:text-zinc-200">{r.teamName}</DataCell>
                    {r.season ? (
                      <>
                        <DataCell className="py-1.5 text-zinc-800 dark:text-zinc-200" numeric>
                          {r.season.lastEventPoints}
                        </DataCell>
                        <DataCell className="py-1.5 text-zinc-500" numeric>
                          {r.season.totalPoints}
                        </DataCell>
                        <DataCell className="py-1.5 text-zinc-500" numeric>
                          {r.season.overallRank?.toLocaleString() ?? "—"}
                        </DataCell>
                        <GapCell gap={r.season.pointsGap} decimals={0} />
                      </>
                    ) : (
                      <DataCell colSpan={4} className="py-1.5 text-xs text-zinc-400" numeric>
                        No gameweeks played yet
                      </DataCell>
                    )}
                  </DataRow>
                ))}
            </tbody>
          </DataTable>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            Nobody has played a gameweek yet — this-season comparisons appear once GW1 results
            are in.
          </p>
        )
      ) : (
        <>
          <p className="mt-1 text-xs text-zinc-500">Full career records, oldest to newest.</p>
          <DataTable
            minWidth="34rem"
            label="Rivals career records"
            wrapperClassName="mt-3 rounded-none border-0 bg-transparent"
          >
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-purple-900/40">
                <DataHeadCell className="py-1.5">Manager</DataHeadCell>
                <DataHeadCell className="py-1.5" numeric>Seasons</DataHeadCell>
                <DataHeadCell className="py-1.5" numeric>Median</DataHeadCell>
                <DataHeadCell className="py-1.5" numeric>Best</DataHeadCell>
                <DataHeadCell className="py-1.5" numeric>Worst</DataHeadCell>
                {/* "Gap" alone never said whose (DSI-120). The sign is right —
                    it is mine minus theirs, so green is genuinely ahead — but a
                    reader seeing a negative number had no way to learn that from
                    the screen. The direction now travels with the column. */}
                <DataHeadCell className="py-1.5" numeric>
                  <AnnotatedLabel
                    label="What the Gap column means"
                    align="right"
                    note="Your median career percentile score minus theirs. Positive (green) means the stronger record is yours; negative (amber) means theirs."
                  >
                    Gap
                  </AnnotatedLabel>
                </DataHeadCell>
              </tr>
            </thead>
            <tbody>
              {[...rivals]
                .sort((a, b) => (b.career?.gap ?? -Infinity) - (a.career?.gap ?? -Infinity))
                .map((r) => (
                  <DataRow key={r.entryId} className="border-b border-zinc-100 last:border-0 dark:border-purple-900/30">
                    <DataCell className="py-1.5 text-zinc-800 dark:text-zinc-200">{r.teamName}</DataCell>
                    {r.career ? (
                      <>
                        <DataCell className="py-1.5 text-zinc-500" numeric>
                          {r.career.seasons}
                        </DataCell>
                        <DataCell className="py-1.5 text-zinc-800 dark:text-zinc-200" numeric>
                          {r.career.median.toFixed(1)}
                        </DataCell>
                        <DataCell className="py-1.5 text-zinc-500" numeric>
                          {r.career.best.toFixed(0)}
                        </DataCell>
                        <DataCell className="py-1.5 text-zinc-500" numeric>
                          {r.career.worst.toFixed(0)}
                        </DataCell>
                        <GapCell gap={r.career.gap} />
                      </>
                    ) : (
                      <DataCell colSpan={5} className="py-1.5 text-xs text-zinc-400" numeric>
                        First season
                      </DataCell>
                    )}
                  </DataRow>
                ))}
            </tbody>
          </DataTable>
        </>
      )}
    </div>
  );
}
