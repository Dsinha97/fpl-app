import type { TeamState } from "./team-state";

// Draft persistence.
//
// localStorage is the working copy — instant load, works signed out, and
// every page that touches a draft (builder, scenarios, transfers, chips)
// reads/writes through this synchronous API unchanged. Sprint 14 adds
// lib/draft-sync.ts as a replica on top: it pulls from and pushes to
// team_drafts using the exact same TeamState shape and the mergeDrafts rule
// below, so the cloud layer is a transport change, not a data-model one.

const KEY = "fpl_drafts_v1";
const HISTORY_KEY = "fpl_draft_history_v1";
/**
 * Deletes made while offline (or before Sprint 14's cloud sync exists) have
 * to survive a later pull from the cloud, or the next sync would resurrect
 * whatever the server still has under that id. Recorded locally as
 * draftId -> deletedAt; lib/draft-sync.ts reads this to push a tombstone and
 * clears the entry once the cloud row is confirmed gone.
 */
const TOMBSTONE_KEY = "fpl_draft_tombstones_v1";

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

// Notified on every local mutation (save, delete, import), so
// lib/draft-sync.ts can debounce a push without lib/drafts.ts knowing
// anything about Supabase or auth — this module stays a pure localStorage
// store, sync is layered on top rather than mixed in.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onDraftsChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyChanged() {
  for (const cb of listeners) cb();
}

function writeAll(drafts: TeamState[]) {
  window.localStorage.setItem(KEY, JSON.stringify(drafts));
  notifyChanged();
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

function readTombstones(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TOMBSTONE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeTombstones(tombstones: Record<string, string>) {
  window.localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
}

/** Draft ids deleted locally, with when — for lib/draft-sync.ts to push as cloud deletes. */
export function pendingTombstones(): Record<string, string> {
  return readTombstones();
}

/** Called once a tombstone has been pushed (or confirmed already applied) in the cloud. */
export function clearTombstone(draftId: string) {
  const tombstones = readTombstones();
  delete tombstones[draftId];
  writeTombstones(tombstones);
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

/**
 * Resolve which draft a page should open initially: the `?draft=<id>` query
 * param if present and still valid, else the most recently saved draft, else
 * none. Shared by every page that can be deep-linked from another draft-aware
 * page (builder, scenarios, chips, transfers) so "open the squad I was just
 * looking at" behaves the same everywhere instead of silently falling back to
 * whichever draft was edited most recently.
 */
export function resolveRequestedDraft(
  list: TeamState[],
  search: string,
): TeamState | undefined {
  const wanted = new URLSearchParams(search).get("draft");
  const requested = wanted ? list.find((d) => d.draftId === wanted) : undefined;
  return requested ?? list[0];
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

  const tombstones = readTombstones();
  tombstones[draftId] = new Date().toISOString();
  writeTombstones(tombstones);
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

export interface MergeResult {
  merged: TeamState[];
  /** Ids that won — either new to `local` or newer by `updatedAt`. */
  addedIds: string[];
  added: number;
  skipped: number;
}

/**
 * The merge rule both file import and cloud sync (lib/draft-sync.ts) run on:
 * a draft this side has never seen always wins; otherwise the newer save
 * wins by `updatedAt`. Pulled out so the two callers cannot silently
 * disagree about which copy of a draft is correct — CLAUDE.md's "one
 * quantity, one implementation".
 */
export function mergeDrafts(local: TeamState[], incoming: TeamState[]): MergeResult {
  const byId = new Map(local.map((d) => [d.draftId, d]));
  const addedIds: string[] = [];
  let skipped = 0;

  for (const inc of incoming) {
    const current = byId.get(inc.draftId);
    if (!current || inc.updatedAt > current.updatedAt) {
      byId.set(inc.draftId, inc);
      addedIds.push(inc.draftId);
    } else {
      skipped++;
    }
  }

  return { merged: [...byId.values()], addedIds, added: addedIds.length, skipped };
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

  const validDrafts: TeamState[] = [];
  let invalidCount = 0;
  for (const d of envelope.drafts) {
    if (isDraft(d)) validDrafts.push(d);
    else invalidCount++;
  }

  const { merged, addedIds, added, skipped } = mergeDrafts(readAll(), validDrafts);

  const history = readHistory();
  for (const id of addedIds) {
    if (incomingHistory[id]) history[id] = incomingHistory[id];
  }

  writeAll(merged);
  writeHistory(history);
  return { added, skipped: skipped + invalidCount, error: null };
}
