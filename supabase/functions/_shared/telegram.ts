// Telegram plumbing shared by `notify` (outbound) and `telegram-webhook`
// (inbound). Sprint 36, DSI-65.
//
// WHERE THE SECRETS LIVE. In Vault, reached through two `public` RPCs the
// migration defines, for the reason Sprint 32 established: PostgREST serves
// only `public` and `graphql_public`, so an Edge Function cannot read the
// `vault` schema directly whatever its service role's privileges say. There is
// deliberately no `TELEGRAM_BOT_TOKEN` function env var — that would put the
// plaintext in a second place that has to match the first by hand, which is a
// silent failure waiting on a typo (CLAUDE.md: secrets are referenced by name).
//
// The two accessors are different shapes on purpose. The bot token is needed as
// a *value*, because it goes in the URL of a call to Telegram. The webhook
// secret is only ever *compared*, so it never leaves Postgres — Postgres
// answers a yes/no question instead.

// deno-lint-ignore no-explicit-any
type Db = any;

const API = "https://api.telegram.org";

/** The bot token, or null when the Vault secret has not been created yet. */
export async function telegramBotToken(db: Db): Promise<string | null> {
  const { data, error } = await db.rpc("telegram_secret", { p_name: "telegram_bot_token" });
  if (error) {
    console.error(`telegram_secret failed: ${error.message}`);
    return null;
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * Whether the caller presented the webhook secret Telegram was configured with.
 *
 * `setWebhook` accepts a `secret_token`, and Telegram then sends it back on
 * every delivery as `X-Telegram-Bot-Api-Secret-Token`. That header is the whole
 * authentication story for the inbound function — the endpoint is necessarily
 * reachable without a JWT, because Telegram has none to send.
 *
 * **Fails closed** on a missing secret, an RPC error, or an absent header. A
 * webhook that accepted anything while the secret was unset would be an open
 * endpoint that reads squads.
 */
export async function verifyTelegramWebhook(req: Request, db: Db): Promise<boolean> {
  const supplied = req.headers.get("x-telegram-bot-api-secret-token");
  if (!supplied) return false;
  const { data, error } = await db.rpc("verify_telegram_webhook_secret", { p_secret: supplied });
  if (error) {
    console.error(`verify_telegram_webhook_secret failed: ${error.message}`);
    return false;
  }
  return data === true;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * One `sendMessage` call.
 *
 * Never throws: the caller is a batch loop, and one chat blocking the bot must
 * not stop everyone else's alerts. The failure comes back as a value to be
 * recorded on the outbox row.
 */
export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<SendResult> {
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        // No parse_mode. Player news and team names are arbitrary text from
        // FPL, and Markdown/HTML parsing would make an unescaped underscore or
        // angle bracket a delivery failure rather than a cosmetic one.
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `telegram ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
