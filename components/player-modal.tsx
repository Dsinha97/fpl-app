"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SlideOver } from "@/components/ui/slide-over";
import { useMinWidth, SM } from "@/components/ui/use-viewport";
import { PlayerIdentityHeader, POSITION_NAME } from "@/components/player-identity";
import type { PlayerData } from "@/components/player-card";
import type { PositionRanks } from "@/lib/player-ranks";
import type { PriceProgress } from "@/lib/price-watch";
import { useAuth } from "@/components/auth-provider";
import { addToShortlist, loadShortlist, removeFromShortlist } from "@/lib/shortlist";
import { OverviewTab } from "@/components/player-modal/overview-tab";
import { GameweeksTab } from "@/components/player-modal/gameweeks-tab";
import { HistoryTab } from "@/components/player-modal/history-tab";

/**
 * The full player profile: three tabs over everything the app knows about one
 * player.
 *
 * Deliberately NOT a replacement for `PlayerDetail`. That is a 320px popover
 * anchored to a pitch card, it never fetches, and it exists for the
 * high-frequency taps — set captain, check the next fixture — that happen
 * dozens of times in a /builder session. Folding four queries behind every
 * one of those taps would be a regression. The popover instead links here.
 *
 * Unlike the popover, this fetches: a per-gameweek history, a season history
 * and a price history are not things a squad page has any reason to have
 * loaded. Each tab loads its own data the first time it is opened, so the
 * cost of opening the card is one query rather than four, and the loaders
 * memoise so tab-switching and reopening are free (lib/player-profile.ts).
 */

export type ProfileTab = "overview" | "gameweeks" | "history";

const TABS = [
  { value: "overview" as const, label: "Overview" },
  { value: "gameweeks" as const, label: "Gameweeks" },
  { value: "history" as const, label: "History" },
];

export interface PlayerModalProps {
  player: PlayerData;
  season: string;
  /** Opponent short names for the gameweek table, keyed by FPL team id. */
  teamShortById: Map<number, string>;
  /** The gameweek in flight, for the TRANSFERS block. */
  currentEvent: number | null;
  /**
   * Position cohorts for the rank captions. Optional by design: pages holding
   * the player pool build it with `buildPositionRanks`; pages without one can
   * pass nothing and the captions are simply absent (never a dash).
   */
  ranks?: PositionRanks;
  /** Price-outlook reading, if the caller already loaded one. */
  priceProgress?: PriceProgress;
  onClose: () => void;

  // --- Zone 1: at most one accent action, whichever the context calls for.
  onAdd?: () => void;
  addLabel?: string;
  addDisabledReason?: string | null;
  onCompare?: () => void;
  compareLabel?: string;

  // --- Zone 2: contextual squad actions. Each renders only if handed a
  // handler — PlayerDetail's existing convention, not a new prop vocabulary.
  onSetCaptain?: () => void;
  onSetVice?: () => void;
  onRemove?: () => void;
  onFindReplacement?: () => void;
}

export function PlayerModal(props: PlayerModalProps) {
  const { player, onClose } = props;
  const isDesktop = useMinWidth(SM);
  const [tab, setTab] = useState<ProfileTab>("overview");

  const label = `${player.web_name} — full profile`;

  const body = <ProfileBody {...props} tab={tab} setTab={setTab} />;

  // Below `sm` this is a different surface, not the same one restyled: a
  // full-height sheet rising from the thumb zone rather than a centred box
  // with nowhere to go. `SlideOver` already owns dismissal, the scroll lock
  // and the safe-area padding.
  if (!isDesktop) {
    return (
      <SlideOver open onClose={onClose} side="bottom" fullHeight label={label}>
        {body}
      </SlideOver>
    );
  }

  return <DesktopDialog label={label} onClose={onClose}>{body}</DesktopDialog>;
}

/**
 * The desktop surface: a centred dialog over a backdrop.
 *
 * Focus is trapped while open and restored to whatever opened it on close —
 * without that, dismissing the modal drops focus to `<body>` and a keyboard
 * user is returned to the top of a long table instead of the row they were on.
 */
function DesktopDialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    panel.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const root = panel.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 motion-safe:[animation:fade-in_var(--duration-fast)_var(--ease-slide)]"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          // Enters from scale(.97), never from scale(0) — a panel that grows
          // from nothing reads as an animation rather than as a thing
          // arriving. `center` origin because a modal has no anchor to grow
          // from. No fill-mode, for the reason SlideOver documents: an
          // animation that never runs must leave a usable resting state.
          className="pointer-events-auto flex max-h-[min(88vh,52rem)] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-purple-800/50 dark:bg-surface-3 motion-safe:[animation:modal-pop_var(--duration-base)_var(--ease-slide)]"
        >
          {children}
        </div>
      </div>
    </>
  );
}

