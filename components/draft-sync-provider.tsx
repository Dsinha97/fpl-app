"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getSyncError, onSyncStatusChanged, watchAndSync } from "@/lib/draft-sync";

/**
 * Mounted once at the root (app/layout.tsx), inside AuthProvider. Starts
 * lib/draft-sync.ts's watch-and-push loop whenever a user is signed in, and
 * tears it down on sign-out — signed-out use is untouched, since
 * lib/drafts.ts's localStorage API doesn't know this exists.
 *
 * It also renders the loop's one user-visible surface (DSI-139). Cloud sync is
 * fire-and-forget by design, which is fine while it works and indefensible
 * when it does not: replication stopped for the whole life of the
 * `draft_snapshots` table and the only trace was a console line nobody had
 * open. A failure now says so, and says what it means — the work is safe on
 * this device, it just has not left it.
 */
export function DraftSyncProvider() {
  const { user } = useAuth();
  // Lazily seeded rather than read in an effect: a setState during an effect
  // is a cascading render, and the value at mount is whatever a previous mount
  // of this provider left behind.
  const [error, setError] = useState<string | null>(() => getSyncError());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchAndSync(user.id);
  }, [user]);

  useEffect(() => {
    return onSyncStatusChanged((next) => {
      setError(next);
      // A new failure after a dismissal is news again; a recovery clears both.
      setDismissed(false);
    });
  }, []);

  if (!user || !error || dismissed) return null;

  return (
    <div
      // Above the content, below any dialog. Fixed rather than in flow: the
      // sync runs from the root, so there is no one page this belongs on.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3"
    >
      <Alert tone="warning" className="pointer-events-auto max-w-md shadow-lg">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>
            Cloud sync failed, so this device is the only copy of your recent draft changes.
            Nothing has been lost locally. {error}
          </span>
          <Button
            type="button"
            variant="link"
            onClick={() => setDismissed(true)}
            className="h-auto p-0 text-inherit"
          >
            dismiss
          </Button>
        </span>
      </Alert>
    </div>
  );
}
