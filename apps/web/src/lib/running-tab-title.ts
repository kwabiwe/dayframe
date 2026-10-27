import { useEffect, useRef } from "react";
import { formatClockDuration } from "@/lib/format";

/** #261 (owner, 27 Oct 2026): while a timer runs, the tab title is its running time only, "0:23:15 · Dayframe". */
export function runningTabTitle(elapsedSeconds: number) {
  return `${formatClockDuration(elapsedSeconds)} · Dayframe`;
}

/**
 * Shows `title` as the browser tab's title while it is set, then puts back the title the page had.
 * One string write per change: the caller's own once-a-second clock drives it, so there is no second
 * timer. It keeps updating while the tab is hidden, because a background tab's title is exactly where
 * it is read; browsers already slow hidden tabs' timers to at most once a second.
 */
export function useRunningTabTitle(title: string | null) {
  const pageTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (title === null) {
      if (pageTitleRef.current !== null) document.title = pageTitleRef.current;
      pageTitleRef.current = null;
      return;
    }
    if (pageTitleRef.current === null) pageTitleRef.current = document.title;
    if (document.title !== title) document.title = title;
  }, [title]);
  useEffect(() => () => {
    if (pageTitleRef.current !== null) document.title = pageTitleRef.current;
  }, []);
}
