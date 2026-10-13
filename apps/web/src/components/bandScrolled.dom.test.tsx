// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isContentUnderBand, useBandScrolled } from "./useBandScrolled";

// Owner design C1 (13 Oct 2026): the sticky timer band's hairline appears only once page content
// has scrolled under it, never at rest, on load or on refresh.

describe("isContentUnderBand", () => {
  it("is false while the content starts at (or below) the band's bottom edge", () => {
    expect(isContentUnderBand(130, 130)).toBe(false);
    expect(isContentUnderBand(130, 160)).toBe(false);
    // Sub-pixel layout is not scrolling.
    expect(isContentUnderBand(130.4, 130)).toBe(false);
  });

  it("is true once the content has moved above the band's bottom edge", () => {
    expect(isContentUnderBand(130, 129)).toBe(true);
    expect(isContentUnderBand(130, -400)).toBe(true);
  });
});

describe("useBandScrolled", () => {
  let contentTop = 130;

  beforeEach(() => {
    contentTop = 130;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function Band() {
    const band = useRef<HTMLDivElement | null>(null);
    const content = useRef<HTMLElement | null>(null);
    const scrolled = useBandScrolled(band, content);
    return (
      <>
        <div
          data-scrolled={scrolled ? "true" : undefined}
          data-testid="band"
          ref={(node) => {
            band.current = node;
            if (node) node.getBoundingClientRect = () => ({ bottom: 130, top: 0 }) as DOMRect;
          }}
        />
        <main
          ref={(node) => {
            content.current = node;
            if (node) node.getBoundingClientRect = () => ({ top: contentTop, bottom: contentTop + 900 }) as DOMRect;
          }}
        />
      </>
    );
  }

  it("draws no hairline at rest, shows it once content scrolls under the band and hides it back at the top", () => {
    const { getByTestId } = render(<Band />);
    const band = getByTestId("band");
    expect(band.dataset.scrolled).toBeUndefined();

    contentTop = -200;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(band.dataset.scrolled).toBe("true");

    contentTop = 130;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(band.dataset.scrolled).toBeUndefined();
  });

  it("measures on mount, so a page restored mid-scroll shows the hairline without waiting for a scroll", () => {
    contentTop = -50;
    const { getByTestId } = render(<Band />);
    expect(getByTestId("band").dataset.scrolled).toBe("true");
  });

  it("follows scrolls of any scroller (capture) and stops listening on unmount", () => {
    const { getByTestId, unmount } = render(<Band />);
    contentTop = 10;
    act(() => {
      document.body.dispatchEvent(new Event("scroll"));
    });
    expect(getByTestId("band").dataset.scrolled).toBe("true");
    const remove = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), { capture: true });
  });
});

describe("useBandScrolled frame scheduling (non-synchronous rAF)", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;
  let contentTop: number;
  const cancelled: number[] = [];

  beforeEach(() => {
    frames = new Map();
    nextId = 0;
    contentTop = 130;
    cancelled.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextId += 1;
      frames.set(nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.push(id);
      frames.delete(id);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function flushFrames() {
    const pending = [...frames.entries()];
    frames.clear();
    act(() => {
      for (const [, callback] of pending) callback(0);
    });
  }

  function Band({ calendar = false }: { calendar?: boolean }) {
    const band = useRef<HTMLDivElement | null>(null);
    const content = useRef<HTMLElement | null>(null);
    const scrolled = useBandScrolled(band, content);
    return (
      <>
        <div
          data-scrolled={scrolled ? "true" : undefined}
          data-testid="band"
          ref={(node) => {
            band.current = node;
            if (node) node.getBoundingClientRect = () => ({ bottom: 130, top: 0 }) as DOMRect;
          }}
        />
        <main
          ref={(node) => {
            content.current = node;
            if (node) node.getBoundingClientRect = () => ({ top: contentTop, bottom: contentTop + 900 }) as DOMRect;
          }}
        >
          {calendar ? <div data-testid="grid" style={{ overflow: "auto" }} /> : null}
        </main>
      </>
    );
  }

  it("batches a burst of scrolls into one frame and measures only when it runs", () => {
    const { getByTestId } = render(<Band />);
    contentTop = -100;
    act(() => {
      for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    });
    expect(frames.size).toBe(1);
    // Nothing is measured until the frame runs.
    expect(getByTestId("band").dataset.scrolled).toBeUndefined();
    flushFrames();
    expect(getByTestId("band").dataset.scrolled).toBe("true");
    // After the frame a new scroll schedules a new one.
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(frames.size).toBe(1);
  });

  it("cancels a pending frame on unmount, so it never measures a removed band", () => {
    const { unmount } = render(<Band />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    const [pendingId] = [...frames.keys()];
    unmount();
    expect(cancelled).toEqual([pendingId]);
    expect(frames.size).toBe(0);
  });

  it("does not cancel anything on unmount when no frame is pending", () => {
    const { unmount } = render(<Band />);
    unmount();
    expect(cancelled).toEqual([]);
  });

  it("ignores an inner scroller (Calendar's grid) while nothing moves under the band", () => {
    const { getByTestId } = render(<Band calendar />);
    act(() => {
      getByTestId("grid").dispatchEvent(new Event("scroll"));
    });
    flushFrames();
    expect(getByTestId("band").dataset.scrolled).toBeUndefined();
  });
});

