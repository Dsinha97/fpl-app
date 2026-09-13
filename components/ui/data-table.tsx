import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The shared shell for the app's 14 hand-copied tables.
 *
 * Deliberately a shell, not a table *engine*: these tables have almost nothing
 * in common cell-for-cell (a comparison matrix, an FDR grid, a league table, a
 * player list), so a column-config abstraction would fit none of them well.
 * What they do share, and what was copy-pasted 14 times, is the wrapper, the
 * header row, and — the part that kept regressing — the opaque background a
 * sticky cell needs, which every copy re-typed as a literal `dark:bg-[#1E0234]`
 * and which is why the raw-hex ESLint count kept climbing.
 *
 * Two things are new rather than lifted. The header can be `sticky top-0`: every
 * existing table only froze its first *column*, so scrolling down a long
 * comparison lost the column identities entirely (DSI-123) — but that needs
 * `maxHeight`, for the reason documented on it. And numeric cells
 * get a real right-alignment convention through `DataCell`, instead of
 * inheriting the default left alignment that made decimal points ragged
 * (DSI-126, DSI-129).
 */
export function DataTable({
  children,
  minWidth = "56rem",
  maxHeight,
  className,
  wrapperClassName,
  label,
}: {
  children: ReactNode;
  /** Width below which the wrapper scrolls horizontally rather than crushing cells. */
  minWidth?: string;
  /**
   * Caps the wrapper's height and lets it scroll vertically — which is what
   * actually makes `DataTableHead`'s sticky header work.
   *
   * This is not optional polish, it is the mechanism. `overflow-x: auto`
   * computes `overflow-y: auto` as well, so this wrapper is already the
   * vertical scroll container for everything inside it. Without a height cap
   * it never scrolls, so a `sticky top-0` header has nothing to stick against
   * and simply leaves with the page — the class is inert, which is worse than
   * absent because it reads as done. Set a height and the header sticks.
   */
  maxHeight?: string;
  className?: string;
  wrapperClassName?: string;
  label?: string;
}) {
  return (
    <div
      style={maxHeight ? { maxHeight } : undefined}
      className={cn(
        "overflow-x-auto rounded-lg border border-border bg-card",
        maxHeight && "overflow-y-auto",
        wrapperClassName,
      )}
    >
      <table
        aria-label={label}
        style={{ minWidth }}
        className={cn("w-full text-sm", className)}
      >
        {children}
      </table>
    </div>
  );
}

/**
 * Sticky header row.
 *
 * `top-0` is relative to the nearest scroll container, which for a `DataTable`
 * is always the wrapper — so this only does anything when that wrapper has a
 * `maxHeight`. Without one it is inert; see the note on `maxHeight`. The
 * background is opaque because rows scroll underneath it.
 */
export function DataTableHead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <thead className={cn("sticky top-0 z-20 bg-card", className)}>
      <tr className="border-b border-border text-left text-xs text-muted-foreground">{children}</tr>
    </thead>
  );
}

/**
 * A header cell. `numeric` right-aligns to match the body cells beneath it —
 * a right-aligned column of numbers under a left-aligned label reads as two
 * different columns.
 */
export function DataHeadCell({
  children,
  numeric = false,
  sticky = false,
  className,
  scope = "col",
  ...rest
}: {
  children?: ReactNode;
  numeric?: boolean;
  /** Freeze this cell horizontally — the row's identity column. */
  sticky?: boolean;
  className?: string;
  scope?: "col" | "row";
} & Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "scope" | "className" | "children">) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-2 py-2 font-medium uppercase tracking-wide",
        numeric && "text-right",
        // z-30 beats the header row's own z-20 so the corner cell stays on top
        // of both the column it freezes and the header it sits in.
        sticky && "sticky left-0 z-30 bg-card px-3",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

/**
 * A body cell. `numeric` pairs right-alignment with `tabular-nums`, which the
 * app already uses consistently (~135 sites) but had never tied to alignment,
 * so decimals in one column could still fail to line up.
 */
export function DataCell({
  children,
  numeric = false,
  sticky = false,
  className,
  ...rest
}: {
  children?: ReactNode;
  numeric?: boolean;
  sticky?: boolean;
  className?: string;
} & Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "className" | "children">) {
  return (
    <td
      className={cn(
        "px-2 py-1.5",
        numeric && "text-right tabular-nums",
        sticky && "sticky left-0 z-10 bg-card px-3",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/** Body row, with the shared hover and divider treatment. */
export function DataRow({
  children,
  selected = false,
  className,
  ...rest
}: {
  children: ReactNode;
  /**
   * A checked row needs to stay obvious while the rest of the table scrolls
   * past it — a tinted fill plus a left edge, not a checkbox alone (DSI-126).
   */
  selected?: boolean;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLTableRowElement>, "className" | "children">) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cn(
        "border-b border-border/60 last:border-0",
        selected && "bg-primary/[0.06] [&>td:first-child]:shadow-[inset_2px_0_0_0_var(--primary)]",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}
