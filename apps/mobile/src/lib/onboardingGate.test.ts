import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    })
  }
}));
vi.mock("./mobileAccount", () => ({
  mobileAccountKey: (owner: { userId: string; workspaceId: string }) => `${owner.userId}:${owner.workspaceId}`
}));

const { claimOnboardingOffer, setupLooksDone } = await import("./onboardingGate");
const owner = { userId: "user-a", workspaceId: "ws-1" };
const nothing = { savedPlaces: 0, healthConnected: false, locationSuggestionsOn: false };

describe("first sign-in setup offer", () => {
  beforeEach(() => store.clear());

  it("treats any saved place, Health connection or location suggestions as set up", () => {
    expect(setupLooksDone(nothing)).toBe(false);
    expect(setupLooksDone({ ...nothing, savedPlaces: 2 })).toBe(true);
    expect(setupLooksDone({ ...nothing, healthConnected: true })).toBe(true);
    expect(setupLooksDone({ ...nothing, locationSuggestionsOn: true })).toBe(true);
  });

  it("offers setup once per account on this phone, only when nothing is set up", async () => {
    await expect(claimOnboardingOffer(owner, async () => nothing)).resolves.toBe(true);
    await expect(claimOnboardingOffer(owner, async () => nothing)).resolves.toBe(false);
    await expect(claimOnboardingOffer({ ...owner, userId: "user-b" }, async () => ({ ...nothing, savedPlaces: 1 }))).resolves.toBe(false);
  });

  it("records the offer even when the signals can't be read, and then offers nothing", async () => {
    await expect(claimOnboardingOffer(owner, async () => { throw new Error("offline"); })).resolves.toBe(false);
    await expect(claimOnboardingOffer(owner, async () => nothing)).resolves.toBe(false);
  });
});
