import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../secure-session", () => ({
  invalidateMobileSessionIfCurrent: vi.fn(() => Promise.resolve(true))
}));

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
    expect(fetch).toHaveBeenCalledWith(
      "https://dayframe.test/api/location/evidence",
      expect.objectContaining({ credentials: "omit" })
    );
  });

  it("clears the deadline after a successful response", async () => {
    const body = {ok:true,replayVersion:"v2",rolloutMode:"v2_shadow",clientAcknowledgedMode:false,finalisedSegmentCount:0,semanticSegmentCount:0,warnings:[]};
    const response = { ok: true, json:async()=>body } as Response;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));

    await expect(fetchLocationSync("https://dayframe.test/api/location/replay", {}, 100))
      .resolves.toEqual({response,body});
    expect(fetch).toHaveBeenCalledWith(
      "https://dayframe.test/api/location/replay",
      expect.objectContaining({ credentials: "omit" })
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
