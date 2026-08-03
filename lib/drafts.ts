import type { TeamState } from "./team-state";

// Draft persistence.
//
// localStorage for now, which is the build plan's stated initial strategy: no
// login, instant load, easy testing. Cloud sync arrives with Supabase Auth in
// a later sprint; because drafts are plain serialised TeamState objects, that
// migration is a transport change rather than a data-model change.

const KEY = "fpl_drafts_v1";

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

export function listDrafts(): TeamState[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveDraft(state: TeamState): TeamState {
  const stamped = { ...state, updatedAt: new Date().toISOString() };
  const drafts = readAll();
  const index = drafts.findIndex((d) => d.draftId === stamped.draftId);
  if (index >= 0) drafts[index] = stamped;
  else drafts.push(stamped);
  writeAll(drafts);
  return stamped;
}

export function deleteDraft(draftId: string) {
  writeAll(readAll().filter((d) => d.draftId !== draftId));
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
