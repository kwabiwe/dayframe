import { beforeEach, describe, expect, it, vi } from "vitest";

// Stability audit 22 Oct 2026, health-3 and health-4. Synthetic accounts; native is a double.
const h = vi.hoisted(() => ({
  asyncStore: new Map<string, string>(),
  expire: vi.fn(async (resolveKeep: () => Promise<unknown>) => { h.kept.push(await resolveKeep()); return 0; }),
  kept: [] as unknown[],
  native: { setEnabled: vi.fn(async (_enabled: boolean) => false) },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => h.asyncStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { h.asyncStore.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { h.asyncStore.delete(key); }),
  },
}));
vi.mock("./backendIdentity", () => ({ requireBackendIdentity: () => "staging-fixture" }));
vi.mock("./healthSyncStore", () => ({ expireInactiveHealthOwners: h.expire }));
vi.mock("../../modules/dayframe-health-background", () => ({ setEnabled: h.native.setEnabled }));

const A = { userId: "a0000000-0000-4000-8000-00000000000a", workspaceId: "a0000000-0000-4000-8000-0000000000aa" };
let account: typeof import("./mobileAccount");
let signOut: typeof import("./healthSignOut");

beforeEach(async () => {
  vi.resetModules();
  h.asyncStore.clear();
  h.kept = [];
  h.expire.mockClear();
  h.native.setEnabled.mockClear();
  account = await import("./mobileAccount");
  signOut = await import("./healthSignOut");
});

describe("Apple Health background delivery while signed out (health-4)", () => {
  it("turns delivery off at a signed-out launch and at every sign-out, never while an account is signed in", async () => {
    await account.activateMobileAccount(A);
    signOut.watchSignedOutHealthBackground(h.native);
    await vi.waitFor(() => expect(account.getActiveMobileAccountSnapshot()).toEqual(A));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.native.setEnabled).not.toHaveBeenCalled();

    await account.deactivateMobileAccount(A);
    await vi.waitFor(() => expect(h.native.setEnabled).toHaveBeenCalledWith(false));
    expect(h.native.setEnabled).toHaveBeenCalledOnce();
    // Signing in again leaves re-enabling to the authenticated foreground (gated on Health access).
    await account.activateMobileAccount(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.native.setEnabled).toHaveBeenCalledOnce();
  });

  it("a launch with no account signed in turns delivery off", async () => {
    signOut.watchSignedOutHealthBackground(h.native);
    await vi.waitFor(() => expect(h.native.setEnabled).toHaveBeenCalledWith(false));
  });

  it("a sign-in that lands before the native call keeps its delivery", async () => {
    // The account store is still writing the sign-in when the stop asks who is signed in.
    const signIn = account.activateMobileAccount(A);
    const stop = signOut.stopHealthBackgroundDeliveryWhileSignedOut(h.native);
    await signIn;
    expect(await stop).toBe(false);
    expect(h.native.setEnabled).not.toHaveBeenCalled();
  });
});

describe("Health journal after logout (health-3)", () => {
  it("logout stops delivery and expires every journal but the signed-in account's", async () => {
    await signOut.endHealthCaptureAfterLogout();
    expect(h.native.setEnabled).toHaveBeenCalledWith(false);
    expect(h.kept).toEqual([null]);
  });

  it("foreground maintenance keeps the signed-in account and runs once per launch, again after a failure", async () => {
    await account.activateMobileAccount(A);
    h.expire.mockRejectedValueOnce(new Error("Synthetic SQLite failure"));
    await expect(signOut.expireSignedOutHealthJournalsOncePerLaunch()).rejects.toThrow("Synthetic");
    await signOut.expireSignedOutHealthJournalsOncePerLaunch();
    await signOut.expireSignedOutHealthJournalsOncePerLaunch();
    expect(h.expire).toHaveBeenCalledTimes(2);
    expect(h.kept).toEqual([{ ...A, backendId: "staging-fixture" }]);
  });
});
