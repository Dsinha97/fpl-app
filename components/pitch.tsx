import React from "react";

/**
 * 2D pitch backdrop: green surface, mow stripes, field markings, and a purple
 * vignette to tie it to the brand. Children are laid out over the top in a
 * flex column, one row per position band.
 */
export const InteractivePitch = ({ children }: { children?: React.ReactNode }) => {
  return (
    <div className="relative mx-auto w-full max-h-[70vh] aspect-[7/10] overflow-hidden rounded-2xl border-2 border-purple-800/80 shadow-2xl transition-colors sm:aspect-[4/3] dark:border-purple-600/60">
      {/* Green pitch background */}
      <div className="absolute inset-0 bg-emerald-600 transition-colors dark:bg-[#082015]" />

      {/* Mow lines */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_10%,#ffffff_10%,#ffffff_20%)] opacity-15 dark:opacity-25" />

      {/* Field markings */}
      <svg
        className="absolute inset-0 h-full w-full stroke-purple-200/60 dark:stroke-purple-400/50"
        fill="none"
        strokeWidth="2.5"
        viewBox="0 0 700 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect x="25" y="25" width="650" height="950" rx="4" />
        <line x1="25" y1="500" x2="675" y2="500" />

        <circle cx="350" cy="500" r="90" />
        <circle cx="350" cy="500" r="4" fill="#00FF87" stroke="none" />

        <rect x="175" y="25" width="350" height="160" />
        <rect x="260" y="25" width="180" height="55" />
        <circle cx="350" cy="130" r="3.5" fill="#00FF87" stroke="none" />
        <path d="M 285 185 A 90 90 0 0 0 415 185" />

        <rect x="175" y="815" width="350" height="160" />
        <rect x="260" y="920" width="180" height="55" />
        <circle cx="350" cy="870" r="3.5" fill="#EF4444" stroke="none" />
        <path d="M 285 815 A 90 90 0 0 1 415 815" />

        <path d="M 25 45 A 20 20 0 0 0 45 25" />
        <path d="M 655 25 A 20 20 0 0 0 675 45" />
        <path d="M 25 955 A 20 20 0 0 1 45 975" />
        <path d="M 675 955 A 20 20 0 0 0 655 975" />
      </svg>

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(59,7,100,0.4)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(19,6,36,0.6)_100%)]" />

      {/* Player rows */}
      <div className="relative z-10 flex h-full w-full flex-col justify-between p-2 sm:p-4">
        {children}
      </div>
    </div>
  );
};
