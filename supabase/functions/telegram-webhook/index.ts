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
// `manager_gameweek_history` for points, `manager_picks` + `players` for the
// squad, `fixtures` for the schedule, `league_entries` for standings. Nothing
// modelled — no xP, no transfer recommendation, no chip advice, no EO. This
// file is Deno and cannot import `lib/`, so any modelled figure here would be
// a second implementation of a number the app already owns, which this project
// treats as a bug with a delay on it. Those questions get a link to the site.

import { jsonResponse, preflight, serviceClient } from "../_shared/sync.ts";
import {
  sendTelegramMessage,
  telegramBotToken,
  verifyTelegramWebhook,
} from "../_shared/telegram.ts";

const SITE = "https://fpldecision.com";

// deno-lint-ignore no-explicit-any
type Db = any;

const HELP = [
  "FPL Decision bot. What I can answer:",
  "",
  "/team — your current squad",
  "/points — this gameweek's points so far",
  "/fixtures — the next gameweek's fixtures",
  "/leagues — your league standings",
  "/link <code> — link this chat (get a code on the site)",
  "",
  `Projections, transfer suggestions and chip advice live on ${SITE} — I only`,
  "report what has already happened.",
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

  if (!row) return "I don't recognise that code. Generate a fresh one on the site.";
  if (row.used_at) return "That code has already been used. Generate a fresh one on the site.";
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return "That code has expired. Generate a fresh one on the site.";
  }

  const { error: upsertError } = await db
    .from("user_notification_prefs")
    .upsert({ user_id: row.user_id, telegram_chat_id: chatId }, { onConflict: "user_id" });
  if (upsertError) {
    // The unique index on telegram_chat_id is what lands here when a chat is
    // already linked to a different account — a real conflict, not a glitch.
    return "Couldn't link this chat — it may already be linked to another account.";
  }

  await db
    .from("telegram_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", row.code);

  return "Linked. Alerts are off by default — turn on the ones you want under Settings → Notifications.";
}

async function handleTeam(db: Db, season: string, entryId: number): Promise<string> {
  const { data: latest } = await db
    .from("manager_picks")
    .select("event")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return "No squad recorded yet — import your team on the site first.";

  const { data: picks } = await db
    .from("manager_picks")
    .select("position, element, multiplier, is_captain, is_vice_captain")
    .eq("season", season)
    .eq("entry_id", entryId)
    .eq("event", latest.event)
    .order("position");
  if (!picks || picks.length === 0) return `No picks recorded for GW${latest.event}.`;

  const { data: players } = await db
    .from("players")
    .select("id, web_name")
    .eq("season", season)
    .in("id", picks.map((p: { element: number }) => p.element));
  const nameOf = new Map<number, string>(
    (players ?? []).map((p: { id: number; web_name: string }) => [p.id, p.web_name]),
  );

  // Position, not multiplier, decides who started — under a Bench Boost every
  // pick has a non-zero multiplier. Same rule as lib/manager-picks.ts's
  // startersOf, and the one place a Deno copy of a rule is unavoidable.
  const line = (p: { position: number; element: number; is_captain: boolean; is_vice_captain: boolean }) =>
    `${nameOf.get(p.element) ?? `#${p.element}`}${p.is_captain ? " (C)" : p.is_vice_captain ? " (V)" : ""}`;

  const starters = picks.filter((p: { position: number }) => p.position <= 11).map(line);
  const bench = picks.filter((p: { position: number }) => p.position >= 12).map(line);

  return [`GW${latest.event} squad`, "", ...starters, "", `Bench: ${bench.join(", ")}`].join("\n");
}

async function handlePoints(db: Db, season: string, entryId: number): Promise<string> {
  const { data } = await db
    .from("manager_gameweek_history")
    .select("event, points, total_points, overall_rank, event_transfers_cost, points_on_bench")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return "No scored gameweek yet this season.";

  // Terms named, never netted — the hit is its own line, as it is everywhere
  // else in this app.
  return [
    `GW${data.event}: ${data.points} pts`,
    data.event_transfers_cost ? `Hit: −${data.event_transfers_cost} pts` : null,
    `Bench: ${data.points_on_bench ?? 0} pts`,
    `Season total: ${data.total_points}`,
    data.overall_rank ? `Overall rank: ${Number(data.overall_rank).toLocaleString("en-GB")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

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
    .select("kickoff_time, team_h, team_a, team_h_difficulty, team_a_difficulty")
    .eq("season", season)
    .eq("event", gw.id)
    .order("kickoff_time");
  if (!fixtures || fixtures.length === 0) return `No fixtures listed for ${gw.name} yet.`;

  const { data: teams } = await db.from("teams").select("id, short_name").eq("season", season);
  const shortOf = new Map<number, string>(
    (teams ?? []).map((t: { id: number; short_name: string }) => [t.id, t.short_name]),
  );

  const lines = fixtures.map((f: Record<string, unknown>) => {
    const when = f.kickoff_time
      ? new Date(f.kickoff_time as string).toUTCString().slice(0, 22)
      : "TBC";
    return `${shortOf.get(f.team_h as number) ?? "?"} v ${shortOf.get(f.team_a as number) ?? "?"} — ${when}`;
  });

  return [`${gw.name}`, `Deadline: ${new Date(gw.deadline_time).toUTCString()}`, "", ...lines].join("\n");
}

async function handleLeagues(db: Db, season: string, entryId: number): Promise<string> {
  const { data: leagues } = await db
    .from("manager_leagues")
    .select("league_id, name, entry_rank, entry_last_rank, rank_count")
    .eq("entry_id", entryId)
    .order("name");
  if (!leagues || leagues.length === 0) return "No leagues recorded — sync your team on the site.";

  const lines = leagues.map((l: Record<string, unknown>) => {
    const rank = l.entry_rank as number | null;
    const last = l.entry_last_rank as number | null;
    // Lower is better, so a falling number is a rise. Spelled out rather than
    // shown as a bare signed delta that reads backwards.
    const move =
      rank !== null && last !== null && last !== 0
        ? last > rank
          ? ` ▲${last - rank}`
          : last < rank
            ? ` ▼${rank - last}`
            : " ="
        : "";
    return `${l.name}: ${rank ?? "?"} of ${l.rank_count ?? "?"}${move}`;
  });
  return ["Your leagues (rank — lower is better)", "", ...lines].join("\n");
}

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
    if (command === "/link") {
      reply = await handleLink(db, chat.id, args[0] ?? "");
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

        if (command === "/fixtures") {
          reply = await handleFixtures(db, season);
        } else if (!entryId) {
          reply = `No FPL team is claimed on this account yet — import one at ${SITE}/team/.`;
        } else if (command === "/team") {
          reply = await handleTeam(db, season, entryId);
        } else if (command === "/points") {
          reply = await handlePoints(db, season, entryId);
        } else if (command === "/leagues") {
          reply = await handleLeagues(db, season, entryId);
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
