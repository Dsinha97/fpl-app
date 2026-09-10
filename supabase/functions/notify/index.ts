// notify — Sprint 36 (DSI-65), the outbound half of the Telegram bot.
//
// Class A (cron-only): the cron secret is the gate, exactly as for the eight
// sync functions. No browser has any business calling this.
//
// Two passes in one invocation, and they are separate on purpose:
//
//   detect   read the signal sources, render a message, write an outbox row
//   send     take unsent outbox rows to Telegram, record the outcome
//
// A send that fails is then a row that can be retried, not an alert that
// silently never happened. It also means detection can run far more often than
// delivery succeeds without producing duplicates, because the dedupe key —
// composed from the fact itself — is uniquely indexed per user.
//
// SCOPE. Player-level alerts (status, news, price) are filtered to the user's
// own squad. Unfiltered they would be ~700 players of noise, which is the same
// thing as no notifications at all. Fixture changes are not filtered: a
// reschedule is a planning fact regardless of who owns whom, and they are rare.
//
// WHAT THIS DOES NOT DO. No modelled quantity is ever sent — no xP, no
// recommendation, no chip advice. This file is Deno and cannot import `lib/`,
// so anything modelled here would be a second implementation of a number the
// app already computes. Facts the pipeline already wrote are fair game;
// anything derived is not, and belongs on the site.

import { currentSeason, jsonResponse, preflight, serviceClient, SyncRun } from "../_shared/sync.ts";
import { verifyCron } from "../_shared/cron-auth.ts";
import { sendTelegramMessage, telegramBotToken } from "../_shared/telegram.ts";

const FUNCTION_NAME = "notify";

/** Mirrors the `notify_batch` row the migration seeds. The row is the source
 *  of truth; this is the documented degradation, not a second one to tune. */
const FALLBACK_BATCH = { maxSends: 25, lookbackMinutes: 180 };

interface Prefs {
  user_id: string;
  telegram_chat_id: number;
  notify_deadline: boolean;
  notify_status: boolean;
  notify_news: boolean;
  notify_price: boolean;
  notify_fixture: boolean;
  deadline_hours_before: number;
}

interface OutboxRow {
  user_id: string;
  kind: string;
  dedupe_key: string;
  body: string;
  payload: Record<string, unknown> | null;
}

// deno-lint-ignore no-explicit-any
type Db = any;

async function loadBatchSettings(db: Db, season: string) {
  const { data, error } = await db
    .from("game_settings")
    .select("value")
    .eq("season", season)
    .eq("key", "notify_batch")
    .maybeSingle();
  if (error || !data?.value) return FALLBACK_BATCH;
  const v = data.value as Record<string, unknown>;
  const maxSends = Number(v.max_sends);
  const lookbackMinutes = Number(v.lookback_minutes);
  if (!Number.isFinite(maxSends) || !Number.isFinite(lookbackMinutes)) return FALLBACK_BATCH;
  return { maxSends, lookbackMinutes };
}

/**
 * The player *codes* in a user's most recent squad.
 *
 * `manager_picks` stores FPL element ids, while `change_feed` keys on
 * `players.code` — the season-stable identifier. The join is the whole reason
 * this is its own function: matching a change_feed row against an element id
 * would silently match nothing.
 */
