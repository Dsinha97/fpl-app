// Shared player-name matching for every search box in the app.
//
// FPL's `web_name` is an abbreviated display name — Elliot Anderson is stored as
// "E.Anderson", so searching his first name matched nothing. Matching has to
// consider the full name fields, which the API does provide.

export interface SearchableName {
  web_name: string | null;
  first_name?: string | null;
  second_name?: string | null;
  known_name?: string | null;
}

/** Unicode combining marks, left by NFD once a letter is decomposed. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** Letters NFD cannot decompose, so they need spelling out. */
const SPECIAL_LETTERS: [RegExp, string][] = [
  [/ø/g, "o"],
  [/đ/g, "d"],
  [/ł/g, "l"],
  [/ß/g, "ss"],
  [/æ/g, "ae"],
];

/** Lowercase and strip accents, so "odegaard" matches "Ødegaard". */
function fold(s: string): string {
  let out = s.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
  for (const [pattern, replacement] of SPECIAL_LETTERS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** The name fields worth searching, folded, with punctuation split out. */
function haystack(p: SearchableName): string[] {
  const parts: string[] = [];
  for (const field of [p.web_name, p.first_name, p.second_name, p.known_name]) {
    if (!field) continue;
    const folded = fold(field);
    parts.push(folded);
    // "E.Anderson" and "Alexander-Arnold" should also match on their segments.
    for (const token of folded.split(/[\s.\-']+/)) {
      if (token.length > 0) parts.push(token);
    }
  }
  return parts;
}

/**
 * Every whitespace-separated term in the query must appear in some name field.
 *
 * Requiring all terms is what makes "anderson elliot" work in either order while
 * keeping "elliot and" narrow rather than matching every player with "and" in a
 * name.
 */
export function matchesPlayerQuery(p: SearchableName, query: string): boolean {
  const terms = fold(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return true;

  const fields = haystack(p);
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/** "Elliot Anderson" for display under the abbreviated web_name. */
export function fullName(p: SearchableName): string | null {
  const full = [p.first_name, p.second_name].filter(Boolean).join(" ").trim();
  if (!full) return null;
  // No point repeating it when FPL's display name is already the full name.
  return fold(full) === fold(p.web_name ?? "") ? null : full;
}
