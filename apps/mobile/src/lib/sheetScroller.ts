/**
 * Moves a sheet's own scroll, animated unless Reduce Motion: a view to the top (with room added below it when the content
 * is too short to get there), a whole view into sight above the footer, or back to the top. Going back cancels any reveal
 * still waiting for a frame or a measurement.
 */
export type SheetScroller = {
  reveal: (view: SheetScrollerView | null, mode: "top" | "whole") => void;
  top: () => void;
  dispose: () => void;
};

export type SheetScrollerView = {
  measureLayout: (relativeTo: never, onSuccess: (x: number, y: number, width: number, height: number) => void, onFail: () => void) => void;
};

export type SheetScrollMetrics = { offset: number; viewport: number; content: number };

export function createSheetScroller({ afterScrollBackMs, inner, metrics, nextFrame, reduceMotion, room, scrollTo }: {
  afterScrollBackMs: number;
  /** What a view measures against; null once the scroll view has gone. */
  inner: () => unknown;
  metrics: SheetScrollMetrics;
  nextFrame: (run: () => void) => void;
  reduceMotion: boolean;
  /** Sets the room added below the content. */
  room: (height: number) => void;
  scrollTo: (y: number, animated: boolean) => void;
}): SheetScroller {
  let added = 0;
  let generation = 0;
  let clearing: ReturnType<typeof setTimeout> | null = null;
  const setRoom = (height: number) => {
    added = height;
    room(height);
  };
  const stopClearing = () => {
    if (clearing) clearTimeout(clearing);
    clearing = null;
  };
  const go = (y: number, extra = 0) => scrollTo(Math.max(0, Math.min(y, metrics.content + extra - metrics.viewport)), !reduceMotion);
  return {
    // After a frame: the sheet's new height and the view's own layout are in by then.
    reveal: (view, mode) => {
      const asked = ++generation;
      nextFrame(() => {
        const relativeTo = inner();
        if (asked !== generation || !view || !relativeTo) return;
        view.measureLayout(relativeTo as never, (_x, y, _width, height) => {
          if (asked !== generation) return;
          if (mode === "whole") {
            if (y + height > metrics.offset + metrics.viewport) go(Math.min(y, y + height - metrics.viewport));
            else if (y < metrics.offset) go(y);
            return;
          }
          stopClearing();
          const own = metrics.content - added;
          // Only a sheet that already scrolls: a shorter one shows it all.
          const needed = own > metrics.viewport ? Math.max(0, y - (own - metrics.viewport)) : 0;
          const growth = Math.max(0, needed - added);
          setRoom(needed);
          // The room is laid out by the next frame.
          nextFrame(() => {
            if (asked === generation) go(y, growth);
          });
        }, () => undefined);
      });
    },
    top: () => {
      generation += 1;
      stopClearing();
      go(0);
      // The added room goes once the scroll back has run.
      if (reduceMotion) setRoom(0);
      else clearing = setTimeout(() => setRoom(0), afterScrollBackMs);
    },
    dispose: () => {
      generation += 1;
      stopClearing();
    }
  };
}
