// Brand lockup derived from public/logo.svg and public/app-name.svg.
// Palette: purple-950 #3B0764 (badge), #00FF87 (FPL green), red-500 accent dot.
// app-name.svg holds two <svg> roots (light + dark variants), which an <img>
// cannot switch between, so the lockup is inlined here with Tailwind dark:
// classes instead.

export function Monogram({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        width="32"
        height="32"
        rx="8"
        className="fill-purple-950 dark:fill-[#1E0234]"
      />
      <g strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <line x1="16" y1="8" x2="16" y2="24" stroke="#FFFFFF" />
        <path d="M16 8H9 M16 15H10" stroke="#00FF87" />
        <path d="M16 8H20C23 8 25 10.5 25 16C25 21.5 23 24 20 24H16" stroke="#00FF87" />
      </g>
      <circle cx="10" cy="23" r="1.5" fill="#EF4444" />
    </svg>
  );
}

export function Wordmark({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <span className="flex flex-col leading-none">
      <span className="text-base font-extrabold tracking-tight text-purple-950 dark:text-white">
        FPL <span className="text-purple-700 dark:text-[#00FF87]">DECISION</span>
      </span>
      {subtitle && (
        <span className="mt-0.5 text-[9px] font-semibold tracking-[0.15em] text-purple-800 dark:text-purple-400">
          ANALYTICS HUB
        </span>
      )}
    </span>
  );
}
