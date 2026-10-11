import { beforeEach, describe, expect, it, vi } from "vitest";

// The real secure session over an in-memory Keychain, so a failed Keychain deletion leaves exactly
// the state a partly failed logout leaves on the phone.
const keychain = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => ({ deleteFails: 0 }));
const account = vi.hoisted(() => ({ owner: null as { userId: string; workspaceId: string } | null }));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => keychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { keychain.set(key, value); },
  deleteItemAsync: async (key: string) => {
    if (secureStore.deleteFails > 0) {
      secureStore.deleteFails -= 1;
      throw new Error("Keychain delete failed");
    }
    keychain.delete(key);
  }
}));
vi.mock("react-native", () => ({ NativeModules: {}, Platform: { OS: "ios" } }));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://dayframe-staging.vercel.app" }));
vi.mock("./mobileAccount", () => ({
  mobileAccountOwnersEqual: (
    left: { userId: string; workspaceId: string } | null | undefined,
    right: { userId: string; workspaceId: string } | null | undefined
  ) => left?.userId === right?.userId && left?.workspaceId === right?.workspaceId,
  readActiveMobileAccount: async () => account.owner
}));

const session = await import("./secure-session");
const {
  captureConfirmAuthority,
  captureLogoutRecovery,
  logoutRecoveryStillCurrent
} = await import("./confirmAuthority");

const A = { userId: "user-a", workspaceId: "ws-a" };
const B = { userId: "user-b", workspaceId: "ws-b" };

async function signIn(owner: typeof A, token: string) {
  account.owner = owner;
  await session.setSessionToken(token, owner);
}

/** What logout() leaves when its last step, the Keychain deletion, fails. */
async function failLogoutAtKeychainDeletion() {
  account.owner = null; // deactivateMobileAccount ran
  secureStore.deleteFails = 1;
  await expect(session.clearSessionToken()).rejects.toThrow("Keychain delete failed");
}

beforeEach(async () => {
  keychain.clear();
  secureStore.deleteFails = 0;
  account.owner = null;
  session.resetSessionTokenCacheForTesting();
  await signIn(A, "token-a");
});

describe("Log out recovery after a partly failed logout (Codex r2)", () => {
  it("offers to finish a logout whose Keychain deletion failed, and a retry that succeeds leaves nothing", async () => {
    expect(await captureConfirmAuthority()).not.toBeNull();
    await failLogoutAtKeychainDeletion();

    // No live session can be pinned any more, yet the sign-in is still stored.
    expect(await captureConfirmAuthority()).toBeNull();
    expect(await session.hasPersistedSessionToken()).toBe(true);
    const recovery = await captureLogoutRecovery();
    expect(recovery).toEqual({ kind: "stored", generation: expect.any(Number) });
    expect(await logoutRecoveryStillCurrent(recovery!)).toBe(true);

    // The retry (logout() ends with the same clearSessionToken) succeeds now that the Keychain works.
    await expect(session.clearSessionToken()).resolves.toBeUndefined();
    expect(await session.hasPersistedSessionToken()).toBe(false);
    // Nothing left: Log out now goes straight to sign-in.
    expect(await captureLogoutRecovery()).toEqual({ kind: "signed_out" });
  });

  it("after a restart, offers the cleanup for the stored session whose account was already removed", async () => {
    await failLogoutAtKeychainDeletion();
    session.resetSessionTokenCacheForTesting(); // the app is relaunched
    const recovery = await captureLogoutRecovery();
    expect(recovery?.kind).toBe("orphaned");
    expect(await logoutRecoveryStillCurrent(recovery!)).toBe(true);
  });

  it("never acts on a replacement session that signed in after the cleanup was offered", async () => {
    await failLogoutAtKeychainDeletion();
    const stored = await captureLogoutRecovery();
    expect(stored?.kind).toBe("stored");

    await signIn(B, "token-b");
    expect(await logoutRecoveryStillCurrent(stored!)).toBe(false);
    // With a live account signed in, Log out is the normal, session-bound path again.
    expect(await captureLogoutRecovery()).toBeNull();
    expect((await captureConfirmAuthority())?.owner).toEqual(B);
  });

  it("voids an orphaned-session cleanup once anyone signs in, even the same account again", async () => {
    await failLogoutAtKeychainDeletion();
    session.resetSessionTokenCacheForTesting();
    const orphaned = await captureLogoutRecovery();
    expect(orphaned?.kind).toBe("orphaned");

    await signIn(A, "token-a-2");
    expect(await logoutRecoveryStillCurrent(orphaned!)).toBe(false);
  });
});
