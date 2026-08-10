"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

// One session for the whole app, mirrored from Supabase's own
// onAuthStateChange stream rather than read ad hoc on every page. Everything
// that needs "am I signed in" (nav-links, /team's claim flow, draft sync)
// reads this instead of calling supabase.auth.getSession() itself, so there
// is exactly one place a stale session could hide.
//
// Sprint 14.3 adds the claimed FPL profile (user_profiles.entry_id ->
// managers.team_name) alongside the session, fetched once per sign-in rather
// than separately by the header, /team, and the settings page — the account
// menu's avatar/label, /team's connect flow, and the squad importer's draft
// name all need the same two fields.

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  entryId: number | null;
  teamName: string | null;
  profileLoading: boolean;
}

interface AuthContextValue extends AuthState {
  /** Call after writing user_profiles.entry_id elsewhere (e.g. /team's connect
   * flow, or the account-details form) so every consumer of teamName/entryId
   * picks up the change without a full reload. */
  refreshProfile: () => Promise<void>;
}

const initialState: AuthState = {
  session: null,
  user: null,
  loading: true,
  entryId: null,
  teamName: null,
  profileLoading: false,
};

const AuthContext = createContext<AuthContextValue>({
  ...initialState,
  refreshProfile: async () => {},
});

async function loadProfile(userId: string): Promise<{ entryId: number | null; teamName: string | null }> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("entry_id")
    .eq("user_id", userId)
    .maybeSingle();

  const entryId = profile?.entry_id ?? null;
  if (entryId === null) return { entryId: null, teamName: null };

  const { data: manager } = await supabase
    .from("managers")
    .select("team_name")
    .eq("entry_id", entryId)
    .maybeSingle();

  return { entryId, teamName: manager?.team_name ?? null };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const refreshProfile = useCallback(async () => {
    const userId = state.user?.id;
    if (!userId) return;
    setState((s) => ({ ...s, profileLoading: true }));
    const { entryId, teamName } = await loadProfile(userId);
    setState((s) => (s.user?.id === userId ? { ...s, entryId, teamName, profileLoading: false } : s));
    // state.user is read via closure above rather than a dep, since this only
    // needs "whoever is signed in right now" at call time — adding it as a
    // dependency would redefine the callback (and any consumer's effect that
    // depends on it) on every auth change for no behavioural difference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applySession = async (session: Session | null) => {
      const user = session?.user ?? null;
      if (cancelled) return;
      setState((s) => ({ ...s, session, user, loading: false, profileLoading: !!user }));

      if (!user) {
        if (!cancelled) setState((s) => ({ ...s, entryId: null, teamName: null, profileLoading: false }));
        return;
      }
      const { entryId, teamName } = await loadProfile(user.id);
      if (!cancelled) setState((s) => (s.user?.id === user.id ? { ...s, entryId, teamName, profileLoading: false } : s));
    };

    supabase.auth.getSession().then(({ data }) => void applySession(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refreshProfile }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
