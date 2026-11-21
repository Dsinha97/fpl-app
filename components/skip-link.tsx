"use client";

/**
 * First tab stop on every page: jumps past the header and nav to the page's
 * `<main>`. Invisible until focused. Done in a click handler rather than as a
 * `#id` anchor because each route renders its own `<main>` and none carries an id.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        const main = document.querySelector<HTMLElement>("main");
        if (!main) return;
        e.preventDefault();
        main.tabIndex = -1;
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: "start" });
      }}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:z-[60] focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Skip to main content
    </a>
  );
}
