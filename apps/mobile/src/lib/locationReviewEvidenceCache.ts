import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import { fetchLocationReviewEvidence } from "./api";
import {
  LOCATION_REVIEW_EVIDENCE_MAX_ITEMS,
  cacheLocationReviewEvidence,
  getActiveReviewAccountIdentity,
  getLocationReviewEvidenceCacheDiagnostics,
  loadCachedLocationReviewEvidence,
  removeCachedLocationReviewEvidenceIfUnchanged
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
  idleStopped: number;
  lastOutcome: "idle" | "running" | "complete" | "cancelled" | "failed";
};

type InFlightEvidenceRequest = {
  networkPromise: Promise<LocationReviewEvidenceDto>;
  cachePromise: Promise<string> | null;
  valid: boolean;
  consumerCount: number;
  invalidate: () => void;
  release: () => void;
};

const inFlightEvidenceRequests = new Map<string, InFlightEvidenceRequest>();
let lastEvidenceCacheWriteMilliseconds = Number.NEGATIVE_INFINITY;
const EMPTY_PREFETCH_DIAGNOSTICS: PrefetchDiagnostics = {
  attempted: 0,
  completed: 0,
  stopped: 0,
  idleStopped: 0,
  lastOutcome: "idle"
};
let prefetchDiagnostics: PrefetchDiagnostics = { ...EMPTY_PREFETCH_DIAGNOSTICS };
// The account the prefetch counters describe: they start over when a prefetch starts for another
// one, and a run for an earlier account never adds to them (Codex r6 on #355).
let prefetchDiagnosticsOwnerKey: string | null = null;
const prefetchOwnerKey = (owner: { workspaceId: string; userId: string }) => `${owner.workspaceId}:${owner.userId}`;

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
  input: EvidenceOwner,
  /**
   * `fresh`: never join a read already under way, which may have begun before the suggestion changed; that
   * read is superseded (card B part 2, Codex r2 on #600).
   */
  options: { fresh?: boolean } = {}
): Promise<LocationReviewEvidenceReadResult> {
  throwIfAborted(input.signal);
  if (options.fresh) inFlightEvidenceRequests.get(`${input.workspaceId}:${input.userId}:${input.reviewItemId}`)?.invalidate();
  const {request,release} = networkLocationReviewEvidence(input);
  try {
    const evidence = await awaitWithAbort(
      request.networkPromise,
      input.signal
    );
    throwIfAborted(input.signal);
    throwIfRequestIsNotCurrent(input, request);
    request.cachePromise ??= cacheNetworkEvidence(input, evidence, request);
    const fetchedAt = await awaitWithAbort(request.cachePromise, input.signal);
    throwIfAborted(input.signal);
    throwIfRequestIsNotCurrent(input, request);
    return {
      evidence,
      source: "network",
      cachedAt: fetchedAt
    };
  } finally {
    release();
  }
}

export function createLocationReviewEvidencePrefetcher() {
  let generation = 0;
  let controller: AbortController | null = null;
  let attemptedForRun=false;
  let runOwnerKey: string | null = null;

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
      attemptedForRun=false;
      const signal = controller.signal;
      const ownerKey = prefetchOwnerKey(input);
      if (prefetchDiagnosticsOwnerKey !== ownerKey) {
        prefetchDiagnostics = { ...EMPTY_PREFETCH_DIAGNOSTICS };
        prefetchDiagnosticsOwnerKey = ownerKey;
      }
      runOwnerKey = ownerKey;
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
        onAttempt:()=>{attemptedForRun=true;},
        isCurrent: () => generation === ownerGeneration
      }).then((outcome) => {
        if (generation !== ownerGeneration) return;
        controller=null;
        if (prefetchDiagnosticsOwnerKey !== ownerKey) return;
        prefetchDiagnostics = {
          ...prefetchDiagnostics,
          lastOutcome: outcome
        };
      });
    },
    stop() {
      generation += 1;
      const cancelled=Boolean(controller && attemptedForRun);
      controller?.abort();
      controller = null;
      if (runOwnerKey !== null && runOwnerKey !== prefetchDiagnosticsOwnerKey) return;
      prefetchDiagnostics = {
        ...prefetchDiagnostics,
        stopped: prefetchDiagnostics.stopped + (cancelled?1:0),
        idleStopped: prefetchDiagnostics.idleStopped + (cancelled?0:1),
        lastOutcome: cancelled?"cancelled":"idle"
      };
    }
  };
}

