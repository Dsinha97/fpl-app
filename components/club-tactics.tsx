"use client";

import { useState } from "react";
import { ModelNote } from "@/components/ui/model-note";
import { ExpandToggle } from "@/components/ui/expand-toggle";
import { TeamCrest } from "@/components/identity";
import { buildupStyleLabel, TACTICAL_PROFILE_NOTE, type TacticalProfile } from "@/lib/tactical-profile";

// ------------------------------------------------- Sprint 12.5 — PL clubs
//
// A 20-club reference table, not tied to any one FPL entry — moved here from
// /team (where it sat below the "connect your team" empty state, on a page
// otherwise entirely about one manager's squad) onto /fixtures, which is
// already club-scoped and already loads a `teams` row per club. See
// docs/roadmap.md, Sprint 12.5.
//
// Cards collapse by default (Sprint 12.7): 20 cards' worth of formation +
// buildup + pressing + a traits list + a modifiers line + a source credit
// forced significant horizontal scroll on mobile even after the overflow
// fix below, so only the identifying essentials (crest, club, coach,
// formation, buildup) show by default — the rest is one tap away.

export interface ClubTactics {
  teamId: number;
  teamName: string;
  teamShort: string;
  teamCode: number | null;
  profile: TacticalProfile;
}

export function ClubTacticsGrid({ clubs }: { clubs: ClubTactics[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  if (clubs.length === 0) return null;

  const toggle = (teamId: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });

  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        PL Club Tactics
        <ModelNote label="What is this?">{TACTICAL_PROFILE_NOTE}</ModelNote>
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        Each club&apos;s head coach — formation, buildup style, pressing intensity — shown as
        context, not folded into any projection.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        {clubs.map(({ teamId, teamName, teamShort, teamCode, profile }) => {
          const open = expanded.has(teamId);
          return (
            <div
              key={teamId}
              className="w-full self-start overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-purple-900/40 dark:bg-card sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)]"
            >
              <button
                type="button"
                onClick={() => toggle(teamId)}
                aria-expanded={open}
                className="group w-full p-3 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-purple-950/30"
              >
                <div className="flex items-center gap-2">
                  <TeamCrest teamCode={teamCode} shortName={teamShort} className="h-6 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {teamName}
                    </p>
                    <p className="truncate text-xs text-zinc-500">{profile.name}</p>
                  </div>
                  <ExpandToggle expanded={open} interactive={false} size="sm" />
                </div>

                <dl className="mt-2.5 space-y-1 text-xs">
                  {profile.preferredFormation && (
                    <div className="flex justify-between gap-2">
                      <dt className="shrink-0 text-zinc-500">Formation</dt>
                      <dd
                        className="min-w-0 truncate text-right text-zinc-700 dark:text-zinc-300"
                        title={profile.preferredFormation}
                      >
                        {profile.preferredFormation}
                      </dd>
                    </div>
                  )}
                  {profile.buildupStyle && (
                    <div className="flex justify-between gap-2">
                      <dt className="shrink-0 text-zinc-500">Buildup</dt>
                      <dd
                        className="min-w-0 truncate text-right text-zinc-700 dark:text-zinc-300"
                        title={buildupStyleLabel(profile.buildupStyle) ?? undefined}
                      >
                        {buildupStyleLabel(profile.buildupStyle)}
                      </dd>
                    </div>
                  )}
                </dl>
              </button>

              {/* CSS Grid 0fr→1fr rather than mount/unmount (Sprint 24) — see
                  CollapsibleCard's identical pattern for why. */}
              <div
                className={`grid transition-[grid-template-rows] duration-base ease-emphasis motion-reduce:transition-none ${
                  open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
              <div className="overflow-hidden">
                <div className="px-3 pb-3">
                  {profile.pressingIntensity && (
                    <dl className="text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="shrink-0 text-zinc-500">Pressing</dt>
                        <dd className="min-w-0 truncate text-right capitalize text-zinc-700 dark:text-zinc-300">
                          {profile.pressingIntensity}
                        </dd>
                      </div>
                    </dl>
                  )}

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
                          <li key={group} className="min-w-0 break-words">
                            <span className="font-medium capitalize text-zinc-600 dark:text-zinc-400">
                              {group}
                            </span>
                            {roleLine && <>: {roleLine.replace(/_/g, " ")}</>}
                            {/* Not italic (DSI-127). These are full sentences of
                                source prose, and several lines of italic at 11px
                                on the dark purple card is the hardest thing to
                                read on the page. Emphasis comes from the role
                                line above it being the medium weight, not from
                                slanting the explanation. */}
                            {detailLine && (
                              <span className="block break-words text-zinc-500 dark:text-zinc-500">
                                {detailLine}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {profile.analysis.length > 0 && (
                    <div className="mt-2.5 space-y-2.5 border-t border-zinc-100 pt-2 text-[11px] dark:border-purple-900/40">
                      {profile.analysis.map((section) => (
                        <section key={section.heading}>
                          <h3 className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                            {section.heading}
                          </h3>
                          <ul className="mt-1 space-y-1 text-zinc-500">
                            {section.points.map((point) => (
                              <li key={point.label} className="min-w-0 break-words">
                                <span className="font-medium text-zinc-600 dark:text-zinc-400">
                                  {point.label}:
                                </span>{" "}
                                {point.text}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )}

                  {(profile.modifiers.lowBlockFdrModifier !== null ||
                    profile.modifiers.highPressFdrModifier !== null ||
                    profile.modifiers.setPieceBias !== null) && (
                    <p className="mt-2 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400 dark:border-purple-900/40">
                      {/* "not applied to xP" sat immediately above three
                          multipliers, which reads as a contradiction rather than
                          a disclaimer (DSI-127). Lead with what they are. */}
                      Context only — the source&apos;s own figures, read by nothing in this app&apos;s
                      projection: low block ×
                      {profile.modifiers.lowBlockFdrModifier ?? "—"}, high press ×
                      {profile.modifiers.highPressFdrModifier ?? "—"}, set pieces ×
                      {profile.modifiers.setPieceBias ?? "—"}
                    </p>
                  )}

                  {profile.sourceFile && (
                    <p className="mt-1.5 truncate text-[10px] text-zinc-500" title={profile.sourceFile}>
                      Source: {profile.sourceFile}
                    </p>
                  )}
                </div>
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
