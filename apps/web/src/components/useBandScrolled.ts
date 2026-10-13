"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether page content has scrolled under the sticky timer band (owner design C1, 13 Oct 2026):
 * the content that follows the band normally starts at the band's bottom edge, and only once it
 * has moved above that edge is anything behind the band. Before the band sticks (a phone's top
 * bar scrolling away first) both move together, so nothing is under it yet. Half a pixel of
 * tolerance absorbs sub-pixel layout.
 */
export function isContentUnderBand(bandBottom: number, contentTop: number) {
  return contentTop < bandBottom - 0.5;
}

/**
 * Tracks `isContentUnderBand` for a sticky band and the element after it. It listens to scrolls
 * anywhere (capture) and resizes, measures at most once per frame, and only re-renders when the
 * answer changes. Before the first measurement (server render, hydration) it is false, so the
 * hairline never lands on load or refresh unless the page really is scrolled. `remeasureKey` (the
 * route) re-measures when the page under the band changes.
 */
export function useBandScrolled(
  bandRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  remeasureKey?: string
) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    let pending = false;
    function measure() {
      const band = bandRef.current;
      const content = contentRef.current;
      if (!band || !content) return;
      const next = isContentUnderBand(band.getBoundingClientRect().bottom, content.getBoundingClientRect().top);
      setScrolled((current) => (current === next ? current : next));
    }
    function schedule() {
      if (pending) return;
      pending = true;
      frame = window.requestAnimationFrame(() => {
        pending = false;
        measure();
      });
    }
    measure();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (pending) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [bandRef, contentRef, remeasureKey]);

  return scrolled;
}
