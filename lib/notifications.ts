// Sprint 36 (DSI-65) — the browser side of notifications.
//
// Reads and writes `user_notification_prefs` and mints `telegram_link_codes`.
// Everything here runs under the signed-in user's own RLS, so there is no Edge
// Function in this path at all: minting a code is an insert into a table whose
// policy is `auth.uid() = user_id`, and the webhook (service role) is what
// redeems it.
//
// The linking flow is deliberately code-first rather than chat-id-first. A
// Telegram chat id is not knowable until the chat has spoken, so the
// alternative is asking the owner to find their numeric id through some
// third-party bot and paste it into a form — which makes the user do the
// protocol's work, and is exactly the kind of instruction that ends with a
// stranger's chat id pasted in by mistake.

import { supabase } from "./supabase/client";

/** How long a minted code stays good. Short: it is a bearer token for the
 *  chat-link, and the flow it serves takes seconds. */
export const LINK_CODE_TTL_MINUTES = 10;

/** Unambiguous alphabet — no O/0, I/1 — because this gets read off a screen
 *  and typed into a phone. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export type NotifyKind = "deadline" | "status" | "news" | "price" | "fixture";

export const NOTIFY_KINDS: Array<{ kind: NotifyKind; label: string; help: string }> = [
  { kind: "deadline", label: "Deadline reminder", help: "Once per gameweek, before it locks." },
  { kind: "status", label: "Injury & availability", help: "Only for players in your squad." },
  { kind: "news", label: "Team news", help: "Only for players in your squad." },
  { kind: "price", label: "Price changes", help: "Only for players in your squad." },
  { kind: "fixture", label: "Fixture changes", help: "Reschedules, for every club." },
];

export interface NotificationPrefs {
  telegramChatId: number | null;
  enabled: Record<NotifyKind, boolean>;
  deadlineHoursBefore: number;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  telegramChatId: null,
  // Everything off. A notifier that starts sending the moment a chat is linked
  // is a notifier people mute, and a muted channel is worse than no channel —
  // it looks like it is working.
  enabled: { deadline: false, status: false, news: false, price: false, fixture: false },
  deadlineHoursBefore: 4,
};

export async function loadNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from("user_notification_prefs")
    .select(
      "telegram_chat_id, notify_deadline, notify_status, notify_news, notify_price, notify_fixture, deadline_hours_before",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_PREFS;

  return {
    telegramChatId: (data.telegram_chat_id as number | null) ?? null,
    enabled: {
      deadline: Boolean(data.notify_deadline),
      status: Boolean(data.notify_status),
      news: Boolean(data.notify_news),
      price: Boolean(data.notify_price),
      fixture: Boolean(data.notify_fixture),
    },
    deadlineHoursBefore: (data.deadline_hours_before as number) ?? DEFAULT_PREFS.deadlineHoursBefore,
  };
}

/**
 * Writes the switches only.
 *
 * `telegram_chat_id` is deliberately not writable from here: it is the inbound
 * allowlist the webhook authorises against, and it is set by redeeming a link
 * code, never by typing a number into a form. A form that accepted a chat id
 * would let anyone point their account at someone else's chat.
 */
export async function saveNotificationPrefs(
  userId: string,
  prefs: Pick<NotificationPrefs, "enabled" | "deadlineHoursBefore">,
): Promise<void> {
  const { error } = await supabase.from("user_notification_prefs").upsert(
    {
      user_id: userId,
      notify_deadline: prefs.enabled.deadline,
      notify_status: prefs.enabled.status,
      notify_news: prefs.enabled.news,
      notify_price: prefs.enabled.price,
      notify_fixture: prefs.enabled.fixture,
      deadline_hours_before: prefs.deadlineHoursBefore,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

export interface LinkCode {
  code: string;
  expiresAt: string;
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Mints a fresh single-use code for this user. */
export async function mintLinkCode(userId: string): Promise<LinkCode> {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60_000).toISOString();
  const { error } = await supabase
    .from("telegram_link_codes")
    .insert({ code, user_id: userId, expires_at: expiresAt });
  if (error) throw new Error(error.message);
  return { code, expiresAt };
}

/**
 * Unlinks this chat.
 *
 * Clears the address rather than deleting the row, so the switches survive a
 * relink — someone who unlinks to change phones should not also lose which
 * alerts they had chosen.
 */
export async function unlinkTelegram(userId: string): Promise<void> {
  const { error } = await supabase
    .from("user_notification_prefs")
    .update({ telegram_chat_id: null })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
