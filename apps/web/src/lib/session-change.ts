// Work held in the page for Undo (Review decisions) must reach the server under the session that
// made it. Switching workspace or logging out first lets each holder save, bounded so a slow
// network never blocks the change for long.

type Flusher = () => Promise<void>;

const flushers = new Set<Flusher>();
export const SESSION_CHANGE_FLUSH_TIMEOUT_MS = 8_000;

export function onBeforeSessionChange(flusher: Flusher) {
  flushers.add(flusher);
  return () => {
    flushers.delete(flusher);
  };
}

// The change's own request failed, so this session goes on: holders that fenced it re-open.
const failureListeners = new Set<() => void>();
export function onSessionChangeFailed(listener: () => void) {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

/** Sends the session-changing request; a failure (an error status or no answer) re-opens this session. */
export async function sessionChangeRequest(send: () => Promise<Response>) {
  const response = await send().catch((error: unknown) => {
    failureListeners.forEach((listener) => listener());
    throw error;
  });
  if (!response.ok) failureListeners.forEach((listener) => listener());
  return response;
}

export async function beforeSessionChange(timeoutMs = SESSION_CHANGE_FLUSH_TIMEOUT_MS) {
  if (!flushers.size) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([...flushers].map((flusher) => flusher())),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    })
  ]);
  clearTimeout(timer);
}
