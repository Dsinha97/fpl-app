import type { TeamState } from "./team-state";
import {
  clearTombstone,
  draftHistory,
  listDrafts,
  mergeDrafts,
  onDraftsChanged,
  pendingTombstones,
  saveDraft,
} from "./drafts";
import { supabase } from "./supabase/client";

// Cloud replica of lib/drafts.ts's localStorage store, for a signed-in user.
// localStorage stays the working copy every page reads/writes synchronously;
// this module only pulls, merges, and pushes the difference. Sprint 14
// deliberately keeps the two APIs separate rather than making every draft
// read async, so /builder, /scenarios, /transfers and /chips are untouched.

interface DraftRow {
  draft_id: string;
  name: string;
  payload: TeamState;
  deleted_at: string | null;
  updated_at: string;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  deleted: number;
  error: string | null;
}

/**
 * Pull every non-tombstoned cloud draft, merge with the local set via the
 * same mergeDrafts rule file import uses, then push whichever side the merge
 * decided is stale — including any locally-pending deletes as soft deletes
 * in the cloud (`deleted_at`), so a delete on one device is not resurrected
 * by a pull on another.
 */
export async function syncDrafts(userId: string): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, deleted: 0, error: null };

  // 1. Push pending local tombstones first, so a draft deleted here can't be
  // re-pulled from the cloud a moment later in step 2.
  const tombstones = pendingTombstones();
  for (const [draftId, deletedAt] of Object.entries(tombstones)) {
    const { error } = await supabase
      .from("team_drafts")
      .update({ deleted_at: deletedAt })
      .eq("draft_id", draftId)
      .eq("user_id", userId);
    if (error) {
      result.error = error.message;
      continue;
    }
    clearTombstone(draftId);
    result.deleted++;
  }

  // 2. Pull the cloud's live (non-tombstoned) drafts.
  const { data, error: pullError } = await supabase
    .from("team_drafts")
    .select("draft_id, name, payload, deleted_at, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (pullError) {
    return { ...result, error: pullError.message };
  }

  const cloudDrafts = ((data as DraftRow[] | null) ?? []).map((r) => r.payload);
  const local = listDrafts();

  // 3. Merge. mergeDrafts treats `local` as authoritative for ties and the
  // newer `updatedAt` as the winner otherwise — same rule importDrafts uses.
  const { merged, addedIds } = mergeDrafts(local, cloudDrafts);
  result.pulled = addedIds.length;

  // Drafts the cloud didn't have yet, or where the local copy won the merge,
  // need pushing. A draft "wins" locally either because it's genuinely new
  // here or because its local updatedAt is newer than what came back.
  const cloudById = new Map(cloudDrafts.map((d) => [d.draftId, d]));
  const toPush = merged.filter((d) => {
    const fromCloud = cloudById.get(d.draftId);
    return !fromCloud || fromCloud.updatedAt !== d.updatedAt;
  });

  for (const draft of merged) {
    if (!local.some((d) => d.draftId === draft.draftId) || addedIds.includes(draft.draftId)) {
      // Persist anything the merge pulled in from the cloud into localStorage
      // too, so this device's working copy reflects the merge outcome.
      saveDraft(draft);
    }
  }

  if (toPush.length > 0) {
    const { error: pushError } = await supabase.from("team_drafts").upsert(
      toPush.map((d) => ({
        draft_id: d.draftId,
        user_id: userId,
        name: d.name,
        payload: d,
        deleted_at: null,
      })),
      { onConflict: "draft_id" },
    );
    if (pushError) return { ...result, error: pushError.message };
    result.pushed = toPush.length;

    // Carry each pushed draft's local save timeline along, trimmed the same
    // way lib/drafts.ts trims its own HISTORY_LIMIT — an unbounded push would
    // grow draft_snapshots forever for a frequently-edited draft.
    const snapshotRows = toPush.flatMap((d) =>
      draftHistory(d.draftId).map((s) => ({
        draft_id: d.draftId,
        user_id: userId,
        at: s.at,
        payload: s,
      })),
    );
    if (snapshotRows.length > 0) {
      const { error: snapError } = await supabase
        .from("draft_snapshots")
        .upsert(snapshotRows, { onConflict: "draft_id,at" });
      if (snapError) console.error(`draft_snapshots push failed: ${snapError.message}`);
    }
  }

  return result;
}

const DEBOUNCE_MS = 2000;

/**
 * Runs an initial sync, then debounces a re-sync after every local draft
 * mutation (save/delete/import) for as long as `userId` stays signed in.
 * Returns an unsubscribe. `syncing` guards against the pull-side of
 * `syncDrafts` itself (which calls `saveDraft` to persist merged-in cloud
 * drafts locally) re-triggering a push mid-sync.
 */
export function watchAndSync(userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let cancelled = false;

  const runSync = async () => {
    if (syncing || cancelled) return;
    syncing = true;
    try {
      const result = await syncDrafts(userId);
      if (result.error) console.error(`draft sync failed: ${result.error}`);
    } finally {
      syncing = false;
    }
  };

  void runSync();

  const unsubscribe = onDraftsChanged(() => {
    if (syncing) return; // this change came from the sync's own pull-merge
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runSync(), DEBOUNCE_MS);
  });

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
