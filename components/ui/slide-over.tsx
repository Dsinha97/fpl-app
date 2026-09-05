"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useDismissablePopover } from "@/components/ui/use-anchored-panel";

/**
 * A dockable panel over a dimmed backdrop.
 *
 * Sprint 33 — this existed already, inlined inside `MobileNav`
 * (`components/nav-links.tsx`), which was the only true slide-over in the
 * app. Merging `/compare` into `/players` needed a second one on the other
 * edge, and the choice was to copy forty-odd lines or to lift the original.
 * One implementation (CLAUDE.md), so: lifted, and `MobileNav` now renders
 * through it too.
 *
 * Dismissal is the app-wide `useDismissablePopover` convention — outside
 * mousedown plus Escape — with the backdrop carrying its own click handler,
 * because a click on it is "outside the panel" while still being inside the
 * subtree the hook watches.
 */
export function SlideOver({
  open,
  onClose,
  side = "right",
  label,
  width = "min(28rem, 92vw)",
  triggerRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Which edge the panel docks to. Dock it to the edge its trigger sits on:
   *  a tap and its result at opposite ends of a phone screen reads as two
   *  unrelated events. */
  side?: "left" | "right";
  /** Accessible name for the dialog. */
  label: string;
  /** Any CSS width. The default keeps a phone's remaining page visible. */
  width?: string;
  /** The control that opens this, so clicking it to *close* isn't also
   *  treated as an outside-click that closes it first. */
  triggerRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useDismissablePopover(open, onClose, triggerRef ? [panel, triggerRef] : [panel]);

  // A background that scrolls behind an open panel is disorienting, and on a
  // phone it is very easy to catch page content instead of the panel.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const edge =
    side === "right"
      ? "right-0 border-l border-zinc-200 dark:border-purple-800/50"
      : "left-0 border-r border-zinc-200 dark:border-purple-800/50";

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/40" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ width }}
        className={`fixed inset-y-0 z-50 overflow-y-auto bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl dark:bg-[#2A0A45] ${edge}`}
      >
        {children}
      </div>
    </>
  );
}
