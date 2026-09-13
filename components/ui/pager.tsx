import { cn } from "@/lib/utils";

/**
 * Prev / position / Next for a paged table.
 *
 * Lifted out of `/builder`'s player picker, which was the only paginated
 * surface in the app — and the reason `/players` needed this: the Player
 * Explorer capped at `rows.slice(0, 100)` with no pager at all, so 557 of the
 * 657 players were unreachable there while the Builder picker could scroll to
 * every one of them. A cap is a reasonable default; a cap with no way past it
 * is a missing feature wearing a default's clothes.
 *
 * Page numbers are zero-based in state and one-based on screen, which is the
 * convention `/builder` already used — kept rather than "fixed", so moving a
 * call site does not silently shift by one.
 *
 * The invisible `before` halo is the same hit-target trick `TapToReveal` and
 * the range slider use: these controls are `text-xs`, well under a comfortable
 * touch target, and enlarging them visually would make a pager louder than the
 * table it pages.
 */
export function Pager({
  page,
  pageCount,
  onPageChange,
  total,
  noun = "item",
  className,
}: {
  /** Zero-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Total rows across all pages, for the "· 657 players" tail. */
  total?: number;
  /** Singular noun; pluralised with a bare "s". */
  noun?: string;
  className?: string;
}) {
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;
  const control =
    "relative before:absolute before:-inset-2.5 before:content-[''] rounded border border-input px-2 py-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35";

  return (
    <div
      className={cn(
        "mt-2 flex items-center justify-between border-t border-border pt-2 text-xs",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={atStart}
        className={control}
      >
        &lsaquo; Prev
      </button>
      <span className="text-muted-foreground">
        Page {page + 1} of {pageCount}
        {total !== undefined && (
          <>
            {" · "}
            {total} {noun}
            {total === 1 ? "" : "s"}
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
        disabled={atEnd}
        className={control}
      >
        Next &rsaquo;
      </button>
    </div>
  );
}
