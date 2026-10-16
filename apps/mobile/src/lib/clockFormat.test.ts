import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  },
}));

const clock = await import("./clockFormat");

describe("the iPhone 12/24-hour time format (PRD D18)", () => {
  beforeEach(() => {
    store.clear();
    clock.resetClockFormatForTests();
  });

  it("follows the iPhone's 24-Hour Time setting by default, and keeps 24-hour without a reader", async () => {
    expect(clock.getClockFormat()).toBe("24h");
    clock.registerSystemClockFormatReader(() => "12h");
    await clock.loadClockFormatPreference();
    expect(clock.getClockFormatPreference()).toBe("system");
    expect(clock.getClockFormat()).toBe("12h");
  });

  it("re-reads the iPhone's setting on return to the foreground and tells listeners only on a change", () => {
    let system: "12h" | "24h" = "24h";
    clock.registerSystemClockFormatReader(() => system);
    const listener = vi.fn();
    const unsubscribe = clock.subscribeToClockFormat(listener);
    clock.refreshSystemClockFormat();
    expect(listener).not.toHaveBeenCalled();
    system = "12h";
    clock.refreshSystemClockFormat();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.getClockFormat()).toBe("12h");
    unsubscribe();
  });

  it("keeps the choice on this phone and lets it win over the system", async () => {
    clock.registerSystemClockFormatReader(() => "12h");
    await clock.setClockFormatPreference("24h");
    expect(store.get(clock.CLOCK_FORMAT_PREFERENCE_KEY)).toBe("24h");
    expect(clock.getClockFormat()).toBe("24h");

    clock.resetClockFormatForTests();
    await clock.loadClockFormatPreference();
    expect(clock.getClockFormatPreference()).toBe("24h");
    expect(clock.getClockFormat()).toBe("24h");
  });

  it("ignores an unknown stored value and a reader that throws", async () => {
    store.set(clock.CLOCK_FORMAT_PREFERENCE_KEY, "13h");
    clock.registerSystemClockFormatReader(() => {
      throw new Error("native module missing");
    });
    await clock.loadClockFormatPreference();
    expect(clock.getClockFormatPreference()).toBe("system");
    expect(clock.getClockFormat()).toBe("24h");
  });
});
