"use client";

import { useCallback, useEffect, useState } from "react";

// Theme preference: explicit light/dark, or follow the OS ("system", the
// default — stored as an absent key). The `dark` Tailwind variant is
// class-based (see globals.css @custom-variant), so all switching reduces to
// toggling `.dark` on <html>. A no-FOUC boot script in the root layout applies
// the stored preference before first paint; this component only handles
// changes after hydration.

type ThemeMode = "light" | "dark" | "system";

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

const CYCLE: Record<ThemeMode, ThemeMode> = {
  system: "dark",
  dark: "light",
  light: "system",
};

const LABEL: Record<ThemeMode, string> = {
  system: "Theme: follows your system setting. Click for dark.",
  dark: "Theme: dark. Click for light.",
  light: "Theme: light. Click to follow your system setting.",
};

function ModeIcon({ mode }: { mode: ThemeMode }) {
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

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // localStorage is client-only, so the stored preference can only be read
    // after mount. The boot script has already applied it visually; this just
    // syncs the button's glyph.
    const stored = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "light" || stored === "dark") setMode(stored);
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

  const cycle = useCallback(() => {
    // Read the live preference rather than the rendered `mode`: two clicks
    // inside one React batch would otherwise both see the pre-batch value and
    // land on the same theme.
    const stored = localStorage.getItem(STORAGE_KEY);
    const current: ThemeMode = stored === "light" || stored === "dark" ? stored : "system";

    const next = CYCLE[current];
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    applyMode(next);
    setMode(next);
  }, []);

  return (
    <button
      type="button"
      onClick={cycle}
      title={mounted ? LABEL[mode] : "Theme"}
      aria-label={mounted ? LABEL[mode] : "Theme"}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:border-[#00FF87] dark:hover:text-[#00FF87]"
    >
      {/* Render a fixed glyph until mounted so server and client HTML match. */}
      {mounted ? <ModeIcon mode={mode} /> : <ModeIcon mode="system" />}
    </button>
  );
}
