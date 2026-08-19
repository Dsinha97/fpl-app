/**
 * A placeholder block for content that's still loading — replaces the
 * app-wide convention of a static grey "Loading …" sentence (nine pages
 * shared one string, verbatim, before Sprint 19 Stage 3). Sized and shaped
 * by the caller via className; this only supplies the shimmer.
 *
 * prefers-reduced-motion drops the pulse to a flat tint rather than removing
 * it — a motion-sensitive user still needs to see that something is loading.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted motion-reduce:animate-none ${className}`}
    />
  );
}
