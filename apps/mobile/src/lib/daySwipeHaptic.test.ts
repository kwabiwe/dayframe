import { beforeEach, describe, expect, it, vi } from "vitest";

const haptics = vi.hoisted(() => ({ playHaptic: vi.fn() }));
vi.mock("./haptics", () => haptics);

import { DAY_SWIPE_TICK_MIN_INTERVAL_MS, __resetDaySwipeTickForTests, playDaySwipeTick } from "./daySwipeHaptic";

describe("the day swipe's tick", () => {
  beforeEach(() => {
    haptics.playHaptic.mockClear();
    __resetDaySwipeTickForTests();
  });

  it("plays one light tick per swipe", () => {
    playDaySwipeTick(1_000);
    expect(haptics.playHaptic).toHaveBeenCalledTimes(1);
    expect(haptics.playHaptic).toHaveBeenCalledWith("tick");
    playDaySwipeTick(1_000 + DAY_SWIPE_TICK_MIN_INTERVAL_MS);
    expect(haptics.playHaptic).toHaveBeenCalledTimes(2);
  });

  it("thins very fast swipes", () => {
    expect(playDaySwipeTick(1_000)).toBe(true);
    expect(playDaySwipeTick(1_050)).toBe(false);
    expect(playDaySwipeTick(1_119)).toBe(false);
    expect(haptics.playHaptic).toHaveBeenCalledTimes(1);
  });
});
