"use client";

import { useEffect, useState } from "react";
import { ModelNote } from "@/components/ui/model-note";
import { FixtureCell } from "@/components/fdr-badge";
import { AvailabilityBadge, RoleBadges } from "@/components/player-status-icons";
import { sourceBadge } from "@/lib/news-feed";
import { ago } from "@/lib/change-feed";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCell, StatGrid, MiniBar } from "@/components/player-modal/stat-cell";
import { rankOf, RANK_MODEL_NOTE, type PositionRanks } from "@/lib/player-ranks";
import {
  loadPlayerGameweeks,
  loadPlayerPrices,
  transferTotals,
  seasonTotals,
  loadCurrentTransferSample,
  loadPlayerExtras,
  type GameweekLine,
  type PriceChange,
  type PlayerExtras,
} from "@/lib/player-profile";
import {
  priceVerdictLabel,
  PRICE_WATCH_MODEL_NOTE,
  type PriceProgress,
} from "@/lib/price-watch";
import type { PlayerData } from "@/components/player-card";

const POSITION_LONG: Record<string, string> = {
  GKP: "goalkeepers",
  DEF: "defenders",
  MID: "midfielders",
  FWD: "forwards",
};

const money = (tenths: number | null | undefined) =>
  tenths === null || tenths === undefined ? "—" : `£${(tenths / 10).toFixed(1)}m`;

const compact = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
};

/** Signed percentage for a price reading. Above 100% is meaningful, not a bug. */
const signedPct = (raw: number | null | undefined) =>
  raw === null || raw === undefined ? "—" : `${raw > 0 ? "+" : raw < 0 ? "−" : ""}${Math.abs(raw * 100).toFixed(1)}%`;

