import { InfoTooltip } from "@/components/info-tooltip";
import { TeamCrest } from "@/components/identity";
import { buildupStyleLabel, TACTICAL_PROFILE_NOTE, type TacticalProfile } from "@/lib/tactical-profile";

// ------------------------------------------------- Sprint 12.5 — PL clubs
//
// A 20-club reference table, not tied to any one FPL entry — moved here from
// /team (where it sat below the "connect your team" empty state, on a page
// otherwise entirely about one manager's squad) onto /fixtures, which is
// already club-scoped and already loads a `teams` row per club. See
// docs/roadmap.md, Sprint 12.5.

export interface ClubTactics {
  teamId: number;
  teamName: string;
  teamShort: string;
  teamCode: number | null;
  profile: TacticalProfile;
}

export function ClubTacticsGrid({ clubs }: { clubs: ClubTactics[] }) {
  if (clubs.length === 0) return null;

  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        PL Club Tactics
        <InfoTooltip label="What is this?">
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {TACTICAL_PROFILE_NOTE}
          </p>
        </InfoTooltip>
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        Each club&apos;s head coach — formation, buildup style, pressing intensity — shown as
        context, not folded into any projection.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map(({ teamId, teamName, teamShort, teamCode, profile }) => (
          <div
            key={teamId}
            className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-purple-900/40 dark:bg-[#1E0234]"
          >
            <div className="flex items-center gap-2">
              <TeamCrest teamCode={teamCode} shortName={teamShort} className="h-6 w-5" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {teamName}
                </p>
                <p className="truncate text-xs text-zinc-500">{profile.name}</p>
              </div>
            </div>

            <dl className="mt-2.5 space-y-1 text-xs">
              {profile.preferredFormation && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Formation</dt>
                  <dd className="text-right text-zinc-700 dark:text-zinc-300">
                    {profile.preferredFormation}
                  </dd>
                </div>
              )}
              {profile.buildupStyle && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Buildup</dt>
                  <dd className="text-right text-zinc-700 dark:text-zinc-300">
                    {buildupStyleLabel(profile.buildupStyle)}
                  </dd>
                </div>
              )}
              {profile.pressingIntensity && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Pressing</dt>
                  <dd className="text-right capitalize text-zinc-700 dark:text-zinc-300">
                    {profile.pressingIntensity}
                  </dd>
                </div>
              )}
            </dl>

            {Object.keys(profile.tacticalTraits).length > 0 && (
              <ul className="mt-2.5 space-y-1 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-purple-900/40">
                {Object.entries(profile.tacticalTraits).map(([group, trait]) => {
                  // Different position groups use different fields in the
                  // source data — wingers/fullbacks carry role + xp_impact,
                  // pivots carry profile_required + rotation_risk_factors,
                  // strikers a mix of both. Show whichever this group has
                  // rather than assuming role/xp_impact are always present.
                  const roleLine = trait.role ?? trait.profileRequired;
                  const detailLine = trait.xpImpact ?? trait.rotationRiskFactors;
                  return (
                    <li key={group}>
                      <span className="font-medium capitalize text-zinc-600 dark:text-zinc-400">
                        {group}
                      </span>
                      {roleLine && <>: {roleLine.replace(/_/g, " ")}</>}
                      {detailLine && <span className="block italic">{detailLine}</span>}
                    </li>
                  );
                })}
              </ul>
            )}

            {(profile.modifiers.lowBlockFdrModifier !== null ||
              profile.modifiers.highPressFdrModifier !== null ||
              profile.modifiers.setPieceBias !== null) && (
              <p className="mt-2 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400 dark:border-purple-900/40">
                Source figures, not applied to xP — low block ×
                {profile.modifiers.lowBlockFdrModifier ?? "—"}, high press ×
                {profile.modifiers.highPressFdrModifier ?? "—"}, set pieces ×
                {profile.modifiers.setPieceBias ?? "—"}
              </p>
            )}

            {profile.sourceFile && (
              <p className="mt-1.5 truncate text-[10px] text-zinc-400" title={profile.sourceFile}>
                Source: {profile.sourceFile}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
