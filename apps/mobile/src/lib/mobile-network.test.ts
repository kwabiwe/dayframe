import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  invalidateMobileSessionIfCurrent: vi.fn(() => Promise.resolve(true))
}));

vi.mock("./secure-session", () => ({
  invalidateMobileSessionIfCurrent: session.invalidateMobileSessionIfCurrent
}));

const { mobileFetch, StaleMobileSessionResponseError } = await import("./mobile-network");

describe("mobile API network boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    session.invalidateMobileSessionIfCurrent.mockResolvedValue(true);
  });

  it("omits shared cookies even when a caller requests credentials", async () => {
    const response = { ok: true } as Response;
    const fetchMock = vi.fn(() => Promise.resolve(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(mobileFetch("https://dayframe.test/api/bootstrap", {
      headers: { Authorization: "Bearer session-token" },
      credentials: "include"
    })).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/bootstrap",
      {
        headers: { Authorization: "Bearer session-token" },
        credentials: "omit"
      }
    );
  });

  it("invalidates only the bearer rejected by an authentication response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 401 } as Response)));

    await mobileFetch("https://dayframe.test/api/bootstrap", {
      headers: { Authorization: "Bearer rejected-token" }
    });

    expect(session.invalidateMobileSessionIfCurrent).toHaveBeenCalledWith("rejected-token");
  });

  it("rejects a stale authentication response without invalidating a replacement login", async () => {
    session.invalidateMobileSessionIfCurrent.mockResolvedValueOnce(false);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 401 } as Response)));

    await expect(mobileFetch("https://dayframe.test/api/bootstrap", {
      headers: { Authorization: "Bearer old-token" }
    })).rejects.toBeInstanceOf(StaleMobileSessionResponseError);
  });
});
