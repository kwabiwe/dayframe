import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

const fetchLocationReviewEvidence = vi.hoisted(() => vi.fn());
const cacheLocationReviewEvidence = vi.hoisted(() =>
  vi.fn((_input?: { fetchedAt?: string }) => Promise.resolve(true))
);
const removeCachedLocationReviewEvidenceIfUnchanged = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(true))
);
const getActiveReviewAccountIdentity = vi.hoisted(() => vi.fn(() => Promise.resolve({
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  workspaceName: "Personal"
})));
const getLocationReviewEvidenceCacheDiagnostics = vi.hoisted(() => vi.fn(() => Promise.resolve({
  itemCount: 0,
  totalBytes: 0,
  oldestFetchedAt: null,
  newestFetchedAt: null
})));
const loadCachedLocationReviewEvidence = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({ fetchLocationReviewEvidence }));
vi.mock("./reviewSyncStore", () => ({
  LOCATION_REVIEW_EVIDENCE_MAX_ITEMS: 25,
  cacheLocationReviewEvidence,
  getActiveReviewAccountIdentity,
  getLocationReviewEvidenceCacheDiagnostics,
  loadCachedLocationReviewEvidence,
  removeCachedLocationReviewEvidenceIfUnchanged
}));

const {
  createLocationReviewEvidencePrefetcher,
  getLocationReviewEvidencePrefetchDiagnostics,
  readLocationReviewEvidence,
  revalidateLocationReviewEvidence
} = await import("./locationReviewEvidenceCache");

const owner = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001"
};

