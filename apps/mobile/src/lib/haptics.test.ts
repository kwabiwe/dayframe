import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const calls: string[] = [];

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  },
}));

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Soft: "soft" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  impactAsync: vi.fn((style: string) => {
    calls.push(`impact:${style}`);
    return Promise.resolve();
  }),
  notificationAsync: vi.fn((type: string) => {
    calls.push(`notification:${type}`);
    return Promise.resolve();
  }),
  selectionAsync: vi.fn(() => {
    calls.push("selection");
    return Promise.resolve();
  }),
}));

async function freshModule() {
  vi.resetModules();
  return import("./haptics");
}

describe("Dayframe haptics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.clear();
    calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps each committed moment to the motion.md haptic", async () => {
    const { playHaptic } = await freshModule();
    playHaptic("start");
    playHaptic("tick");
    playHaptic("reviewLog");
    playHaptic("reviewSkip");
    playHaptic("delete");
    playHaptic("undoRestore");
    expect(calls).toEqual([
      "impact:medium",
      "selection",
      "notification:success",
      "impact:light",
      "notification:warning",
      "impact:light",
    ]);
  });

  it("plays Stop as one composite: success, then a soft impact as the block lands", async () => {
    const { STOP_LANDING_HAPTIC_DELAY_MS, playHaptic } = await freshModule();
    playHaptic("stop");
    expect(calls).toEqual(["notification:success"]);
    vi.advanceTimersByTime(STOP_LANDING_HAPTIC_DELAY_MS);
    expect(calls).toEqual(["notification:success", "impact:soft"]);
  });

  it("never stacks two landing impacts when Stop repeats quickly", async () => {
    const { STOP_LANDING_HAPTIC_DELAY_MS, playHaptic } = await freshModule();
    playHaptic("stop");
    vi.advanceTimersByTime(STOP_LANDING_HAPTIC_DELAY_MS / 2);
    playHaptic("stop");
    vi.advanceTimersByTime(STOP_LANDING_HAPTIC_DELAY_MS * 2);
    expect(calls).toEqual(["notification:success", "notification:success", "impact:soft"]);
  });

  it("stays silent when the Settings switch is off, including a landing still waiting", async () => {
    const { STOP_LANDING_HAPTIC_DELAY_MS, playHaptic, setHapticsEnabled } = await freshModule();
    playHaptic("stop");
    await setHapticsEnabled(false);
    vi.advanceTimersByTime(STOP_LANDING_HAPTIC_DELAY_MS);
    playHaptic("start");
    expect(calls).toEqual(["notification:success"]);
    expect(store.get("dayframe.hapticsEnabled.v1")).toBe("off");
  });

  it("restores the saved preference on launch and defaults to on", async () => {
    const first = await freshModule();
    expect(await first.loadHapticsPreference()).toBe(true);

    store.set("dayframe.hapticsEnabled.v1", "off");
    const second = await freshModule();
    expect(await second.loadHapticsPreference()).toBe(false);
    second.playHaptic("start");
    expect(calls).toEqual([]);
  });
});
