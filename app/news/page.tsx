"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { CalendarClock, LineChart, Newspaper, Rss, TriangleAlert } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedRowItem } from "@/components/feed-row";
import { ago, type FeedRow } from "@/lib/change-feed";
import { confidentEntities, dedupeByUrl, sourceBadge, type NewsRow } from "@/lib/news-feed";
import { listDrafts, resolveRequestedDraft } from "@/lib/drafts";
import { useAuth } from "@/components/auth-provider";

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
  /**
   * One tagged player or club, when a chip has been used to narrow the feed
   * (DSI-122). The chips already carried the entity resolution — they just
   * weren't wired to anything, so they looked clickable and did nothing.
   */
  const [entityFilter, setEntityFilter] = useState<
    { type: string; id: number; name: string } | null
  >(null);
  /**
   * DSI-137 #1 -- "does this affect my 15?" is the first question an FPL
   * manager asks of any news item, and this page could not answer it: it held
   * no squad state at all.
   *
   * The squad is resolved exactly as /deadline and /transfers resolve it --
   * `resolveRequestedDraft` over the local drafts, preferring the linked
   * manager's import once the identity settles. This page only ever reads.
   *
   * Matching is by player *code*, not element id: both `change_feed.player_code`
   * and `news_feed`'s player entity ids are codes (see lib/news-feed.ts), while
   * a draft stores element ids. The one query below is what bridges them.
   */
  const [squadCodes, setSquadCodes] = useState<Set<number> | null>(null);
  const [squadTeamShorts, setSquadTeamShorts] = useState<Set<string>>(new Set());
  const [squadName, setSquadName] = useState<string | null>(null);
  const [mySquadOnly, setMySquadOnly] = useState(false);
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

  /**
   * Fixtures per club per gameweek, so a fixture move can say what it did
   * rather than only that it happened (DSI-122). Keyed by short name because
   * that is the club identity `change_feed` carries; counts are read
   * post-move, which is what makes "blank in GW20" true of the round the
   * fixture left.
   */
  const [fixtureCounts, setFixtureCounts] = useState<Map<string, Map<number, number>>>(new Map());

  useEffect(() => {
    (async () => {
      const { data: gw } = await supabase
        .from("gameweeks")
        .select("season")
        .eq("is_next", true)
        .limit(1)
        .maybeSingle();
      if (!gw?.season) return;
      const [{ data: clubs }, { data: fixtures }] = await Promise.all([
        supabase.from("teams").select("id, short_name").eq("season", gw.season),
        supabase.from("fixtures").select("event, team_h, team_a").eq("season", gw.season),
      ]);
      const shortById = new Map((clubs ?? []).map((t) => [t.id as number, t.short_name as string]));
      const counts = new Map<string, Map<number, number>>();
      const bump = (teamId: number, event: number | null) => {
        const short = shortById.get(teamId);
        if (!short || event === null) return;
        const byEvent = counts.get(short) ?? new Map<number, number>();
        byEvent.set(event, (byEvent.get(event) ?? 0) + 1);
        counts.set(short, byEvent);
      };
      for (const fx of fixtures ?? []) {
        bump(fx.team_h as number, fx.event as number | null);
        bump(fx.team_a as number, fx.event as number | null);
      }
      setFixtureCounts(counts);
    })();
  }, []);

  /** 0 rather than undefined for a club we know about: a club with no fixture
   *  in a gameweek has none, which is exactly the blank worth reporting. */
  const fixtureCountAt = (teamShort: string, event: number) => {
    const byEvent = fixtureCounts.get(teamShort);
    return byEvent ? (byEvent.get(event) ?? 0) : undefined;
  };

  const { entryId, teamName, profileLoading } = useAuth();

  useEffect(() => {
    if (profileLoading) return;
    const squad = resolveRequestedDraft(listDrafts(), window.location.search, {
      entryId,
      teamName,
    });
    if (!squad || squad.players.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSquadCodes(null);
      setSquadName(null);
      return;
    }
    setSquadName(squad.name);

    (async () => {
      const { data: gw } = await supabase
        .from("gameweeks")
        .select("season")
        .eq("is_next", true)
        .limit(1)
        .maybeSingle();
      if (!gw?.season) return;
      // Scoped by id list, so no 1000-row truncation risk (CLAUDE.md).
      const { data: picked } = await supabase
        .from("players")
        .select("code, team_code")
        .eq("season", gw.season)
        .in("id", squad.players.map((p) => p.playerId));
      setSquadCodes(new Set<number>((picked ?? []).map((p) => p.code as number)));

      const teamCodes = [...new Set((picked ?? []).map((p) => p.team_code as number))];
      if (teamCodes.length === 0) return;
      const { data: clubs } = await supabase
        .from("teams")
        .select("short_name")
        .eq("season", gw.season)
        .in("code", teamCodes);
      setSquadTeamShorts(new Set((clubs ?? []).map((t) => t.short_name as string)));
    })();
  }, [entryId, teamName, profileLoading]);

  /** Is this change-feed row about a player -- or a club -- in the squad? */
  const inSquad = (r: FeedRow) => {
    if (!squadCodes) return true;
    if (r.player_code !== null && squadCodes.has(r.player_code)) return true;
    // A fixture move carries no player: it is about a club, and it matters to
    // whoever owns that club's players. Matched on short name because that is
    // the only club identity the change feed carries.
    return r.kind === "fixture" && r.team_short !== null && squadTeamShorts.has(r.team_short);
  };

  const visible = useMemo(() => {
    const scoped = mySquadOnly ? rows.filter(inSquad) : rows;
    if (filter === "all" || filter === "feeds") return scoped;
    return scoped.filter((r) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, mySquadOnly, squadCodes, squadTeamShorts]);

  const visibleNews = useMemo(() => {
    let filtered = source === "all" ? newsRows : newsRows.filter((r) => r.source_slug === source);
    if (mySquadOnly && squadCodes) {
      filtered = filtered.filter((r) =>
        confidentEntities(r).some(
          (e) => e.entity_type === "player" && squadCodes.has(e.entity_id),
        ),
      );
    }
    if (entityFilter) {
      filtered = filtered.filter((r) =>
        confidentEntities(r).some(
          (e) => e.entity_type === entityFilter.type && e.entity_id === entityFilter.id,
        ),
      );
    }
    // newsRows is already published_at-descending, so dedupeByUrl keeps the
    // newest occurrence of a triplicated FFS item — see lib/news-feed.ts.
    return dedupeByUrl(filtered);
  }, [newsRows, source, entityFilter, mySquadOnly, squadCodes]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      {/* DSI-141: "My squad only" scopes the whole page, not the change-type
          row it used to sit in — where it wrapped onto its own line on a phone
          and read as a fourth filter pill in a different shape. A page setting
          belongs with the page title. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">What Changed?</h1>
        {/* Only offered when there is a squad to filter to. A toggle that can
            only ever empty the page is not a filter, it is a trap -- and a
            visitor with no draft is exactly the person who would try it. */}
        {squadCodes && squadCodes.size > 0 && (
          <Button
            variant="toggle"
            size="md"
            aria-pressed={mySquadOnly}
            onClick={() => setMySquadOnly((v) => !v)}
            title={
              mySquadOnly
                ? "Show every club's news again"
                : `Only news about players in "${squadName}" -- and fixture moves for their clubs`
            }
          >
            My squad only
          </Button>
        )}
      </div>
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
                <FeedRowItem key={i} row={row} fixtureCountAt={fixtureCountAt} />
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

          {/* A filter with no visible state is a trap: scroll past the chip you
              clicked and a short feed looks like a quiet news day rather than a
              filter you left on. */}
          {entityFilter && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Showing only headlines that mention{" "}
              <span className="font-medium text-foreground">{entityFilter.name}</span>
              <Button
                type="button"
                onClick={() => setEntityFilter(null)}
                variant="link"
                className="h-auto p-0 text-inherit"
              >
                clear
              </Button>
            </p>
          )}

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
                      const label = name ?? `${e.entity_type} #${e.entity_id}`;
                      const active =
                        entityFilter?.type === e.entity_type && entityFilter?.id === e.entity_id;
                      return (
                        <Button
                          size="xs"
                          variant="ghost"
                          key={i}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setEntityFilter(
                              active ? null : { type: e.entity_type, id: e.entity_id, name: label },
                            )
                          }
                          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                            active
                              ? "bg-primary text-slate-950"
                              : "bg-accent text-accent-foreground hover:bg-primary/20"
                          }`}
                          title={`${active ? "Clear this filter" : `Show only headlines mentioning ${label}`} · ${e.entity_type} match · ${Math.round(e.confidence * 100)}% confidence · ${e.matched_via}`}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </li>
              ))}
              {visibleNews.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {entityFilter
                    ? `No headlines mentioning ${entityFilter.name}${source === "all" ? "" : " from this source"}.`
                    : "No headlines yet for this source — sync-news polls every 20 minutes."}
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
