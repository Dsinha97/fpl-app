"use client";

/**
 * A drawing of the DevTools Network panel, with the four steps of the my-team
 * copy marked on it.
 *
 * The instructions on /settings are correct and have always been correct, and
 * people still get lost in them — because "filter the request list for
 * my-team, then open its Response tab" is a description of a place, given to
 * someone who has never been there. A numbered list cannot show you where a
 * panel is; a picture of the panel can.
 *
 * Drawn rather than screenshotted: a screenshot of Chrome DevTools would be
 * someone else's UI frozen at one version, wrong the moment it changes, and it
 * cannot follow the app's own light/dark theme. This is schematic on purpose —
 * it needs to be recognisable, not accurate. Every colour is a token, so it
 * themes with everything else.
 *
 * The numbers match the `<ol>` beside it, which stays the authoritative text:
 * this is the map, not the directions. Accessible name describes the whole
 * figure, and the list carries the actual content for anyone who cannot see it.
 */
export function DevToolsWalkthrough({ urlHint }: { urlHint: string }) {
  return (
    <figure className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card">
      <svg
        viewBox="0 0 420 200"
        role="img"
        aria-label="Diagram of the DevTools Network panel: the Network tab at the top, a filter box containing my-team, the matching request in the list, and its Response tab holding the JSON to copy."
        className="w-full"
      >
        {/* panel chrome */}
        <rect x="8" y="8" width="404" height="184" rx="6" className="fill-transparent stroke-zinc-300 dark:stroke-purple-900" strokeWidth="1" />

        {/* tab strip */}
        <rect x="8" y="8" width="404" height="22" className="fill-zinc-100 dark:fill-surface-3" />
        <text x="20" y="23" className="fill-zinc-400 text-[9px]">Elements</text>
        <text x="62" y="23" className="fill-zinc-400 text-[9px]">Console</text>
        <rect x="102" y="10" width="44" height="18" rx="3" className="fill-primary/15 stroke-primary" strokeWidth="1" />
        <text x="108" y="23" className="fill-zinc-900 text-[9px] font-semibold dark:fill-zinc-100">Network</text>
        <circle cx="152" cy="19" r="7" className="fill-primary" />
        <text x="152" y="22.5" textAnchor="middle" className="fill-primary-foreground text-[8px] font-bold">2</text>

        {/* filter box */}
        <rect x="20" y="40" width="120" height="16" rx="3" className="fill-transparent stroke-zinc-300 dark:stroke-purple-900" strokeWidth="1" />
        <text x="26" y="51.5" className="fill-zinc-900 text-[9px] dark:fill-zinc-100">my-team</text>
        <circle cx="150" cy="48" r="7" className="fill-primary" />
        <text x="150" y="51.5" textAnchor="middle" className="fill-primary-foreground text-[8px] font-bold">3</text>

        {/* request list */}
        <rect x="20" y="66" width="150" height="118" rx="4" className="fill-zinc-50 dark:fill-surface-3" />
        <text x="27" y="79" className="fill-zinc-400 text-[8px]">Name</text>
        <line x1="20" y1="84" x2="170" y2="84" className="stroke-zinc-200 dark:stroke-purple-900" strokeWidth="1" />
        <rect x="20" y="88" width="150" height="16" className="fill-primary/15" />
        <text x="27" y="99" className="fill-zinc-900 text-[8px] font-semibold dark:fill-zinc-100">
          {urlHint.length > 22 ? `${urlHint.slice(0, 21)}…` : urlHint}
        </text>
        <text x="27" y="119" className="fill-zinc-400 text-[8px]">bootstrap-static/</text>
        <text x="27" y="135" className="fill-zinc-400 text-[8px]">fixtures/</text>
        <circle cx="180" cy="96" r="7" className="fill-primary" />
        <text x="180" y="99.5" textAnchor="middle" className="fill-primary-foreground text-[8px] font-bold">4</text>

        {/* response pane */}
        <rect x="196" y="66" width="196" height="118" rx="4" className="fill-zinc-50 dark:fill-surface-3" />
        <text x="204" y="79" className="fill-zinc-400 text-[8px]">Headers</text>
        <rect x="240" y="70" width="46" height="13" rx="2" className="fill-primary/15 stroke-primary" strokeWidth="1" />
        <text x="246" y="79" className="fill-zinc-900 text-[8px] font-semibold dark:fill-zinc-100">Response</text>
        <line x1="196" y1="88" x2="392" y2="88" className="stroke-zinc-200 dark:stroke-purple-900" strokeWidth="1" />
        <text x="204" y="102" className="fill-zinc-500 text-[8px] font-mono">{"{\"picks\":[{\"element\":351,"}</text>
        <text x="204" y="116" className="fill-zinc-500 text-[8px] font-mono">{"\"position\":1,\"is_captain\":"}</text>
        <text x="204" y="130" className="fill-zinc-500 text-[8px] font-mono">{"false},…],\"chips\":[…],"}</text>
        <text x="204" y="144" className="fill-zinc-500 text-[8px] font-mono">{"\"transfers\":{\"bank\":4,…}}"}</text>
        <text x="204" y="166" className="fill-zinc-400 text-[8px]">copy the whole body</text>
      </svg>
      <figcaption className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-purple-900/40 dark:text-zinc-400">
        Schematic, not a screenshot — your DevTools will look a little different. The numbers match
        the steps above.
      </figcaption>
    </figure>
  );
}
