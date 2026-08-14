import { afterEach, describe, expect, it, vi } from "vitest";
import { mobileFetch } from "./mobile-network";

describe("mobile API network boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
