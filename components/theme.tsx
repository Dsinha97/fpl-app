"use client";

import { useCallback, useEffect, useState } from "react";

// Theme preference: explicit light/dark, or follow the OS ("system", the
// default — stored as an absent key). The `dark` Tailwind variant is
// class-based (see globals.css @custom-variant), so all switching reduces to
// toggling `.dark` on <html>. A no-FOUC boot script in the root layout applies
// the stored preference before first paint; this component only handles
// changes after hydration.
//
// Sprint 14.3 — the cycling ThemeToggle button was replaced by three
// explicit choices inside components/account-menu.tsx's dropdown, so the
// state/localStorage logic here is exposed as useThemeMode() rather than
// wrapped in a single button component. applyMode and THEME_BOOT_SCRIPT are
// unchanged and still the source of truth for "what does .dark mean".

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyMode(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/** Script string for the layout: sets .dark before paint. Keep in sync with applyMode. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
};

export function ThemeModeIcon({ mode }: { mode: ThemeMode }) {
  // 16px inline glyphs; stroke inherits text colour.
  if (mode === "light") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/**
 * Reads/writes the stored theme preference and keeps `.dark` in sync.
 * `mounted` lets a caller render a fixed placeholder until hydration, since
 * localStorage is client-only — same reasoning ThemeToggle used to apply
 * inline.
 */
export function useThemeMode(): { mode: ThemeMode; mounted: boolean; setMode: (m: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "light" || stored === "dark") setModeState(stored);
    setMounted(true);
  }, []);

  // In system mode, track OS-level changes live.
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    applyMode(next);
    setModeState(next);
  }, []);

  return { mode: mounted ? mode : "system", mounted, setMode };
}
