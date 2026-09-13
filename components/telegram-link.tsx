"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { TelegramIcon } from "@/components/icons/telegram";
import { useAnchoredPanel, useDismissablePopover } from "@/components/ui/use-anchored-panel";

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

  const controls = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {linked ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-primary">
              <span aria-hidden>●</span> Telegram linked
            </span>
            <Button
              type="button"
              onClick={() => void unlink()}
              disabled={busy}
              /* Unlink drops the chat-id allowlist row that is the bot's
                 access boundary, and it looked exactly like every neutral
                 button on the page (DSI-128). Danger-toned on hover rather
                 than always-red: it is destructive, not dangerous to sit
                 next to. */
              variant="outline"
              size="xs"
              className="border-zinc-300 px-2.5 text-zinc-700 hover:border-red-500 hover:bg-red-50 hover:text-red-700 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:border-red-500/70 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              Unlink
            </Button>
          </>
        ) : (
          <Button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            variant="outline"
            size="xs"
            className="border-zinc-300 px-2.5 text-zinc-700 hover:bg-zinc-100 dark:border-purple-800/50 dark:text-zinc-300 dark:hover:bg-purple-950/60"
          >
            {busy ? "Generating…" : code ? "New code" : "Link Telegram →"}
          </Button>
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
    </>
  );

  // DSI-141: compact used to contribute a status sentence *and* a button to
  // /team's header row, which is why four actions wrapped raggedly on a phone.
  // One icon carries the state; everything else moves into the panel behind it.
  if (variant === "compact") {
    return (
      <CompactTelegram linked={linked}>
        {/* Linked, the status row inside `controls` already says so. Unlinked,
            a bare "Link Telegram" button never says what the alerts are. */}
        {!linked && (
          <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
            Link a Telegram chat to get deadline, price and availability alerts.
          </p>
        )}
        {controls}
      </CompactTelegram>
    );
  }

  return (
    <div className="text-sm">
      {controls}

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
                <Checkbox
                  id={`notify-${kind}`}
                  checked={(prefs ?? DEFAULT_PREFS).enabled[kind]}
                  onChange={() => void toggle(kind)}
                  className="mt-0.5"
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

/**
 * The `/team` header affordance: one icon button whose colour and accessible
 * name both carry the link state, opening the controls in an anchored panel.
 *
 * Positioning and dismissal come from `useAnchoredPanel` /
 * `useDismissablePopover` — the same pair `TapToReveal` and `FilterDisclosure`
 * use, so there is one implementation of "floating panel that stays on screen".
 */
function CompactTelegram({ linked, children }: { linked: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, coords } = useAnchoredPanel<HTMLButtonElement, HTMLDivElement>(
    open,
    { align: "right" },
  );

  useDismissablePopover(open, () => setOpen(false), [triggerRef, panelRef]);

  return (
    <div className="relative inline-flex">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-expanded={open}
        aria-label={linked ? "Telegram linked — open Telegram settings" : "Telegram not linked — open Telegram settings"}
        title={linked ? "Telegram linked" : "Telegram not linked"}
        onClick={() => setOpen((v) => !v)}
        /* Colour is never the only channel: the aria-label and the title both
           say the state in words, the way the venue rings do. */
        className={linked ? "text-emerald-700 dark:text-primary" : "text-muted-foreground"}
      >
        <TelegramIcon size={16} />
      </Button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Telegram alerts"
          style={coords ? { top: coords.top, left: coords.left } : { top: -9999, left: -9999 }}
          className="fixed z-30 w-[calc(100vw-1rem)] max-w-[20rem] rounded-lg border border-border bg-popover p-3 text-left text-sm text-popover-foreground shadow-lg dark:shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
