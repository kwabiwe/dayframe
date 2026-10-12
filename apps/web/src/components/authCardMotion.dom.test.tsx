// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/blocks-motion", () => ({
  prefersReducedMotion: () => reduced.value,
  springTransition: () => ({ easing: "spring", durationMs: 300 })
}));

const { AuthCardMotion } = await import("./AuthCardMotion");

type Call = { element: HTMLElement; keyframes: Keyframe[]; cancel: ReturnType<typeof vi.fn> };
let calls: Call[] = [];
let observed: { callback: ResizeObserverCallback; target: Element } | null = null;
// The inner wrapper's natural height, as the next measurement reads it.
let naturalHeight = 100;

beforeEach(() => {
  calls = [];
  reduced.value = false;
  naturalHeight = 100;
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (this: HTMLElement, keyframes: Keyframe[]) {
      const call = { element: this, keyframes, cancel: vi.fn() };
      calls.push(call);
      return { cancel: call.cancel, onfinish: null } as unknown as Animation;
    }
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { observed = { callback: this.callback, target }; }
    disconnect() { observed = null; }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: this.className === "auth-card-motion" ? 80 : naturalHeight } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

function resize(height: number) {
  naturalHeight = height;
  act(() => observed?.callback([], {} as ResizeObserver));
}

describe("the sign-in card's motion (UIA-317)", () => {
  it("resizes from the old height to the new one, and a new view fades in with a rise", () => {
    const view = render(<AuthCardMotion view="login"><p>Log in</p></AuthCardMotion>);
    resize(100); // first measurement: nothing moves
    expect(calls).toHaveLength(0);
    view.rerender(<AuthCardMotion view="reset"><p>Reset password</p></AuthCardMotion>);
    const enter = calls.at(-1)!;
    expect(enter.keyframes[0]).toMatchObject({ opacity: 0, transform: "translateY(6px)" });
    resize(140);
    const grow = calls.at(-1)!;
    expect(grow.element.className).toBe("auth-card-motion");
    expect(grow.keyframes.map((frame) => frame.height)).toEqual(["100px", "140px"]);
  });

  it("an error line resizes the card without fading the view again", () => {
    render(<AuthCardMotion view="login"><p>Log in</p></AuthCardMotion>);
    resize(100);
    resize(124);
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes.map((frame) => frame.height)).toEqual(["100px", "124px"]);
  });

  it("a resize during a resize starts from where the card is now", () => {
    render(<AuthCardMotion view="form"><p>New password</p></AuthCardMotion>);
    resize(100);
    resize(160);
    const first = calls.at(-1)!;
    resize(90);
    expect(first.cancel).toHaveBeenCalled();
    // The card's current (mid-resize) height, 80 here, is the start.
    expect(calls.at(-1)!.keyframes.map((frame) => frame.height)).toEqual(["80px", "90px"]);
  });

  it("Reduce Motion: no resize and no rise; a new view only fades", () => {
    reduced.value = true;
    const view = render(<AuthCardMotion view="form"><p>New password</p></AuthCardMotion>);
    resize(100);
    view.rerender(<AuthCardMotion view="done"><p>Password changed</p></AuthCardMotion>);
    resize(60);
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});
