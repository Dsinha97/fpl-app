"use client";

import { useState } from "react";

// ------------------------------------------------------------ country flag
//
// FPL's region codes are mostly ISO 3166-1 alpha-2, but the UK home nations
// are not: it reports "EN", "S1", "WA", "NI". flagcdn serves those as
// `gb-eng` and friends and 404s on `en`, so they need translating.

const FPL_REGION_TO_FLAG: Record<string, string> = {
  EN: "gb-eng",
  S1: "gb-sct",
  WA: "gb-wls",
  NI: "gb-nir",
};

export function flagCode(regionIso: string | null | undefined): string | null {
  if (!regionIso) return null;
  const upper = regionIso.toUpperCase();
  if (FPL_REGION_TO_FLAG[upper]) return FPL_REGION_TO_FLAG[upper];
  // Anything that is not a two-letter code is not something flagcdn serves.
  return /^[A-Z]{2}$/.test(upper) ? upper.toLowerCase() : null;
}

export function CountryFlag({
  regionIso,
  countryName,
  className = "w-6 h-4",
}: {
  regionIso: string | null | undefined;
  countryName?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const code = flagCode(regionIso);

  if (!code || failed) return null;

  return (
    // Flags come straight from flagcdn at a fixed size; next/image would add a
    // remote-pattern config for no benefit on a 40px asset.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      srcSet={`https://flagcdn.com/w80/${code}.png 2x`}
      alt={countryName ?? code.toUpperCase()}
      onError={() => setFailed(true)}
      className={`rounded-[2px] object-cover shadow-sm ${className}`}
    />
  );
}

// ------------------------------------------------------------- team crest
//
// The official Premier League badge, falling back to a drawn crest when the
// image is unavailable (a newly promoted club, or an offline viewer).

export function TeamCrest({
  teamCode,
  shortName,
  className = "w-6 h-7",
}: {
  teamCode: number | null | undefined;
  shortName: string | null | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = (shortName ?? "").toUpperCase().slice(0, 3);

  if (teamCode && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://resources.premierleague.com/premierleague/badges/70/t${teamCode}.png`}
        alt={shortName ?? "Club crest"}
        onError={() => setFailed(true)}
        className={`object-contain ${className}`}
      />
    );
  }

  return <CrestFallback label={label} className={className} />;
}

function CrestFallback({ label, className }: { label: string; className: string }) {
  return (
    <svg viewBox="0 0 32 38" className={className} fill="none" aria-hidden="true">
      <path
        d="M16 2L30 6V20C30 29 20 35 16 37C12 35 2 29 2 20V6L16 2Z"
        fill="#3B0764"
        stroke="#00FF87"
        strokeWidth="2"
      />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="900"
        fontSize="9"
        fill="#00FF87"
      >
        {label}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------- seasons badge
//
// Tiered by experience: bronze, green, silver, then a gold diamond for a
// decade or more.

export function SeasonsBadge({
  seasons,
  className = "w-6 h-6",
}: {
  seasons: number;
  className?: string;
}) {
  const title = `${seasons} season${seasons === 1 ? "" : "s"} in FPL`;

  if (seasons <= 2) {
    return (
      <svg viewBox="0 0 32 32" className={className} fill="none" role="img" aria-label={title}>
        <title>{title}</title>
        <circle cx="16" cy="16" r="14" fill="#78350F" stroke="#B45309" strokeWidth="2" />
        <SeasonsNumber x={16} y={21} value={seasons} fill="#FEF3C7" />
      </svg>
    );
  }

  if (seasons <= 5) {
    return (
      <svg viewBox="0 0 32 32" className={className} fill="none" role="img" aria-label={title}>
        <title>{title}</title>
        <rect x="3" y="3" width="26" height="26" rx="6" fill="#059669" stroke="#10B981" strokeWidth="2" />
        <SeasonsNumber x={16} y={21} value={seasons} fill="#FFFFFF" />
      </svg>
    );
  }

  if (seasons <= 9) {
    return (
      <svg viewBox="0 0 32 36" className={className} fill="none" role="img" aria-label={title}>
        <title>{title}</title>
        <path
          d="M16 2L29 6V18C29 26 19 32 16 34C13 32 3 26 3 18V6L16 2Z"
          fill="#94A3B8"
          stroke="#E2E8F0"
          strokeWidth="2"
        />
        <SeasonsNumber x={16} y={21} value={seasons} fill="#0F172A" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 36 36" className={className} fill="none" role="img" aria-label={title}>
      <title>{title}</title>
      <polygon points="18,2 34,18 18,34 2,18" fill="#D97706" stroke="#FBBF24" strokeWidth="2.5" />
      <SeasonsNumber x={18} y={22} value={seasons} fill="#FFFBEB" />
    </svg>
  );
}

function SeasonsNumber({
  x,
  y,
  value,
  fill,
}: {
  x: number;
  y: number;
  value: number;
  fill: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontFamily="system-ui, sans-serif"
      fontWeight="900"
      // Three digits would overflow the badge; nobody has played 100 seasons,
      // but the guard costs nothing.
      fontSize={value >= 10 ? 12 : 13}
      fill={fill}
    >
      {value}
    </text>
  );
}
