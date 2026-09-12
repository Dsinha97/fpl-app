import { CalendarClock, Newspaper, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { ago, describe, type FeedRow as Row } from "@/lib/change-feed";
import { semanticText } from "@/lib/semantic-colors";
import { cn } from "@/lib/utils";

/**
 * One row of the change feed, rendered the same way wherever it appears.
 *
 * `/news` and `/deadline` each had their own copy of this markup, and both
 * leaned on `describe()` returning a system emoji plus one long string. The
 * audit's complaints about the feed (DSI-122) were mostly consequences of that
 * shape: rises and falls looked identical because direction lived in the
 * decimals; availability rows restated the same premise three times because
 * there was only one line to put it on; the emoji never matched the design
 * system because emoji never do.
 *
 * `describe()` now returns semantics and this decides how they look, so the two
 * pages cannot drift apart again.
 */
const ICON: Record<Row["kind"], typeof TrendingUp> = {
  price_rise: TrendingUp,
  price_fall: TrendingDown,
  status: TriangleAlert,
  news: Newspaper,
  fixture: CalendarClock,
};

export function FeedRowItem({
  row,
  className,
  trailing,
}: {
  row: Row;
  className?: string;
  /** Overrides the default relative timestamp. */
  trailing?: ReactNode;
}) {
  const { tone, headline, badge, detail } = describe(row);
  const Icon = ICON[row.kind];

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", className)}>
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "neutral" ? "text-muted-foreground" : semanticText(tone),
        )}
      />

      <div className="min-w-0 flex-1">
        {/* Row 1 — who, what changed, and by how much. DSI-122's scan line. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-foreground">
          {row.web_name && (
            <span className="font-medium">
              {row.web_name}
              {row.team_short ? ` (${row.team_short})` : ""}
            </span>
          )}
          <span className={row.web_name ? "text-muted-foreground" : undefined}>{headline}</span>
          {badge && (
            <Badge tone={tone === "neutral" ? "neutral" : tone} size="sm">
              {badge}
            </Badge>
          )}
        </div>

        {/* Row 2 — the supporting quote, muted and out of the scan path. */}
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      </div>

      {trailing ?? (
        <time
          dateTime={row.observed_at}
          className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
        >
          {ago(row.observed_at)}
        </time>
      )}
    </li>
  );
}