async function squadCodesFor(db: Db, season: string, entryId: number): Promise<Set<number>> {
  const { data: latest } = await db
    .from("manager_picks")
    .select("event")
    .eq("season", season)
    .eq("entry_id", entryId)
    .order("event", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return new Set();

  const { data: picks } = await db
    .from("manager_picks")
    .select("element")
    .eq("season", season)
    .eq("entry_id", entryId)
    .eq("event", latest.event);
  const elements = (picks ?? []).map((p: { element: number }) => p.element);
  if (elements.length === 0) return new Set();

  const { data: players } = await db
    .from("players")
    .select("code")
    .eq("season", season)
    .in("id", elements);
  return new Set((players ?? []).map((p: { code: number }) => p.code as number));
}

/** A change_feed row rendered for a human. Terms named, nothing netted. */
function renderChange(row: Record<string, unknown>): string | null {
  const name = (row.web_name as string | null) ?? "A player";
  const club = row.team_short ? ` (${row.team_short})` : "";
  const detail = (row.detail ?? {}) as Record<string, unknown>;

  switch (row.kind) {
    case "status": {
      const chance = detail.new_chance as number | null;
      const chanceText = chance === null || chance === undefined ? "" : ` — ${chance}% chance of playing`;
      return `⚠️ ${name}${club}: ${detail.old_status ?? "?"} → ${detail.new_status ?? "?"}${chanceText}`;
    }
    case "news":
      return `📰 ${name}${club}: ${detail.new_news ?? ""}`.trim();
    case "price": {
      const oldP = Number(detail.old_price ?? 0) / 10;
      const newP = Number(detail.new_price ?? 0) / 10;
      const arrow = newP > oldP ? "📈" : "📉";
      return `${arrow} ${name}${club}: £${oldP.toFixed(1)}m → £${newP.toFixed(1)}m`;
    }
    default:
      return null;
  }
}

async function detect(db: Db, season: string, prefs: Prefs[], lookbackMinutes: number) {
  const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
  const rows: OutboxRow[] = [];

  // ---- the next deadline, shared by every user who wants a reminder --------
  const { data: nextGw } = await db
    .from("gameweeks")
    .select("id, name, deadline_time")
    .eq("season", season)
    .eq("is_next", true)
    .limit(1)
    .maybeSingle();

  // ---- player-level changes, once for everyone ----------------------------
  const { data: changes } = await db
    .from("change_feed")
    .select("season, kind, observed_at, player_code, web_name, team_short, detail")
    .eq("season", season)
    .gte("observed_at", since)
    .order("observed_at", { ascending: false });

  // ---- fixture reschedules, read from the table rather than the view ------
  // The view flattens fixture changes without their `id`, and an id is what a
  // stable dedupe key wants. Same fact, better key.
  const { data: fixtureChanges } = await db
    .from("fixture_changes")
    .select("id, fixture_id, field, old_value, new_value, observed_at")
    .eq("season", season)
    .gte("observed_at", since);

  for (const p of prefs) {
    // Deadline. The key is the event, so the reminder fires once per gameweek
    // however often detection runs inside the window.
    if (p.notify_deadline && nextGw?.deadline_time) {
      const hoursOut = (new Date(nextGw.deadline_time).getTime() - Date.now()) / 3_600_000;
      if (hoursOut > 0 && hoursOut <= p.deadline_hours_before) {
        rows.push({
          user_id: p.user_id,
          kind: "deadline",
          dedupe_key: `deadline:${nextGw.id}`,
          body:
            `⏰ ${nextGw.name} deadline in ${hoursOut.toFixed(1)}h ` +
            `(${new Date(nextGw.deadline_time).toUTCString()}).`,
          payload: { event: nextGw.id },
        });
      }
    }

    const wants: Record<string, boolean> = {
      status: p.notify_status,
      news: p.notify_news,
      price: p.notify_price,
    };
    const needsSquad = wants.status || wants.news || wants.price;

    if (needsSquad && (changes?.length ?? 0) > 0) {
      const { data: profile } = await db
        .from("user_profiles")
        .select("entry_id")
        .eq("user_id", p.user_id)
        .maybeSingle();

      // No claimed entry means no squad to filter against. Sending every
      // player's news instead would be the wrong kind of helpful.
      const codes = profile?.entry_id
        ? await squadCodesFor(db, season, profile.entry_id as number)
        : new Set<number>();

      for (const c of changes ?? []) {
        const kind = c.kind as string;
        if (!wants[kind]) continue;
        if (c.player_code === null || !codes.has(c.player_code as number)) continue;
        const body = renderChange(c);
        if (!body) continue;
        rows.push({
          user_id: p.user_id,
          kind,
          dedupe_key: `${kind}:${c.player_code}:${c.observed_at}`,
          body,
          payload: { player_code: c.player_code, observed_at: c.observed_at },
        });
      }
    }

    if (p.notify_fixture) {
      for (const f of fixtureChanges ?? []) {
        rows.push({
          user_id: p.user_id,
          kind: "fixture",
          dedupe_key: `fixture:${f.id}`,
          body: `🗓️ Fixture ${f.fixture_id} rescheduled: ${f.field} ${f.old_value ?? "?"} → ${f.new_value ?? "?"}`,
          payload: { fixture_id: f.fixture_id, field: f.field },
        });
      }
    }
  }

  if (rows.length === 0) return 0;

  // The unique index is the dedupe. Re-inserting a known fact is a no-op, so
  // this is safe to run as often as cron likes.
  const { data: inserted, error } = await db
    .from("notification_outbox")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`notification_outbox: ${error.message}`);
  return (inserted ?? []).length;
}

