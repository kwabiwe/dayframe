import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { fetchLocationReviewEvidence } from "./api";
import {
  LOCATION_REVIEW_EVIDENCE_MAX_ITEMS,
  cacheLocationReviewEvidence,
  getActiveReviewAccountIdentity,
  getLocationReviewEvidenceCacheDiagnostics,
  loadCachedLocationReviewEvidence
} from "./reviewSyncStore";

type EvidenceOwner = {
  reviewItemId: string;
  workspaceId: string;
  userId: string;
  signal?: AbortSignal;
};

export type LocationReviewEvidenceReadResult = {
  evidence: LocationReviewEvidenceDto;
  source: "cache" | "network";
  cachedAt: string | null;
};

type PrefetchDiagnostics = {
  attempted: number;
  completed: number;
  stopped: number;
  lastOutcome: "idle" | "running" | "complete" | "cancelled" | "failed";
};

type InFlightEvidenceRequest = {
  networkPromise: Promise<LocationReviewEvidenceDto>;
  cachePromise: Promise<string> | null;
  valid: boolean;
};

const inFlightEvidenceRequests = new Map<string, InFlightEvidenceRequest>();
let prefetchDiagnostics: PrefetchDiagnostics = {
  attempted: 0,
  completed: 0,
  stopped: 0,
  lastOutcome: "idle"
};

export async function readLocationReviewEvidence(
  input: EvidenceOwner
): Promise<LocationReviewEvidenceReadResult> {
  throwIfAborted(input.signal);
  const cached = await loadCachedLocationReviewEvidence(input.reviewItemId);
  throwIfAborted(input.signal);
  if (cached) {
    return {
      evidence: cached.evidence,
      source: "cache",
      cachedAt: cached.fetchedAt
    };
  }
  return revalidateLocationReviewEvidence(input);
}

export async function revalidateLocationReviewEvidence(
  input: EvidenceOwner
): Promise<LocationReviewEvidenceReadResult> {
  throwIfAborted(input.signal);
  const request = networkLocationReviewEvidence(input);
  const evidence = await awaitWithAbort(
    request.networkPromise,
    input.signal
  );
  throwIfAborted(input.signal);
  throwIfRequestCannotPersist(input, request);
  request.cachePromise ??= cacheNetworkEvidence(input, evidence, request);
  const fetchedAt = await awaitWithAbort(request.cachePromise, input.signal);
  throwIfAborted(input.signal);
  return {
    evidence,
    source: "network",
    cachedAt: fetchedAt
  };
}

export function createLocationReviewEvidencePrefetcher() {
  let generation = 0;
  let controller: AbortController | null = null;

  return {
    start(input: {
      reviewItemIds: string[];
      workspaceId: string;
      userId: string;
      initialDelayMilliseconds?: number;
      yieldMilliseconds?: number;
    }) {
      generation += 1;
      const ownerGeneration = generation;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      prefetchDiagnostics = {
        ...prefetchDiagnostics,
        lastOutcome: "running"
      };
      void runPrefetch({
        ...input,
        reviewItemIds: input.reviewItemIds.slice(
          0,
          LOCATION_REVIEW_EVIDENCE_MAX_ITEMS
        ),
        signal,
        isCurrent: () => generation === ownerGeneration
      }).then((outcome) => {
        if (generation !== ownerGeneration) return;
        prefetchDiagnostics = {
          ...prefetchDiagnostics,
          lastOutcome: outcome
        };
      });
    },
    stop() {
      generation += 1;
      controller?.abort();
      controller = null;
      prefetchDiagnostics = {
        ...prefetchDiagnostics,
        stopped: prefetchDiagnostics.stopped + 1,
        lastOutcome: "cancelled"
      };
    }
  };
}

export function getLocationReviewEvidencePrefetchDiagnostics() {
  return { ...prefetchDiagnostics };
}

