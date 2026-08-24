import { beforeEach, describe, expect, it, vi } from "vitest";

const values = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));
const nativeModule = vi.hoisted(() => ({
  setRuntimeContext: vi.fn(),
  clearRuntimeContext: vi.fn(),
  clearRuntimeContextIfToken: vi.fn()
}));
let nativeRuntimeToken: string | null = null;

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: secureStore.getItemAsync,
  setItemAsync: secureStore.setItemAsync,
  deleteItemAsync: secureStore.deleteItemAsync
}));

vi.mock("react-native", () => ({
  NativeModules: { DayframeLiveActivityModule: nativeModule },
  Platform: { OS: "ios" }
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe-staging.vercel.app"
}));

const {
  SecureSessionUnavailableError,
  bindAuthenticatedSessionOwner,
  clearSessionToken,
  getSessionToken,
  invalidateMobileSession,
  invalidateMobileSessionIfCurrent,
  isKeychainInteractionUnavailable,
  readAuthenticatedSessionSnapshot,
  readOwnedAuthenticatedSessionSnapshot,
  resetSessionTokenCacheForTesting,
  setSessionToken
} = await import("./secure-session");
const { subscribeMobileSignedOut } = await import("./mobileSessionTransition");

describe("secure mobile session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    values.clear();
    vi.clearAllMocks();
    secureStore.getItemAsync.mockImplementation((key: string) =>
      Promise.resolve(values.get(key) ?? null)
    );
    secureStore.setItemAsync.mockImplementation((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    });
    secureStore.deleteItemAsync.mockImplementation((key: string) => {
      values.delete(key);
      return Promise.resolve();
    });
    nativeRuntimeToken = null;
    nativeModule.setRuntimeContext.mockImplementation((_apiBase: string, token: string) => {
      nativeRuntimeToken = token;
      return Promise.resolve(true);
    });
    nativeModule.clearRuntimeContext.mockImplementation(() => {
      nativeRuntimeToken = null;
      return Promise.resolve(true);
    });
    nativeModule.clearRuntimeContextIfToken.mockImplementation((token: string) => {
      if (nativeRuntimeToken !== token) return Promise.resolve(false);
      nativeRuntimeToken = null;
      return Promise.resolve(true);
    });
    resetSessionTokenCacheForTesting();
  });

  it("stores new sessions with background-safe device-only accessibility", async () => {
    await setSessionToken("session-token");

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "dayframe.localSessionToken.v2",
      "session-token",
      { keychainAccessible: 1 }
    );
    expect(values.get("dayframe.localSessionToken.v2")).toBe("session-token");
    expect(nativeModule.setRuntimeContext).toHaveBeenCalledWith(
      "https://dayframe-staging.vercel.app",
      "session-token"
    );
  });

  it("persists the verified account in the same secure session envelope", async () => {
    const owner = { userId: "user-a", workspaceId: "workspace-a" };
    await setSessionToken("session-token", owner);

    expect(JSON.parse(values.get("dayframe.localSessionToken.v2") ?? "{}")).toEqual({
      version: 1,
      token: "session-token",
      userId: "user-a",
      workspaceId: "workspace-a"
    });
    resetSessionTokenCacheForTesting();
    await expect(readOwnedAuthenticatedSessionSnapshot(owner)).resolves.toMatchObject({
      status: "authenticated",
      snapshot: { owner, token: "session-token" }
    });
    await expect(readOwnedAuthenticatedSessionSnapshot({
      userId: "user-b",
      workspaceId: "workspace-b"
    })).resolves.toEqual({ status: "owner_mismatch" });
  });

  it("binds a migrated unowned token only after its session snapshot is verified", async () => {
    values.set("dayframe.localSessionToken.v2", "legacy-unbound-token");
    const session = await readAuthenticatedSessionSnapshot();
    expect(session).toMatchObject({
      status: "authenticated",
      snapshot: { owner: null, token: "legacy-unbound-token" }
    });
    await expect(readOwnedAuthenticatedSessionSnapshot({
      userId: "user-a",
      workspaceId: "workspace-a"
    })).resolves.toEqual({ status: "owner_mismatch" });
    if (session.status !== "authenticated") throw new Error("Expected an authenticated session");
    const owner = { userId: "user-a", workspaceId: "workspace-a" };

    await expect(bindAuthenticatedSessionOwner(session.snapshot, owner)).resolves.toBe(true);
    resetSessionTokenCacheForTesting();
    await expect(readOwnedAuthenticatedSessionSnapshot(owner)).resolves.toMatchObject({
      status: "authenticated"
    });
  });

  it("migrates the legacy token without signing the user out", async () => {
    values.set("dayframe.localSessionToken.v1", "legacy-token");

    await expect(getSessionToken()).resolves.toBe("legacy-token");
    expect(values.get("dayframe.localSessionToken.v2")).toBe("legacy-token");
    expect(values.has("dayframe.localSessionToken.v1")).toBe(false);
    expect(nativeModule.setRuntimeContext).toHaveBeenCalledWith(
      "https://dayframe-staging.vercel.app",
      "legacy-token"
    );
  });

  it("mirrors an existing session for app-intent execution", async () => {
    values.set("dayframe.localSessionToken.v2", "current-token");

    await expect(getSessionToken()).resolves.toBe("current-token");

    expect(nativeModule.setRuntimeContext).toHaveBeenCalledWith(
      "https://dayframe-staging.vercel.app",
      "current-token"
    );
  });

  it("reuses a foreground session without another Keychain interaction", async () => {
    values.set("dayframe.localSessionToken.v2", "current-token");

    await expect(getSessionToken()).resolves.toBe("current-token");
    await expect(getSessionToken()).resolves.toBe("current-token");

    expect(secureStore.getItemAsync).toHaveBeenCalledOnce();
    expect(nativeModule.setRuntimeContext).toHaveBeenCalledOnce();
  });

  it("keeps the normal session usable when native context mirroring is unavailable", async () => {
    nativeModule.setRuntimeContext.mockRejectedValueOnce(new Error("Native module unavailable"));

    await expect(setSessionToken("session-token")).resolves.toBeUndefined();
    expect(values.get("dayframe.localSessionToken.v2")).toBe("session-token");
  });

  it("retries the transient iOS interaction error before returning the token", async () => {
    secureStore.getItemAsync
      .mockRejectedValueOnce(new Error("KeyChainException: User interaction is not allowed."))
      .mockResolvedValueOnce("session-token");

    const result = getSessionToken();
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe("session-token");
    expect(secureStore.getItemAsync).toHaveBeenCalledTimes(2);
  });

  it("replaces a persistent native exception with actionable copy", async () => {
    secureStore.getItemAsync.mockRejectedValue(
      new Error("FunctionCallException: KeyChainException: User interaction is not allowed.")
    );

    const result = getSessionToken();
    const rejection = expect(result).rejects.toMatchObject({
      name: SecureSessionUnavailableError.name,
      message: expect.stringContaining("Unlock your iPhone")
    });
    await vi.runAllTimersAsync();

    await rejection;
  });

  it("recognises the native status code and message variants", () => {
    expect(isKeychainInteractionUnavailable(new Error("User interaction is not allowed."))).toBe(true);
    expect(isKeychainInteractionUnavailable(new Error("OSStatus -25308"))).toBe(true);
    expect(isKeychainInteractionUnavailable(new Error("Network unavailable"))).toBe(false);
  });

  it("clears current and legacy tokens", async () => {
    values.set("dayframe.localSessionToken.v1", "old");
    values.set("dayframe.localSessionToken.v2", "new");

    await clearSessionToken();

    expect(values.size).toBe(0);
    expect(nativeModule.clearRuntimeContext).toHaveBeenCalledOnce();
  });

  it("invalidates the process cache when the user signs out", async () => {
    values.set("dayframe.localSessionToken.v2", "first-token");
    await expect(getSessionToken()).resolves.toBe("first-token");

    await clearSessionToken();
    await expect(getSessionToken()).resolves.toBeNull();
    await setSessionToken("second-token");

    await expect(getSessionToken()).resolves.toBe("second-token");
    expect(secureStore.getItemAsync).toHaveBeenCalledOnce();
  });

  it("does not restore an earlier account after logout and a new login", async () => {
    let finishOldRead: ((token: string) => void) | undefined;
    secureStore.getItemAsync.mockImplementationOnce(() => new Promise((resolve) => {
      finishOldRead = resolve;
    }));

    const oldRead = getSessionToken();
    await vi.waitFor(() => expect(secureStore.getItemAsync).toHaveBeenCalledOnce());
    const logout = clearSessionToken();
    const newLogin = setSessionToken("account-b-token");
    finishOldRead?.("account-a-token");

    await expect(oldRead).resolves.toBeNull();
    await logout;
    await newLogin;
    await expect(getSessionToken()).resolves.toBe("account-b-token");
    expect(nativeModule.setRuntimeContext).not.toHaveBeenCalledWith(
      "https://dayframe-staging.vercel.app",
      "account-a-token"
    );
    expect(nativeModule.setRuntimeContext).toHaveBeenLastCalledWith(
      "https://dayframe-staging.vercel.app",
      "account-b-token"
    );
  });

  it("clears native context even when secure storage deletion fails", async () => {
    secureStore.deleteItemAsync.mockRejectedValueOnce(new Error("Keychain unavailable"));

    await expect(clearSessionToken()).rejects.toThrow("Keychain unavailable");
    expect(nativeModule.clearRuntimeContext).toHaveBeenCalledOnce();
  });

  it("publishes a signed-out transition when a background request rejects the session", async () => {
    values.set("dayframe.localSessionToken.v2", "expired-token");
    const listener = vi.fn();
    const unsubscribe = subscribeMobileSignedOut(listener);

    try {
      await invalidateMobileSession();
    } finally {
      unsubscribe();
    }

    expect(values.size).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not let a delayed old-session rejection sign out a newer login", async () => {
    await setSessionToken("account-a-token");
    const rejectedToken = await getSessionToken();
    await setSessionToken("account-b-token");
    const listener = vi.fn();
    const unsubscribe = subscribeMobileSignedOut(listener);

    try {
      await expect(invalidateMobileSessionIfCurrent(rejectedToken!)).resolves.toBe(false);
    } finally {
      unsubscribe();
    }

    await expect(getSessionToken()).resolves.toBe("account-b-token");
    expect(values.get("dayframe.localSessionToken.v2")).toBe("account-b-token");
    expect(nativeModule.clearRuntimeContext).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not publish sign-out when a replacement login starts during invalidation", async () => {
    await setSessionToken("account-a-token");
    let finishDelete: (() => void) | undefined;
    secureStore.deleteItemAsync.mockImplementation((key: string) => {
      if (key !== "dayframe.localSessionToken.v2") {
        values.delete(key);
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        finishDelete = () => {
          values.delete(key);
          resolve();
        };
      });
    });
    const listener = vi.fn();
    const unsubscribe = subscribeMobileSignedOut(listener);

    try {
      const staleInvalidation = invalidateMobileSessionIfCurrent("account-a-token");
      await vi.waitFor(() => expect(finishDelete).toBeTypeOf("function"));
      const replacementLogin = setSessionToken("account-b-token");
      finishDelete?.();

      await expect(staleInvalidation).resolves.toBe(false);
      await replacementLogin;
    } finally {
      unsubscribe();
    }

    await expect(getSessionToken()).resolves.toBe("account-b-token");
    expect(values.get("dayframe.localSessionToken.v2")).toBe("account-b-token");
    expect(nativeModule.clearRuntimeContext).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not clear replacement native context when login starts during native invalidation", async () => {
    await setSessionToken("account-a-token");
    let finishNativeClear: (() => void) | undefined;
    nativeModule.clearRuntimeContextIfToken.mockImplementationOnce((token: string) =>
      new Promise<boolean>((resolve) => {
        finishNativeClear = () => {
          if (nativeRuntimeToken === token) nativeRuntimeToken = null;
          resolve(true);
        };
      })
    );
    const listener = vi.fn();
    const unsubscribe = subscribeMobileSignedOut(listener);

    try {
      const staleInvalidation = invalidateMobileSessionIfCurrent("account-a-token");
      await vi.waitFor(() => expect(finishNativeClear).toBeTypeOf("function"));
      const replacementLogin = setSessionToken("account-b-token");
      finishNativeClear?.();

      await expect(staleInvalidation).resolves.toBe(false);
      await replacementLogin;
    } finally {
      unsubscribe();
    }

    await expect(getSessionToken()).resolves.toBe("account-b-token");
    expect(nativeRuntimeToken).toBe("account-b-token");
    expect(nativeModule.clearRuntimeContextIfToken).toHaveBeenCalledWith("account-a-token");
    expect(listener).not.toHaveBeenCalled();
  });

  it("invalidates and publishes sign-out when the rejected bearer is still current", async () => {
    await setSessionToken("expired-token");
    const listener = vi.fn();
    const unsubscribe = subscribeMobileSignedOut(listener);

    try {
      await expect(invalidateMobileSessionIfCurrent("expired-token")).resolves.toBe(true);
    } finally {
      unsubscribe();
    }

    await expect(getSessionToken()).resolves.toBeNull();
    expect(values.size).toBe(0);
    expect(nativeModule.clearRuntimeContextIfToken).toHaveBeenCalledOnce();
    expect(nativeModule.clearRuntimeContextIfToken).toHaveBeenCalledWith("expired-token");
    expect(nativeModule.clearRuntimeContext).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
  });
});
