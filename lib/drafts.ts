import type { TeamState } from "./team-state";

// Draft persistence.
//
// localStorage for now, which is the build plan's stated initial strategy: no
// login, instant load, easy testing. Cloud sync arrives with Supabase Auth in
// a later sprint; because drafts are plain serialised TeamState objects, that
// migration is a transport change rather than a data-model change.

const KEY = "fpl_drafts_v1";
const HISTORY_KEY = "fpl_draft_history_v1";

/**
 * Saves retained per draft.
 *
 * localStorage is a few megabytes for the whole origin, and a squad snapshot is
 * roughly 700 bytes, so twenty per draft is affordable while still showing how a
 * line of thinking developed. Older entries are dropped rather than compacted —
 * a truncated timeline is honest, a silently lossy one is not.
 */
const HISTORY_LIMIT = 20;

export interface DraftSnapshot {
  at: string;
  name: string;
  playerIds: number[];
  captain: number | null;
  viceCaptain: number | null;
  spent: number;
  size: number;
}

function readAll(): TeamState[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TeamState[]) : [];
  } catch {
    // A corrupt blob should not take the page down; treat it as no drafts.
    return [];
  }
}

function writeAll(drafts: TeamState[]) {
  window.localStorage.setItem(KEY, JSON.stringify(drafts));
}

function readHistory(): Record<string, DraftSnapshot[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, DraftSnapshot[]>)
      : {};
  } catch {
    return {};
  }
}

function writeHistory(history: Record<string, DraftSnapshot[]>) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

const snapshotOf = (state: TeamState): DraftSnapshot => ({
  at: state.updatedAt,
  name: state.name,
  playerIds: state.players.map((p) => p.playerId),
  captain: state.captain,
  viceCaptain: state.viceCaptain,
  spent: state.players.reduce((sum, p) => sum + p.purchasePrice, 0),
  size: state.players.length,
});

const sameSquad = (a: DraftSnapshot, b: DraftSnapshot) =>
  a.captain === b.captain &&
  a.viceCaptain === b.viceCaptain &&
  a.name === b.name &&
  a.playerIds.length === b.playerIds.length &&
  a.playerIds.every((id, i) => id === b.playerIds[i]);

export function listDrafts(): TeamState[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getDraft(draftId: string): TeamState | null {
  return readAll().find((d) => d.draftId === draftId) ?? null;
}

export function saveDraft(state: TeamState): TeamState {
  const stamped = { ...state, updatedAt: new Date().toISOString() };
  const drafts = readAll();
  const index = drafts.findIndex((d) => d.draftId === stamped.draftId);
  if (index >= 0) drafts[index] = stamped;
  else drafts.push(stamped);
  writeAll(drafts);
  recordSnapshot(stamped);
  return stamped;
}

/** Append to the timeline, skipping saves that changed nothing worth showing. */
function recordSnapshot(state: TeamState) {
  const history = readHistory();
  const entries = history[state.draftId] ?? [];
  const next = snapshotOf(state);
  const last = entries[entries.length - 1];
  if (last && sameSquad(last, next)) return;
  history[state.draftId] = [...entries, next].slice(-HISTORY_LIMIT);
  writeHistory(history);
}

export function draftHistory(draftId: string): DraftSnapshot[] {
  return readHistory()[draftId] ?? [];
}

export function deleteDraft(draftId: string) {
  writeAll(readAll().filter((d) => d.draftId !== draftId));
  const history = readHistory();
  delete history[draftId];
  writeHistory(history);
}

export function renameDraft(draftId: string, name: string): TeamState | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const drafts = readAll();
  const index = drafts.findIndex((d) => d.draftId === draftId);
  if (index < 0) return null;
  const renamed = { ...drafts[index], name: trimmed, updatedAt: new Date().toISOString() };
  drafts[index] = renamed;
  writeAll(drafts);
  recordSnapshot(renamed);
  return renamed;
}

export function cloneDraft(state: TeamState): TeamState {
  const now = new Date().toISOString();
  const copy: TeamState = {
    ...state,
    draftId: crypto.randomUUID(),
    name: `${state.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  return saveDraft(copy);
}

// -------------------------------------------------------- export / import
//
// Drafts live in origin-scoped localStorage, so a hostname change orphans
// them — it happened once already, moving to the Workers hostname, and was
// recovered by hand. This is a real backup path, not a sync feature: Sprint
// 14 supersedes it with cloud storage that has an owner.

const EXPORT_VERSION = 1;

interface DraftExportEnvelope {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  drafts: TeamState[];
  /** The save timeline travels with the drafts, so a restore isn't a blank slate. */
  history: Record<string, DraftSnapshot[]>;
}

/** Every draft and its save timeline, as a JSON string ready to download. */
export function exportDrafts(): string {
  const envelope: DraftExportEnvelope = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    drafts: readAll(),
    history: readHistory(),
  };
  return JSON.stringify(envelope, null, 2);
}

export interface ImportResult {
  added: number;
  skipped: number;
  /** A rejected file, or nothing usable inside it — not per-draft, which "skipped" already covers. */
  error: string | null;
}

/**
 * Restore drafts from a previously exported file.
 *
 * `merge` keeps whichever copy of a draft is newer by `updatedAt` rather
 * than blindly overwriting — reimporting an old backup should never clobber
 * work done since. `replace` is an explicit, named choice for "start over
 * from this file", never the default.
 */
export function importDrafts(json: string, mode: "merge" | "replace"): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { added: 0, skipped: 0, error: "That file isn't valid JSON." };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== EXPORT_VERSION ||
    !Array.isArray((parsed as { drafts?: unknown }).drafts)
  ) {
    return {
      added: 0,
      skipped: 0,
      error: "Not a draft export this app recognises — wrong version or shape.",
    };
  }

  const envelope = parsed as DraftExportEnvelope;
  const incomingHistory =
    envelope.history && typeof envelope.history === "object" ? envelope.history : {};

  // Each entry is validated on its own — one malformed draft in a file
  // should not sink the rest of an otherwise-good import.
  const isDraft = (d: unknown): d is TeamState =>
    !!d &&
    typeof d === "object" &&
    typeof (d as TeamState).draftId === "string" &&
    typeof (d as TeamState).updatedAt === "string" &&
    Array.isArray((d as TeamState).players);

  if (mode === "replace") {
    const drafts = envelope.drafts.filter(isDraft);
    writeAll(drafts);
    writeHistory(incomingHistory);
    return { added: drafts.length, skipped: envelope.drafts.length - drafts.length, error: null };
  }

  const byId = new Map(readAll().map((d) => [d.draftId, d]));
  const history = readHistory();
  let added = 0;
  let skipped = 0;

  for (const incoming of envelope.drafts) {
    if (!isDraft(incoming)) {
      skipped++;
      continue;
    }
    const current = byId.get(incoming.draftId);
    // A draft this browser has never seen always wins; otherwise the newer
    // save wins, so reimporting an old backup can't clobber later work.
    if (!current || incoming.updatedAt > current.updatedAt) {
      byId.set(incoming.draftId, incoming);
      if (incomingHistory[incoming.draftId]) history[incoming.draftId] = incomingHistory[incoming.draftId];
      added++;
    } else {
      skipped++;
    }
  }

  writeAll([...byId.values()]);
  writeHistory(history);
  return { added, skipped, error: null };
}
