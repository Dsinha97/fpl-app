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
  notify_price_watch: boolean;
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

/** The player *codes* on a user's shortlist. Owner-scoped like `squadCodesFor`,
 *  but a straight read — `user_shortlist` is already keyed on `player_code`. */
async function shortlistCodesFor(db: Db, season: string, userId: string): Promise<Set<number>> {
  const { data } = await db
    .from("user_shortlist")
    .select("player_code")
    .eq("season", season)
    .eq("user_id", userId);
  return new Set((data ?? []).map((r: { player_code: number }) => r.player_code as number));
}

/** The flat, unfitted net-transfer threshold that decides which players get
 *  sampled every ~2h (20260830191442_sprint29_price_watchlist.sql). Reused
 *  here as the notification trigger — see the Sprint 39 migration header for
 *  why this is the fitted, ownership-scaled reading `lib/price-watch.ts`
 *  shows on the site, not a copy of it. */
async function priceWatchThreshold(db: Db, season: string): Promise<number> {
  const { data } = await db
    .from("game_settings")
    .select("value")
    .eq("season", season)
    .eq("key", "price_watch_net_transfer_threshold")
    .maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : 20_000;
}

interface PriceWatchAlert {
  code: number;
  direction: "rise" | "fall";
  netTransfers: number;
  anchorAt: string;
}

/**
 * Which of `codes` have net transfers past the flat threshold since their
 * last recorded price change — a fact-level crossing check, not the fitted
 * progress-to-threshold reading `lib/price-watch.ts` computes for the site.
 * Deliberately duplicates only the reset-aware accumulation
 * (`netTransfersSinceLastPriceChange` there), which is careful counter
 * handling rather than a fitted model — see that function's own comment for
 * why `transfers_in_event`/`transfers_out_event` can't simply be
 * differenced. Not paged like the site's `loadPriceProgress`: this only ever
 * runs over a user's own squad plus shortlist, dozens of players rather than
 * the ~700-player pool, so the 1000-row cap CLAUDE.md warns about is not in
 * play at this scale.
 */
async function priceWatchAlerts(
  db: Db,
  season: string,
  codes: Set<number>,
  threshold: number,
): Promise<PriceWatchAlert[]> {
  if (codes.size === 0) return [];
  const codeList = [...codes];

  const { data: changes } = await db
    .from("player_price_history")
    .select("player_code, observed_at")
    .eq("season", season)
    .in("player_code", codeList)
    .order("observed_at", { ascending: false });
  const anchorAt = new Map<number, string>();
  for (const row of changes ?? []) {
    const code = row.player_code as number;
    if (!anchorAt.has(code)) anchorAt.set(code, row.observed_at as string);
  }
  if (anchorAt.size === 0) return [];

  let earliestAnchor = "";
  for (const at of anchorAt.values()) {
    if (earliestAnchor === "" || at < earliestAnchor) earliestAnchor = at;
  }

  const { data: samples } = await db
    .from("player_ownership_history")
    .select("player_code, observed_at, transfers_in_event, transfers_out_event")
    .eq("season", season)
    .in("player_code", [...anchorAt.keys()])
    .gte("observed_at", earliestAnchor)
    .order("observed_at", { ascending: true });

  const byPlayer = new Map<number, Array<{ in: number; out: number }>>();
  for (const row of samples ?? []) {
    const code = row.player_code as number;
    const anchor = anchorAt.get(code);
    if (!anchor || (row.observed_at as string) < anchor) continue;
    const list = byPlayer.get(code) ?? [];
    list.push({ in: (row.transfers_in_event as number | null) ?? 0, out: (row.transfers_out_event as number | null) ?? 0 });
    byPlayer.set(code, list);
  }

  const alerts: PriceWatchAlert[] = [];
  for (const [code, list] of byPlayer) {
    if (list.length < 2) continue;
    // Reset-aware accumulation: transfers_in_event only ever increases within
    // a gameweek, so a decrease between consecutive samples marks a deadline
    // reset, and the new sample's own net *is* the accumulation since that
    // reset rather than a delta from the pre-reset sample.
    let total = 0;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const reset = cur.in < prev.in;
      const netCur = cur.in - cur.out;
      const netPrev = prev.in - prev.out;
      total += reset ? netCur : netCur - netPrev;
    }
    if (Math.abs(total) < threshold) continue;
    alerts.push({
      code,
      direction: total > 0 ? "rise" : "fall",
      netTransfers: total,
      anchorAt: anchorAt.get(code)!,
    });
  }
  return alerts;
}

/** `12th Jan 10:00 am` — UTC, since that's what `kickoff_time` is stored in
 *  and every other timestamp this function renders (the deadline reminder)
 *  already uses `toUTCString()` rather than converting to a guessed zone. */
