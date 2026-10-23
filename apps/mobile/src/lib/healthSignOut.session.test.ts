import { beforeEach, describe, expect, it, vi } from "vitest";

// Codex r4 on #549: against the real session store, a 401 that rejects a session left by an
// interrupted logout (account record already removed, token still stored) turns Health delivery off
// and runs the recorded expiry. Synthetic accounts; the Keychain, journal and native are doubles.
const h = vi.hoisted(() => ({
  asyncStore: new Map<string, string>(),
  secureStore: new Map<string, string>(),
  keepers: [] as Array<{ keep: unknown } | null>,
  calls: [] as boolean[],
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => h.asyncStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { h.asyncStore.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { h.asyncStore.delete(key); }),
  },
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => h.secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { h.secureStore.set(key, value); },
  deleteItemAsync: async (key: string) => { h.secureStore.delete(key); },
}));
vi.mock("react-native", () => ({
  NativeModules: { DayframeLiveActivityModule: {
    clearRuntimeContext: async () => true, clearRuntimeContextIfToken: async () => true, setRuntimeContext: async () => true } },
  Platform: { OS: "ios" },
}));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://dayframe.test" }));
vi.mock("./backendIdentity", () => ({ requireBackendIdentity: () => "staging-fixture" }));
vi.mock("./healthSyncStore", () => ({
  expireInactiveHealthOwners: async (resolveKeep: () => Promise<{ keep: unknown; isCurrent: () => boolean } | null>) => {
    const keeper = await resolveKeep();
    h.keepers.push(keeper && { keep: keeper.keep });
    return keeper ? 0 : null;
  },
}));

const A = { userId: "a0000000-0000-4000-8000-00000000000a", workspaceId: "a0000000-0000-4000-8000-0000000000aa" };
const native = { setEnabled: vi.fn(async (enabled: boolean) => { h.calls.push(enabled); return enabled; }) };

beforeEach(() => {
  vi.resetModules();
  h.asyncStore.clear();
  h.secureStore.clear();
  h.keepers = [];
  h.calls = [];
});

describe("Health sign-out after a rejected session (real session store)", () => {
  it("a 401 on an interrupted logout's session stops delivery and runs the recorded expiry", async () => {
    const signOut = await import("./healthSignOut");
    const session = await import("./secure-session");
    // The earlier launch's logout removed A's account record, then stopped before removing the token.
    h.secureStore.set("dayframe.localSessionToken.v2", JSON.stringify({
      version: 1, token: "session-a", userId: A.userId, workspaceId: A.workspaceId,
    }));
    h.asyncStore.set(signOut.HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY,
      JSON.stringify({ id: "interrupted", launch: "earlier-launch", done: false, owner: A }));
    expect(await session.getSessionToken()).toBe("session-a");

    signOut.watchSignedOutHealthBackground(native);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Still signed in with no account record: delivery stays and the expiry waits.
    expect(h.calls).toEqual([]);
    expect(h.asyncStore.has(signOut.HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY)).toBe(true);

    // The next request's 401 goes through the real invalidation helper.
    expect(await session.invalidateMobileSessionIfCurrent("session-a")).toBe(true);
    await vi.waitFor(() => expect(h.calls).toEqual([false]));
    await vi.waitFor(() => expect(h.asyncStore.has(signOut.HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY)).toBe(false));
    expect(h.keepers.at(-1)).toEqual({ keep: null });
  });
});
