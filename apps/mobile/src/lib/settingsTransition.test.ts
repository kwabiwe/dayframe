import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterSettingsTransition } from "./settingsTransition";

function fakeNavigation() {
  const listeners = new Set<() => void>();
  return {
    subscribeTransitionEnd: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    end: () => [...listeners].forEach((listener) => listener()),
    listenerCount: () => listeners.size
  };
}

describe("afterSettingsTransition (I1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not start before transitionEnd, then runs exactly once", () => {
    const nav = fakeNavigation();
    const work = vi.fn();
    afterSettingsTransition({ subscribeTransitionEnd: nav.subscribeTransitionEnd, fallbackMs: 1000 }, work);
    vi.advanceTimersByTime(999);
    expect(work).not.toHaveBeenCalled();
    nav.end();
    expect(work).toHaveBeenCalledTimes(1);
    expect(nav.listenerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    nav.end();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("falls back to the timer when no transition event arrives", () => {
    const nav = fakeNavigation();
    const work = vi.fn();
    afterSettingsTransition({ subscribeTransitionEnd: nav.subscribeTransitionEnd, fallbackMs: 300 }, work);
    vi.advanceTimersByTime(300);
    expect(work).toHaveBeenCalledTimes(1);
    expect(nav.listenerCount()).toBe(0);
  });

  it("never runs once cancelled (unmount or blur)", () => {
    const nav = fakeNavigation();
    const work = vi.fn();
    const cancel = afterSettingsTransition({ subscribeTransitionEnd: nav.subscribeTransitionEnd, fallbackMs: 300 }, work);
    cancel();
    nav.end();
    vi.advanceTimersByTime(1000);
    expect(work).not.toHaveBeenCalled();
    expect(nav.listenerCount()).toBe(0);
  });

  it("discards the work when the account was replaced before the transition ended", () => {
    const nav = fakeNavigation();
    const work = vi.fn();
    let account = "a";
    const scheduledFor = account;
    afterSettingsTransition({ subscribeTransitionEnd: nav.subscribeTransitionEnd, isCurrent: () => account === scheduledFor }, work);
    account = "b";
    nav.end();
    vi.advanceTimersByTime(5000);
    expect(work).not.toHaveBeenCalled();
  });
});

describe("createFocusedTransitionReady (I1 r2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mount → blur before ready: the fallback must not fire; refocus → ready after its own transition", async () => {
    const { createFocusedTransitionReady } = await import("./settingsTransition");
    const nav = fakeNavigation();
    const onReady = vi.fn();
    const gateReady = createFocusedTransitionReady(() => ({ subscribeTransitionEnd: nav.subscribeTransitionEnd, fallbackMs: 300 }), onReady);
    gateReady.focus();
    gateReady.blur();
    vi.advanceTimersByTime(1000);
    expect(onReady).not.toHaveBeenCalled();
    expect(nav.listenerCount()).toBe(0);
    gateReady.focus();
    vi.advanceTimersByTime(100);
    expect(onReady).not.toHaveBeenCalled();
    nav.end();
    expect(onReady).toHaveBeenCalledTimes(1);
    // Once ready it stays ready: later focus/blur never schedules again.
    gateReady.blur();
    gateReady.focus();
    vi.advanceTimersByTime(1000);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("refocus falls back to the timer when no transition event arrives", async () => {
    const { createFocusedTransitionReady } = await import("./settingsTransition");
    const nav = fakeNavigation();
    const onReady = vi.fn();
    const gateReady = createFocusedTransitionReady(() => ({ subscribeTransitionEnd: nav.subscribeTransitionEnd, fallbackMs: 300 }), onReady);
    gateReady.focus();
    gateReady.blur();
    gateReady.focus();
    vi.advanceTimersByTime(300);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
