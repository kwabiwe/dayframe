import { afterEach, describe, expect, it, vi } from "vitest";
import { createSheetScroller } from "./sheetScroller";

function harness(reduceMotion = false) {
  const frames: Array<() => void> = [];
  const scrolled: number[] = [];
  const rooms: number[] = [];
  const metrics = { offset: 0, viewport: 600, content: 850 };
  const scroller = createSheetScroller({ afterScrollBackMs: 260, inner: () => ({}), metrics, nextFrame: (run) => frames.push(run), reduceMotion,
    room: (height) => rooms.push(height), scrollTo: (y) => scrolled.push(y) });
  const view = { measureLayout: (_to: never, done: (x: number, y: number, width: number, height: number) => void) => done(0, 500, 300, 44) };
  const flush = () => { while (frames.length) frames.shift()!(); };
  return { flush, frames, metrics, rooms, scrolled, scroller, view };
}

afterEach(() => { vi.useRealTimers(); });

describe("the sheet's scroller", () => {
  it("adds the room a short content needs to bring a view to the top", () => {
    const { flush, rooms, scrolled, scroller, view } = harness();
    scroller.reveal(view, "top");
    flush();
    expect(rooms).toEqual([250]);
    expect(scrolled).toEqual([500]);
  });

  it("a close before a reveal has run cancels it and clears the room", () => {
    vi.useFakeTimers();
    const { flush, rooms, scrolled, scroller, view } = harness();
    scroller.reveal(view, "top");
    scroller.top();
    flush();
    expect(scrolled).toEqual([0]);
    vi.advanceTimersByTime(260);
    expect(rooms).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a close between the room and its scroll cancels the scroll and clears the room at once with Reduce Motion", () => {
    const { frames, rooms, scrolled, scroller, view } = harness(true);
    scroller.reveal(view, "top");
    frames.shift()!();
    scroller.top();
    while (frames.length) frames.shift()!();
    expect(scrolled).toEqual([0]);
    expect(rooms).toEqual([250, 0]);
  });

  it("shows a whole view above the footer without moving one already in sight", () => {
    const { flush, metrics, scrolled, scroller, view } = harness();
    scroller.reveal(view, "whole");
    flush();
    expect(scrolled).toEqual([]);
    metrics.viewport = 520;
    scroller.reveal(view, "whole");
    flush();
    expect(scrolled).toEqual([24]);
  });

  it("dispose leaves nothing running", () => {
    vi.useFakeTimers();
    const { flush, scrolled, scroller, view } = harness();
    scroller.top();
    scroller.reveal(view, "top");
    scroller.dispose();
    flush();
    expect(scrolled).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