function formatKickoff(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const time = d
    .toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "UTC" })
    .toLowerCase();
  return `${day}${suffix} ${month} ${time}`;
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
      return `📰 ${name}${club}: ${detail.new ?? ""}`.trim();
    case "price": {
      const oldP = Number(detail.old ?? 0) / 10;
      const newP = Number(detail.new ?? 0) / 10;
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

  // Which match a reschedule belongs to — a bare fixture id says nothing on
  // its own. Same two-step join squadCodesFor uses: fixtures for the two team
  // ids, then teams for their short names, rather than a nested embed whose
  // FK constraint name would have to be guessed.
  const fixtureLabelOf = new Map<number, string>();
  const fixtureIds = [...new Set((fixtureChanges ?? []).map((f: { fixture_id: number }) => f.fixture_id))];
  if (fixtureIds.length > 0) {
    const { data: fxRows } = await db
      .from("fixtures")
      .select("id, team_h, team_a")
      .eq("season", season)
      .in("id", fixtureIds);
    const teamIds = [...new Set((fxRows ?? []).flatMap((r: { team_h: number; team_a: number }) => [r.team_h, r.team_a]))];
    const { data: teamRows } = await db
      .from("teams")
      .select("id, short_name")
      .eq("season", season)
      .in("id", teamIds);
    const shortOf = new Map<number, string>(
      (teamRows ?? []).map((t: { id: number; short_name: string }) => [t.id, t.short_name]),
    );
    for (const r of fxRows ?? []) {
      const row = r as { id: number; team_h: number; team_a: number };
      fixtureLabelOf.set(row.id, `${shortOf.get(row.team_h) ?? "?"} vs ${shortOf.get(row.team_a) ?? "?"}`);
    }
  }

  // Loaded once per invocation, not per user — the same flat threshold for
  // everyone, same as the watchlist it's borrowed from.
  const priceWatchThresholdValue = prefs.some((p) => p.notify_price_watch)
    ? await priceWatchThreshold(db, season)
    : 0;

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
    const needsSquadOrShortlist = needsSquad || p.notify_price_watch;

    let squadCodes: Set<number> | null = null;
    if (needsSquadOrShortlist) {
      const { data: profile } = await db
        .from("user_profiles")
        .select("entry_id")
        .eq("user_id", p.user_id)
        .maybeSingle();

      // No claimed entry means no squad to filter against. Sending every
      // player's news instead would be the wrong kind of helpful.
      squadCodes = profile?.entry_id
        ? await squadCodesFor(db, season, profile.entry_id as number)
        : new Set<number>();
    }

    if (needsSquad && (changes?.length ?? 0) > 0) {
      for (const c of changes ?? []) {
        // change_feed reports price moves as 'price_rise'/'price_fall' (the
        // direction is the fact), but prefs and the outbox's own check
        // constraint only know a single 'price' kind — normalise before
        // either lookup, or every price change is silently unwanted.
        const rawKind = c.kind as string;
        const kind = rawKind === "price_rise" || rawKind === "price_fall" ? "price" : rawKind;
        if (!wants[kind]) continue;
        if (c.player_code === null || !squadCodes!.has(c.player_code as number)) continue;
        const body = renderChange({ ...c, kind });
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

    // ---- price watch: squad + shortlist, net transfers past the flat
    // threshold since the last price change (see priceWatchAlerts above). ----
    if (p.notify_price_watch) {
      const shortlistCodes = await shortlistCodesFor(db, season, p.user_id);
      const watchCodes = new Set<number>([...(squadCodes ?? []), ...shortlistCodes]);
      const alerts = await priceWatchAlerts(db, season, watchCodes, priceWatchThresholdValue);

      if (alerts.length > 0) {
        // Two-step join, not a nested embed — same reasoning as
        // `fixtureLabelOf` above: an embed's FK constraint name would have
        // to be guessed, and a wrong guess fails at query time, not review
        // time.
        const { data: playerRows } = await db
          .from("players")
          .select("code, web_name, team_id")
          .eq("season", season)
          .in("code", alerts.map((a) => a.code));
        const teamIds = [...new Set((playerRows ?? []).map((r: { team_id: number }) => r.team_id))];
        const { data: teamRows } = await db
          .from("teams")
          .select("id, short_name")
          .eq("season", season)
          .in("id", teamIds);
        const shortOf = new Map<number, string>(
          (teamRows ?? []).map((t: { id: number; short_name: string }) => [t.id, t.short_name]),
        );
        const nameOf = new Map<number, { name: string; club: string | null }>(
          (playerRows ?? []).map((r: { code: number; web_name: string; team_id: number }) => [
            r.code,
            { name: r.web_name, club: shortOf.get(r.team_id) ?? null },
          ]),
        );

        for (const a of alerts) {
          const info = nameOf.get(a.code);
          const name = info?.name ?? "A player";
          const club = info?.club ? ` (${info.club})` : "";
          const arrow = a.direction === "rise" ? "📈" : "📉";
          rows.push({
            user_id: p.user_id,
            kind: "price_watch",
            // One alert per anchor period — the net-transfer count keeps
            // growing every run, so keying on it would re-fire constantly.
            dedupe_key: `price_watch:${a.code}:${a.anchorAt}`,
            body: `${arrow} ${name}${club} has crossed the watch threshold for a ${a.direction} (net ${a.netTransfers > 0 ? "+" : ""}${a.netTransfers.toLocaleString()} since its last price change). Not a prediction of tonight — see the Price watch card for the full reading.`,
            payload: { player_code: a.code, direction: a.direction, net_transfers: a.netTransfers },
          });
        }
      }
    }

    if (p.notify_fixture) {
      for (const f of fixtureChanges ?? []) {
        const match = fixtureLabelOf.get(f.fixture_id as number) ?? "?";
        // Only two `field` values are ever written (sync-fixtures.ts's
        // TRACKED): 'kickoff_time' (an ISO timestamp) and 'event' (a
        // gameweek number). Report the one that actually changed rather than
        // a generic old→new that means nothing without knowing which field it is.
        const changeText =
          f.field === "kickoff_time"
            ? `New kickoff time/match date: ${formatKickoff(f.new_value as string)}.`
            : `Moved to Gameweek ${f.new_value}.`;
        rows.push({
          user_id: p.user_id,
          kind: "fixture",
          dedupe_key: `fixture:${f.id}`,
          body: `🗓️ Fixture ${f.fixture_id} (${match}) Changed. ${changeText}`,
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
        "user_id, telegram_chat_id, notify_deadline, notify_status, notify_news, notify_price, notify_fixture, notify_price_watch, deadline_hours_before",
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
