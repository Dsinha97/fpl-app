// Shared shape and presentation helpers for the `change_feed` view
// (price rises/falls, availability status, news, fixture changes). Lifted
// out of app/changes/page.tsx so the Deadline Hub can reuse the same feed,
// filtered to one squad, without a second implementation — one quantity,
// one implementation, per CLAUDE.md.

export interface FeedRow {
  season: string;
  kind: "price_rise" | "price_fall" | "status" | "news" | "fixture";
  observed_at: string;
  player_code: number | null;
  web_name: string | null;
  team_short: string | null;
  detail: Record<string, unknown>;
}

export const STATUS_LABEL: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};

export function ago(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

const money = (tenths: unknown): string =>
  typeof tenths === "number" ? `£${(tenths / 10).toFixed(1)}m` : "?";

export function describe(row: FeedRow): { icon: string; text: string } {
  const d = row.detail;
  switch (row.kind) {
    case "price_rise":
      return { icon: "📈", text: `${money(d.old)} → ${money(d.new)}` };
    case "price_fall":
      return { icon: "📉", text: `${money(d.old)} → ${money(d.new)}` };
    case "status": {
      const oldS = STATUS_LABEL[String(d.old_status)] ?? String(d.old_status);
      const newS = STATUS_LABEL[String(d.new_status)] ?? String(d.new_status);
      const chance = d.new_chance !== null && d.new_chance !== undefined
        ? ` (${d.new_chance}% next round)`
        : "";
      const ruledOut = d.new_status === "i" || d.new_status === "s" || d.new_status === "u";
      return { icon: ruledOut ? "🔴" : "🟡", text: `${oldS} → ${newS}${chance}` };
    }
    case "news": {
      const text = d.new === null || d.new === "" ? "News cleared" : String(d.new);
      return { icon: "📰", text };
    }
    case "fixture": {
      const match = `${d.home ?? "?"} v ${d.away ?? "?"}`;
      const what = d.field === "event"
        ? `moved GW${d.old} → GW${d.new}`
        : `kickoff ${String(d.old ?? "?").slice(0, 16)} → ${String(d.new ?? "?").slice(0, 16)}`;
      return { icon: "📅", text: `${match} — ${what}` };
    }
  }
}
