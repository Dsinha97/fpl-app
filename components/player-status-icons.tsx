import React from "react";

import { TapToReveal } from "@/components/info-tooltip";

// Player availability and set-piece role icons.
//
// Every icon is paired with a `title` at the call site, so status is never
// conveyed by shape or colour alone.

interface IconProps {
  className?: string;
}

interface DoubtfulIconProps extends IconProps {
  chance?: number;
}

// 1a. Injured / unknown status — red octagon with an exclamation mark.
export const InjuredIcon: React.FC<IconProps> = ({ className = "w-6 h-6" }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon
      points="10,2 22,2 30,10 30,22 22,30 10,30 2,22 2,10"
      className="fill-red-950/90 stroke-red-500 dark:fill-red-950/95"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path d="M16 8V18" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" />
    <circle cx="16" cy="23" r="1.75" fill="#EF4444" />
  </svg>
);

// 1b. Suspended — red octagon with a red card.
export const SuspendedIcon: React.FC<IconProps> = ({ className = "w-6 h-6" }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon
      points="10,2 22,2 30,10 30,22 22,30 10,30 2,22 2,10"
      className="fill-red-950/90 stroke-red-500 dark:fill-red-950/95"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <rect x="10.5" y="8" width="11" height="16" rx="1.5" fill="#EF4444" stroke="#7F1D1D" strokeWidth="1" />
  </svg>
);

// 2. Doubtful — amber warning triangle carrying the chance-of-playing figure.
export const DoubtfulIcon: React.FC<DoubtfulIconProps> = ({ chance = 75, className = "w-6 h-6" }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M16 3L29.5 26.5C30.2 27.7 29.3 29 27.9 29H4.1C2.7 29 1.8 27.7 2.5 26.5L16 3Z"
      className="fill-amber-400 stroke-amber-600 dark:fill-amber-500 dark:stroke-amber-400"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <text
      x="16"
      y="22"
      textAnchor="middle"
      fontFamily="system-ui, sans-serif"
      fontWeight="900"
      fontSize="10"
      fill="#0F172A"
    >
      {chance}%
    </text>
  </svg>
);

/** Football with a pentagon pattern — shared body for the set-piece icons. */
const FootballBase = () => (
  <>
    <circle cx="16" cy="16" r="14" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
    <polygon points="16,4 19,7 17,10 15,10 13,7" fill="#1E293B" />
    <polygon points="4,16 7,13 10,15 10,17 7,19" fill="#1E293B" />
    <polygon points="28,16 25,13 22,15 22,17 25,19" fill="#1E293B" />
    <polygon points="11,27 13,24 16,25 16,28 13,28" fill="#1E293B" />
    <polygon points="21,27 19,24 16,25 16,28 19,28" fill="#1E293B" />
  </>
);

// 3. Penalty taker — football with a purple "P".
export const PenaltyTakerIcon: React.FC<IconProps> = ({ className = "w-6 h-6" }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <FootballBase />
    <text
      x="16"
      y="22"
      textAnchor="middle"
      fontFamily="system-ui, sans-serif"
      fontWeight="900"
      fontSize="17"
      fill="#3B0764"
      stroke="#7E22CE"
      strokeWidth="0.5"
    >
      P
    </text>
  </svg>
);

// 4. Free-kick taker — football with a green "F".
export const FreeKickTakerIcon: React.FC<IconProps> = ({ className = "w-6 h-6" }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <FootballBase />
    <text
      x="16"
      y="22"
      textAnchor="middle"
      fontFamily="system-ui, sans-serif"
      fontWeight="900"
      fontSize="17"
      fill="#059669"
      stroke="#10B981"
      strokeWidth="0.5"
    >
      F
    </text>
  </svg>
);

