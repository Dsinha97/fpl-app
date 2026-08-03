// The FPL API never states which season it is serving, so we derive it from
// the earliest gameweek deadline. A Premier League season starting in August
// 2026 is "2026-27".

export function deriveSeason(events: { deadline_time: string }[]): string {
  if (events.length === 0) throw new Error("cannot derive season from zero events");

  const earliest = events
    .map((e) => new Date(e.deadline_time))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  if (!earliest) throw new Error("cannot derive season: no valid deadlines");

  // Deadlines from July onwards belong to the season starting that year;
  // anything earlier is the run-in of the season that started the year before.
  const year = earliest.getUTCFullYear();
  const startYear = earliest.getUTCMonth() >= 6 ? year : year - 1;

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
