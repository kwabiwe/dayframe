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

describe("Location error-body extraction",()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it("consumes a 503 JSON body once and extracts only safe data",async()=>{
    const response=new Response(JSON.stringify({code:"location_processing_busy",phase:"effect",locationStage:"evidence_read",raw:"secret"}),{status:503});
    const json=vi.spyOn(response,"json");vi.stubGlobal("fetch",vi.fn(async()=>response));
    const {body}=await fetchLocationSync("https://dayframe.test/api/location/replay",{});
    const {locationResponseDiagnostics,LocationHttpResponseError}=await import("./network");
    const {MobileHttpResponseError}=await import("../mobile-network");
    const details=locationResponseDiagnostics("replay",response,body);
    expect(json).toHaveBeenCalledTimes(1);expect(JSON.stringify(details)).not.toContain("secret");
    expect(new LocationHttpResponseError(details)).toBeInstanceOf(MobileHttpResponseError);
  });
  it.each(["", "<html>private</html>"])("retains status from malformed 503 bodies",async(body)=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(body,{status:503})));
    const result=await fetchLocationSync("https://dayframe.test/api/location/evidence",{});
    const {locationResponseDiagnostics}=await import("./network");
    expect(locationResponseDiagnostics("evidence",result.response,result.body)).toMatchObject({httpStatus:503,code:"location_sync_failed"});
  });
});