// 5. Corner taker — corner flag on the pitch arc.
export const CornerTakerIcon: React.FC<IconProps> = ({ className = "w-6 h-6" }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 28C14 28 28 14 28 4" stroke="#00FF87" strokeWidth="2" strokeDasharray="3 3" />
    <line x1="8" y1="28" x2="8" y2="6" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="8" cy="28" r="2.5" fill="#64748B" />
    <path d="M8 6L23 11L8 16V6Z" className="fill-red-600 stroke-red-700" strokeWidth="1" strokeLinejoin="round" />
    <path d="M13 7.7L18.5 14.5" stroke="#FBBF24" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

// 6. Rotation risk — bi-directional arrows.
//
// Not wired up yet: rotation risk needs a Risk Engine that does not exist,
// and inventing a threshold from minutes alone would be a guess dressed as a
// signal. Ships here so the badge is ready when that data lands.
export const RotationIcon: React.FC<IconProps> = ({ className = "w-6 h-6" }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="14" className="fill-purple-950/80 stroke-purple-700" strokeWidth="1.5" />
    <path
      d="M10 13A8 8 0 0 1 23 11M23 11V6M23 11H18"
      stroke="#00FF87"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M22 19A8 8 0 0 1 9 21M9 21V26M9 21H14"
      stroke="#EF4444"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ------------------------------------------------------------- badges

interface StatusBadgeProps {
  status?: string | null;
  chanceOfPlaying?: number | null;
  isPenaltyTaker?: boolean;
  isFreeKickTaker?: boolean;
  isCornerTaker?: boolean;
  isRotationRisk?: boolean;
  size?: string;
}

const STATUS_TEXT: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};

/**
 * A single availability/role glyph, following the caller-supplied priority:
 * suspension and injury outrank doubt, which outranks set-piece duty.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  chanceOfPlaying,
  isPenaltyTaker,
  isFreeKickTaker,
  isCornerTaker,
  isRotationRisk,
  size = "w-6 h-6",
}) => {
  if (status === "s") return <SuspendedIcon className={size} />;
  if (status === "i" || status === "u" || status === "n" || chanceOfPlaying === 0) {
    return <InjuredIcon className={size} />;
  }

  if (
    status === "d" ||
    (chanceOfPlaying !== undefined && chanceOfPlaying !== null && chanceOfPlaying < 100)
  ) {
    return <DoubtfulIcon chance={chanceOfPlaying ?? 75} className={size} />;
  }

  if (isPenaltyTaker) return <PenaltyTakerIcon className={size} />;
  if (isFreeKickTaker) return <FreeKickTakerIcon className={size} />;
  if (isCornerTaker) return <CornerTakerIcon className={size} />;
  if (isRotationRisk) return <RotationIcon className={size} />;

  return null;
};

interface AvailabilityProps {
  status?: string | null;
  chanceOfPlaying?: number | null;
  news?: string | null;
  size?: string;
}

/**
 * Availability only, wrapped in a titled span. Returns null for fully fit
 * players so healthy rows stay uncluttered.
 */
export function AvailabilityBadge({
  status,
  chanceOfPlaying,
  news,
  size = "w-4 h-4",
}: AvailabilityProps) {
  const flagged =
    (status && status !== "a") ||
    (chanceOfPlaying !== null && chanceOfPlaying !== undefined && chanceOfPlaying < 100);
  if (!flagged) return null;

  const label = STATUS_TEXT[status ?? "a"] ?? status ?? "Unavailable";
  const chanceText =
    chanceOfPlaying !== null && chanceOfPlaying !== undefined
      ? ` · ${chanceOfPlaying}% chance of playing`
      : "";

  const description = `${label}${chanceText}${news ? ` — ${news}` : ""}`;

  return (
    // `role="img"` + `aria-label` rather than `title` alone.
    //
    // Sprint B's scope named the app's 88 native `title=` attributes for
    // conversion to TapToReveal, on the grounds that a hover tooltip is
    // unreachable on touch. For THIS badge that cure is worse than the
    // disease: it renders on every row of /players, every pitch card and
    // every /transfers row, so converting it would add several hundred
    // focusable buttons to a single page and make keyboard traversal far
    // worse than the hover gap it fixed.
    //
    // The real defect here was different and worse: this file had no
    // `aria-label`, no `role` and no `aria-hidden` anywhere, and `title` on a
    // `<span>` is not reliably announced — so an injury flag was invisible to
    // a screen reader entirely, on any device. That is the part that had to
    // be fixed, and it costs one attribute rather than a new interaction
    // model. `title` stays for desktop hover.
    <span
      role="img"
      aria-label={description}
      title={description}
      className="inline-flex shrink-0 align-middle"
    >
      <StatusBadge status={status} chanceOfPlaying={chanceOfPlaying} size={size} />
    </span>
  );
}

interface RoleProps {
  penaltyOrder?: number | null;
  freeKickOrder?: number | null;
  cornerOrder?: number | null;
  size?: string;
  /**
   * Whether the `+N` chip may be a button.
   *
   * Off by default, and that default is load-bearing rather than cautious:
   * `/builder`'s picker makes the whole row a `<button>`, so a nested button
   * here is invalid HTML and a React hydration error — found by opening the
   * page, not by review. Callers that render into a plain cell opt in.
   */
  revealable?: boolean;
}

const CHIP_CLASS =
  "rounded-full bg-muted px-1 text-[10px] font-medium leading-4 tabular-nums text-muted-foreground";

/**
 * First-choice set-piece duties. Only order 1 counts as "the taker".
 *
 * DSI-141: a triple-duty player (B.Fernandes takes penalties, free kicks and
 * corners) spent three icons inside the frozen first column of `/players`,
 * which on a phone is most of the viewport. Only the highest-ranked duty is
 * drawn, followed by a `+N` chip carrying the rest — the same priority
 * `StatusBadge` above already encodes: penalty, then free kick, then corner.
 *
 * The chip is a `TapToReveal` rather than a `title`, because it is the only
 * place the other duties exist and a hover tooltip is unreachable on the very
 * device this was fixed for. The single icon keeps its `title`: it is one of
 * hundreds on the page, and the note at `AvailabilityBadge` records why
 * converting those would be worse than the gap it closes.
 */
export function RoleBadges({
  penaltyOrder,
  freeKickOrder,
  cornerOrder,
  size = "w-4 h-4",
  revealable = false,
}: RoleProps) {
  const duties: { key: string; label: string; Icon: React.FC<IconProps> }[] = [];
  if (penaltyOrder === 1) {
    duties.push({ key: "pen", label: "First-choice penalty taker", Icon: PenaltyTakerIcon });
  }
  if (freeKickOrder === 1) {
    duties.push({ key: "fk", label: "First-choice direct free-kick taker", Icon: FreeKickTakerIcon });
  }
  if (cornerOrder === 1) {
    duties.push({ key: "corner", label: "First-choice corner taker", Icon: CornerTakerIcon });
  }
  if (duties.length === 0) return null;

  const [top, ...rest] = duties;

  return (
    <>
      <span role="img" aria-label={top.label} title={top.label} className="inline-flex shrink-0 align-middle">
        <top.Icon className={size} />
      </span>
      {rest.length > 0 &&
        (revealable ? (
          <TapToReveal
            label={`${rest.length} more set-piece ${rest.length === 1 ? "duty" : "duties"}`}
            trigger={`+${rest.length}`}
            triggerClassName={CHIP_CLASS}
          >
            <ul className="space-y-1">
              {rest.map((d) => (
                <li key={d.key} className="flex items-center gap-1.5">
                  <d.Icon className="w-4 h-4" />
                  {d.label}
                </li>
              ))}
            </ul>
          </TapToReveal>
        ) : (
          <span
            role="img"
            aria-label={rest.map((d) => d.label).join(", ")}
            title={rest.map((d) => d.label).join(", ")}
            className={`inline-flex shrink-0 align-middle ${CHIP_CLASS}`}
          >
            +{rest.length}
          </span>
        ))}
    </>
  );
}
