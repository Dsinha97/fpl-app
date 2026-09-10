"use client";

import { useCallback, useEffect, useState } from "react";
import {
  botLinkUrl,
  DEFAULT_PREFS,
  LINK_CODE_TTL_MINUTES,
  NOTIFY_KINDS,
  loadNotificationPrefs,
  mintLinkCode,
  saveNotificationPrefs,
  unlinkTelegram,
  type LinkCode,
  type NotificationPrefs,
  type NotifyKind,
} from "@/lib/notifications";
import { useAuth } from "@/components/auth-provider";

/**
 * The Telegram link control, in two sizes.
 *
 * One component mounted twice rather than two implementations: `/team` is
 * where the owner actually is, so the button belongs there, and `/settings`
 * is where the switches belong. Two copies of "am I linked?" would be the same
 * mistake as two scorers.
 *
 *   compact  the link state and its button. `/team`.
 *   full     the same, plus the per-alert switches. `/settings`.
 */
export function TelegramLink({ variant = "full" }: { variant?: "compact" | "full" }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [code, setCode] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await loadNotificationPrefs(userId);
        if (!cancelled) setPrefs(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const generate = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      setCode(await mintLinkCode(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [userId]);

  const unlink = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await unlinkTelegram(userId);
      setPrefs((p) => (p ? { ...p, telegramChatId: null } : p));
      setCode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [userId]);

  const toggle = useCallback(
    async (kind: NotifyKind) => {
      if (!userId || !prefs) return;
      const next: NotificationPrefs = {
        ...prefs,
        enabled: { ...prefs.enabled, [kind]: !prefs.enabled[kind] },
      };
      setPrefs(next);
      setSaved(false);
      try {
        await saveNotificationPrefs(userId, next);
        setSaved(true);
      } catch (err) {
        // Put the switch back rather than leaving the UI claiming a state the
        // database does not hold.
        setPrefs(prefs);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [userId, prefs],
  );

  // Signed out, the compact variant renders nothing at all. It sits in /team's
  // header row next to Import, and a sentence about signing in is not a header
  // action — it would be a paragraph wedged between two buttons. The full
  // variant is inside a settings panel, where the prompt reads correctly.
  if (!userId) {
    if (variant === "compact") return null;
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Sign in to send FPL alerts to Telegram.
      </p>
    );
  }

  const linked = (prefs ?? DEFAULT_PREFS).telegramChatId !== null;

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {linked ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-primary">
              <span aria-hidden>●</span> Telegram linked
            </span>
            <button
              type="button"
              onClick={() => void unlink()}
              disabled={busy}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
            >
              Unlink
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
          >
            {busy ? "Generating…" : code ? "New code" : "Link Telegram →"}
          </button>
        )}
      </div>

      {!linked && code && (
        <div className="mt-2 max-w-xs rounded-md border border-zinc-200 bg-zinc-50 p-2.5 text-xs dark:border-purple-900/40 dark:bg-purple-950/40">
          {/* One tap on the phone, and the code travels with the link — Telegram
              turns ?start=CODE into a /start CODE message the bot treats as a
              link attempt. The manual form stays visible underneath because a
              deep link fails silently with no Telegram installed, and opens the
              wrong account for anyone signed into two. */}
          <a
            href={botLinkUrl(code.code)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-950 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-emerald-950/60 dark:text-primary dark:ring-1 dark:ring-primary/40 dark:hover:bg-emerald-950"
          >
            Open Telegram and link →
          </a>
          <p className="mt-2 text-zinc-700 dark:text-zinc-300">
            Or send it by hand:{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-zinc-900 dark:bg-input dark:text-zinc-100">
              /link {code.code}
            </code>
          </p>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
            Single use, valid for {LINK_CODE_TTL_MINUTES} minutes (until{" "}
            {new Date(code.expiresAt).toLocaleTimeString()}). The chat that sends it becomes the
            one that receives your alerts.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}

      {variant === "full" && (
        <div className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            What to send
          </h3>
          {!linked && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              These take effect once a chat is linked — nothing is sent before then.
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {NOTIFY_KINDS.map(({ kind, label, help }) => (
              <li key={kind} className="flex items-start gap-2">
                <input
                  id={`notify-${kind}`}
                  type="checkbox"
                  checked={(prefs ?? DEFAULT_PREFS).enabled[kind]}
                  onChange={() => void toggle(kind)}
                  className="mt-0.5 h-4 w-4 accent-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:accent-primary"
                />
                <label htmlFor={`notify-${kind}`} className="text-xs">
                  <span className="text-zinc-800 dark:text-zinc-200">{label}</span>{" "}
                  <span className="text-zinc-500 dark:text-zinc-400">— {help}</span>
                </label>
              </li>
            ))}
          </ul>
          {saved && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Saved.</p>
          )}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            The bot answers <code className="font-mono">/team</code>,{" "}
            <code className="font-mono">/points</code>,{" "}
            <code className="font-mono">/fixtures</code> and{" "}
            <code className="font-mono">/leagues</code> — what already happened. Projections,
            transfer suggestions and chip advice stay on the site, so there is only ever one
            implementation of them.
          </p>
        </div>
      )}
    </div>
  );
}
