import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLocationSync } from "./network";

describe("location sync network boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts and rejects a stalled request at the configured deadline", async () => {
    const requestSignals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_input, init: RequestInit | undefined) => {
      requestSignals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    }));

    const request = fetchLocationSync("https://dayframe.test/api/location/evidence", {}, 100);
    const rejection = expect(request).rejects.toThrow("Location sync request timed out.");
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(requestSignals[0]?.aborted).toBe(true);
  });

  it("clears the deadline after a successful response", async () => {
    const response = { ok: true } as Response;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));

    await expect(fetchLocationSync("https://dayframe.test/api/location/replay", {}, 100))
      .resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });
});
