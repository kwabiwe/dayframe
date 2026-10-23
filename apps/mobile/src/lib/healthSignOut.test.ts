import { beforeEach, describe, expect, it, vi } from "vitest";

// Stability audit 22 Oct 2026, health-3 and health-4, and Codex r1 on #549. Synthetic accounts; the
// session authority and native are doubles.
type Owner = { userId: string; workspaceId: string };
const h = vi.hoisted(() => ({
  asyncStore: new Map<string, string>(),
  session: { status: "signed_out" as "signed_out" | "authenticated", generation: 1, owner: null as Owner | null, token: "" },
  sessionListeners: new Set<() => void>(),
  expireResult: 0 as number | null | Error,
  keepers: [] as Array<{ keep: unknown } | null>,
  calls: [] as boolean[],
  native: { setEnabled: vi.fn(async (enabled: boolean) => { h.calls.push(enabled); return enabled; }) },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => h.asyncStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { h.asyncStore.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { h.asyncStore.delete(key); }),
  },
}));
vi.mock("./backendIdentity", () => ({ requireBackendIdentity: () => "staging-fixture" }));
vi.mock("./secure-session", () => ({
  currentSessionGeneration: () => h.session.generation,
  readAuthenticatedSessionSnapshot: async () => h.session.status === "signed_out"
    ? { status: "signed_out" }
    : { status: "authenticated", snapshot: { generation: h.session.generation, owner: h.session.owner, token: h.session.token } },
  isAuthenticatedSessionSnapshotCurrent: (snapshot: { generation: number; token: string }) =>
    h.session.status === "authenticated" && snapshot.generation === h.session.generation && snapshot.token === h.session.token,
  subscribeAuthenticatedSession: (listener: () => void) => { h.sessionListeners.add(listener); return () => h.sessionListeners.delete(listener); },
}));
vi.mock("./healthSyncStore", () => ({
  expireInactiveHealthOwners: async (resolveKeep: () => Promise<{ keep: unknown; isCurrent: () => boolean } | null>) => {
    const keeper = await resolveKeep();
    h.keepers.push(keeper && { keep: keeper.keep });
    if (!keeper) return null;
    if (h.expireResult instanceof Error) throw h.expireResult;
    return h.expireResult;
  },
}));
vi.mock("../../modules/dayframe-health-background", () => ({ setEnabled: h.native.setEnabled }));

const A = { userId: "a0000000-0000-4000-8000-00000000000a", workspaceId: "a0000000-0000-4000-8000-0000000000aa" };
const B = { userId: "b0000000-0000-4000-8000-00000000000b", workspaceId: "b0000000-0000-4000-8000-0000000000bb" };
let account: typeof import("./mobileAccount");
let signOut: typeof import("./healthSignOut");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function signIn(owner: Owner) {
  h.session = { status: "authenticated", generation: h.session.generation + 1, owner, token: `token-${owner.userId}` };
  for (const listener of h.sessionListeners) listener();
}
function signOutSession() {
  h.session = { status: "signed_out", generation: h.session.generation + 1, owner: null, token: "" };
  for (const listener of h.sessionListeners) listener();
}

beforeEach(async () => {
  vi.resetModules();
  h.asyncStore.clear();
  h.sessionListeners.clear();
  h.session = { status: "signed_out", generation: 1, owner: null, token: "" };
  h.expireResult = 0;
  h.keepers = [];
  h.calls = [];
  h.native.setEnabled.mockClear();
  account = await import("./mobileAccount");
  signOut = await import("./healthSignOut");
});

