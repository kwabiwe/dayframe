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
