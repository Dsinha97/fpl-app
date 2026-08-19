/**
 * The app had zero animate-* classes anywhere before this — nine pages
 * shared one static grey "Loading …" paragraph, and the two real engine
 * searches (/transfers, /chips) had no visual indicator at all while they
 * ran (Sprint 19, Stage 3). This is the one spinning indicator, sized to sit
 * inline with a label ("Optimising…") or standalone.
 *
 * prefers-reduced-motion turns the spin into a static ring rather than
 * hiding it — the busy state itself is still real information.
 */
export function Spinner({ className = "", label }: { className?: string; label?: string }) {
  return (
    <svg
      className={`inline-block h-4 w-4 animate-spin text-current motion-reduce:animate-none ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={label ? undefined : true}
      role={label ? "status" : undefined}
      aria-label={label}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
