// Which queued events the server has refused for good: Sync help lists them under "Couldn't be sent",
// sync no longer resends them on its own, and the Dashboard does not project them (Codex r1 on #578).
// Pure, so the projection can share it without loading the queue module.

/** HTTP answers that mean the server will never accept the event as it is. */
export const permanentStatusCodes: ReadonlySet<number> = new Set([400, 413, 422]);

export function isPermanentlyFailedQueuedEvent(item: {
  failureKind?: string;
  failedAt?: string;
  lastStatusCode?: number;
}) {
  return (
    item.failureKind === "permanent" ||
    Boolean(item.failedAt && item.lastStatusCode && permanentStatusCodes.has(item.lastStatusCode))
  );
}
