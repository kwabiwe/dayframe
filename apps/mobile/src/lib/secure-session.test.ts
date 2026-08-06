import { beforeEach, describe, expect, it, vi } from "vitest";

const values = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));
const nativeModule = vi.hoisted(() => ({
  setRuntimeContext: vi.fn(),
  clearRuntimeContext: vi.fn()
}));

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
  clearSessionToken,
  getSessionToken,
  isKeychainInteractionUnavailable,
  setSessionToken
} = await import("./secure-session");

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
    nativeModule.setRuntimeContext.mockResolvedValue(true);
    nativeModule.clearRuntimeContext.mockResolvedValue(true);
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

  it("clears native context even when secure storage deletion fails", async () => {
    secureStore.deleteItemAsync.mockRejectedValueOnce(new Error("Keychain unavailable"));

    await expect(clearSessionToken()).rejects.toThrow("Keychain unavailable");
    expect(nativeModule.clearRuntimeContext).toHaveBeenCalledOnce();
  });
});
