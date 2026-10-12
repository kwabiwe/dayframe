"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion, springTransition } from "@/lib/blocks-motion";

/** How the sign-in card moves (motion.md › Web sign-in card). */
export const AUTH_CARD_MOTION = { enterMs: 180, enterRisePx: 6, reducedFadeMs: 90 } as const;

/** Set once a card has been shown in this page session: later cards come from client navigation. */
let authCardShown = false;

/**
 * The one motion owner for the sign-in card (Log in, Create account, Reset password, the reset
 * page). It is the card itself (surface, radius, shadow, width) and stays mounted while the view
 * inside changes, so:
 * - any change of the card's height (another view, an error or notice line, the form giving way
 *   to the outcome) resizes it smoothly from the height it has now, also mid-resize;
 * - a new view (`view` changes) fades in with a small rise, and so does a card reached by moving
 *   between Log in and Create account (separate pages); the first card of a page load does not.
 * Reduce Motion: no resize or rise, the new view fades in briefly. Focus is left to the views.
 */
export function AuthCardMotion({ children, view }: { children: ReactNode; view: string }) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const heightRef = useRef<number | null>(null);
  const resizeRef = useRef<Animation | null>(null);
  const enterRef = useRef<Animation | null>(null);
  const viewRef = useRef(view);

  // Height: follow the content's natural height and resize from wherever the card is now.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = inner.getBoundingClientRect().height;
      const last = heightRef.current;
      heightRef.current = next;
      if (last === null || Math.abs(last - next) < 0.5 || typeof outer.animate !== "function") return;
      const from = resizeRef.current ? outer.getBoundingClientRect().height : last;
      resizeRef.current?.cancel();
      resizeRef.current = null;
      if (prefersReducedMotion()) return;
      const { durationMs, easing } = springTransition("sheet");
      const animation = outer.animate(
        [{ height: `${from}px`, overflow: "hidden" }, { height: `${next}px`, overflow: "hidden" }],
        { duration: durationMs, easing }
      );
      resizeRef.current = animation;
      animation.onfinish = () => {
        if (resizeRef.current === animation) resizeRef.current = null;
      };
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
      resizeRef.current?.cancel();
      resizeRef.current = null;
    };
  }, []);

  // A new view fades in (and rises, unless Reduce Motion); a newer view restarts it.
  const enter = useCallback(() => {
    const inner = innerRef.current;
    if (!inner || typeof inner.animate !== "function") return;
    enterRef.current?.cancel();
    const reduced = prefersReducedMotion();
    enterRef.current = inner.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: `translateY(${AUTH_CARD_MOTION.enterRisePx}px)` }, { opacity: 1, transform: "none" }],
      { duration: reduced ? AUTH_CARD_MOTION.reducedFadeMs : AUTH_CARD_MOTION.enterMs, easing: "ease-out" }
    );
  }, []);

  useLayoutEffect(() => {
    if (viewRef.current === view) return;
    viewRef.current = view;
    enter();
  }, [enter, view]);

  // A card reached by client navigation (Log in ↔ Create account) enters like a new view.
  useLayoutEffect(() => {
    if (authCardShown) enter();
    authCardShown = true;
    return () => enterRef.current?.cancel();
  }, [enter]);

  return (
    <div className="auth-card mx-auto w-full max-w-[440px]" ref={outerRef}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

export function __resetAuthCardShownForTests() {
  authCardShown = false;
}