describe("Apple Health background delivery while signed out (health-4)", () => {
  it("a signed-out launch turns delivery off even with a stale account record", async () => {
    await account.activateMobileAccount(A);
    signOut.watchSignedOutHealthBackground(h.native);
    await vi.waitFor(() => expect(h.calls).toEqual([false]));
  });

  it("stays on while signed in, and turns off when logout clears the session", async () => {
    signIn(A);
    await account.activateMobileAccount(A);
    signOut.watchSignedOutHealthBackground(h.native);
    await flush();
    // Logout deactivates the account record first, while the session still reads signed in.
    await account.deactivateMobileAccount(A);
    await flush();
    expect(h.calls).toEqual([]);
    signOutSession();
    await vi.waitFor(() => expect(h.calls).toEqual([false]));
  });

  it("an enable that started before logout cannot turn delivery back on after it", async () => {
    signIn(A);
    const generation = h.session.generation;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // The enable is held in native, then logout completes and asks to stop.
    h.native.setEnabled.mockImplementationOnce(async (enabled: boolean) => { await held; h.calls.push(enabled); return enabled; });
    const enable = signOut.enableHealthBackgroundDeliveryForSession(generation, h.native);
    await flush();
    signOutSession();
    const stop = signOut.stopHealthBackgroundDeliveryWhileSignedOut(h.native);
    release();
    await Promise.all([enable, stop]);
    expect(h.calls).toEqual([true, false]);
    // An enable asked for by the signed-out generation never reaches native.
    expect(await signOut.enableHealthBackgroundDeliveryForSession(generation, h.native)).toBe(false);
    signIn(B);
    expect(await signOut.enableHealthBackgroundDeliveryForSession(generation, h.native)).toBe(false);
    expect(h.calls).toEqual([true, false]);
    expect(await signOut.enableHealthBackgroundDeliveryForSession(h.session.generation, h.native)).toBe(true);
  });
});

describe("Health journal after logout (health-3)", () => {
  it("keeps the session's account and defers during an account hand-over", async () => {
    // Login installs B's session before B's account record: nothing is decided yet.
    await account.activateMobileAccount(A);
    signIn(B);
    expect(await signOut.expireSignedOutHealthJournals()).toBeNull();
    await account.activateMobileAccount(B);
    await signOut.expireSignedOutHealthJournals();
    // Signed out with an account record still being removed: also deferred.
    signOutSession();
    expect(await signOut.expireSignedOutHealthJournals()).toBeNull();
    await account.deactivateMobileAccount(B);
    await signOut.expireSignedOutHealthJournals();
    expect(h.keepers).toEqual([null, { keep: { ...B, backendId: "staging-fixture" } }, null, { keep: null }]);
  });

  it("a recorded logout expiry survives deferral and failure, and clears only after it ran", async () => {
    await signOut.markSignedOutHealthExpiryPending();
    const marker = () => h.asyncStore.get(signOut.HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY);
    await account.activateMobileAccount(A);
    expect(await signOut.runPendingSignedOutHealthExpiry()).toBe(false);
    expect(marker()).toBeTruthy();
    await account.deactivateMobileAccount(A);
    h.expireResult = new Error("Synthetic SQLite failure");
    await expect(signOut.runPendingSignedOutHealthExpiry()).rejects.toThrow("Synthetic");
    expect(marker()).toBeTruthy();
    // The next launch, still signed out, retries it.
    h.expireResult = 3;
    signOut.watchSignedOutHealthBackground(h.native);
    await vi.waitFor(() => expect(marker()).toBeUndefined());
    expect(await signOut.runPendingSignedOutHealthExpiry()).toBe(false);
  });

  it("logout stops delivery and runs its recorded expiry", async () => {
    await signOut.markSignedOutHealthExpiryPending();
    await signOut.endHealthCaptureAfterLogout();
    expect(h.calls).toEqual([false]);
    expect(h.keepers).toEqual([{ keep: null }]);
    expect(h.asyncStore.has(signOut.HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY)).toBe(false);
  });

  it("foreground maintenance runs once per launch, again after a failure or a deferral", async () => {
    signIn(A);
    await account.activateMobileAccount(A);
    h.expireResult = new Error("Synthetic SQLite failure");
    await expect(signOut.expireSignedOutHealthJournalsOncePerLaunch()).rejects.toThrow("Synthetic");
    h.expireResult = null;
    await signOut.expireSignedOutHealthJournalsOncePerLaunch();
    h.expireResult = 0;
    await signOut.expireSignedOutHealthJournalsOncePerLaunch();
    await signOut.expireSignedOutHealthJournalsOncePerLaunch();
    expect(h.keepers).toHaveLength(3);
  });
});
