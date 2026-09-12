"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A segmented pill control with a sliding indicator.
 *
 * The app had five separate takes on "pick one of these": `/transfers`' sub-tab
 * pills, `/fixtures`' four tabs and its Official/Strength switch, `/settings`'
 * four tabs, `/scenarios`' xP / Points-scored toggle, and `/news`' filter row.
 * Several of the audit's complaints are really about their inconsistency —
 * DSI-127 asks for the Official/Strength pair to read "as a unified segmented
 * pill switch", DSI-124 wants tab navigation visually separated from the
 * dropdown beside it, DSI-122 flags an active pill whose styling fights itself.
 *
 * Motion follows References/Components/tab-sliding.md: the indicator's width
 * and transform are written from the active tab's measured geometry so it
 * tweens between positions rather than cross-fading, and it is positioned
 * without a transition on first paint and on resize so it never animates in
 * from zero. `motion-reduce` drops the tween, per that reference's own guard.
 *
 * The indicator is deliberately a raised neutral surface, not `--primary`.
 * Choosing a tab is navigation, not an action, and M9's accent-discipline rule
 * (DSI-129) reserves the neon for actions and winners. This is also what makes
 * the `/news` active pill stop clashing with the icon inside it.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Optional count/suffix rendered muted after the label. */
  badge?: React.ReactNode;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  size = "md",
  className,
  /**
   * `tabs` gives tablist/tab semantics (the control switches a visible panel).
   * `radio` is for a control that picks a *parameter* rather than a view — the
   * Official/Strength rating source, say — where "tab" would be a lie to a
   * screen reader.
   */
  semantics = "tabs",
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
  semantics?: "tabs" | "radio";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<T, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  // Suppresses the tween for the first measurement and for resizes, so the
  // indicator snaps into place instead of sliding in from the left edge.
  const [animate, setAnimate] = useState(false);

  const measure = useCallback(() => {
    const el = itemRefs.current.get(value);
    const list = listRef.current;
    if (!el || !list) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);

  useLayoutEffect(() => {
    measure();
  }, [measure, options]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setAnimate(false);
      measure();
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [measure]);

  // Enable the tween only after the first paint has placed the indicator.
  useEffect(() => {
    if (indicator && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(id);
    }
  }, [indicator, animate]);

  /** Arrow keys move between segments — expected of both roles. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1
      : 0;
    if (dir === 0) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (next) {
      onValueChange(next.value);
      itemRefs.current.get(next.value)?.focus();
    }
  };

  const pad = size === "sm" ? "p-0.5" : "p-1";
  const item = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";

  return (
    <div
      ref={listRef}
      role={semantics === "tabs" ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted",
        pad,
        className,
      )}
    >
      {indicator && (
        <span
          aria-hidden
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
          className={cn(
            "pointer-events-none absolute inset-y-1 left-0 z-0 rounded-full bg-card shadow-sm",
            size === "sm" && "inset-y-0.5",
            animate &&
              "transition-[transform,width] duration-base ease-slide motion-reduce:transition-none",
          )}
        />
      )}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            ref={(el) => {
              if (el) itemRefs.current.set(o.value, el);
              else itemRefs.current.delete(o.value);
            }}
            role={semantics === "tabs" ? "tab" : "radio"}
            aria-selected={semantics === "tabs" ? selected : undefined}
            aria-checked={semantics === "radio" ? selected : undefined}
            // Only the active segment is in the tab order; arrow keys move
            // within the group. Standard roving-tabindex for both roles.
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors duration-base ease-slide motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              item,
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.badge !== undefined && (
              <span className="text-[0.85em] tabular-nums text-muted-foreground">{o.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
