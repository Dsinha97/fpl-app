"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The click-toggle disclosure primitive underneath `InfoTooltip` below,
 * generalised to take an arbitrary trigger instead of always drawing its own
 * "?" circle. Sprint 19 built `InfoTooltip` for that "?" case; the
 * accessibility follow-on it named and deferred is every native `title=`
 * that carries reasoning found nowhere else (badges, dotted-underline stat
 * labels, small inline notes) — those need the exact same touch/keyboard
 * behaviour on a trigger that isn't a "?" button. This is the one popover
 * implementation both share, rather than a second hand-copy of the
 * open/close/outside-click/Escape logic per call site.
 */
export function TapToReveal({
  trigger,
  children,
  label,
  align = "left",
  triggerClassName = "",
  wrapperClassName = "relative inline-flex align-middle",
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
  align?: "left" | "right";
  triggerClassName?: string;
  /** Overrides the outer wrapper's display — a trigger meant to sit on its
   * own line (e.g. `RateBand`, previously a `block` span) needs `relative
   * block`, not the default `inline-flex`. */
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapper} className={wrapperClassName}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${triggerClassName}`}
      >
        {trigger}
      </button>

      {open && (
        <span
          role="dialog"
          className={`absolute top-full z-30 mt-1 w-72 rounded-lg border border-border bg-popover p-3 text-left text-xs font-normal leading-relaxed text-zinc-700 shadow-lg dark:text-zinc-300 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * A "?" affordance that opens a small explanatory panel.
 *
 * Click-toggled rather than hover-only so it works on touch, closes on Escape
 * and on outside click, and is reachable by keyboard.
 */
export function InfoTooltip({
  children,
  label = "What do these colours mean?",
  align = "left",
}: {
  children: ReactNode;
  label?: string;
  align?: "left" | "right";
}) {
  return (
    <TapToReveal
      label={label}
      align={align}
      triggerClassName="flex h-4 w-4 items-center justify-center rounded-full border border-zinc-400 text-[10px] font-bold text-zinc-500 transition-colors hover:border-purple-700 hover:text-purple-700 dark:border-purple-800/50 dark:text-zinc-400 dark:hover:border-primary dark:hover:text-primary"
      trigger="?"
    >
      {children}
    </TapToReveal>
  );
}

/** Shared explanation of the fixture colour + ring encoding. */
export function FdrLegendContent() {
  return (
    <>
      <p className="font-semibold text-zinc-900 dark:text-zinc-100">Reading a fixture</p>
      <p className="mt-1.5">
        <span className="font-medium">Fill colour</span> is the difficulty rating, dark green
        (easiest) through yellow to dark red (hardest).
      </p>
      <p className="mt-1.5">
        <span className="font-medium">Ring colour</span> is the venue — a{" "}
        <span className="font-semibold text-green-600 dark:text-green-400">green ring</span> means
        playing at home, a{" "}
        <span className="font-semibold text-red-600 dark:text-red-400">red ring</span> means away.
      </p>
      <p className="mt-1.5">
        The text is the opponent&apos;s three-letter code. Hover any fixture for the gameweek,
        venue, and difficulty in words.
      </p>
      <p className="mt-1.5 text-zinc-500 dark:text-zinc-400">
        Ratings currently come from the official FPL difficulty scale; a custom analytical rating
        arrives once teams have played matches.
      </p>
    </>
  );
}
