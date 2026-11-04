// Write only the rows that differ from what is already stored.
//
// An upsert that changes nothing still writes a new row version and WAL, so a
// sync that re-sends an unchanged table every few minutes burns Disk IO for no
// information (the Supabase "depleting Disk IO Budget" warning, Nov 2026:
// player_predictions had ~93M inserts and deletes for a 20k-row table).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const PAGE = 1000; // the API caps every response at 1000 rows

/** Stable form of a value: jsonb comes back with its keys reordered. */
function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    // numeric columns can come back as strings; compare them as numbers
    return v !== "" && !isNaN(Number(v)) && /^-?[\d.]+$/.test(v) ? String(Number(v)) : JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

type Scope = Record<string, string | number>;

/** Reads every stored row matching `scope`, paging past the 1000-row cap. */
async function fetchStored(
  db: SupabaseClient,
  table: string,
  scope: Scope,
  keyCols: string[],
): Promise<Record<string, unknown>[]> {
  let countQ = db.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(scope)) countQ = countQ.eq(k, v);
  const { count, error: countError } = await countQ;
  if (countError) throw new Error(`${table}: ${countError.message}`);

  const pages = Math.ceil((count ?? 0) / PAGE);
  const out = await Promise.all(
    Array.from({ length: pages }, async (_, i) => {
      let q = db.from(table).select("*");
      for (const [k, v] of Object.entries(scope)) q = q.eq(k, v);
      for (const k of keyCols) q = q.order(k, { ascending: true });
      const { data, error } = await q.range(i * PAGE, (i + 1) * PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    }),
  );
  return out.flat();
}

export interface DiffResult {
  /** Rows that are new or differ from the stored copy. */
  changed: Record<string, unknown>[];
  /** Stored rows with no counterpart in `rows`. */
  stale: Record<string, unknown>[];
}

/**
 * Compares `rows` against what `table` holds for `scope` (e.g. `{ season }`).
 * Columns in `ignore` (timestamps that change every run) never count as a
 * difference. Columns the stored row has but `rows` omits are not compared.
 */
export async function diffAgainstStored(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  keyCols: string[],
  scope: Scope,
  ignore: string[] = [],
): Promise<DiffResult> {
  const stored = await fetchStored(db, table, scope, keyCols);
  const keyOf = (r: Record<string, unknown>) => keyCols.map((k) => String(r[k])).join("|");
  const byKey = new Map(stored.map((r) => [keyOf(r), r]));
  const skip = new Set(ignore);

  const changed: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    seen.add(key);
    const old = byKey.get(key);
    if (!old) {
      changed.push(row);
      continue;
    }
    for (const col of Object.keys(row)) {
      if (skip.has(col)) continue;
      if (canon(row[col]) !== canon(old[col])) {
        changed.push(row);
        break;
      }
    }
  }
  const stale = stored.filter((r) => !seen.has(keyOf(r)));
  return { changed, stale };
}