export function OverviewTab({
  player,
  season,
  currentEvent,
  ranks,
  positionShort,
  priceProgress,
  teamShortById,
}: {
  player: PlayerData;
  season: string;
  currentEvent: number | null;
  ranks?: PositionRanks;
  positionShort: string;
  priceProgress?: PriceProgress;
  /** Opponent short names, for the Recent form chips. */
  teamShortById: Map<number, string>;
}) {
  const [lines, setLines] = useState<GameweekLine[] | null>(null);
  const [prices, setPrices] = useState<PriceChange[] | null>(null);
  const [sample, setSample] = useState<{ in: number; out: number } | null>(null);
  const [extras, setExtras] = useState<PlayerExtras | null>(null);

  const code = player.code ?? null;
  const positionLong = POSITION_LONG[positionShort] ?? "players";

  useEffect(() => {
    let live = true;
    loadPlayerGameweeks(season, player.id)
      .then((r) => live && setLines(r))
      .catch(() => live && setLines([]));
    return () => {
      live = false;
    };
  }, [season, player.id]);

  useEffect(() => {
    if (code === null) return;
    let live = true;
    loadPlayerPrices(season, code)
      .then((r) => live && setPrices(r))
      .catch(() => live && setPrices([]));
    loadCurrentTransferSample(season, code)
      .then((r) => live && setSample(r))
      .catch(() => live && setSample(null));
    // Loaded here rather than read off `player`, so the profile shows the
    // same sections from every page instead of whatever that page happened
    // to have queried.
    loadPlayerExtras(season, player.id, code, currentEvent)
      .then((r) => live && setExtras(r))
      .catch(() => live && setExtras(null));
    return () => {
      live = false;
    };
  }, [season, code, player.id, currentEvent]);

  const rank = (metric: Parameters<typeof rankOf>[2]) =>
    code === null ? null : rankOf(ranks, code, metric);

  const totals = lines ? transferTotals(lines, currentEvent, sample) : null;
  // Season figures come from the same gameweek lines the Gameweeks tab
  // itemises, so the headline and the table beside it cannot disagree.
  const season_ = lines ? seasonTotals(lines) : null;
  const loadingCell = <Skeleton className="h-5 w-12" />;
  // Season-start price: the earliest recorded price if we have the history,
  // else the oldest gameweek's `value`. Both are records of what it was, not
  // a derivation from today's price minus the net change.
  const seasonStart =
    prices && prices.length > 0
      ? prices[prices.length - 1].price - (prices[prices.length - 1].cost_change_event ?? 0)
      : lines && lines.length > 0
        ? lines[0].value
        : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatGrid label="Snapshot">
        <StatCell
          label="Total pts"
          value={lines === null ? loadingCell : season_!.points}
          rank={rank("total_points")}
          positionShort={positionShort}
          positionLong={positionLong}
          emphasis
        />
        <StatCell
          label="Owned"
          value={player.ownership !== undefined && player.ownership !== null ? `${player.ownership}%` : "—"}
          rank={rank("ownership")}
          positionShort={positionShort}
          positionLong={positionLong}
        />
        <StatCell
          label="xP next"
          value={player.expected_points !== undefined && player.expected_points !== null ? player.expected_points.toFixed(1) : "—"}
          rank={rank("xp_next")}
          positionShort={positionShort}
          positionLong={positionLong}
          captionMode="band"
        />
        <StatCell label="Form" value={player.form ?? "—"} rank={rank("form")} positionShort={positionShort} positionLong={positionLong} captionMode="band" />
        <StatCell
          label="Minutes"
          value={lines === null ? loadingCell : compact(season_!.minutes)}
          rank={rank("minutes")}
          positionShort={positionShort}
          positionLong={positionLong}
          captionMode="band"
        />
        <StatCell
          label="ICT"
          value={lines === null ? loadingCell : season_!.ict}
          rank={rank("ict")}
          positionShort={positionShort}
          positionLong={positionLong}
        />
      </StatGrid>

      <StatGrid label="Price">
        <StatCell
          label="Price"
          value={money(player.now_cost)}
          rank={rank("now_cost")}
          positionShort={positionShort}
          positionLong={positionLong}
        />
        <StatCell label="Season start" value={money(seasonStart)} />
        <StatCell
          label="Change"
          value={
            seasonStart !== null && player.now_cost !== undefined
              ? `${player.now_cost - seasonStart >= 0 ? "+" : "−"}£${(Math.abs(player.now_cost - seasonStart) / 10).toFixed(1)}m`
              : "—"
          }
        />
      </StatGrid>

      {priceProgress && priceProgress.verdict !== "unknown" && (
        <section className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-purple-900/60">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Price watch
          </h3>
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p
              className={`min-w-0 truncate text-sm font-semibold ${
                priceProgress.direction === "rise"
                  ? "text-emerald-600 dark:text-primary"
                  : priceProgress.direction === "fall"
                    ? "text-red-600 dark:text-red-400"
                    : "text-zinc-500"
              }`}
            >
              {priceVerdictLabel(priceProgress.verdict, priceProgress.direction)}
            </p>
            <p className="shrink-0 tabular-nums text-sm font-bold">{signedPct(priceProgress.progressRaw)}</p>
          </div>
          <MiniBar
            fill={priceProgress.progress ?? 0}
            tone={priceProgress.direction === "rise" ? "accent" : "muted"}
          />

          {priceProgress.projections && priceProgress.projections.length > 0 && (
            <>
              <p className="mt-2.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                At the current transfer rate
              </p>
              <div className="mt-1 grid min-w-0 gap-1.5 [grid-template-columns:repeat(3,minmax(0,1fr))]">
                {priceProgress.projections.map((p) => (
                  <div
                    key={p.nightsAhead}
                    className="min-w-0 rounded border border-zinc-200 px-1.5 py-1 text-center dark:border-purple-900/60"
                  >
                    <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                      {p.at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </p>
                    <p className="truncate tabular-nums text-[11px] font-semibold">{signedPct(p.progressRaw)}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <ModelNote className="mt-2">
            {signedPct(priceProgress.progressRaw)} is progress toward the net-transfer threshold you
            set — 100% means it has been reached, not that a change is likely. Measured across this
            season, a player past the threshold actually moved that night about 10% of the time for
            falls and 22% for rises, and heavily-owned players sit well past a flat threshold for
            days because FPL&apos;s real one rises with ownership.{" "}
            {priceProgress.projections && priceProgress.projections.length > 0
              ? "The dated figures carry the last 24 hours' transfer rate forward to the next nightly cutoffs; they are an extrapolation, not a forecast. "
              : ""}
            {PRICE_WATCH_MODEL_NOTE}
          </ModelNote>
        </section>
      )}

      <StatGrid label="Transfers">
        <StatCell
          label="GW in"
          value={lines === null ? loadingCell : compact(totals?.gwIn)}
          sub={totals?.gwSource === "sampled" ? "from a ~2h sample" : undefined}
        />
        <StatCell
          label="GW out"
          value={lines === null ? loadingCell : compact(totals?.gwOut)}
          sub={totals?.gwSource === "sampled" ? "from a ~2h sample" : undefined}
        />
        <StatCell label="Season in" value={lines === null ? loadingCell : compact(totals?.seasonIn)} />
        <StatCell label="Season out" value={lines === null ? loadingCell : compact(totals?.seasonOut)} />
      </StatGrid>

      {player.upcoming && player.upcoming.length > 0 && (
        <section className="min-w-0">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Next fixtures
          </h3>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {player.upcoming.slice(0, 5).map((f) => (
              <FixtureCell
                key={`${f.event}-${f.opponent_short_name}-${f.is_home ? "H" : "A"}`}
                opponent={f.opponent_short_name}
                home={f.is_home}
                fdr={f.fdr}
                gw={f.event}
              />
            ))}
          </div>
        </section>
      )}

      <StatGrid label="Season stats">
        <StatCell
          label="Goals"
          value={lines === null ? loadingCell : season_!.goals}
          rank={rank("goals")}
          positionShort={positionShort}
          positionLong={positionLong}
          captionMode="band"
        />
        <StatCell
          label="Assists"
          value={lines === null ? loadingCell : season_!.assists}
          rank={rank("assists")}
          positionShort={positionShort}
          positionLong={positionLong}
          captionMode="band"
        />
        <StatCell
          label="PPG"
          value={lines === null ? loadingCell : (season_!.ppg ?? "—")}
          sub={season_ ? `over ${season_.appearances} appearance${season_.appearances === 1 ? "" : "s"}` : undefined}
          rank={rank("ppg")}
          positionShort={positionShort}
          positionLong={positionLong}
          captionMode="band"
        />
      </StatGrid>

      {prices !== null && prices.length > 0 && (
        <section className="min-w-0">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Recent price changes
          </h3>
          <ul className="flex min-w-0 flex-col gap-1">
            {prices.slice(0, 5).map((p) => {
              const delta = p.cost_change_event ?? 0;
              const from = p.price - delta;
              return (
                <li
                  key={p.observed_at}
                  className="flex min-w-0 items-center justify-between gap-2 rounded border border-zinc-200 px-2.5 py-1.5 text-xs dark:border-purple-900/60"
                >
                  <span className="min-w-0 truncate tabular-nums font-medium">
                    {money(from)} → {money(p.price)}
                  </span>
                  <span className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                    {new Date(p.observed_at).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Recent form — the mirror of Next fixtures, looking backward. Built
          from the gameweek lines already loaded, so it needs no `past_results`
          from the caller and is present on every page. */}
      {lines !== null && lines.length > 0 && (
        <section className="min-w-0">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Recent form
          </h3>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {lines.slice(-6).map((r) => (
              <span
                key={`${r.event}-${r.fixture}`}
                title={`GW${r.event} · ${r.total_points} points · ${r.minutes} mins`}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  r.total_points >= 6
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : r.total_points >= 2
                      ? "bg-zinc-100 text-zinc-700 dark:bg-surface-3 dark:text-zinc-300"
                      : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                }`}
              >
                {r.total_points}pts {(teamShortById.get(r.opponent_team) ?? "?").toUpperCase()}
                {r.was_home ? "(H)" : "(A)"}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Season detail. `dc_actions` is a raw action count, not points: FPL
          only scores defensive contribution on crossing a positional
          threshold, so labelling it "DC pts" would be wrong. */}
      {season_ && (
        <StatGrid label="Season detail" columns={2}>
          <StatCell label="Bonus pts" value={season_.bonus} />
          <StatCell
            label="Appearances"
            value={season_.appearances}
            sub={`of ${lines?.length ?? 0} fixtures`}
          />
        </StatGrid>
      )}

      {extras && (extras.expectedMinutes !== null || extras.startProbability !== null) && (
        <StatGrid label="This gameweek" columns={2}>
          <StatCell
            label="Expected mins"
            value={extras.expectedMinutes !== null ? Math.round(extras.expectedMinutes) : "—"}
          />
          <StatCell
            label="Start chance"
            value={
              extras.startProbability !== null ? `${Math.round(extras.startProbability * 100)}%` : "—"
            }
          />
        </StatGrid>
      )}

      {extras && (extras.status ?? "a") !== "a" && (
        <section className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AvailabilityBadge
            status={extras.status}
            chanceOfPlaying={extras.chanceOfPlaying}
            news={extras.news}
            size="w-4 h-4"
          />
          <div className="min-w-0 flex-1 text-xs">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              Availability
              {extras.chanceOfPlaying !== null && extras.chanceOfPlaying < 100
                ? ` · ${extras.chanceOfPlaying}% chance of playing`
                : ""}
            </p>
            {extras.news && <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{extras.news}</p>}
          </div>
        </section>
      )}

      {extras &&
        (extras.penaltyOrder === 1 || extras.freeKickOrder === 1 || extras.cornerOrder === 1) && (
          <section className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <RoleBadges
              penaltyOrder={extras.penaltyOrder}
              freeKickOrder={extras.freeKickOrder}
              cornerOrder={extras.cornerOrder}
              size="w-4 h-4"
            />
            <span className="min-w-0 truncate">
              Takes{" "}
              {[
                extras.penaltyOrder === 1 ? "penalties" : null,
                extras.freeKickOrder === 1 ? "free kicks" : null,
                extras.cornerOrder === 1 ? "corners" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </section>
        )}

      {extras?.system && (
        <section className="flex min-w-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">System</span> ·
          <span className="min-w-0 truncate">{extras.system}</span>
          <ModelNote label="What the club system tells you">
            Tactical context for {extras.system} — not applied to xP.
          </ModelNote>
        </section>
      )}

      {extras && extras.headlines.length > 0 && (
        <section className="min-w-0">
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            In the news
          </h3>
          <ul className="flex min-w-0 flex-col gap-1.5">
            {extras.headlines.slice(0, 3).map((h, i) => (
              <li key={i} className="min-w-0">
                <a
                  href={h.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="line-clamp-2 text-xs font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                >
                  {h.title}
                </a>
                <div className="text-[10px] text-zinc-500">
                  {sourceBadge(h)} · {ago(h.published_at)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ranks ? <ModelNote>{RANK_MODEL_NOTE}</ModelNote> : null}
    </div>
  );
}
