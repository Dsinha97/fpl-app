"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";

export interface ActionItem {
  label: string;
  onSelect: () => void;
  /** Shown under the label — use it to warn, not to restate the label. */
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  /**
   * Ask before acting. The item stays open showing "<label>?" plus Confirm, so
   * an unrecoverable action can never be a single stray click.
   */
  confirm?: boolean;
}

interface ActionMenuProps {
  /** The default action, rendered as the primary button. */
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryDisabledReason?: string;
  items: ActionItem[];
  /** Announced on the caret trigger. */
  menuLabel?: string;
}

/**
 * Split button: a default action plus a caret opening the rest.
 *
 * The builder's draft bar had four equally weighted buttons competing with a
 * horizon group, a select, and a name field on one line. Save is the action
 * taken ninety percent of the time, so it keeps a button; the others move behind
 * the caret.
 */
export function ActionMenu({
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryDisabledReason,
  items,
  menuLabel = "More actions",
}: ActionMenuProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  /**
   * Controlled open state.
   *
   * Left uncontrolled, the trigger's own press handling toggled twice on a real
   * mouse click — pointerdown opened it and the following click closed it again,
   * so it only ever appeared to work under synthetic `.click()`. Owning the
   * state and toggling on click makes one press mean one toggle.
   */
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex overflow-hidden rounded-md">
      <button
        onClick={onPrimary}
        disabled={primaryDisabled}
        title={primaryDisabled ? primaryDisabledReason : undefined}
        className="bg-purple-950 px-3 py-1.5 font-medium text-white transition-colors hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
      >
        {primaryLabel}
      </button>

      <Menu.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirming(null);
        }}
      >
        <Menu.Trigger
          aria-label={menuLabel}
          openOnHover={false}
          onClick={() => setOpen((prev) => !prev)}
          className="border-l border-white/25 bg-purple-950 px-2 py-1.5 text-white transition-colors hover:bg-purple-800 dark:border-slate-950/25 dark:bg-[#00FF87] dark:text-slate-950 dark:hover:bg-[#00e67a]"
        >
          <span aria-hidden="true" className="text-[10px]">
            ▾
          </span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            {/* The transition is not decoration: Base UI keeps the popup
                mounted until a close animation completes, so without one it
                stays on screen after closing. */}
            <Menu.Popup className="min-w-52 origin-[var(--transform-origin)] rounded-md border border-zinc-200 bg-white py-1 shadow-xl outline-none transition-[opacity,scale] duration-100 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 dark:border-purple-800/60 dark:bg-[#2A0A45]">
              {items.map((item) => {
                const isConfirming = confirming === item.label;
                return (
                  <Menu.Item
                    key={item.label}
                    disabled={item.disabled}
                    // A confirm step must survive the first click, so the menu
                    // is told not to close on it.
                    closeOnClick={!item.confirm || isConfirming}
                    onClick={() => {
                      if (item.confirm && !isConfirming) {
                        setConfirming(item.label);
                        return;
                      }
                      setConfirming(null);
                      setOpen(false);
                      item.onSelect();
                    }}
                    title={item.disabled ? item.disabledReason : undefined}
                    className={`cursor-pointer px-3 py-1.5 text-sm outline-none transition-colors data-disabled:cursor-not-allowed data-disabled:opacity-40 data-highlighted:bg-zinc-100 dark:data-highlighted:bg-purple-950/70 ${
                      item.danger
                        ? "text-red-600 dark:text-red-400"
                        : "text-zinc-800 dark:text-zinc-200"
                    }`}
                  >
                    {isConfirming ? (
                      <span className="font-medium">{item.label}? Click again to confirm</span>
                    ) : (
                      <>
                        {item.label}
                        {item.description && (
                          <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                            {item.description}
                          </span>
                        )}
                      </>
                    )}
                  </Menu.Item>
                );
              })}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
}
