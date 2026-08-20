"use client";

// Chip strategy — the shared editor mounted on /transfers and /deadline (the
// pages that already run the optimiser). /chips stays the read-only
// valuation page; a later "Pin to plan" button there writes through the same
// `setChipPlanEntry`/`clearChipPlanEntry` helpers this component uses.

import {
  CHIP_LABELS,
  clearChipPlanEntry,
  resolveStopEvent,
  setChipPlanEntry,
  validateChipPlan,
  type ChipDefinitionRow,
} from "@/lib/chip-plan";
import { EMPTY_CHIP_PLAN, type ChipKind, type ChipPlan } from "@/lib/team-state";
import { CollapsibleCard } from "@/components/ui/collapsible-card";

const CHIP_ORDER: ChipKind[] = ["wildcard", "freehit", "bboost", "3xc"];

export interface ChipPlanEditorProps {
  plan: ChipPlan | undefined;
  chipDefinitions: ChipDefinitionRow[];
  nextEvent: number;
  lastEvent: number;
  activeChip: string | null;
  /** Called with the next plan; the page decides how to persist it (saveDraft). */
  onChange: (next: ChipPlan) => void;
  className?: string;
}

/** Replaces whatever this chip has pinned inside `[def.startEvent, stop]`, so picking a new gameweek for a half moves the pin rather than adding a second one. */
function pinInHalf(
  plan: ChipPlan | undefined,
  chip: ChipKind,
  def: ChipDefinitionRow,
  lastEvent: number,
  event: number | null,
): ChipPlan {
  const stop = resolveStopEvent(def, lastEvent);
  const cleared = plan ?? EMPTY_CHIP_PLAN;
  const withoutHalf: ChipPlan = {
    version: 1,
    entries: cleared.entries.filter(
      (e) => !(e.chip === chip && e.event >= def.startEvent && e.event <= stop),
    ),
  };
  return event === null ? withoutHalf : setChipPlanEntry(withoutHalf, chip, event);
}

export function ChipPlanEditor({
  plan,
  chipDefinitions,
  nextEvent,
  lastEvent,
  activeChip,
  onChange,
  className = "mt-4",
}: ChipPlanEditorProps) {
  const validation = validateChipPlan(plan, chipDefinitions, nextEvent, lastEvent, activeChip);
  const entries = (plan ?? EMPTY_CHIP_PLAN).entries;
  const problemsFor = (chip: ChipKind, event: number) =>
    validation.problems.filter((p) => p.chip === chip && p.event === event);

  const defsByChip = new Map<ChipKind, ChipDefinitionRow[]>();
  for (const def of chipDefinitions) {
    if (!CHIP_ORDER.includes(def.name as ChipKind)) continue;
    const chip = def.name as ChipKind;
    const list = defsByChip.get(chip) ?? [];
    list.push(def);
    defsByChip.set(chip, list);
  }
  for (const list of defsByChip.values()) list.sort((a, b) => a.startEvent - b.startEvent);

  const hasAnyWindow = CHIP_ORDER.some((c) => (defsByChip.get(c) ?? []).length > 0);
  if (!hasAnyWindow) return null;

  const appliedCount = validation.usable.length;
  const totalCount = entries.length;

  // Collapsed summary: the planned window for each chip, in CHIP_ORDER — the
  // essential detail (docs/wiki/design-system.md's tier rule: a supporting
  // card shows context, but this is the primary decision itself, so it needs
  // to survive the collapse).
  const summary = CHIP_ORDER.map((chip) => {
    const chipEntries = entries.filter((e) => e.chip === chip).sort((a, b) => a.event - b.event);
    const windows = chipEntries.map((e) => `GW${e.event}`).join(", ");
    return `${CHIP_LABELS[chip]} ${windows || "not planned"}`;
  }).join(" · ");

  return (
    <CollapsibleCard title="Chip plan" summary={summary} tier="primary" className={className}>
      <p className="text-xs text-zinc-500">
        {totalCount === 0
          ? "No chips planned. The optimiser is treating every gameweek the same."
          : `${appliedCount} of ${totalCount} planned chip${totalCount === 1 ? "" : "s"} applied${
              appliedCount < totalCount ? " — see problems below" : ""
            }.`}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CHIP_ORDER.map((chip) => {
          const defs = defsByChip.get(chip) ?? [];
          if (defs.length === 0) return null;
          return (
            <div key={chip} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {CHIP_LABELS[chip]}
              </span>
              <div className="flex flex-wrap gap-2">
                {defs.map((def, i) => {
                  const stop = resolveStopEvent(def, lastEvent);
                  const current = entries.find(
                    (e) => e.chip === chip && e.event >= def.startEvent && e.event <= stop,
                  );
                  const selectableFrom = Math.max(def.startEvent, nextEvent);
                  const options: number[] = [];
                  for (let e = selectableFrom; e <= stop; e++) options.push(e);
                  const rowProblems = current ? problemsFor(chip, current.event) : [];

                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <label className="flex min-h-9 items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        GW{def.startEvent}-{stop}
                        <select
                          value={current?.event ?? ""}
                          onChange={(ev) => {
                            const v = ev.target.value;
                            onChange(pinInHalf(plan, chip, def, lastEvent, v === "" ? null : Number(v)));
                          }}
                          className="min-h-9 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-purple-800/50 dark:bg-[#2A0A45] dark:text-zinc-100"
                        >
                          <option value="">Not planned</option>
                          {options.map((e) => (
                            <option key={e} value={e}>
                              GW{e}
                            </option>
                          ))}
                        </select>
                        {current && (
                          <button
                            type="button"
                            onClick={() => onChange(clearChipPlanEntry(plan, current.event))}
                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            title="Clear this pin"
                          >
                            ✕
                          </button>
                        )}
                      </label>
                      {rowProblems.map((p, pi) => (
                        <p
                          key={pi}
                          className="max-w-xs rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                        >
                          {p.message}
                        </p>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}
