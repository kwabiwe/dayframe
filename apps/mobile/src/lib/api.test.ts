import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => new Map<string, string>());
const asyncStore = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStore.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: vi.fn((key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  })
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    })
  }
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe.test"
}));

const {
  AuthRequiredError,
  createCategory,
  enqueueEvent,
  fetchBootstrap,
  getSessionToken,
  isNetworkTimerError,
  login,
  startTimer,
  signup,
  syncQueue
} = await import("./api");

describe("mobile API client", () => {
  beforeEach(() => {
    secureStore.clear();
    asyncStore.clear();
    vi.restoreAllMocks();
  });

  it("stores the Dayframe app session token after login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            token: "dayframe-token",
            user: { id: "user-1", email: "user@example.com", name: "User" },
            workspace: { id: "workspace-1", name: "Workspace" },
            expiresAt: "2026-08-01T00:00:00.000Z"
          })
        )
      )
    );

    const result = await login("user@example.com", "password");

    expect("token" in result ? result.token : null).toBe("dayframe-token");
    await expect(getSessionToken()).resolves.toBe("dayframe-token");
  });

  it("does not store a token for email-confirmation signup responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              requiresEmailConfirmation: true,
              message: "Check your email to confirm your account.",
              user: { id: "user-1", email: "user@example.com", name: "User" },
              workspace: { id: "workspace-1", name: "Workspace" }
            },
            202
          )
        )
      )
    );

    const result = await signup("user@example.com", "password", "User", "Workspace");

    expect("requiresEmailConfirmation" in result && result.requiresEmailConfirmation).toBe(true);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("clears the session token when bootstrap returns 401", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required" }, 401))));

    await expect(fetchBootstrap()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("preserves queue order when the first event fails to sync", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 1 } });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 2 } });
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Server error" }, 500)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.synced).toEqual([]);
    expect(result.remaining).toHaveLength(2);
    expect(result.remaining[0].rawPayload).toEqual({ order: 1 });
    expect(result.remaining[1].rawPayload).toEqual({ order: 2 });
  });

  it("removes synced events and preserves later unsynced events", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 1 } });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 2 } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ eventId: "event-1", duplicate: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(result.synced).toHaveLength(1);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].rawPayload).toEqual({ order: 2 });
  });

  it("starts timers with an optional category and no project", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await startTimer("20000000-0000-4000-8000-000000000001", "Write notes");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "start",
          source: "mobile_app",
          categoryId: "20000000-0000-4000-8000-000000000001",
          description: "Write notes"
        })
      })
    );
  });

  it("creates pinned categories through the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await createCategory("DIY", { isPinned: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/categories",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "DIY",
          color: "lime",
          isPinned: true
        })
      })
    );
  });

  it("recognizes network failures as timer-queue fallback candidates", () => {
    expect(isNetworkTimerError(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkTimerError(new Error("Timer action failed: 500"))).toBe(false);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