describe("Location Review evidence cache orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheLocationReviewEvidence.mockResolvedValue(true);
    removeCachedLocationReviewEvidenceIfUnchanged.mockResolvedValue(true);
    getActiveReviewAccountIdentity.mockResolvedValue({
      ...owner,
      workspaceName: "Personal"
    });
    getLocationReviewEvidenceCacheDiagnostics.mockResolvedValue({
      itemCount: 0,
      totalBytes: 0,
      oldestFetchedAt: null,
      newestFetchedAt: null
    });
    loadCachedLocationReviewEvidence.mockResolvedValue(null);
  });

  it("does not report a cancelled sync when prefetch was stopped without an attempt", () => {
    const before=getLocationReviewEvidencePrefetchDiagnostics();
    createLocationReviewEvidencePrefetcher().stop();
    expect(getLocationReviewEvidencePrefetchDiagnostics().stopped).toBe(before.stopped);
  });

  it("returns a fresh cache hit without starting a network request", async () => {
    const evidence = evidenceFixture();
    loadCachedLocationReviewEvidence.mockResolvedValue({
      evidence,
      fetchedAt: "2026-08-20T10:00:00.000Z",
      expiresAt: "2026-08-21T10:00:00.000Z"
    });

    await expect(readLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId
    })).resolves.toEqual({
      evidence,
      source: "cache",
      cachedAt: "2026-08-20T10:00:00.000Z"
    });
    expect(fetchLocationReviewEvidence).not.toHaveBeenCalled();
  });

  it("deduplicates a user request with prefetch and writes one cache row", async () => {
    const evidence = evidenceFixture();
    let resolveFetch: ((value: LocationReviewEvidenceDto) => void) | undefined;
    fetchLocationReviewEvidence.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const first = revalidateLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId
    });
    const second = revalidateLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId
    });
    resolveFetch?.(evidence);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ evidence, source: "network" }),
      expect.objectContaining({ evidence, source: "network" })
    ]);
    expect(fetchLocationReviewEvidence).toHaveBeenCalledTimes(1);
    expect(cacheLocationReviewEvidence).toHaveBeenCalledTimes(1);
  });

  it("uses the network when no fresh cache row exists", async () => {
    const evidence = evidenceFixture();
    fetchLocationReviewEvidence.mockResolvedValue(evidence);

    await expect(readLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId
    })).resolves.toMatchObject({ evidence, source: "network" });
    expect(fetchLocationReviewEvidence).toHaveBeenCalledOnce();
  });

  it("never shares an in-flight request across account owners", async () => {
    const evidence = evidenceFixture();
    const otherOwner = {
      workspaceId: "30000000-0000-4000-8000-000000000001",
      userId: "40000000-0000-4000-8000-000000000001"
    };
    getActiveReviewAccountIdentity.mockResolvedValue({
      ...otherOwner,
      workspaceName: "Other"
    });
    fetchLocationReviewEvidence.mockResolvedValue(evidence);

    const oldAccountRequest = revalidateLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId
    });
    const currentAccountRequest = revalidateLocationReviewEvidence({
      ...otherOwner,
      reviewItemId: evidence.reviewItemId
    });

    await expect(oldAccountRequest).rejects.toThrow("active Dayframe account changed");
    await expect(currentAccountRequest).resolves.toMatchObject({
      evidence,
      source: "network"
    });
    expect(fetchLocationReviewEvidence).toHaveBeenCalledTimes(2);
  });

  it("does not cache or return a response after its owner cancels", async () => {
    const evidence = evidenceFixture();
    let resolveFetch: ((value: LocationReviewEvidenceDto) => void) | undefined;
    fetchLocationReviewEvidence.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const controller = new AbortController();
    const request = revalidateLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId,
      signal: controller.signal
    });

    controller.abort(new Error("Route exited."));
    await expect(request).rejects.toThrow("Route exited.");
    resolveFetch?.(evidence);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(cacheLocationReviewEvidence).not.toHaveBeenCalled();
  });

  it("cancels the owned fetch and lets immediate re-entry create a replacement", async () => {
    const evidence = evidenceFixture();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const cancellation = new Error("Route exited.");
    fetchLocationReviewEvidence
      .mockImplementationOnce((
        _reviewItemId: string,
        options: { signal?: AbortSignal } = {}
      ) => new Promise<LocationReviewEvidenceDto>((_resolve, reject) => {
        const signal = options.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true
        });
      }))
      .mockResolvedValueOnce(evidence);

    const first = revalidateLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId,
      signal: firstController.signal
    });
    const firstRejection = expect(first).rejects.toBe(cancellation);
    expect(fetchLocationReviewEvidence).toHaveBeenNthCalledWith(
      1,
      evidence.reviewItemId,
      { signal: expect.any(AbortSignal) }
    );

    firstController.abort(cancellation);
    const reopened = revalidateLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId,
      signal: secondController.signal
    });

    await firstRejection;
    await expect(reopened).resolves.toMatchObject({
      evidence,
      source: "network"
    });
    expect(fetchLocationReviewEvidence).toHaveBeenNthCalledWith(
      2,
      evidence.reviewItemId,
      { signal: expect.any(AbortSignal) }
    );
    expect(cacheLocationReviewEvidence).toHaveBeenCalledOnce();
  });

  it("keeps a visible consumer usable when presentation prefetch cancels", async () => {
    const evidence=evidenceFixture();let finish!:(value:LocationReviewEvidenceDto)=>void;
    fetchLocationReviewEvidence.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const prefetchController=new AbortController();
    const prefetch=revalidateLocationReviewEvidence({...owner,reviewItemId:evidence.reviewItemId,signal:prefetchController.signal});
    const visible=revalidateLocationReviewEvidence({...owner,reviewItemId:evidence.reviewItemId});
    const cancelled=expect(prefetch).rejects.toThrow();prefetchController.abort();await cancelled;
    expect(fetchLocationReviewEvidence.mock.calls[0][1].signal.aborted).toBe(false);
    finish(evidence);await expect(visible).resolves.toMatchObject({evidence,source:"network"});
    expect(fetchLocationReviewEvidence).toHaveBeenCalledOnce();expect(cacheLocationReviewEvidence).toHaveBeenCalledOnce();
  });
  it("removes a late write when the last consumer cancels during persistence", async () => {
    const evidence=evidenceFixture();let finish!:()=>void;
    fetchLocationReviewEvidence.mockResolvedValueOnce(evidence);
    cacheLocationReviewEvidence.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve(true);}));
    const controller=new AbortController();const read=revalidateLocationReviewEvidence({...owner,reviewItemId:evidence.reviewItemId,signal:controller.signal});
    const cancelled=expect(read).rejects.toThrow();
    await vi.waitFor(()=>expect(finish).toBeTypeOf("function"));controller.abort();await cancelled;finish();
    await vi.waitFor(()=>expect(removeCachedLocationReviewEvidenceIfUnchanged).toHaveBeenCalledOnce());
  });
  it("rejects a response when the active account changed before caching", async () => {
    const evidence = evidenceFixture();
    fetchLocationReviewEvidence.mockResolvedValue(evidence);
    getActiveReviewAccountIdentity.mockResolvedValue({
      workspaceId: "30000000-0000-4000-8000-000000000001",
      userId: "40000000-0000-4000-8000-000000000001",
      workspaceName: "Other"
    });

    await expect(revalidateLocationReviewEvidence({
      ...owner,
      reviewItemId: evidence.reviewItemId
    })).rejects.toThrow("active Dayframe account changed");
  });

  it("stops prefetch on its first failure and a later start can retry", async () => {
    const evidence = evidenceFixture();
    const prefetcher = createLocationReviewEvidencePrefetcher();
    const attemptedBefore = getLocationReviewEvidencePrefetchDiagnostics().attempted;
    fetchLocationReviewEvidence.mockRejectedValueOnce(new Error("offline"));

    prefetcher.start({
      ...owner,
      reviewItemIds: [evidence.reviewItemId, "70000000-0000-4000-8000-000000000001"],
      initialDelayMilliseconds: 0,
      yieldMilliseconds: 0
    });
    await vi.waitFor(() => {
      expect(getLocationReviewEvidencePrefetchDiagnostics().lastOutcome).toBe("failed");
    });
    expect(fetchLocationReviewEvidence).toHaveBeenCalledTimes(1);

    fetchLocationReviewEvidence.mockResolvedValue(evidence);
    prefetcher.start({
      ...owner,
      reviewItemIds: [evidence.reviewItemId],
      initialDelayMilliseconds: 0,
      yieldMilliseconds: 0
    });
    await vi.waitFor(() => {
      expect(getLocationReviewEvidencePrefetchDiagnostics().lastOutcome).toBe("complete");
    });
    expect(fetchLocationReviewEvidence).toHaveBeenCalledTimes(2);
    expect(getLocationReviewEvidencePrefetchDiagnostics().attempted).toBe(
      attemptedBefore + 2
    );
  });

  it("does not prefetch another payload after the account cache reaches its cap", async () => {
    const prefetcher = createLocationReviewEvidencePrefetcher();
    getLocationReviewEvidenceCacheDiagnostics.mockResolvedValue({
      itemCount: 25,
      totalBytes: 1024,
      oldestFetchedAt: null,
      newestFetchedAt: null
    });

    prefetcher.start({
      ...owner,
      reviewItemIds: [evidenceFixture().reviewItemId],
      initialDelayMilliseconds: 0,
      yieldMilliseconds: 0
    });
    await vi.waitFor(() => {
      expect(getLocationReviewEvidencePrefetchDiagnostics().lastOutcome).toBe("complete");
    });
    expect(fetchLocationReviewEvidence).not.toHaveBeenCalled();
  });
});

