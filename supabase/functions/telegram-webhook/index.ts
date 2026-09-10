// telegram-webhook — Sprint 36 (DSI-65), the inbound half of the bot.
//
// A third caller class this project has not had before: not cron, not the
// browser. Telegram calls it, and Telegram has no JWT to send. So the posture
// is stated here rather than defaulted (DSI-59 in this same sprint is about
// exactly what happens when a `verify_jwt` posture is left implicit):
//
//   AUTHENTICATION is the `setWebhook` secret token, arriving as
//   `X-Telegram-Bot-Api-Secret-Token` and compared by digest inside Postgres
//   (see _shared/telegram.ts). Wrong or absent → 401, nothing read.
//
//   AUTHORISATION is the chat-id allowlist. Anyone can message a public bot,
//   and this bot answers questions about a specific manager's squad, so an
//   unrecognised chat gets one "not linked" reply and no data at all.
//
// WHAT IT WILL NOT ANSWER. Only facts the pipeline already wrote:
// `manager_gameweek_history` for points, `team_drafts`/`manager_picks` +
// `players` for the squad, `fixtures` for the schedule, `league_entries` for
// standings. Nothing modelled — no xP, no transfer recommendation, no chip
// advice, no EO. This file is Deno and cannot import `lib/`, so any modelled
// figure here would be a second implementation of a number the app already
// owns, which this project treats as a bug with a delay on it. Those questions
// get a link to the site.

import { jsonResponse, preflight, serviceClient } from "../_shared/sync.ts";
import {
  sendTelegramMessage,
  telegramBotToken,
  verifyTelegramWebhook,
} from "../_shared/telegram.ts";
import {
  clubEmoji,
  dateTimeLabel,
  dayLabel,
  movement,
  positionEmoji,
  shortRank,
  timeLabel,
  title,
} from "../_shared/telegram-format.ts";

const SITE = "https://fpldecision.com";

/**
 * Where "mini-league" stops.
 *
 * FPL's own `league_type` does not answer this: `x` (invitational) covers both
 * a two-person league between friends and a 66,000-entry YouTube league, and
 * grouping the latter under "mini" would be wrong in the way that matters —
 * a rank of 27,762 is not a rank you read the same way as 1-of-5. So the split
 * is by size, the threshold is stated in the message itself rather than hidden
 * here, and it is a display choice with no effect on any number.
 */
const MINI_LEAGUE_MAX = 100;

// deno-lint-ignore no-explicit-any
type Db = any;

const HELP = [
  "⚽ FPL Decision bot",
  "",
  "/team — your current squad and any forced changes",
  "/points — the last scored gameweek",
  "/fixtures — the next gameweek, by day",
  "/leagues — your standings",
  "/link <code> — link this chat (or use the button on the site)",
  "",
  `Projections, transfer suggestions and chip advice live on ${SITE} — I only`,
  "report what has already happened or is already decided.",
].join("\n");

