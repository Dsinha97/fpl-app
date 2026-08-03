// The FPL API is loose about types: numbers arrive as strings ("0.3", "4.5"),
// absent values arrive as null, "" or "None", and dates arrive in several
// shapes. These helpers normalise before the value reaches Postgres.

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || v === "None";

export function num(v: unknown): number | null {
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

export function str(v: unknown): string | null {
  if (isBlank(v)) return null;
  return String(v);
}

export function bool(v: unknown): boolean | null {
  if (isBlank(v)) return null;
  return Boolean(v);
}

/** ISO date (YYYY-MM-DD) for a Postgres `date` column. */
export function date(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** ISO timestamp for a Postgres `timestamptz` column. */
export function ts(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Split an array into fixed-size chunks, to keep upsert payloads modest. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
