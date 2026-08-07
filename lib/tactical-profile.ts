// Sprint 12.5 — PL Team (Club) Manager Intelligence, buildable slice.
//
// Ships the owner's tactical-profile data as disclosed, non-multiplicative
// context, following the pattern CLAUDE.md already uses for exactly this
// tension ("when a term cannot be dropped, make it an input" /
// `decisionMargin` in transfer-optimizer.ts): the modifiers here are
// transcribed tactical opinion from video and article titles, not measured
// data, and the underlying player-role tags (`inverted_pivot`,
// `wide_crosser`, ...) key on a taxonomy no data source in this app supplies.
// So there is no `calculateSystemFitMultiplier`, no `μ_fit`, and nothing here
// is ever multiplied into an xP figure — see docs/roadmap.md, "Sprint 12.5",
// for the full reasoning, and TACTICAL_PROFILE_NOTE below for the version
// shown in the UI.
//
// Deliberately thin: types plus a loader, nothing that scores a player. If a
// later change validates the modifiers against real 2026/27 results and
// wants to fold them into xP, that is a new, reviewed change — not a
// consequence of this file existing.

export interface TacticalTrait {
  role: string | null;
  /** Free text, e.g. "+10% npxG for wingers isolating 1v1 in wide/half-spaces". Never parsed as a number. */
  xpImpact: string | null;
  profileRequired: string | null;
  rotationRiskFactors: string | null;
}

export interface TacticalModifiers {
  lowBlockFdrModifier: number | null;
  highPressFdrModifier: number | null;
  setPieceBias: number | null;
}

export interface TacticalProfile {
  managerKey: string;
  name: string;
  currentClub: string;
  preferredFormation: string | null;
  buildupStyle: string | null;
  pressingIntensity: string | null;
  sourceFile: string | null;
  /** Keyed by position group as given in the source — "wingers", "fullbacks", "pivots", "strikers". */
  tacticalTraits: Record<string, TacticalTrait>;
  modifiers: TacticalModifiers;
}

export const TACTICAL_PROFILE_NOTE =
  "These profiles are transcribed tactical judgment from published breakdowns and video analysis — " +
  "the source is credited per club — not measured data, and they are never folded into xP. Displayed " +
  "as context for the manager's tactical identity, not as a score. The modifiers shown alongside a " +
  "profile (fixture-difficulty bias, set-piece bias) are the source's own figures, kept for reference " +
  "only. See docs/roadmap.md, \"Sprint 12.5\", for why: the modifiers are opinion, not evidence, and " +
  "the traits key on player roles (e.g. \"inverted pivot\", \"box-presence target\") that no data " +
  "source here can match to a specific player.";

const TRAIT_GROUPS = ["wingers", "fullbacks", "pivots", "strikers"] as const;

interface TacticalTraitRow {
  role?: string | null;
  xp_impact?: string | null;
  profile_required?: string | null;
  rotation_risk_factors?: string | null;
}

/** Row shape as `pl_managers` returns it — snake_case jsonb, one raw object per column. */
export interface PlManagerRow {
  manager_key: string;
  name: string;
  current_club: string;
  preferred_formation: string | null;
  buildup_style: string | null;
  pressing_intensity: string | null;
  source_file: string | null;
  tactical_traits: Record<string, TacticalTraitRow>;
  modifiers: {
    low_block_fdr_modifier?: number | null;
    high_press_fdr_modifier?: number | null;
    set_piece_bias?: number | null;
  };
}

export function toTacticalProfile(row: PlManagerRow): TacticalProfile {
  const traits: Record<string, TacticalTrait> = {};
  for (const group of TRAIT_GROUPS) {
    const raw = row.tactical_traits?.[group];
    if (!raw) continue;
    traits[group] = {
      role: raw.role ?? null,
      xpImpact: raw.xp_impact ?? null,
      profileRequired: raw.profile_required ?? null,
      rotationRiskFactors: raw.rotation_risk_factors ?? null,
    };
  }

  return {
    managerKey: row.manager_key,
    name: row.name,
    currentClub: row.current_club,
    preferredFormation: row.preferred_formation,
    buildupStyle: row.buildup_style,
    pressingIntensity: row.pressing_intensity,
    sourceFile: row.source_file,
    tacticalTraits: traits,
    modifiers: {
      lowBlockFdrModifier: row.modifiers?.low_block_fdr_modifier ?? null,
      highPressFdrModifier: row.modifiers?.high_press_fdr_modifier ?? null,
      setPieceBias: row.modifiers?.set_piece_bias ?? null,
    },
  };
}

/** Human-readable label for a buildup style code, e.g. "high_regain_pressing" -> "High regain pressing". */
export function buildupStyleLabel(style: string | null): string | null {
  if (!style) return null;
  return style
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** One-line summary for compact surfaces (e.g. the player detail panel's System line). */
export function tacticalSummary(profile: TacticalProfile): string {
  const parts = [profile.preferredFormation, buildupStyleLabel(profile.buildupStyle)];
  if (profile.pressingIntensity) {
    parts.push(`${profile.pressingIntensity} press`);
  }
  return parts.filter((p): p is string => !!p).join(" · ");
}
