"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { watchAndSync } from "@/lib/draft-sync";

/**
 * Mounted once at the root (app/layout.tsx), inside AuthProvider. Starts
 * lib/draft-sync.ts's watch-and-push loop whenever a user is signed in, and
 * tears it down on sign-out — signed-out use is untouched, since
 * lib/drafts.ts's localStorage API doesn't know this exists.
 */
export function DraftSyncProvider() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    return watchAndSync(user.id);
  }, [user]);

  return null;
}
