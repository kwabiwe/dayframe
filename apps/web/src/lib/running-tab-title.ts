import { useEffect, useRef } from "react";
import { formatClockDuration } from "@/lib/format";

/** #261 (owner, 27 Oct 2026): while a timer runs, the tab title is its running time only, "0:23:15 · Dayframe". */
export function runningTabTitle(elapsedSeconds: number) {
  return `${formatClockDuration(elapsedSeconds)} · Dayframe`;
}

/**
 * Shows `title` as the browser tab's title while it is set, then puts back the page's own title.
 * One string write per change: the caller's own once-a-second clock drives it, so there is no second
 * timer. It keeps updating while the tab is hidden, because a background tab's title is exactly where
 * it is read; browsers already slow hidden tabs' timers to at most once a second.
 *
 * The page may set its own title meanwhile (a client navigation's metadata): that becomes the title to
 * restore, and on stop or unmount the title is put back only while it is still the one written here.
 */
export function useRunningTabTitle(title: string | null) {
  const ownedRef = useRef<{ page: string; written: string } | null>(null);
  useEffect(() => {
    const owned = ownedRef.current;
    if (title === null) {
      if (owned && document.title === owned.written) document.title = owned.page;
      ownedRef.current = null;
      return;
    }
    // A title someone else set since the last write is the page's newer own title.
    const page = owned && document.title === owned.written ? owned.page : document.title;
    if (document.title !== title) document.title = title;
    ownedRef.current = { page, written: title };
  }, [title]);
  useEffect(() => () => {
    const owned = ownedRef.current;
    if (owned && document.title === owned.written) document.title = owned.page;
    ownedRef.current = null;
  }, []);
}