async function send(db: Db, token: string, maxSends: number) {
  const { data: pending, error } = await db
    .from("notification_outbox")
    .select("id, user_id, body")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(maxSends);
  if (error) throw new Error(`notification_outbox: ${error.message}`);
  if ((pending?.length ?? 0) === 0) return { sent: 0, failed: 0 };

  // chat id per user, resolved once
  const userIds = [...new Set((pending ?? []).map((r: { user_id: string }) => r.user_id))];
  const { data: prefRows } = await db
    .from("user_notification_prefs")
    .select("user_id, telegram_chat_id")
    .in("user_id", userIds);
  const chatOf = new Map<string, number>();
  for (const r of prefRows ?? []) {
    if (r.telegram_chat_id !== null) chatOf.set(r.user_id as string, r.telegram_chat_id as number);
  }

  let sent = 0;
  let failed = 0;
  for (const row of pending ?? []) {
    const chatId = chatOf.get(row.user_id as string);
    // One row's failure never stops the batch — the whole point of an outbox.
    if (chatId === undefined) {
      await db
        .from("notification_outbox")
        .update({ error: "no linked chat", attempts: 1 })
        .eq("id", row.id);
      failed += 1;
      continue;
    }
    const result = await sendTelegramMessage(token, chatId, row.body as string);
    if (result.ok) {
      await db
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), error: null })
        .eq("id", row.id);
      sent += 1;
    } else {
      await db.from("notification_outbox").update({ error: result.error }).eq("id", row.id);
      failed += 1;
    }
  }
  return { sent, failed };
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = serviceClient();
  const denied = await verifyCron(req, db);
  if (denied) return denied;

  const season = await currentSeason(db);
  const run = await SyncRun.start(db, FUNCTION_NAME, season);

  try {
    const { maxSends, lookbackMinutes } = await loadBatchSettings(db, season);

    // Only linked users are detected for. An outbox row for a user with no
    // chat is undeliverable by construction, and accumulating them would turn
    // the dedupe index into a permanent record of alerts nobody can ever get.
    const { data: prefs, error: prefsError } = await db
      .from("user_notification_prefs")
      .select(
        "user_id, telegram_chat_id, notify_deadline, notify_status, notify_news, notify_price, notify_fixture, deadline_hours_before",
      )
      .not("telegram_chat_id", "is", null);
    if (prefsError) throw new Error(`user_notification_prefs: ${prefsError.message}`);

    const detected = await detect(db, season, (prefs ?? []) as Prefs[], lookbackMinutes);

    // The send pass runs unconditionally, not only when something was just
    // detected: it is also what retries rows a previous run could not deliver.
    const token = await telegramBotToken(db);
    if (!token) {
      // Loud, and not an error that loses the detected rows — they stay unsent
      // and go out on the next run once the secret exists.
      await run.finish("partial", {
        rowsWritten: detected,
        details: { detected, note: "telegram_bot_token not set in Vault" },
      });
      return jsonResponse({ detected, sent: 0, note: "telegram_bot_token not set" });
    }

    const { sent, failed } = await send(db, token, maxSends);

    await run.finish(failed > 0 ? "partial" : "success", {
      rowsWritten: detected,
      details: { detected, sent, failed },
    });
    return jsonResponse({ detected, sent, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.finish("error", { error: message });
    return jsonResponse({ error: message }, 500);
  }
});