async function currentSeason(db: Db): Promise<string> {
  const { data } = await db
    .from("gameweeks")
    .select("season")
    .order("deadline_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.season ?? "";
}

/** chat id → the user who linked it. The access boundary, in one query. */
async function userForChat(db: Db, chatId: number): Promise<string | null> {
  const { data } = await db
    .from("user_notification_prefs")
    .select("user_id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  return (data?.user_id as string) ?? null;
}

async function entryForUser(db: Db, userId: string): Promise<number | null> {
  const { data } = await db
    .from("user_profiles")
    .select("entry_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.entry_id as number) ?? null;
}

/** The manager's own team name, for the header of every reply. */
async function teamNameFor(db: Db, entryId: number): Promise<string | null> {
  const { data } = await db
    .from("managers")
    .select("team_name")
    .eq("entry_id", entryId)
    .maybeSingle();
  return (data?.team_name as string) ?? null;
}

// ---------------------------------------------------------------- /link

/**
 * `/link <code>`. The one command an unlinked chat may use.
 *
 * Expired and already-used codes get distinct messages: a burnt code is a
 * different situation from a typo, and telling someone "unknown code" when
 * they in fact already linked sends them round the loop again.
 */
async function handleLink(db: Db, chatId: number, code: string): Promise<string> {
  if (!code) return "Send /link followed by the code from the site, e.g. /link ABC123.";

  const { data: row } = await db
    .from("telegram_link_codes")
    .select("code, user_id, expires_at, used_at")
    .eq("code", code.toUpperCase())
    .maybeSingle();

  if (!row) return "❌ I don't recognise that code. Generate a fresh one on the site.";
  if (row.used_at) return "❌ That code has already been used. Generate a fresh one on the site.";
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return "❌ That code has expired. Generate a fresh one on the site.";
  }

  const { error: upsertError } = await db
    .from("user_notification_prefs")
    .upsert({ user_id: row.user_id, telegram_chat_id: chatId }, { onConflict: "user_id" });
  if (upsertError) {
    // The unique index on telegram_chat_id is what lands here when a chat is
    // already linked to a different account — a real conflict, not a glitch.
    return "❌ Couldn't link this chat — it may already be linked to another account.";
  }

  await db
    .from("telegram_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", row.code);

  return "✅ Linked. Alerts are off by default — choose which ones you want under Settings → Notifications.";
}

// ---------------------------------------------------------------- /team

interface SquadPlayer {
  id: number;
  name: string;
  posShort: string;
  posId: number;
  club: string;
  status: string;
  chance: number | null;
}

interface FormationLimit {
  id: number;
  short: string;
  minPlay: number;
  maxPlay: number;
}

/** Formation limits come from `element_types`, never hardcoded (CLAUDE.md). */
async function loadFormationLimits(db: Db, season: string): Promise<Map<number, FormationLimit>> {
  const { data } = await db
    .from("element_types")
    .select("id, singular_name_short, squad_min_play, squad_max_play")
    .eq("season", season);
  const out = new Map<number, FormationLimit>();
  for (const r of data ?? []) {
    out.set(r.id as number, {
      id: r.id as number,
      short: r.singular_name_short as string,
      minPlay: r.squad_min_play as number,
      maxPlay: r.squad_max_play as number,
    });
  }
  return out;
}

/** `a` is available; everything else is injured, suspended, doubtful or gone. */
const isAvailable = (p: SquadPlayer) => p.status === "a";

const STATUS_WORD: Record<string, string> = {
  i: "injured",
  d: "doubtful",
  s: "suspended",
  u: "unavailable",
  n: "not in squad",
};

function unavailableReason(p: SquadPlayer): string {
  const word = STATUS_WORD[p.status] ?? "unavailable";
  return p.chance !== null ? `${word}, ${p.chance}% chance` : word;
}

/**
 * Which bench player would come on for an unavailable starter.
 *
 * This mirrors the rule `projectAutoSubs` implements in lib/gameweek-state.ts:
 * a goalkeeper can only be replaced by the other goalkeeper, an outfielder by
 * the first bench player in **bench order** whose arrival still leaves a legal
 * formation. Bench order is FPL's own priority, so this reports a decision the
 * game will make rather than a preference of ours.
 *
 * It is a deliberate second copy of a rule, for the same reason
 * `_shared/entities.ts` keeps its own `fold()` — Supabase bundles each function
 * directory independently and cannot import `lib/`. **lib/gameweek-state.ts is
 * the source of truth; keep the two in sync.**
 *
 * Note what this is *not*: it is not the xP-optimal starting XI. That is
 * `optimiseLineup`, it is modelled, and it stays on the site.
 */
function forcedChanges(
  xi: SquadPlayer[],
  bench: SquadPlayer[],
  limits: Map<number, FormationLimit>,
): Array<{ out: SquadPlayer; in: SquadPlayer | null }> {
  const out: Array<{ out: SquadPlayer; in: SquadPlayer | null }> = [];
  const used = new Set<number>();

  for (const starter of xi.filter((p) => !isAvailable(p))) {
    const counts = new Map<number, number>();
    for (const p of xi) counts.set(p.posId, (counts.get(p.posId) ?? 0) + 1);

    const candidate = bench.find((b) => {
      if (used.has(b.id) || !isAvailable(b)) return false;
      // Goalkeepers are their own closed swap: min and max play are both 1.
      const gk = limits.get(1);
      if (gk && (starter.posId === gk.id || b.posId === gk.id)) return starter.posId === b.posId;
      if (b.posId === starter.posId) return true;
      const after = new Map(counts);
      after.set(starter.posId, (after.get(starter.posId) ?? 0) - 1);
      after.set(b.posId, (after.get(b.posId) ?? 0) + 1);
      for (const [posId, limit] of limits) {
        const n = after.get(posId) ?? 0;
        if (n < limit.minPlay || n > limit.maxPlay) return false;
      }
      return true;
    }) ?? null;

    if (candidate) used.add(candidate.id);
    out.push({ out: starter, in: candidate });
  }
  return out;
}

const playerLine = (p: SquadPlayer, armband: string) =>
  `${positionEmoji(p.posShort)} ${p.name}${armband} ${clubEmoji(p.club)}${p.club}` +
  (isAvailable(p) ? "" : `  ⚠️ ${unavailableReason(p)}`);

async function handleTeam(
  db: Db,
  season: string,
  userId: string,
  entryId: number,
  teamName: string | null,
): Promise<string> {
  // The *current* squad, not the last scored one. `manager_picks` only ever
  // holds gameweeks FPL has already started, so reading it means answering a
  // question about last week — which is what this command used to do. The
  // imported draft is the squad as of the last sync, and it is the only record
  // of the team standing for the upcoming deadline.
  //
  // Scoped to the *user's own* drafts and then matched on entry id in memory,
  // rather than filtering on the jsonb field alone: two accounts can hold a
  // draft for the same entry, and "any draft claiming this entry id" is not a
  // question this bot should be asking on someone's behalf.
  const { data: drafts } = await db
    .from("team_drafts")
    .select("payload, updated_at")
    .is("deleted_at", null)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  const draft = (drafts ?? []).find(
    (d: { payload: Record<string, unknown> }) => Number(d.payload?.entryId) === entryId,
  );

  if (!draft) {
    return [
      title("⚽", "Your Team", teamName),
      "",
      `No synced squad yet — import your team at ${SITE}/team/ and I'll have the current one.`,
    ].join("\n");
  }

  const payload = draft.payload as Record<string, unknown>;
  const xiIds = (payload.startingXI as number[] | undefined) ?? [];
  const benchIds = (payload.benchOrder as number[] | undefined) ?? [];
  const captain = payload.captain as number | null;
  const vice = payload.viceCaptain as number | null;
  const gameweek = payload.gameweek as number | null;

  if (xiIds.length === 0) {
    return [
      title("⚽", "Your Team", teamName),
      "",
      "That squad has no starting XI saved yet — open it on the site once and I'll pick it up.",
    ].join("\n");
  }

  const ids = [...xiIds, ...benchIds];
  const [{ data: playerRows }, limits] = await Promise.all([
    db
      .from("players")
      .select("id, web_name, element_type, team_id, status, chance_of_playing_next_round")
      .eq("season", season)
      .in("id", ids),
    loadFormationLimits(db, season),
  ]);
  const { data: teamRows } = await db
    .from("teams")
    .select("id, short_name")
    .eq("season", season);
  const clubOf = new Map<number, string>(
    (teamRows ?? []).map((t: { id: number; short_name: string }) => [t.id, t.short_name]),
  );

  const byId = new Map<number, SquadPlayer>();
  for (const r of playerRows ?? []) {
    const limit = limits.get(r.element_type as number);
    byId.set(r.id as number, {
      id: r.id as number,
      name: (r.web_name as string) ?? `#${r.id}`,
      posShort: limit?.short ?? "",
      posId: r.element_type as number,
      club: clubOf.get(r.team_id as number) ?? "",
      status: (r.status as string) ?? "a",
      chance: (r.chance_of_playing_next_round as number | null) ?? null,
    });
  }

  const xi = xiIds.map((id) => byId.get(id)).filter((p): p is SquadPlayer => !!p);
  const bench = benchIds.map((id) => byId.get(id)).filter((p): p is SquadPlayer => !!p);
  // Pitch order: keepers, then out through the positions.
  const ordered = [...xi].sort((a, b) => a.posId - b.posId || a.name.localeCompare(b.name));

  const armbandOf = (p: SquadPlayer) =>
    p.id === captain ? " (C)" : p.id === vice ? " (V)" : "";

  const lines = [
    title("⚽", "Your Team", teamName),
    gameweek ? `Gameweek ${gameweek} · squad as last synced` : "Squad as last synced",
    "",
    ...ordered.map((p) => playerLine(p, armbandOf(p))),
    "",
    `🪑 Bench: ${bench.map((p) => `${p.name} ${clubEmoji(p.club)}`).join(" · ")}`,
  ];

  const forced = forcedChanges(xi, bench, limits);
  lines.push("");
  if (forced.length === 0) {
    lines.push("✅ All eleven are available — no forced changes.");
  } else {
    lines.push("🔁 Forced changes");
    for (const f of forced) {
      lines.push(
        f.in
          ? `  ${f.out.name} (${unavailableReason(f.out)}) → ${f.in.name} ${clubEmoji(f.in.club)}`
          : `  ${f.out.name} (${unavailableReason(f.out)}) → no legal bench cover`,
      );
    }
    lines.push("");
    lines.push("Availability only — who to start on merit is on the site.");
  }

  return lines.join("\n");
}

// -------------------------------------------------------------- /points

async function handlePoints(
  db: Db,
  season: string,
  entryId: number,
  teamName: string | null,
): Promise<string> {
  const { data: rows } = await db
    .from("manager_gameweek_history")
    .select("event, points, total_points, overall_rank, event_transfers_cost, points_on_bench, active_chip")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event", { ascending: false })
    .limit(2);
  if (!rows || rows.length === 0) return "No scored gameweek yet this season.";

  const now = rows[0];
  const prev = rows[1] ?? null;

  // Terms named, never netted — the hit is its own line, as it is everywhere
  // else in this app. Rank movement is a direction only: the magnitude of an
  // overall-rank swing is mostly a function of how many managers are above
  // you, not of how well you played.
  const lines = [
    title("📊", `Gameweek ${now.event}`, teamName),
    "",
    `⚽ ${now.points} pts`,
  ];
  if (now.event_transfers_cost) lines.push(`💸 Hit: −${now.event_transfers_cost} pts`);
  lines.push(`🪑 Bench: ${now.points_on_bench ?? 0} pts`);
  if (now.active_chip) lines.push(`🎴 Chip: ${now.active_chip}`);
  lines.push("");
  lines.push(`🏅 Season: ${now.total_points} pts`);
  lines.push(
    `🌍 Overall rank: ${shortRank(now.overall_rank)} ${movement(now.overall_rank, prev?.overall_rank)}`,
  );
  return lines.join("\n");
}

// ------------------------------------------------------------ /fixtures

async function handleFixtures(db: Db, season: string): Promise<string> {
  const { data: gw } = await db
    .from("gameweeks")
    .select("id, name, deadline_time")
    .eq("season", season)
    .eq("is_next", true)
    .limit(1)
    .maybeSingle();
  if (!gw) return "No upcoming gameweek found.";

  const { data: fixtures } = await db
    .from("fixtures")
    .select("kickoff_time, team_h, team_a")
    .eq("season", season)
    .eq("event", gw.id)
    .order("kickoff_time");
  if (!fixtures || fixtures.length === 0) return `No fixtures listed for ${gw.name} yet.`;

  const { data: teams } = await db.from("teams").select("id, short_name").eq("season", season);
  const shortOf = new Map<number, string>(
    (teams ?? []).map((t: { id: number; short_name: string }) => [t.id, t.short_name]),
  );
  const side = (id: number) => {
    const s = shortOf.get(id) ?? "?";
    return `${clubEmoji(s)}${s}`;
  };

  const lines = [
    title("🗓️", `${gw.name} Fixtures`, null),
    `⏰ Deadline: ${dateTimeLabel(gw.deadline_time)}`,
  ];

  // Grouped by day, so the date is said once instead of ten times. A fixture
  // with no kickoff time yet is its own group rather than being dropped —
  // "TBC" is a fact about the schedule, and a blank-gameweek hunt needs it.
  let currentDay: string | null = null;
  for (const f of fixtures) {
    const day = f.kickoff_time ? dayLabel(f.kickoff_time as string) : "Date TBC";
    if (day !== currentDay) {
      lines.push("");
      lines.push(day);
      currentDay = day;
    }
    const when = f.kickoff_time ? timeLabel(f.kickoff_time as string) : "TBC";
    lines.push(`${when}  ${side(f.team_h as number)} v ${side(f.team_a as number)}`);
  }

  return lines.join("\n");
}

// ------------------------------------------------------------- /leagues

async function handleLeagues(
  db: Db,
  entryId: number,
  teamName: string | null,
): Promise<string> {
  const { data: leagues } = await db
    .from("manager_leagues")
    .select("league_id, name, entry_rank, entry_last_rank, rank_count")
    .eq("entry_id", entryId)
    .order("name");
  if (!leagues || leagues.length === 0) return "No leagues recorded — sync your team on the site.";

  const row = (l: Record<string, unknown>) => {
    const rank = l.entry_rank as number | null;
    const last = l.entry_last_rank as number | null;
    const size = l.rank_count as number | null;
    const move = movement(rank, last);
    // Magnitude is kept here and dropped on /points, and the difference is
    // deliberate: a mini-league move of two places is a real event, where an
    // overall-rank swing of 100k mostly measures the field, not the manager.
    const delta =
      rank !== null && last !== null && last !== 0 && rank !== last
        ? ` ${shortRank(Math.abs(rank - last))}`
        : "";
    return `${l.name}: ${shortRank(rank)} of ${shortRank(size)} ${move}${delta}`;
  };

  const mini = leagues.filter((l: Record<string, unknown>) => ((l.rank_count as number) ?? 0) <= MINI_LEAGUE_MAX);
  const big = leagues.filter((l: Record<string, unknown>) => ((l.rank_count as number) ?? 0) > MINI_LEAGUE_MAX);

  const lines = [title("🏆", "Your Leagues", teamName), "Rank — lower is better"];
  if (mini.length > 0) {
    lines.push("", `👥 Mini-leagues (under ${MINI_LEAGUE_MAX})`);
    for (const l of mini) lines.push(`  ${row(l)}`);
  }
  if (big.length > 0) {
    lines.push("", "🌍 Bigger leagues");
    for (const l of big) lines.push(`  ${row(l)}`);
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ serve

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = serviceClient();

  if (!(await verifyTelegramWebhook(req, db))) {
    // No detail, and nothing read before this point.
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return jsonResponse({ ok: true });
  }

  const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
  const chat = message?.chat as { id: number } | undefined;
  const text = ((message?.text as string) ?? "").trim();
  if (!chat || !text) return jsonResponse({ ok: true });

  const token = await telegramBotToken(db);
  // Without a token there is nothing to reply with. 200 regardless: a non-200
  // makes Telegram redeliver the same update, and redelivering into a missing
  // secret just builds a backlog.
  if (!token) return jsonResponse({ ok: true });

  const [rawCommand, ...args] = text.split(/\s+/);
  // Group chats address commands as /points@BotName.
  const command = rawCommand.split("@")[0].toLowerCase();

  let reply: string;
  try {
    // `/start CODE` is what tapping the site's t.me deep link sends — Telegram
    // turns `?start=CODE` into exactly that. So it is a link attempt, not a
    // greeting, and it has to be handled before the linked-chat check below:
    // the whole point of the deep link is that the chat is *not* linked yet.
    const startPayload = command === "/start" ? (args[0] ?? "") : "";
    if (command === "/link" || startPayload) {
      reply = await handleLink(db, chat.id, command === "/link" ? (args[0] ?? "") : startPayload);
    } else {
      const userId = await userForChat(db, chat.id);
      if (!userId) {
        reply =
          "This chat isn't linked to an account. Open Settings → Notifications (or My Team) on " +
          `${SITE}, generate a code, then send /link <code>.`;
      } else if (command === "/help" || command === "/start") {
        reply = HELP;
      } else {
        const season = await currentSeason(db);
        const entryId = await entryForUser(db, userId);
        const teamName = entryId ? await teamNameFor(db, entryId) : null;

        if (command === "/fixtures") {
          reply = await handleFixtures(db, season);
        } else if (!entryId) {
          reply = `No FPL team is claimed on this account yet — import one at ${SITE}/team/.`;
        } else if (command === "/team") {
          reply = await handleTeam(db, season, userId, entryId, teamName);
        } else if (command === "/points") {
          reply = await handlePoints(db, season, entryId, teamName);
        } else if (command === "/leagues") {
          reply = await handleLeagues(db, entryId, teamName);
        } else {
          reply = HELP;
        }
      }
    }
  } catch (err) {
    console.error(err);
    reply = "Something went wrong answering that. Try again shortly.";
  }

  await sendTelegramMessage(token, chat.id, reply);
  // Always 200 once the update has been handled — Telegram retries anything
  // else, and a handled error is not something to redeliver.
  return jsonResponse({ ok: true });
});
