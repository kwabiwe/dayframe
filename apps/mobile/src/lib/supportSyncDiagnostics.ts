import type { QueuedEvent } from "./api";

/** Routine support output is an allowlist. Detailed Health source exports remain separate. */
export function supportQueueDiagnostics(queue: readonly QueuedEvent[]) {
  return queue.map((item) => ({
    clientEventId: item.localId,
    source: item.source,
    type: item.type,
    queuedAt: item.queuedAt,
    attemptCount: item.failureCount ?? 0,
    lastAttemptedAt: item.lastAttemptedAt ?? null,
    nextRetryAt: item.nextRetryAt ?? null,
    failureKind: item.failureKind ?? null,
    lastHttpStatus: item.lastStatusCode ?? null
  }));
}
