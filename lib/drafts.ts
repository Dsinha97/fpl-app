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