async function runPrefetch(input: {
  reviewItemIds: string[];
  workspaceId: string;
  userId: string;
  initialDelayMilliseconds?: number;
  yieldMilliseconds?: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
}): Promise<PrefetchDiagnostics["lastOutcome"]> {
  try {
    await delay(input.initialDelayMilliseconds ?? 300, input.signal);
    for (const reviewItemId of input.reviewItemIds) {
      if (!input.isCurrent()) return "cancelled";
      throwIfAborted(input.signal);
      const cached = await loadCachedLocationReviewEvidence(reviewItemId);
      throwIfAborted(input.signal);
      if (cached) continue;
      const cacheDiagnostics = await getLocationReviewEvidenceCacheDiagnostics();
      throwIfAborted(input.signal);
      if (cacheDiagnostics.itemCount >= LOCATION_REVIEW_EVIDENCE_MAX_ITEMS) {
        return "complete";
      }
      prefetchDiagnostics = {
        ...prefetchDiagnostics,
        attempted: prefetchDiagnostics.attempted + 1
      };
      await revalidateLocationReviewEvidence({
        reviewItemId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        signal: input.signal
      });
      prefetchDiagnostics = {
        ...prefetchDiagnostics,
        completed: prefetchDiagnostics.completed + 1
      };
      await delay(input.yieldMilliseconds ?? 250, input.signal);
    }
    return "complete";
  } catch (error) {
    return input.signal.aborted || !input.isCurrent() || isAbortError(error)
      ? "cancelled"
      : "failed";
  }
}

function networkLocationReviewEvidence(input: EvidenceOwner) {
  const key = `${input.workspaceId}:${input.userId}:${input.reviewItemId}`;
  let request = inFlightEvidenceRequests.get(key);
  if (!request) {
    let nextRequest: InFlightEvidenceRequest;
    const clearIfCurrent = () => {
      if (inFlightEvidenceRequests.get(key) === nextRequest) {
        inFlightEvidenceRequests.delete(key);
      }
    };
    const invalidate = () => {
      nextRequest.valid = false;
      clearIfCurrent();
    };
    const ownerSignal = input.signal;
    const handleOwnerAbort = () => invalidate();
    ownerSignal?.addEventListener("abort", handleOwnerAbort, { once: true });
    const networkPromise = fetchLocationReviewEvidence(input.reviewItemId, {
      signal: ownerSignal
    })
      .then((evidence) => {
        setTimeout(() => {
          if (
            inFlightEvidenceRequests.get(key) === nextRequest &&
            !nextRequest.cachePromise
          ) {
            invalidate();
          }
        }, 0);
        return evidence;
      }, (error: unknown) => {
        invalidate();
        throw error;
      })
      .finally(() => {
        ownerSignal?.removeEventListener("abort", handleOwnerAbort);
      });
    nextRequest = { networkPromise, cachePromise: null, valid: true };
    request = nextRequest;
    inFlightEvidenceRequests.set(key, request);
  }
  return request;
}

async function cacheNetworkEvidence(
  input: EvidenceOwner,
  evidence: LocationReviewEvidenceDto,
  request: InFlightEvidenceRequest
) {
  const key = `${input.workspaceId}:${input.userId}:${input.reviewItemId}`;
  throwIfRequestCannotPersist(input, request);
  const fetchedAt = new Date().toISOString();
  try {
    await cacheLocationReviewEvidence({
      expectedWorkspaceId: input.workspaceId,
      expectedUserId: input.userId,
      reviewItemId: input.reviewItemId,
      evidence,
      fetchedAt
    });
    const activeOwner = await getActiveReviewAccountIdentity();
    if (
      activeOwner?.workspaceId !== input.workspaceId ||
      activeOwner.userId !== input.userId
    ) {
      throw new Error("The active Dayframe account changed.");
    }
    return fetchedAt;
  } finally {
    request.valid = false;
    if (inFlightEvidenceRequests.get(key) === request) {
      inFlightEvidenceRequests.delete(key);
    }
  }
}

function throwIfRequestCannotPersist(
  input: EvidenceOwner,
  request: InFlightEvidenceRequest
) {
  const key = `${input.workspaceId}:${input.userId}:${input.reviewItemId}`;
  if (!request.valid || inFlightEvidenceRequests.get(key) !== request) {
    throw new Error("Location evidence request was cancelled or superseded.");
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Location evidence request was cancelled.");
}

function isAbortError(error: unknown) {
  return error instanceof Error && /abort|cancel/i.test(error.message);
}
