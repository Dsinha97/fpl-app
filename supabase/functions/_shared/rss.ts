// Hand-rolled RSS 2.0 / Atom parser — same "no new dependency" precedent as
// ingest-fpl-archive's hand-rolled CSV parser (Deno bundles each function
// directory independently; there is no import map for a third-party parser
// to hang off). Only the fields sync-news needs are extracted; everything
// else in the feed is ignored.
//
// Verified against all five enabled feeds during Sprint 20 (see
// docs/sprints/sprint-20.md): FFS and Sky use bare
// `<category>text</category>`, the Guardian uses
// `<category domain="...">text</category>` — both forms are handled.

export interface FeedItem {
  guid: string;
  url: string;
  title: string;
  /** Raw description/summary HTML, tags not yet stripped — callers excerpt it. */
  descriptionHtml: string | null;
  author: string | null;
  /** Raw pubDate/updated string, unparsed — callers call parsePubDate on it. */
  pubDateRaw: string | null;
  categories: string[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#8217": "’",
  "#8216": "‘",
  "#8211": "–",
  "#8212": "—",
  "#038": "&",
};

/** Decodes named/numeric XML entities. Not a full HTML entity table — feeds only need these. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#?[a-zA-Z0-9]+);/g, (m, code) => {
    if (ENTITIES[code] !== undefined) return ENTITIES[code];
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (Number.isFinite(n)) return String.fromCodePoint(n);
    }
    return m;
  });
}

/**
 * Strips tags and collapses whitespace, for turning a description into an
 * excerpt. Entities are decoded *before* tags are stripped — the Guardian's
 * feed escapes its markup (`&lt;p&gt;...&lt;/p&gt;`) rather than embedding
 * real `<p>` elements, so stripping first (as this used to) never matches
 * those tags and decoding afterwards turns the escaped text back into
 * literal `<p>` visible in the excerpt. Decoding twice is harmless for a
 * feed that already used real tags (CDATA'd markup has no entities to
 * double-decode).
 */
export function stripTags(html: string): string {
  return decodeEntities(decodeEntities(html))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

/** First match of a simple (non-self-closing) tag's inner content. */
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrapCdata(m[1]).trim() : null;
}

/** All `<category>` values, unwrapping CDATA and ignoring any `domain=".."` attribute. */
function categories(block: string): string[] {
  const out: string[] = [];
  const re = /<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = unwrapCdata(m[1]).trim();
    if (v) out.push(decodeEntities(v));
  }
  return out;
}

/** Atom's <link href="..."/> is a self-closing attribute, not RSS's text-content <link>. */
function atomLink(block: string): string | null {
  const m = block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/i);
  return m ? m[1] : null;
}

/**
 * Parses an RSS 2.0 `<item>` or Atom `<entry>` feed. Returns [] rather than
 * throwing on a feed that isn't XML at all (e.g. a 200 that actually served
 * an HTML page — the exact failure mode hit probing two of the seven
 * originally-requested feeds).
 */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blockRe = /<item\b[^>]*>([\s\S]*?)<\/item>|<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;

  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1] ?? m[2] ?? "";

    const title = tag(block, "title");
    const link = tag(block, "link") ?? atomLink(block);
    const guid = tag(block, "guid") ?? tag(block, "id") ?? link;
    if (!title || !link || !guid) continue; // not enough to identify the item

    items.push({
      guid: decodeEntities(guid),
      url: decodeEntities(link),
      title: decodeEntities(title),
      descriptionHtml: tag(block, "description") ?? tag(block, "content:encoded") ?? tag(block, "summary"),
      author: tag(block, "dc:creator") ?? tag(block, "author"),
      pubDateRaw: tag(block, "pubDate") ?? tag(block, "updated") ?? tag(block, "published"),
      categories: categories(block),
    });
  }

  return items;
}

/** Timezone abbreviations `Date()` cannot parse, mapped to an offset it can. */
const ZONE_OFFSETS: Record<string, string> = {
  GMT: "+0000",
  UTC: "+0000",
  BST: "+0100",
  // Guardian/BBC items are already GMT/UTC; BST only showed up on Sky in
  // the Sprint 20 probe, but IST/CEST are cheap to cover for any future feed.
  IST: "+0530",
  CEST: "+0200",
  CET: "+0100",
};

/**
 * Parses an RSS/Atom pubDate, rewriting a bare alphabetic zone abbreviation
 * to a numeric offset first. `new Date("Wed, 19 Aug 2026 12:59:00 BST")` is
 * `Invalid Date` as-is — confirmed against a live Sky Sports item during the
 * Sprint 20 probe — because JS Date only recognises GMT/UTC and numeric
 * offsets, not zone names. Returns null on genuine failure so the caller can
 * fall back to fetch time rather than write an Invalid Date to the DB.
 */
export function parsePubDate(raw: string | null): Date | null {
  if (!raw) return null;
  const rewritten = raw.replace(/\s([A-Z]{2,4})$/, (m, zone) =>
    ZONE_OFFSETS[zone] ? ` ${ZONE_OFFSETS[zone]}` : m,
  );
  const d = new Date(rewritten);
  return Number.isNaN(d.getTime()) ? null : d;
}
