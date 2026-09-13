"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { CalendarClock, LineChart, Newspaper, Rss, TriangleAlert } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedRowItem } from "@/components/feed-row";
import { ago, type FeedRow } from "@/lib/change-feed";
import { confidentEntities, dedupeByUrl, sourceBadge, type NewsRow } from "@/lib/news-feed";

/**
 * DSI-122: this row used to pair each label with a system emoji
 * (`📈 Prices`, `🟡 Availability`, …). Two problems. An emoji renders in the
 * platform's own colours and weight, so it never matches the system around it.
 * And the yellow circle on Availability read as an active warning *state*
 * rather than a category label — worse when the active pill was a solid green
 * fill with a yellow dot sitting inside it.
 *
 * Monochrome line icons inherit `currentColor`, so they follow the selected
 * and unselected states instead of fighting them.
 */
const FILTERS = [
  { key: "all", label: "All", Icon: null },
  { key: "price", label: "Prices", Icon: LineChart },
  { key: "availability", label: "Availability", Icon: TriangleAlert },
  { key: "news", label: "News", Icon: Newspaper },
  { key: "fixture", label: "Fixtures", Icon: CalendarClock },
  { key: "feeds", label: "Feeds", Icon: Rss },
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
        // change_feed carries every season's rows — scope to the current one
        // (same lookup used below for news_feed's entity names) so a second
        // season doesn't interleave into this feed once one exists.
        const { data: gw } = await supabase
          .from("gameweeks")
          .select("season")
          .eq("is_next", true)
          .limit(1)
          .maybeSingle();
        let query = supabase
          .from("change_feed")
          .select("*")
          .order("observed_at", { ascending: false })
          .limit(200);
        if (gw?.season) query = query.eq("season", gw.season);
        const { data, error: feedError } = await query;
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
    // newsRows is already published_at-descending, so dedupeByUrl keeps the
    // newest occurrence of a triplicated FFS item — see lib/news-feed.ts.
    return dedupeByUrl(filtered);
  }, [newsRows, source]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">What Changed?</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Price moves, availability, injury news, fixture changes, and now the reporting behind
        them — most recent first.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <SegmentedControl
          label="Change type"
          value={filter}
          onValueChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f.key,
            label: (
              <>
                {f.Icon && <f.Icon className="size-3.5" aria-hidden />}
                {f.label}
              </>
            ),
          }))}
        />
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
              {visible.map((row, i) => (
                <FeedRowItem key={i} row={row} />
              ))}
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

          {/* The filter row above this is already a SegmentedControl; these
              picked one source with `Button variant="toggle"`, so the page had
              two shapes for "pick exactly one". */}
          <div className="mt-3">
            <SegmentedControl
              label="Feed source"
              semantics="radio"
              size="sm"
              value={source}
              onValueChange={(v) => setSource(v as (typeof SOURCE_PILLS)[number]["slug"])}
              options={SOURCE_PILLS.map((s) => ({ value: s.slug, label: s.label }))}
            />
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