function ProfileBody({
  player,
  season,
  teamShortById,
  currentEvent,
  ranks,
  priceProgress,
  onClose,
  onAdd,
  addLabel = "Add to squad",
  addDisabledReason,
  onCompare,
  compareLabel = "Add to compare",
  onSetCaptain,
  onSetVice,
  onRemove,
  onFindReplacement,
  tab,
  setTab,
}: PlayerModalProps & { tab: ProfileTab; setTab: (t: ProfileTab) => void }) {
  const positionShort = POSITION_NAME[player.element_type] ?? "—";

  // The shortlist is owned here rather than passed in, so the control behaves
  // identically from every page instead of existing only where a caller
  // remembered to wire it.
  const { user } = useAuth();
  const code = player.code ?? null;
  const [loadedShortlisted, setLoadedShortlisted] = useState<boolean | null>(null);
  const [shortlistBusy, setShortlistBusy] = useState(false);

  // Derived, not stored: with no session and no player code there is nothing
  // to fetch, so this resolves rather than writing state inside an effect.
  const shortlisted = !user || code === null ? null : loadedShortlisted;

  useEffect(() => {
    if (!user || code === null) return;
    let live = true;
    loadShortlist(season)
      .then((m) => live && setLoadedShortlisted(m.has(code)))
      .catch(() => live && setLoadedShortlisted(null));
    return () => {
      live = false;
    };
  }, [user, season, code]);

  const toggleShortlist = async () => {
    if (code === null || shortlisted === null || shortlistBusy) return;
    setShortlistBusy(true);
    // Optimistic, then reconciled — a star that waits on a round trip before
    // acknowledging a tap feels broken.
    const next = !shortlisted;
    setLoadedShortlisted(next);
    try {
      if (next) await addToShortlist(season, code);
      else await removeFromShortlist(season, code);
    } catch {
      setLoadedShortlisted(!next);
    } finally {
      setShortlistBusy(false);
    }
  };

  // Zone 1 holds exactly one accent action. Two stacked neon buttons mean
  // neither reads as the primary one (DSI-129 reserves --primary for actions
  // and winners), so "Add to squad" wins where a squad context exists and
  // "Add to compare" takes the slot where it doesn't.
  const primary = onAdd
    ? { label: addLabel, run: onAdd, disabledReason: addDisabledReason ?? null }
    : onCompare
      ? { label: compareLabel, run: onCompare, disabledReason: null }
      : null;

  const secondaryCompare = onAdd && onCompare ? onCompare : null;

  const hasSquadActions = Boolean(onSetCaptain || onSetVice || onRemove || onFindReplacement);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Header — sticky so the player's name stays visible while scrolling */}
      <div className="flex min-w-0 items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-purple-900/60">
        <PlayerIdentityHeader player={player} size={56} className="flex-1" />
        <Button
          type="button"
          onClick={onClose}
          aria-label="Close"
          variant="ghost"
          size="icon-sm"
          // 44px is the minimum comfortable touch target; the glyph is
          // smaller than its hit area on purpose.
          className="-mr-1 shrink-0 [touch-action:manipulation] [user-select:none]"
        >
          ×
        </Button>
      </div>

      {/* Actions */}
      {(primary || secondaryCompare || hasSquadActions || code !== null) && (
        <div className="flex min-w-0 flex-col gap-2 border-b border-zinc-200 px-4 py-3 dark:border-purple-900/60">
          {primary && (
            <Button
              type="button"
              onClick={primary.run}
              disabled={Boolean(primary.disabledReason)}
              title={primary.disabledReason ?? undefined}
              className="w-full"
            >
              {primary.label}
            </Button>
          )}
          <div className="flex min-w-0 gap-2">
            {secondaryCompare && (
              <Button type="button" variant="outline" onClick={secondaryCompare} className="min-w-0 flex-1">
                {compareLabel}
              </Button>
            )}
            {code !== null &&
              (user ? (
                <Button
                  type="button"
                  variant={shortlisted ? "secondary" : "outline"}
                  onClick={toggleShortlist}
                  disabled={shortlisted === null || shortlistBusy}
                  aria-pressed={shortlisted === true}
                  className="min-w-0 flex-1"
                >
                  {shortlisted === null
                    ? "Shortlist…"
                    : shortlisted
                      ? "★ On your shortlist"
                      : "☆ Add to shortlist"}
                </Button>
              ) : (
                // Never a silent no-op when signed out — the control says what
                // it needs and goes there.
                <a
                  href="/signin/"
                  className="inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
                >
                  Sign in to shortlist
                </a>
              ))}
          </div>
          {hasSquadActions && (
            <div className="flex min-w-0 flex-wrap gap-2">
              {onSetCaptain && (
                <Button type="button" variant="outline" size="sm" onClick={onSetCaptain}>
                  Set captain
                </Button>
              )}
              {onSetVice && (
                <Button type="button" variant="outline" size="sm" onClick={onSetVice}>
                  Set vice
                </Button>
              )}
              {onFindReplacement && (
                <Button type="button" variant="outline" size="sm" onClick={onFindReplacement}>
                  Replace
                </Button>
              )}
              {onRemove && (
                <Button type="button" variant="outline" size="sm" onClick={onRemove}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="min-w-0 border-b border-zinc-200 px-4 py-2 dark:border-purple-900/60">
        <SegmentedControl
          options={TABS}
          value={tab}
          onValueChange={setTab}
          semantics="tabs"
          size="sm"
          label="Player profile sections"
        />
      </div>

      {/*
        The scroll container. `min-h-0` matters: a flex child defaults to
        min-height:auto and refuses to shrink below its content, so without
        it this never scrolls and the dialog grows past the viewport instead.
      */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {/*
          No enter animation on tab panels. Tab switching is the highest-
          frequency interaction in this card and the data is already memoised,
          so a fade has nothing to mask and charges attention every time. Only
          the SegmentedControl's own indicator moves.
        */}
        {tab === "overview" && (
          <OverviewTab
            player={player}
            season={season}
            currentEvent={currentEvent}
            ranks={ranks}
            positionShort={positionShort}
            priceProgress={priceProgress}
            teamShortById={teamShortById}
          />
        )}
        {tab === "gameweeks" && (
          <GameweeksTab
            player={player}
            season={season}
            teamShortById={teamShortById}
            positionShort={positionShort}
          />
        )}
        {tab === "history" && <HistoryTab player={player} />}
      </div>
    </div>
  );
}

/** Hook form, for pages that want the modal's open/close plumbing. */
export function usePlayerModal<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const open = useCallback((t: T) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  return useMemo(() => ({ target, open, close }), [target, open, close]);
}