/** With `owner`, the counters only when they describe that account (empty otherwise). */
export function getLocationReviewEvidencePrefetchDiagnostics(owner?: { workspaceId: string; userId: string }) {
  if (owner && prefetchDiagnosticsOwnerKey !== prefetchOwnerKey(owner)) return { ...EMPTY_PREFETCH_DIAGNOSTICS };
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
  onAttempt:()=>void;
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
      input.onAttempt();
      if (prefetchDiagnosticsOwnerKey === prefetchOwnerKey(input)) {
        prefetchDiagnostics = {
          ...prefetchDiagnostics,
          attempted: prefetchDiagnostics.attempted + 1
        };
      }
      await revalidateLocationReviewEvidence({
        reviewItemId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        signal: input.signal
      });
      if (prefetchDiagnosticsOwnerKey === prefetchOwnerKey(input)) {
        prefetchDiagnostics = {
          ...prefetchDiagnostics,
          completed: prefetchDiagnostics.completed + 1
        };
      }
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
    const transportController=new AbortController();
    const clearIfCurrent = () => {
      if (inFlightEvidenceRequests.get(key) === nextRequest) {
        inFlightEvidenceRequests.delete(key);
      }
    };
    const invalidate = () => {
      nextRequest.valid = false;
      transportController.abort();
      clearIfCurrent();
    };
    const release = () => {
      nextRequest.consumerCount = Math.max(0, nextRequest.consumerCount - 1);
      if (nextRequest.consumerCount === 0) invalidate();
    };
    const networkPromise = fetchLocationReviewEvidence(input.reviewItemId, {
      signal: transportController.signal,
      // Read under the account it is cached for, never whichever session is current (Codex r3 on #522).
      owner: { userId: input.userId, workspaceId: input.workspaceId }
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
      });
    nextRequest = {
      networkPromise,
      cachePromise: null,
      valid: true,
      consumerCount: 0,
      invalidate,
      release
    };
    request = nextRequest;
    inFlightEvidenceRequests.set(key, request);
  }
  request.consumerCount += 1;
  const held=request;
  let released=false;
  const release=()=>{
    if(released)return;
    released=true;
    input.signal?.removeEventListener("abort",release);
    held.release();
  };
  input.signal?.addEventListener("abort",release,{once:true});
  return {request:held,release};
}

async function cacheNetworkEvidence(
  input: EvidenceOwner,
  evidence: LocationReviewEvidenceDto,
  request: InFlightEvidenceRequest
) {
  const key = `${input.workspaceId}:${input.userId}:${input.reviewItemId}`;
  throwIfRequestIsNotCurrent(input, request);
  const fetchedAt = nextEvidenceCacheWriteAt();
  let written = false;
  let completed = false;
  try {
    written = await cacheLocationReviewEvidence({
      expectedWorkspaceId: input.workspaceId,
      expectedUserId: input.userId,
      reviewItemId: input.reviewItemId,
      evidence,
      fetchedAt,
      isStillCurrent: () => request.valid &&
        inFlightEvidenceRequests.get(key) === request
    });
    throwIfRequestIsNotCurrent(input, request);
    const activeOwner = await getActiveReviewAccountIdentity();
    if (
      activeOwner?.workspaceId !== input.workspaceId ||
      activeOwner.userId !== input.userId
    ) {
      throw new Error("The active Dayframe account changed.");
    }
    throwIfRequestIsNotCurrent(input, request);
    completed = true;
    return fetchedAt;
  } catch (error) {
    if (written) {
      await removeCachedLocationReviewEvidenceIfUnchanged({
        expectedWorkspaceId: input.workspaceId,
        expectedUserId: input.userId,
        reviewItemId: input.reviewItemId,
        evidence,
        fetchedAt
      });
    }
    throw error;
  } finally {
    if (!completed) request.invalidate();
  }
}

function nextEvidenceCacheWriteAt() {
  const milliseconds = Math.max(
    Date.now(),
    lastEvidenceCacheWriteMilliseconds + 1
  );
  lastEvidenceCacheWriteMilliseconds = milliseconds;
  return new Date(milliseconds).toISOString();
}

function throwIfRequestIsNotCurrent(
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
