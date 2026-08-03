// Captain and vice-captain badges for the projection and lineup panels.
//
// The pitch cards keep their own compact corner badges — these are 32x32 with
// two concentric rings, which would swamp a 64px kit graphic.

interface BadgeProps {
  className?: string;
}

/** Deep purple with a neon-green ring. */
export function CaptainBadge({ className = "w-6 h-6" }: BadgeProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" role="img" aria-label="Captain">
      <title>Captain</title>
      <circle cx="16" cy="16" r="15" fill="#130624" stroke="#00FF87" strokeWidth="2" />
      <circle
        cx="16"
        cy="16"
        r="12"
        fill="#2D124D"
        stroke="#00FF87"
        strokeWidth="1"
        strokeDasharray="3 1"
      />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="900"
        fontSize="18"
        fill="#00FF87"
        style={{ filter: "drop-shadow(0px 1px 2px rgba(0,0,0,0.8))" }}
      >
        C
      </text>
    </svg>
  );
}

/** Deep purple with a silver accent, to read as secondary to the captain. */
export function ViceCaptainBadge({ className = "w-6 h-6" }: BadgeProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" role="img" aria-label="Vice-captain">
      <title>Vice-captain</title>
      <circle cx="16" cy="16" r="15" fill="#130624" stroke="#A855F7" strokeWidth="2" />
      <circle cx="16" cy="16" r="12" fill="#2D124D" stroke="#E2E8F0" strokeWidth="1" />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="900"
        fontSize="13"
        letterSpacing="-0.5"
        fill="#FFFFFF"
        style={{ filter: "drop-shadow(0px 1px 2px rgba(0,0,0,0.8))" }}
      >
        VC
      </text>
    </svg>
  );
}