function evidenceFixture(): LocationReviewEvidenceDto {
  return {
    reviewItemId: "50000000-0000-4000-8000-000000000001",
    eventId: "60000000-0000-4000-8000-000000000001",
    segment: {
      id: "segment-1",
      kind: "commute",
      status: "finalised",
      startedAt: "2026-08-20T08:00:00.000Z",
      stoppedAt: "2026-08-20T08:30:00.000Z",
      confidence: "high",
      continuityStatus: "continuous",
      algorithmVersion: "location-v2.0",
      evidenceCount: 2,
      rejectedEvidenceCount: 0
    },
    display: {
      title: "Commute",
      subtitle: null,
      placeId: null,
      placeName: null,
      addressSummary: null
    },
    map: {
      centre: null,
      stayRadiusMeters: null,
      route: {
        type: "LineString",
        coordinates: [[-0.1, 51.5], [-0.2, 51.6]]
      },
      straightLineFallback: null,
      acceptedSamples: [],
      rejectedSamples: [],
      anchors: [],
      gaps: [],
      nearbySavedPlaces: []
    },
    suggestedSplitPoints: [],
    evidenceExpiresAt: "2026-08-21T08:30:00.000Z",
    evidenceExpired: false,
    rawEvidenceAvailable: true,
    textualSummary: "Private route evidence."
  };
}
