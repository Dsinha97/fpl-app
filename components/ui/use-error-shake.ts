"use client";

import { useEffect, useRef } from "react";

/**
 * Shake an element when a form rejects what was typed into it.
 *
 * The app's forms report failure with a red panel *below* the control — fine
 * when you are looking at it, invisible when the control is what you are
 * looking at and the message lands off the fold (the /settings import textarea
 * is six rows tall, so its error was regularly below the viewport). The shake
 * is the part of the feedback that happens where the eye already is.
 *
 * Pass the error itself, not a boolean: the effect keys off the value, so the
 * *same* message arriving twice still shakes. That is the point — a second
 * failed submit with an identical error is exactly the case where a static
 * panel looks like nothing happened. Restarting a running CSS animation needs
 * the class dropped, a reflow forced, and the class re-added; that is what the
 * `offsetWidth` read is for, and why this is not a `className` toggle in JSX.
 *
 * Honours `prefers-reduced-motion` through the stylesheet, not here, so the
 * class stays a truthful record of "this errored" either way.
 */
export function useErrorShake<T extends HTMLElement>(error: unknown) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !error) return;
    el.classList.remove("t-shake");
    void el.offsetWidth;
    el.classList.add("t-shake");
    const done = () => el.classList.remove("t-shake");
    el.addEventListener("animationend", done, { once: true });
    return () => el.removeEventListener("animationend", done);
  }, [error]);

  return ref;
}
