"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, describe, type FeedRow } from "@/lib/change-feed";
import { confidentEntities, sourceBadge, type NewsRow } from "@/lib/news-feed";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "price", label: "📈 Prices" },
  { key: "availability", label: "🟡 Availability" },
  { key: "news", label: "📰 News" },
  { key: "fixture", label: "📅 Fixtures" },
  { key: "feeds", label: "🗞 Feeds" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const SOURCE_PILLS = [
  { slug: "all", label: "All" },
  { slug: "ffs-all", label: "Scout" },
  { slug: "bbc-football", label: "BBC" },
  { slug: "guardian-football", label: "Guardian" },
  { slug: "sky-football", label: "Sky" },
] as const;

export default function NewsPage() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [newsRows, setNewsRows] = useState<NewsRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [source, setSource] = useState<(typeof SOURCE_PILLS)[number]["slug"]>("all");
  const [loading, setLoading] = useState(true);
  const [newsLoading, setNewsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  // entity_id -> display name, so a chip reads "club Arsenal" rather than a
  // bare numeric code the reader has no way to place.
  const [teamNames, setTeamNames] = useState<Map<number, string>>(new Map());
  const [playerNames, setPlayerNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    (async () => {
      try {
        const { data, error: feedError } = await supabase
          .from("change_feed")
          .select("*")
          .order("observed_at", { ascending: false })
          .limit(200);
        if (feedError) throw new Error(feedError.message);
        setRows((data ?? []) as FeedRow[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Feeds are only queried once the tab is opened — most visits to /news are
  // for the change feed, so there is no reason to pay for the RSS query on
  // every load.
  useEffect(() => {
    if (filter !== "feeds" || newsRows.length > 0 || newsError) return;
    (async () => {
      try {
        setNewsLoading(true);
        const { data, error: rssError } = await supabase
          .from("news_feed")
          .select("*")
          .order("published_at", { ascending: false })
          .limit(150);
        if (rssError) throw new Error(rssError.message);
        setNewsRows((data ?? []) as NewsRow[]);

        // teams/players are season-scoped rows (CLAUDE.md: the API caps every
        // response at 1000 rows) — an unfiltered players query would risk
        // silent truncation, so this scopes to the current season the same
        // way every squad-building page does.
        const { data: gw } = await supabase
          .from("gameweeks")
          .select("season")
          .eq("is_next", true)
          .limit(1)
          .maybeSingle();
        const season = gw?.season;
        if (season) {
          const [{ data: teams }, { data: players }] = await Promise.all([
            supabase.from("teams").select("code, short_name").eq("season", season),
            supabase.from("players").select("code, web_name").eq("season", season).limit(1000),
          ]);
          setTeamNames(new Map((teams ?? []).map((t) => [t.code as number, t.short_name as string])));
          setPlayerNames(new Map((players ?? []).map((p) => [p.code as number, p.web_name as string])));
        }
      } catch (err) {
        setNewsError(err instanceof Error ? err.message : String(err));
      } finally {
        setNewsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const visible = useMemo(() => {
    if (filter === "all" || filter === "feeds") return rows;
    return rows.filter((r) => {
      switch (filter) {
        case "price":
          return r.kind === "price_rise" || r.kind === "price_fall";
        case "availability":
          return r.kind === "status";
        case "news":
          return r.kind === "news";
        case "fixture":
          return r.kind === "fixture";
        default:
          return true;
      }
    });
  }, [rows, filter]);

  const visibleNews = useMemo(() => {
    const filtered = source === "all" ? newsRows : newsRows.filter((r) => r.source_slug === source);
    // Fantasy Football Scout is registered as three logical sources sharing
    // one feed URL (all-news, team-news, scout-picks — see
    // news_sources.include_categories), so an item whose categories satisfy
    // more than one filter is upserted once per source and shows up more
    // than once in "All". newsRows is already published_at-descending, so
    // keeping the first occurrence per url keeps the newest.
    const seen = new Set<string>();
    return filtered.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }, [newsRows, source]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">What Changed?</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Price moves, availability, injury news, fixture changes, and now the reporting behind
        them — most recent first.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            type="button"
            variant="toggle"
            size="md"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {filter !== "feeds" && (
        <>
          {error && (
            <p className="mt-6 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {loading && (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {!loading && !error && (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
              {visible.map((row, i) => {
                const { icon, text } = describe(row);
                return (
                  <li key={i} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 text-base" aria-hidden="true">
                      {icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {row.web_name && (
                          <span className="font-medium">
                            {row.web_name}
                            {row.team_short ? ` (${row.team_short})` : ""}
                            {" · "}
                          </span>
                        )}
                        {text}
                      </p>
                    </div>
                    <time
                      title={new Date(row.observed_at).toLocaleString()}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {ago(row.observed_at)}
                    </time>
                  </li>
                );
              })}
              {visible.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing yet — changes appear here as the pipeline observes them. Price changes
                  typically land daily around 01:30 UTC once the season starts.
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {filter === "feeds" && (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            Third-party headlines, not verified data — player/club links are the pipeline&apos;s
            best guess at what a story is about, not a fact the way a price change is.
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {SOURCE_PILLS.map((s) => (
              <Button
                key={s.slug}
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={source === s.slug}
                onClick={() => setSource(s.slug)}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {newsError && (
            <p className="mt-4 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
              {newsError}
            </p>
          )}
          {newsLoading && (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!newsLoading && !newsError && (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
              {visibleNews.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {row.title}
                    </a>
                    <time
                      title={new Date(row.published_at).toLocaleString()}
                      className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
                    >
                      {row.published_estimated ? "~" : ""}
                      {ago(row.published_at)}
                    </time>
                  </div>
                  {row.excerpt && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.excerpt}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {sourceBadge(row)}
                    </span>
                    {confidentEntities(row).map((e, i) => {
                      const name =
                        e.entity_type === "team"
                          ? teamNames.get(e.entity_id)
                          : playerNames.get(e.entity_id);
                      return (
                        <span
                          key={i}
                          className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
                          title={`${e.entity_type} match · ${Math.round(e.confidence * 100)}% confidence · ${e.matched_via}`}
                        >
                          {name ?? `${e.entity_type} #${e.entity_id}`}
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
              {visibleNews.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No headlines yet for this source — sync-news polls every 20 minutes.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
